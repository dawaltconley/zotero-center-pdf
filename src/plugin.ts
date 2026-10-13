import { config } from '../package.json';
import {
  PagingMode,
  isPagingMode,
  isPDFReader,
  isIFrame,
  waitForReader,
  waitForInternalReader,
} from './utils';

type PDFView =
  _ZoteroTypes.ReaderInstance<'pdf'>['_internalReader']['_lastView'];

/** The navigation functions defined at reader/src/pdf/pdf-view.js */
interface Navigation {
  navigateBack: () => void;
  navigateToPreviousPage: () => void;
  navigateToNextPage: () => void;
  navigateToFirstPage: () => void;
  navigateToLastPage: () => void;
}

/** What a patched view needs in order to be re-patched on a mode change. */
interface PatchedView {
  viewer: HTMLElement;
  defaults: Navigation;
}

export interface PluginOptions {
  id: string;
  version: string;
  rootURI: string;
  stylesId?: string;
}

export class Plugin {
  readonly id: string;
  readonly stylesId: string;
  readonly version: string;
  readonly rootURI: string;

  #mode: PagingMode = this.loadMode() || 'centered';
  get mode(): PagingMode {
    return this.#mode;
  }
  set mode(mode: PagingMode) {
    if (mode !== this.#mode) {
      this.saveMode(mode);
      this.#mode = mode;
      this.patchOpenReaders();
    }
  }

  constructor({
    id = 'center-pdf@dylan.ac',
    stylesId = 'pluginStyles',
    version,
    rootURI,
  }: PluginOptions) {
    this.id = id;
    this.stylesId = stylesId;
    this.version = version;
    this.rootURI = rootURI;
  }

  startup(): void {
    this.log('registering renderToolbar listener');
    this.registerObserver();
    this.addToAllWindows();
  }

  shutdown(): void {
    this.log('unregistering renderToolbar listener');
    this.unregisterObserver();
    this.removeFromAllWindows();
  }

  addToWindow(window: _ZoteroTypes.MainWindow): void {
    this.addMenuItems(window);
  }

  addToAllWindows(): void {
    Zotero.getMainWindows().forEach((w) => this.addToWindow(w));
  }

  removeFromWindow(window: _ZoteroTypes.MainWindow): void {
    this.removeMenuItems(window);
  }

  removeFromAllWindows(): void {
    Zotero.getMainWindows().forEach((w) => this.removeFromWindow(w));
  }

  observerID?: string;
  #updatedTabs = new Set<string | number>();
  registerObserver() {
    this.log('registering tab observer');
    if (this.observerID) {
      throw new Error(`${this.id}: observer is already registered`);
    }
    type Trigger = _ZoteroTypes.Notifier.Event | 'load'; // zotero-types doesn't include 'load' in the event definition, but tabs have a load event
    const triggers = new Set<Trigger>(['add', 'load', 'select']);
    this.observerID = Zotero.Notifier.registerObserver(
      {
        notify: async (event, type, ids, extraData) => {
          if (triggers.has(event) && type === 'tab') {
            const tabIDs = ids.filter(
              (id) =>
                extraData[id].type === 'reader' && !this.#updatedTabs.has(id),
            );
            await Promise.all(
              tabIDs.map(async (id) => {
                const reader = Zotero.Reader.getByTabID(id.toString());
                if (reader && isPDFReader(reader)) {
                  await this.addListeners(reader);
                }
              }),
            );
          }
        },
      },
      ['tab'],
    );
    this.log('registered observer: ' + this.observerID);
  }

  unregisterObserver() {
    if (this.observerID) {
      this.log('unregistering observer: ' + this.observerID);
      Zotero.Notifier.unregisterObserver(this.observerID);
      this.observerID = undefined;
    }
  }

  #patchedViews = new WeakMap<PDFView, PatchedView>();

  async addListeners(reader: _ZoteroTypes.ReaderInstance<'pdf'>) {
    this.log('adding page listeners');
    await waitForReader(reader);
    await waitForInternalReader(reader);
    const doc = reader?._iframeWindow?.document;
    const iframe = doc?.querySelector<HTMLIFrameElement>(
      'iframe[src="pdf/web/viewer.html"]',
    );
    if (!doc || !iframe || !isIFrame(iframe)) {
      this.log(`couldn't attach styles; tab ${reader.tabID} not ready`);
      return;
    }

    const viewer = await Plugin.getViewerContainer(iframe);
    const lastView = reader._internalReader._lastView;
    const app = lastView._iframeWindow?.PDFViewerApplication;
    if (!viewer || !app?.pdfViewer || !app?.eventBus) {
      return;
    }

    this.patchNavigation(lastView, viewer);
    this.log('added page listeners');
  }

  /**
   * Replaces a view's navigation functions with implementations of the current
   * paging mode. Safe to call repeatedly: the view's default implementations
   * are saved on the first patch, so later patches replace rather than nest.
   */
  patchNavigation(view: PDFView, viewer: HTMLElement): void {
    let patched = this.#patchedViews.get(view);
    if (!patched) {
      patched = {
        viewer,
        defaults: {
          navigateBack: view.navigateBack.bind(view),
          navigateToPreviousPage: view.navigateToPreviousPage.bind(view),
          navigateToNextPage: view.navigateToNextPage.bind(view),
          navigateToFirstPage: view.navigateToFirstPage.bind(view),
          navigateToLastPage: view.navigateToLastPage.bind(view),
        },
      };
      this.#patchedViews.set(view, patched);
    }
    // the stored container wins; the argument only seeds the first patch
    const { defaults, viewer: container } = patched;

    switch (this.mode) {
      case 'regular':
        view.navigateBack = defaults.navigateBack;
        view.navigateToPreviousPage = defaults.navigateToPreviousPage;
        view.navigateToNextPage = defaults.navigateToNextPage;
        view.navigateToFirstPage = defaults.navigateToFirstPage;
        view.navigateToLastPage = defaults.navigateToLastPage;
        break;

      case 'centered':
        view.navigateBack = () => {
          defaults.navigateBack();
          this.centerCurrentPage(container);
        };
        view.navigateToPreviousPage = () => {
          defaults.navigateToPreviousPage();
          this.centerCurrentPage(container);
        };
        view.navigateToNextPage = () => {
          defaults.navigateToNextPage();
          this.centerCurrentPage(container);
        };
        view.navigateToFirstPage = () => {
          defaults.navigateToFirstPage();
          this.centerCurrentPage(container);
        };
        view.navigateToLastPage = () => {
          defaults.navigateToLastPage();
          this.centerCurrentPage(container);
        };
        break;

      case 'continuous':
        // only next/previous become scrolls; jumping to a specific page still
        // means jumping to that page
        view.navigateBack = defaults.navigateBack;
        view.navigateToPreviousPage = () => Plugin.scrollByPages(container, -1);
        view.navigateToNextPage = () => Plugin.scrollByPages(container, 1);
        view.navigateToFirstPage = defaults.navigateToFirstPage;
        view.navigateToLastPage = defaults.navigateToLastPage;
        break;
    }

    this.log(`patched navigation for '${this.mode}' paging`);
  }

  /** Re-patches every open PDF reader, applying the current paging mode. */
  patchOpenReaders(): void {
    for (const reader of Zotero.Reader._readers) {
      if (!isPDFReader(reader)) continue;
      const view = reader._internalReader?._lastView;
      const patched = view && this.#patchedViews.get(view);
      if (patched) {
        this.patchNavigation(view, patched.viewer);
      }
    }
  }

  addMenuItems(window: _ZoteroTypes.MainWindow): void {
    const doc = window.document;
    const menuId = `${config.addonRef}-radio-menu`;
    if (doc.getElementById(menuId)) {
      this.log('paging menu already attached');
      return;
    }

    window.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-menu.ftl`);

    // submenu container
    const menu = doc.createXULElement('menu') as XULMenuElement;
    menu.id = menuId;
    menu.classList.add('menu-type-reader');
    menu.setAttribute('data-l10n-id', menuId);

    // submenu popup, contains menu items
    const popup = doc.createXULElement('menupopup') as XULMenuPopupElement;
    menu.appendChild(popup);

    // menu items: radio buttons
    for (const value of PagingMode) {
      const radio = doc.createXULElement('menuitem') as XULMenuItemElement;
      radio.setAttribute('type', 'radio');
      radio.setAttribute('name', `${config.addonRef}-menu-ui-radio`);

      radio.id = `${menuId}-${value}`;
      radio.value = value;
      radio.addEventListener('command', () => {
        this.mode = value;
      });

      radio.setAttribute('data-l10n-id', radio.id);
      if (radio.value === this.mode) {
        radio.setAttribute('checked', 'true');
      }

      popup.appendChild(radio);
    }

    const viewMenu = doc.getElementById('menu_viewPopup');
    const referenceNode =
      viewMenu?.querySelector('menuseparator.menu-type-library') || null;
    const inserted = viewMenu?.insertBefore(menu, referenceNode);

    if (inserted) {
      this.log(`successfully inserted menu: ${menu.id}`);
      this.storeAddedElement(menu);
    }
  }

  removeMenuItems(window: _ZoteroTypes.MainWindow): void {
    const doc = window.document;
    for (const id of this.#addedElementIDs) {
      doc.getElementById(id)?.remove();
    }
  }

  #addedElementIDs: string[] = [];
  storeAddedElement(elem: Element) {
    if (!elem.id) {
      throw new Error('Element must have an id');
    }
    this.#addedElementIDs.push(elem.id);
  }

  loadMode(): PagingMode | null {
    const saved = Zotero.Prefs.get(PREFS.pagingMode, true);
    return isPagingMode(saved) ? saved : null;
  }

  saveMode(mode: PagingMode) {
    Zotero.Prefs.set(PREFS.pagingMode, mode, true);
  }

  centerCurrentPage(viewer: HTMLElement) {
    const page = Plugin.getCurrentPage(viewer);
    if (!page) {
      this.log("couldn't identify current page");
      return;
    }
    const target = Plugin.getScrollTarget(viewer, page);
    this.log(`scrolling to ${JSON.stringify(target)}`);
    viewer.scrollTo(target);
  }

  static getViewerContainer(
    iframe: HTMLIFrameElement,
  ): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const viewer =
        iframe.contentDocument?.querySelector<HTMLElement>('#viewerContainer');
      if (viewer) {
        resolve(viewer);
      } else {
        iframe.addEventListener('load', () => {
          const viewer =
            iframe.contentDocument?.querySelector<HTMLElement>(
              '#viewerContainer',
            );
          resolve(viewer || null);
        });
      }
    });
  }

  log(msg: string) {
    Zotero.debug(`[${config.addonName}] ${msg}`);
  }

  /**
   * Scrolls the viewer by `pages` pages. Equivalent to
   * window.scrollByPages(), which can't be used here: #viewerContainer is the
   * PDF viewer's scrolling element, so its window never scrolls.
   */
  static scrollByPages(viewer: HTMLElement, pages: number): void {
    viewer.scrollBy({ top: pages * Plugin.getPageScrollAmount(viewer) });
  }

  /**
   * How far one page scroll travels: the viewport height, less the smaller of
   * 10% of the viewport or two lines of text. Leaving that overlap keeps a
   * little context between scrolls. Mirrors Gecko's page scroll amount, which
   * window.scrollByPages() would otherwise have given us for free.
   */
  static getPageScrollAmount(viewer: HTMLElement): number {
    const height = viewer.clientHeight;
    const overlap = Math.min(height / 10, Plugin.getLineHeight(viewer) * 2);
    return height - overlap;
  }

  static getLineHeight(elem: HTMLElement): number {
    const style = elem.ownerDocument?.defaultView?.getComputedStyle(elem);
    const lineHeight = parseFloat(style?.lineHeight || '');
    if (!Number.isNaN(lineHeight)) {
      return lineHeight;
    }
    // 'normal' computes to roughly 1.2x the font size
    const fontSize = parseFloat(style?.fontSize || '');
    return Number.isNaN(fontSize) ? 0 : fontSize * 1.2;
  }

  static getScrollTarget(viewer: HTMLElement, page: HTMLElement) {
    const xOffset = (page.clientWidth - viewer.clientWidth) * 0.5;
    const yOffset = (page.clientHeight - viewer.clientHeight) * 0.5;
    return {
      top: page.offsetTop + yOffset,
      left: page.offsetLeft + xOffset,
    };
  }

  // // unused, can uncomment if needed
  // static getCurrentPageIndex(): number | null {
  //   const viewState =
  //     Zotero.Reader._readers[0]._internalReader._state.primaryViewState;
  //   return 'pageIndex' in viewState ? viewState.pageIndex : null;
  // }

  static getCurrentPage(viewer: HTMLElement): HTMLElement | null {
    const pages = viewer.querySelectorAll<HTMLElement>('.pdfViewer .page');
    for (const p of pages) {
      if (Math.abs(p.offsetTop - viewer.scrollTop) < 5) {
        return p;
      }
    }
    return null;
  }
}

const PREFS = {
  pagingMode: `${config.prefsPrefix}.paging-mode`,
} satisfies Record<string, string>;
