import { applyInverseTransform, type Area, type Transform } from '../geometry';
import type { Navigator } from '../navigator';

const MIN_SIZE = 10; // CSS px

/**
 * Zoom the current page out to fit, cover it with a canvas, and let the user
 * drag out a rectangle. Resolves with the area (as page fractions) and the page
 * it was drawn on, or `null` if cancelled.
 *
 * The canvas lives in the pdf.js iframe body, outside `#viewerContainer`, so
 * the reader ignores its pointer events and never starts a text selection.
 */
export function drawArea(
  nav: Navigator,
  columns: number,
): Promise<{ area: Area; pageIndex: number } | null> {
  const win = nav.window;
  const doc = nav.document;
  const pdfViewer = nav.pdfViewer;
  const container = nav.container;

  const saved = {
    scaleValue: pdfViewer.currentScaleValue,
    top: container.scrollTop,
    left: container.scrollLeft,
  };
  const pageIndex: number = pdfViewer.currentPageNumber - 1;
  pdfViewer.currentScaleValue = 'page-fit';
  // scrolls the page into view; avoids passing a plugin-scope object to pdf.js
  pdfViewer.currentPageNumber = pageIndex + 1;

  const pageView = pdfViewer.getPageView(pageIndex);
  const pageDiv = nav.pageDiv(pageIndex);
  const pr = pageDiv.getBoundingClientRect();
  const box = {
    left: pr.left + pageDiv.clientLeft,
    top: pr.top + pageDiv.clientTop,
    width: pageDiv.clientWidth,
    height: pageDiv.clientHeight,
  };

  const backdrop = doc.createElement('div');
  backdrop.tabIndex = -1;
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100000',
    cursor: 'crosshair',
    touchAction: 'none',
  });

  const hint = doc.createElement('div');
  hint.textContent = 'Drag to select the content area · Esc to cancel';
  Object.assign(hint.style, {
    position: 'absolute',
    top: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '4px 10px',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.75)',
    color: 'white',
    font: '13px system-ui, sans-serif',
    pointerEvents: 'none',
  });

  const canvas = doc.createElement('canvas');
  const dpr = win.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  Object.assign(canvas.style, {
    position: 'absolute',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(dpr, dpr);

  backdrop.append(canvas, hint);
  doc.body!.append(backdrop);
  backdrop.focus();

  let start: { x: number; y: number } | null = null;
  let rect: { x0: number; y0: number; x1: number; y1: number } | null = null;

  const clampPoint = (e: PointerEvent) => ({
    x: Math.min(box.width, Math.max(0, e.clientX - box.left)),
    y: Math.min(box.height, Math.max(0, e.clientY - box.top)),
  });

  const draw = () => {
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    if (!rect) {
      ctx.fillRect(0, 0, box.width, box.height);
      return;
    }
    const { x0, y0, x1, y1 } = rect;
    const w = x1 - x0;
    const h = y1 - y0;
    // dim everything outside the selection
    ctx.fillRect(0, 0, box.width, y0);
    ctx.fillRect(0, y1, box.width, box.height - y1);
    ctx.fillRect(0, y0, x0, h);
    ctx.fillRect(x1, y0, box.width - x1, h);
    ctx.strokeStyle = '#2ea8e5';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(x0, y0, w, h);
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    for (let i = 1; i < columns; i++) {
      const x = x0 + (w * i) / columns;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
  };
  draw();

  return new Promise((resolve) => {
    let done = false;
    const finish = (result: { area: Area; pageIndex: number } | null) => {
      if (done) return;
      done = true;
      backdrop.remove();
      win.removeEventListener('keydown', onKeyDown, true);
      win.removeEventListener('resize', onResize);
      if (!result) {
        pdfViewer.currentScaleValue = saved.scaleValue;
        container.scrollTo({
          top: saved.top,
          left: saved.left,
          behavior: 'instant',
        });
      }
      resolve(result);
    };

    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    backdrop.addEventListener('pointerdown', (e: PointerEvent) => {
      stop(e);
      if (e.button !== 0) return finish(null);
      backdrop.setPointerCapture(e.pointerId);
      start = clampPoint(e);
      rect = null;
    });
    backdrop.addEventListener('pointermove', (e: PointerEvent) => {
      stop(e);
      if (!start) return;
      const p = clampPoint(e);
      rect = {
        x0: Math.min(start.x, p.x),
        y0: Math.min(start.y, p.y),
        x1: Math.max(start.x, p.x),
        y1: Math.max(start.y, p.y),
      };
      draw();
    });
    // Zotero may synthesize a duplicate pointerup; `finish` is idempotent
    backdrop.addEventListener('pointerup', (e: PointerEvent) => {
      stop(e);
      if (!start) return;
      start = null;
      if (
        !rect ||
        rect.x1 - rect.x0 < MIN_SIZE ||
        rect.y1 - rect.y0 < MIN_SIZE
      ) {
        return finish(null);
      }
      finish({ area: toArea(rect), pageIndex });
    });
    backdrop.addEventListener('contextmenu', stop);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stop(e);
        finish(null);
      }
    };
    const onResize = () => finish(null);
    win.addEventListener('keydown', onKeyDown, true);
    win.addEventListener('resize', onResize);
  });

  /** Convert canvas CSS px to fractions of the unrotated page box. */
  function toArea(r: { x0: number; y0: number; x1: number; y1: number }): Area {
    const viewport = pageView.viewport;
    const sx = viewport.width / box.width;
    const sy = viewport.height / box.height;
    const [vx0, vy0, vx1, vy1] = viewport.viewBox as number[];
    const transform = [...viewport.transform] as Transform;
    const toFraction = (x: number, y: number) => {
      const [px, py] = applyInverseTransform([x * sx, y * sy], transform);
      return [(px - vx0) / (vx1 - vx0), (vy1 - py) / (vy1 - vy0)];
    };
    const [ax, ay] = toFraction(r.x0, r.y0);
    const [bx, by] = toFraction(r.x1, r.y1);
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x0: clamp(Math.min(ax, bx)),
      y0: clamp(Math.min(ay, by)),
      x1: clamp(Math.max(ax, bx)),
      y1: clamp(Math.max(ay, by)),
    };
  }
}

/**
 * Outline the content area and column dividers on a page. Returns a function
 * that removes the outline.
 */
export function showAreaPreview(nav: Navigator, columns: number): () => void {
  const pdfViewer = nav.pdfViewer;
  const pageIndex: number = pdfViewer.currentPageNumber - 1;
  const pageDiv = nav.pageDiv(pageIndex);
  const doc = pageDiv.ownerDocument!;
  const scale: number = pdfViewer.currentScale;
  const area = nav.pageArea(pageIndex);

  // percentages, so the outline follows later zoom changes
  const pageW = pageDiv.clientWidth / scale;
  const pageH = pageDiv.clientHeight / scale;
  const pct = (v: number, total: number) => `${(100 * v) / total}%`;
  const outline = doc.createElement('div');
  Object.assign(outline.style, {
    position: 'absolute',
    left: pct(area.left, pageW),
    top: pct(area.top, pageH),
    width: pct(area.width, pageW),
    height: pct(area.height, pageH),
    border: '2px dashed #2ea8e5',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    zIndex: '10',
  });
  for (let i = 1; i < columns; i++) {
    const divider = doc.createElement('div');
    Object.assign(divider.style, {
      position: 'absolute',
      top: '0',
      bottom: '0',
      left: `${(100 * i) / columns}%`,
      borderLeft: '1px dashed #2ea8e5',
    });
    outline.append(divider);
  }
  pageDiv.append(outline);
  return () => outline.remove();
}
