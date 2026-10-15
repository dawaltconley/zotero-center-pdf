import { describe, expect, it } from 'vitest';
import {
  applyInverseTransform,
  applyTransform,
  columnAt,
  columnRects,
  computeStops,
  stepFromIndex,
  stepFromPosition,
  type LayoutOptions,
  type Rect,
  type Transform,
} from './geometry';

describe('transforms', () => {
  it('inverts a rotated, scaled, translated transform', () => {
    // pdf.js viewport for a 612x792 page rotated 90 degrees at 1.5x
    const m: Transform = [0, 1.5, 1.5, 0, 0, 0];
    const p = applyTransform([100, 200], m);
    expect(p).toEqual([300, 150]);
    const back = applyInverseTransform(p, m);
    expect(back[0]).toBeCloseTo(100);
    expect(back[1]).toBeCloseTo(200);
    const flip: Transform = [2, 0, 0, -2, -10, 1584];
    const q = applyInverseTransform(applyTransform([7, 9], flip), flip);
    expect(q[0]).toBeCloseTo(7);
    expect(q[1]).toBeCloseTo(9);
  });
});

const area: Rect = { left: 50, top: 100, width: 400, height: 600 };
const view = { width: 800, height: 600 };

const opts = (o: Partial<LayoutOptions>): LayoutOptions => ({
  mode: 'page',
  columns: 1,
  marginPx: 0,
  overlapPct: 0,
  ...o,
});

describe('columnRects', () => {
  it('splits the area into equal columns, left to right', () => {
    const cols = columnRects(area, 4);
    expect(cols).toHaveLength(4);
    expect(cols.map((c) => c.left)).toEqual([50, 150, 250, 350]);
    cols.forEach((c) => {
      expect(c.width).toBe(100);
      expect(c.top).toBe(100);
      expect(c.height).toBe(600);
    });
  });
});

describe('computeStops: page mode', () => {
  it('contains and centers a single area', () => {
    const [stop] = computeStops(columnRects(area, 1), view, opts({}));
    expect(stop.scale).toBe(1); // min(800/400, 600/600)
    // area center (250, 400) at the view center
    expect(stop.left + view.width / 2).toBe(250);
    expect(stop.top + view.height / 2).toBe(400);
  });

  it('respects the margin', () => {
    const [stop] = computeStops(
      columnRects(area, 1),
      view,
      opts({ marginPx: 30 }),
    );
    expect(stop.scale).toBeCloseTo(540 / 600);
  });

  it('gives one stop per column', () => {
    for (const n of [1, 2, 3, 4]) {
      const stops = computeStops(columnRects(area, n), view, opts({}));
      expect(stops.map((s) => s.column)).toEqual([...Array(n).keys()]);
      // narrow columns are limited by height
      expect(stops[0].scale).toBe(1);
    }
  });
});

describe('computeStops: continuous mode', () => {
  const cont = (o: Partial<LayoutOptions> = {}) =>
    opts({ mode: 'continuous', ...o });

  it('fits the column width and steps down with overlap', () => {
    const stops = computeStops(
      columnRects(area, 2),
      view,
      cont({ overlapPct: 10 }),
    );
    const scale = 800 / 200;
    expect(stops[0].scale).toBe(scale);
    const col0 = stops.filter((s) => s.column === 0);
    expect(col0[0].top).toBe(100 * scale);
    // 1800px to scroll, max step 540: four even steps of 450
    expect(col0).toHaveLength(5);
    expect(col0[1].top - col0[0].top).toBeCloseTo(450);
    // last stop is flush with the column bottom
    expect(col0.at(-1)!.top).toBe(700 * scale - view.height);
    // every chunk overlaps the previous one
    for (let i = 1; i < col0.length; i++) {
      expect(col0[i].top - col0[i - 1].top).toBeLessThanOrEqual(540 + 1e-9);
    }
    // the second column starts at the top again
    const col1 = stops.filter((s) => s.column === 1);
    expect(col1[0].top).toBe(100 * scale);
    expect(col1[0].left).toBeGreaterThan(col0[0].left);
  });

  it('includes margins at the top and bottom of a column', () => {
    const stops = computeStops(
      columnRects(area, 1),
      view,
      cont({ marginPx: 20 }),
    );
    const scale = 760 / 400;
    expect(stops[0].top).toBeCloseTo(100 * scale - 20);
    expect(stops.at(-1)!.top).toBeCloseTo(700 * scale + 20 - view.height);
  });

  it('centers a column that fits in the view', () => {
    const short: Rect = { left: 0, top: 0, width: 800, height: 100 };
    const stops = computeStops([short], view, cont());
    expect(stops).toHaveLength(1);
    expect(stops[0].top + view.height / 2).toBe(50);
  });

  it('spreads steps evenly instead of adding a tiny final step', () => {
    const tops = (height: number) =>
      computeStops([{ left: 0, top: 0, width: 800, height }], view, cont()).map(
        (s) => s.top,
      );
    // scrollable distance 610 with a max step of 600: two steps of 305
    expect(tops(1210)).toEqual([0, 305, 610]);
    // exactly one view height of scrolling: a single step
    expect(tops(1200)).toEqual([0, 600]);
  });
});

describe('navigation', () => {
  it('steps by index and signals page changes at the ends', () => {
    const stops = computeStops(columnRects(area, 2), view, opts({}));
    expect(stepFromIndex(stops, 0, 1)).toBe(1);
    expect(stepFromIndex(stops, 1, 1)).toBeNull();
    expect(stepFromIndex(stops, 1, -1)).toBe(0);
    expect(stepFromIndex(stops, 0, -1)).toBeNull();
  });

  it('finds the column at a point', () => {
    const cols = columnRects(area, 2);
    expect(columnAt(cols, 0)).toBe(0);
    expect(columnAt(cols, 200)).toBe(0);
    expect(columnAt(cols, 300)).toBe(1);
    expect(columnAt(cols, 1000)).toBe(1);
  });

  it('steps from an arbitrary position in page mode by column', () => {
    const stops = computeStops(columnRects(area, 3), view, opts({}));
    const pos = { column: 1, top: 9999 };
    expect(stepFromPosition(stops, pos, 1, 'page')).toBe(2);
    expect(stepFromPosition(stops, pos, -1, 'page')).toBe(0);
    expect(stepFromPosition(stops, { column: 2, top: 0 }, 1, 'page')).toBe(
      null,
    );
  });

  it('steps from an arbitrary position in continuous mode', () => {
    const stops = computeStops(
      columnRects(area, 2),
      view,
      opts({ mode: 'continuous' }),
    );
    const scale = stops[0].scale;
    const col0 = stops.filter((s) => s.column === 0);
    // halfway between the first two stops of column 0
    const top = (col0[0].top + col0[1].top) / 2 / scale;
    expect(stepFromPosition(stops, { column: 0, top }, 1, 'continuous')).toBe(
      1,
    );
    expect(stepFromPosition(stops, { column: 0, top }, -1, 'continuous')).toBe(
      0,
    );
    // exactly on a stop moves past it
    const onStop = col0[1].top / scale;
    expect(
      stepFromPosition(stops, { column: 0, top: onStop }, 1, 'continuous'),
    ).toBe(2);
    // past the end of the last column
    expect(
      stepFromPosition(stops, { column: 1, top: 1e6 }, 1, 'continuous'),
    ).toBeNull();
    // before the start of the first column
    expect(
      stepFromPosition(stops, { column: 0, top: -1e6 }, -1, 'continuous'),
    ).toBeNull();
  });
});
