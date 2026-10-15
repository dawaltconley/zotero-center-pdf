import {
  FULL_AREA,
  applyTransform,
  columnAt,
  columnRects,
  computeStops,
  stepFromIndex,
  stepFromPosition,
  type Area,
  type Rect,
  type Stop,
  type Transform,
} from './geometry';
import type { Settings } from './settings';
import pdfViewCss from './styles/pdf-view.scss';

const STYLE_ID = 'center-pdf-styles';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Zotero's internal PDFView (reader/src/pdf/pdf-view.js). */
export type PDFView = any;

type Dir = 1 | -1;

interface Target {
  pageIndex: number;
  index: number;
}

const NAV_KEYS = new Set(['PageDown', 'PageUp', ' ', 'Home', 'End']);

/**
 * Handles column-aware navigation for a single pdf.js view. Monkeypatches the
 * view's navigation methods and restores them on `destroy()`.
 */
export class Navigator {
  readonly view: PDFView;
  readonly #getSettings: () => Settings;
  readonly #log: (msg: string) => void;
  #restore: (() => void)[] = [];
  /** The stop we last scrolled to, and where the container actually ended up. */
  #last: (Target & { scrollTop: number; scrollLeft: number }) | null = null;

  constructor(
    view: PDFView,
    getSettings: () => Settings,
    log: (msg: string) => void,
  ) {
    this.view = view;
    this.#getSettings = getSettings;
    this.#log = log;
    this.#patch();
    this.#addStyles();
  }

  #addStyles() {
    const doc = this.document;
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = pdfViewCss;
    doc.head!.append(style);
    this.#restore.push(() => style.remove());
  }

  // The reader hands us its objects with Xray wrappers waived, so anything
  // reached through `view` is a raw page object that can't read objects
  // created here. Use Xray-wrapped DOM for all DOM work, and only exchange
  // primitives with the reader and pdf.js objects.

  /** The pdf.js iframe window, Xray-wrapped. */
  get window(): Window {
    return Components.utils.unwaiveXrays(this.view._iframeWindow);
  }

  get document(): Document {
    return this.window.document!;
  }

  get container(): HTMLElement {
    return this.document.getElementById('viewerContainer') as HTMLElement;
  }

  pageDiv(pageIndex: number): HTMLElement {
    return this.document.querySelector<HTMLElement>(
      `.pdfViewer .page[data-page-number="${pageIndex + 1}"]`,
    )!;
  }

  /** The raw pdf.js viewer: only read or assign primitive values on it. */
  get pdfViewer(): any {
    return this.view._iframeWindow.PDFViewerApplication.pdfViewer;
  }

  get active(): boolean {
    return this.#getSettings().mode !== 'off';
  }

  // --- hooks ---

  #patch() {
    const view = this.view;
    const original = {
      navigateToNextPage: view.navigateToNextPage,
      navigateToPreviousPage: view.navigateToPreviousPage,
      navigateToFirstPage: view.navigateToFirstPage,
      navigateToLastPage: view.navigateToLastPage,
      navigateBack: view.navigateBack,
      _onChangeViewStats: view._onChangeViewStats,
    };

    // Modifying functions defined at reader/src/pdf/pdf-view.js
    view.navigateToNextPage = () => {
      if (!this.active) return original.navigateToNextPage.call(view);
      view._onManualNavigation?.();
      this.go(1);
    };
    view.navigateToPreviousPage = () => {
      if (!this.active) return original.navigateToPreviousPage.call(view);
      view._onManualNavigation?.();
      this.go(-1);
    };
    view.navigateToFirstPage = () => {
      if (!this.active) return original.navigateToFirstPage.call(view);
      view._onManualNavigation?.();
      this.goToPage(0);
    };
    view.navigateToLastPage = () => {
      if (!this.active) return original.navigateToLastPage.call(view);
      view._onManualNavigation?.();
      this.goToPage(this.pdfViewer.pagesCount - 1);
    };
    view.navigateBack = () => {
      original.navigateBack.call(view);
      if (this.active) this.snap();
    };
    // keep the "next" button enabled while columns remain on the last page
    view._onChangeViewStats = (stats: any) => {
      if (this.active) {
        try {
          // write through any Xray wrapper so the reader sees the change
          const target = stats.wrappedJSObject ?? stats;
          target.canNavigateToNextPage = this.hasStep(1);
          target.canNavigateToPreviousPage = this.hasStep(-1);
        } catch {
          // fall back to the native values if the page isn't laid out yet
        }
      }
      return original._onChangeViewStats.call(view, stats);
    };

    // pdf.js handles these keys itself, bypassing the view methods above
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.active || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!NAV_KEYS.has(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.('input, textarea, select, [contenteditable]') ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Home') view.navigateToFirstPage();
      else if (e.key === 'End') view.navigateToLastPage();
      else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey))
        view.navigateToPreviousPage();
      else view.navigateToNextPage();
    };
    this.window.addEventListener('keydown', onKeyDown, true);

    this.#restore.push(() => {
      Object.assign(view, original);
      this.window?.removeEventListener('keydown', onKeyDown, true);
    });
  }

  destroy() {
    this.#restore.forEach((fn) => fn());
    this.#restore = [];
  }

  // --- geometry ---

  /** Content box of a page in page-local CSS px at scale 1. */
  pageArea(pageIndex: number, area: Area | null = this.#getSettings().area) {
    const pageView = this.pdfViewer.getPageView(pageIndex);
    const viewport = pageView.viewport;
    const [vx0, vy0, vx1, vy1] = viewport.viewBox as number[];
    const a = area ?? FULL_AREA;
    // Area fractions are measured from the top-left of the unrotated page.
    // Transform here rather than with viewport.convertToViewportRectangle:
    // reader code can't read arrays created in the plugin's scope.
    const transform = [...viewport.transform] as Transform;
    const [x0, y0] = applyTransform(
      [vx0 + a.x0 * (vx1 - vx0), vy1 - a.y0 * (vy1 - vy0)],
      transform,
    );
    const [x1, y1] = applyTransform(
      [vx0 + a.x1 * (vx1 - vx0), vy1 - a.y1 * (vy1 - vy0)],
      transform,
    );
    const scale = this.pdfViewer.currentScale;
    return {
      left: Math.min(x0, x1) / scale,
      top: Math.min(y0, y1) / scale,
      width: Math.abs(x1 - x0) / scale,
      height: Math.abs(y1 - y0) / scale,
    };
  }

  columns(pageIndex: number): Rect[] {
    return columnRects(this.pageArea(pageIndex), this.#getSettings().columns);
  }

  stops(pageIndex: number): Stop[] {
    const settings = this.#getSettings();
    if (settings.mode === 'off') return [];
    return computeStops(this.columns(pageIndex), this.viewSize(), {
      mode: settings.mode,
      columns: settings.columns,
      marginPx: settings.marginPx,
      overlapPct: settings.overlapPct,
    });
  }

  viewSize() {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
  }

  /** Position of a page's content box in the container's scroll coordinates. */
  pageOrigin(pageIndex: number) {
    const div = this.pageDiv(pageIndex);
    const container = this.container;
    const cr = container.getBoundingClientRect();
    const pr = div.getBoundingClientRect();
    return {
      left:
        pr.left -
        cr.left -
        container.clientLeft +
        container.scrollLeft +
        div.clientLeft,
      top:
        pr.top -
        cr.top -
        container.clientTop +
        container.scrollTop +
        div.clientTop,
    };
  }

  // --- navigation ---

  /** Where we are, relative to the stops of the current page. */
  #current(): { pageIndex: number; index: number | null; stops: Stop[] } & (
    { index: number } | { index: null; column: number; top: number }
  ) {
    const container = this.container;
    const last = this.#last;
    if (
      last &&
      Math.abs(container.scrollTop - last.scrollTop) <= 2 &&
      Math.abs(container.scrollLeft - last.scrollLeft) <= 2
    ) {
      const stops = this.stops(last.pageIndex);
      if (last.index < stops.length) {
        return { pageIndex: last.pageIndex, index: last.index, stops };
      }
    }
    const pageIndex = this.pdfViewer.currentPageNumber - 1;
    const stops = this.stops(pageIndex);
    const origin = this.pageOrigin(pageIndex);
    const scale = this.pdfViewer.currentScale;
    const { width } = this.viewSize();
    const centerX = (container.scrollLeft + width / 2 - origin.left) / scale;
    const top = (container.scrollTop - origin.top) / scale;
    return {
      pageIndex,
      index: null,
      stops,
      column: columnAt(this.columns(pageIndex), centerX),
      top,
    };
  }

  #findTarget(dir: Dir): Target | null {
    const mode = this.#getSettings().mode;
    if (mode === 'off') return null;
    const cur = this.#current();
    const index =
      cur.index !== null
        ? stepFromIndex(cur.stops, cur.index, dir)
        : stepFromPosition(
            cur.stops,
            { column: cur.column, top: cur.top },
            dir,
            mode,
          );
    if (index !== null) return { pageIndex: cur.pageIndex, index };
    const pageIndex = cur.pageIndex + dir;
    if (pageIndex < 0 || pageIndex >= this.pdfViewer.pagesCount) return null;
    const stops = this.stops(pageIndex);
    if (!stops.length) return null;
    return { pageIndex, index: dir === 1 ? 0 : stops.length - 1 };
  }

  hasStep(dir: Dir): boolean {
    if (this.#scrollsAcrossPages) return this.#scrollTarget(dir) !== null;
    return this.#findTarget(dir) !== null;
  }

  go(dir: Dir) {
    this.#ensureLayout();
    if (this.#scrollsAcrossPages) {
      this.#scroll(dir);
      return;
    }
    const target = this.#findTarget(dir);
    if (target) this.#apply(target);
  }

  /**
   * With a single column there's no reason to stop at page boundaries, so
   * continuous mode scrolls straight through them by a fixed step.
   */
  get #scrollsAcrossPages(): boolean {
    const { mode, columns } = this.#getSettings();
    return mode === 'continuous' && columns === 1;
  }

  /**
   * The scroll position one step away, clamped between the top of the first
   * page's area and the bottom of the last page's. `undefined` means the zoom
   * doesn't match the content area yet; `null` means there's nowhere to go.
   */
  #scrollTarget(dir: Dir): number | null | undefined {
    const pageIndex = this.pdfViewer.currentPageNumber - 1;
    const stop = this.stops(pageIndex)[0];
    if (!stop || Math.abs(this.pdfViewer.currentScale - stop.scale) > 1e-3) {
      return undefined;
    }
    const lastPage = this.pdfViewer.pagesCount - 1;
    const min = this.pageOrigin(0).top + this.stops(0)[0].top;
    const max =
      this.pageOrigin(lastPage).top + this.stops(lastPage).at(-1)!.top;
    const overlap = Math.min(Math.max(this.#getSettings().overlapPct, 0), 90);
    const step = this.viewSize().height * (1 - overlap / 100);
    const current = this.container.scrollTop;
    const target =
      dir === 1 ? Math.min(max, current + step) : Math.max(min, current - step);
    return (target - current) * dir > 1 ? target : null;
  }

  #scroll(dir: Dir) {
    const target = this.#scrollTarget(dir);
    if (target === undefined) {
      // first press after changing settings or zooming: align to the area
      this.snap();
      return;
    }
    if (target === null) return;
    const pageIndex = this.pdfViewer.currentPageNumber - 1;
    const left =
      this.pageOrigin(pageIndex).left + this.stops(pageIndex)[0].left;
    this.#log(`scrolling to ${left}, ${target}`);
    this.container.scrollTo({ top: target, left, behavior: 'instant' });
    this.#last = null;
  }

  /** Go to the first stop of a page. */
  goToPage(pageIndex: number) {
    this.#ensureLayout();
    this.#apply({ pageIndex, index: 0 });
  }

  /** Re-apply the stop nearest to the current position (e.g. after settings change). */
  snap() {
    this.#ensureLayout();
    const cur = this.#current();
    if (!cur.stops.length) return;
    if (cur.index !== null) {
      this.#apply({ pageIndex: cur.pageIndex, index: cur.index });
      return;
    }
    let best = 0;
    let bestDist = Infinity;
    cur.stops.forEach((s, i) => {
      const dist =
        Math.abs(s.column - cur.column) * 1e6 +
        Math.abs(s.top / s.scale - cur.top);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    this.#apply({ pageIndex: cur.pageIndex, index: best });
  }

  /** Paging only makes sense in vertical scroll mode without spreads. */
  #ensureLayout() {
    const pdfViewer = this.pdfViewer;
    if (pdfViewer.scrollMode !== 0) this.view.setScrollMode(0);
    if (pdfViewer.spreadMode !== 0) this.view.setSpreadMode(0);
  }

  #apply({ pageIndex, index }: Target) {
    const pdfViewer = this.pdfViewer;
    let stop = this.stops(pageIndex)[index];
    if (!stop) return;
    if (Math.abs(pdfViewer.currentScale - stop.scale) > 1e-3) {
      pdfViewer.currentScale = stop.scale;
      // the scrollbars may have changed the view size
      stop = this.stops(pageIndex)[index] ?? stop;
    }
    const origin = this.pageOrigin(pageIndex);
    const container = this.container;
    const top = origin.top + stop.top;
    const left = origin.left + stop.left;
    this.#log(
      `page ${pageIndex + 1}, stop ${index}: scrolling to ${left}, ${top}`,
    );
    container.scrollTo({ top, left, behavior: 'instant' });
    this.#last = {
      pageIndex,
      index,
      scrollTop: container.scrollTop,
      scrollLeft: container.scrollLeft,
    };
  }
}
