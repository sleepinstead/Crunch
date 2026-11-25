/** Pure geometry for the canvas: bounds, alignment, distribution and smart snapping. */
import type { Item } from './api';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RAD = Math.PI / 180;

/** Axis-aligned box around a (possibly rotated) item. */
export function aabb(i: Rect & { rotation?: number }): Rect {
  const r = (i.rotation ?? 0) * RAD;
  if (!r) return { x: i.x, y: i.y, w: i.w, h: i.h };
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = i.w * c + i.h * s;
  const h = i.w * s + i.h * c;
  return { x: i.x + i.w / 2 - w / 2, y: i.y + i.h / 2 - h / 2, w, h };
}

export function boundsOf(items: (Rect & { rotation?: number })[]): Rect | null {
  if (!items.length) return null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const it of items) {
    const i = aabb(it);
    x1 = Math.min(x1, i.x);
    y1 = Math.min(y1, i.y);
    x2 = Math.max(x2, i.x + i.w);
    y2 = Math.max(y2, i.y + i.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/* ---------- align & distribute ---------- */

/** Groups move as one unit, like Figma. */
function units(items: Item[]): Item[][] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const key = it.groupId || it.id;
    map.set(key, [...(map.get(key) ?? []), it]);
  }
  return [...map.values()];
}

const shift = (unit: Item[], dx: number, dy: number) => unit.map((i) => ({ ...i, x: i.x + dx, y: i.y + dy }));

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function align(items: Item[], mode: AlignMode): Item[] {
  const all = units(items);
  if (all.length < 2) return items;
  const b = boundsOf(items)!;
  return all.flatMap((u) => {
    const a = boundsOf(u)!;
    const dx =
      mode === 'left' ? b.x - a.x : mode === 'right' ? b.x + b.w - (a.x + a.w) : mode === 'hcenter' ? b.x + b.w / 2 - (a.x + a.w / 2) : 0;
    const dy =
      mode === 'top' ? b.y - a.y : mode === 'bottom' ? b.y + b.h - (a.y + a.h) : mode === 'vcenter' ? b.y + b.h / 2 - (a.y + a.h / 2) : 0;
    return shift(u, dx, dy);
  });
}

/** Equal gaps between units along an axis (needs 3+). */
export function distribute(items: Item[], axis: 'x' | 'y'): Item[] {
  const all = units(items).map((u) => ({ u, b: boundsOf(u)! }));
  if (all.length < 3) return items;
  const pos = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  all.sort((a, b) => a.b[pos] - b.b[pos]);
  const first = all[0].b;
  const last = all[all.length - 1].b;
  const span = last[pos] + last[size] - first[pos];
  const total = all.reduce((s, a) => s + a.b[size], 0);
  const gap = (span - total) / (all.length - 1);
  let cursor = first[pos];
  return all.flatMap(({ u, b }) => {
    const d = cursor - b[pos];
    cursor += b[size] + gap;
    return axis === 'x' ? shift(u, d, 0) : shift(u, 0, d);
  });
}

/* ---------- smart snapping ---------- */

export interface Guide {
  /** Alignment line: axis it is perpendicular to, position, and the extent it spans. */
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

export interface GapMark {
  axis: 'x' | 'y';
  /** Start/end along the axis, and where across it to draw. */
  a: number;
  b: number;
  at: number;
}

export interface Snap {
  dx: number;
  dy: number;
  guides: Guide[];
  gaps: GapMark[];
}

const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && a2 > b1;

/**
 * Snap a moving box to other boxes: edges and centers line up, and equal spacing
 * between neighbours (both "centered between two" and "same gap as next door").
 */
export function snapMove(box: Rect, others: Rect[], tol: number, useSpacing = true): Snap {
  let bestX: { d: number } | null = null;
  let bestY: { d: number } | null = null;
  const consider = (axis: 'x' | 'y', d: number) => {
    if (Math.abs(d) > tol) return;
    if (axis === 'x' && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d };
    if (axis === 'y' && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d };
  };

  const bx = [box.x, box.x + box.w / 2, box.x + box.w];
  const by = [box.y, box.y + box.h / 2, box.y + box.h];
  for (const o of others) {
    for (const line of [o.x, o.x + o.w / 2, o.x + o.w]) for (const p of bx) consider('x', line - p);
    for (const line of [o.y, o.y + o.h / 2, o.y + o.h]) for (const p of by) consider('y', line - p);
  }

  // Equal spacing along each axis among boxes sharing the other axis.
  const spacing = (axis: 'x' | 'y') => {
    const P = axis === 'x' ? 'x' : 'y';
    const S = axis === 'x' ? 'w' : 'h';
    const Q = axis === 'x' ? 'y' : 'x';
    const T = axis === 'x' ? 'h' : 'w';
    const row = others.filter((o) => overlaps(o[Q], o[Q] + o[T], box[Q], box[Q] + box[T]));
    const mid = box[P] + box[S] / 2;
    const before = row.filter((o) => o[P] + o[S] <= mid).sort((a, b) => b[P] + b[S] - (a[P] + a[S]));
    const after = row.filter((o) => o[P] >= mid).sort((a, b) => a[P] - b[P]);
    const L = before[0];
    const R = after[0];
    if (L && R) consider(axis, (L[P] + L[S] + R[P] - box[S]) / 2 - box[P]);
    // Same gap as an existing neighbouring pair.
    const gaps: number[] = [];
    const sorted = [...row].sort((a, b) => a[P] - b[P]);
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i][P] - (sorted[i - 1][P] + sorted[i - 1][S]);
      if (g > 0) gaps.push(g);
    }
    for (const g of gaps) {
      if (L) consider(axis, L[P] + L[S] + g - box[P]);
      if (R) consider(axis, R[P] - g - box[S] - box[P]);
    }
  };
  if (useSpacing) {
    spacing('x');
    spacing('y');
  }

  const dx = (bestX as { d: number } | null)?.d ?? 0;
  const dy = (bestY as { d: number } | null)?.d ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  return { dx, dy, ...guidesFor(moved, others, !!bestX, !!bestY, useSpacing) };
}

/** Lines and gap markers that hold for a box at its final position. */
export function guidesFor(
  box: Rect,
  others: Rect[],
  showX = true,
  showY = true,
  showGaps = true,
): { guides: Guide[]; gaps: GapMark[] } {
  const eps = 0.5;
  const guides: Guide[] = [];
  const gaps: GapMark[] = [];
  if (showX)
    for (const p of [box.x, box.x + box.w / 2, box.x + box.w]) {
      const hits = others.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((l) => Math.abs(l - p) < eps));
      if (hits.length)
        guides.push({
          axis: 'x',
          pos: p,
          from: Math.min(box.y, ...hits.map((o) => o.y)),
          to: Math.max(box.y + box.h, ...hits.map((o) => o.y + o.h)),
        });
    }
  if (showY)
    for (const p of [box.y, box.y + box.h / 2, box.y + box.h]) {
      const hits = others.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((l) => Math.abs(l - p) < eps));
      if (hits.length)
        guides.push({
          axis: 'y',
          pos: p,
          from: Math.min(box.x, ...hits.map((o) => o.x)),
          to: Math.max(box.x + box.w, ...hits.map((o) => o.x + o.w)),
        });
    }

  // Show spacing when the box sits evenly between / next to neighbours.
  for (const axis of ['x', 'y'] as const) {
    if (!showGaps || (axis === 'x' && !showX) || (axis === 'y' && !showY)) continue;
    const P = axis === 'x' ? 'x' : 'y';
    const S = axis === 'x' ? 'w' : 'h';
    const Q = axis === 'x' ? 'y' : 'x';
    const T = axis === 'x' ? 'h' : 'w';
    const row = others.filter((o) => overlaps(o[Q], o[Q] + o[T], box[Q], box[Q] + box[T]));
    const mid = box[P] + box[S] / 2;
    const L = row.filter((o) => o[P] + o[S] <= mid).sort((a, b) => b[P] + b[S] - (a[P] + a[S]))[0];
    const R = row.filter((o) => o[P] >= mid).sort((a, b) => a[P] - b[P])[0];
    const gl = L ? box[P] - (L[P] + L[S]) : NaN;
    const gr = R ? R[P] - (box[P] + box[S]) : NaN;
    const at = box[Q] + box[T] / 2;
    if (L && R && Math.abs(gl - gr) < eps && gl > 0) {
      gaps.push({ axis, a: L[P] + L[S], b: box[P], at });
      gaps.push({ axis, a: box[P] + box[S], b: R[P], at });
    } else if (L && gl > 0) {
      const LL = row.filter((o) => o !== L && o[P] + o[S] <= L[P]).sort((a, b) => b[P] + b[S] - (a[P] + a[S]))[0];
      if (LL && Math.abs(L[P] - (LL[P] + LL[S]) - gl) < eps) {
        gaps.push({ axis, a: LL[P] + LL[S], b: L[P], at });
        gaps.push({ axis, a: L[P] + L[S], b: box[P], at });
      }
    }
    if (!(L && R && Math.abs(gl - gr) < eps) && R && gr > 0) {
      const RR = row.filter((o) => o !== R && o[P] >= R[P] + R[S]).sort((a, b) => a[P] - b[P])[0];
      if (RR && Math.abs(RR[P] - (R[P] + R[S]) - gr) < eps) {
        gaps.push({ axis, a: box[P] + box[S], b: R[P], at });
        gaps.push({ axis, a: R[P] + R[S], b: RR[P], at });
      }
    }
  }
  return { guides, gaps };
}

/** Snap one moving edge (during resize) to the nearest line within tolerance. */
export function snapEdge(edge: number, axis: 'x' | 'y', others: Rect[], tol: number): number | null {
  let best: number | null = null;
  for (const o of others) {
    const lines = axis === 'x' ? [o.x, o.x + o.w / 2, o.x + o.w] : [o.y, o.y + o.h / 2, o.y + o.h];
    for (const l of lines) if (Math.abs(l - edge) <= tol && (best === null || Math.abs(l - edge) < Math.abs(best - edge))) best = l;
  }
  return best;
}
