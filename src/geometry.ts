// Pure layout math for computing navigation "stops" on a page. No DOM access
// here, so it can be unit tested.

export type Mode = 'off' | 'page' | 'continuous';

/** Rectangle as fractions (0-1) of the unrotated page box, origin top-left. */
export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Rectangle in page-local CSS px at scale 1, origin top-left of the page. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface LayoutOptions {
  mode: Exclude<Mode, 'off'>;
  columns: number;
  marginPx: number;
  overlapPct: number;
}

/**
 * A position to scroll to. `left` and `top` are page-local CSS px at `scale`:
 * the scroll offset of the view relative to the page's content box.
 */
export interface Stop {
  column: number;
  scale: number;
  left: number;
  top: number;
}

/** Where the view currently is on a page, in page-local px at scale 1. */
export interface Position {
  column: number;
  top: number;
}

export const FULL_AREA: Area = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** A 2D affine transform `[a, b, c, d, e, f]`, as used by pdf.js. */
export type Transform = [number, number, number, number, number, number];

/** Same as pdf.js `Util.applyTransform`. */
export function applyTransform(
  [x, y]: [number, number],
  m: Transform,
): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Same as pdf.js `Util.applyInverseTransform`. */
export function applyInverseTransform(
  [x, y]: [number, number],
  m: Transform,
): [number, number] {
  const d = m[0] * m[3] - m[1] * m[2];
  return [
    (x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / d,
    (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / d,
  ];
}

/** Split a rect into `n` equal-width columns, ordered left to right. */
export function columnRects(rect: Rect, n: number): Rect[] {
  const count = Math.max(1, Math.floor(n));
  const width = rect.width / count;
  return Array.from({ length: count }, (_, i) => ({
    left: rect.left + i * width,
    top: rect.top,
    width,
    height: rect.height,
  }));
}

/** Compute the stops for one page, in reading order. */
export function computeStops(
  columns: Rect[],
  view: Size,
  opts: LayoutOptions,
): Stop[] {
  const m = opts.marginPx;
  const availW = Math.max(1, view.width - 2 * m);
  const availH = Math.max(1, view.height - 2 * m);
  const stops: Stop[] = [];

  columns.forEach((col, column) => {
    const centerX = col.left + col.width / 2;
    if (opts.mode === 'page') {
      const scale = Math.min(availW / col.width, availH / col.height);
      const centerY = col.top + col.height / 2;
      stops.push({
        column,
        scale,
        left: centerX * scale - view.width / 2,
        top: centerY * scale - view.height / 2,
      });
      return;
    }

    const scale = availW / col.width;
    const left = centerX * scale - view.width / 2;
    const first = col.top * scale - m;
    const last = (col.top + col.height) * scale + m - view.height;
    if (last <= first) {
      // whole column fits in the view; center it vertically
      const centerY = (col.top + col.height / 2) * scale;
      stops.push({ column, scale, left, top: centerY - view.height / 2 });
      return;
    }
    const overlap = Math.min(Math.max(opts.overlapPct, 0), 90) / 100;
    const maxStep = Math.max(1, view.height * (1 - overlap));
    // Spread the steps evenly so the first and last chunks are flush with the
    // column edges, the overlap is at least the requested amount, and there is
    // no tiny final step.
    const count = Math.ceil((last - first) / maxStep);
    const step = (last - first) / count;
    for (let i = 0; i <= count; i++) {
      stops.push({ column, scale, left, top: first + i * step });
    }
  });

  return stops;
}

/** Index of the column containing (or nearest to) the x coordinate. */
export function columnAt(columns: Rect[], x: number): number {
  let best = 0;
  let bestDist = Infinity;
  columns.forEach((col, i) => {
    const dist =
      x < col.left
        ? col.left - x
        : x > col.left + col.width
          ? x - (col.left + col.width)
          : 0;
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}

const EPSILON = 2;

/**
 * Find the index of the next stop in direction `dir` from a position that may
 * not correspond to a stop (e.g. after manual scrolling). Returns `null` when
 * navigation should continue on the adjacent page.
 *
 * In page mode only the column matters. In continuous mode stops in the same
 * column are compared by their top edge.
 */
export function stepFromPosition(
  stops: Stop[],
  pos: Position,
  dir: 1 | -1,
  mode: Exclude<Mode, 'off'>,
): number | null {
  const cmp = (s: Stop): number => {
    if (s.column !== pos.column) return s.column - pos.column;
    if (mode === 'page') return 0;
    const diff = s.top - pos.top * s.scale;
    return Math.abs(diff) <= EPSILON ? 0 : diff;
  };
  if (dir === 1) {
    const i = stops.findIndex((s) => cmp(s) > 0);
    return i === -1 ? null : i;
  }
  for (let i = stops.length - 1; i >= 0; i--) {
    if (cmp(stops[i]) < 0) return i;
  }
  return null;
}

/** Step from a known stop index. Returns `null` to move to the adjacent page. */
export function stepFromIndex(
  stops: Stop[],
  index: number,
  dir: 1 | -1,
): number | null {
  const next = index + dir;
  return next >= 0 && next < stops.length ? next : null;
}
