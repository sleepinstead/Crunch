// Placement maths: hit tests on rotated layers, tidy rows for new images, finding free space.
import { RAD } from './constants';
import { type Asset, type Item } from '../../api';
import { aabb, boundsOf, type Rect } from '../../geometry';

/** Axis-aligned box around a (possibly rotated) item. */
/** Does the (possibly rotated) item actually overlap an axis-aligned rect? */
export function hitsRect(i: Item, r: Rect): boolean {
  const a = aabb(i);
  if (!(a.x < r.x + r.w && a.x + a.w > r.x && a.y < r.y + r.h && a.y + a.h > r.y)) return false;
  if (!i.rotation) return true;
  // Separating-axis test on the item's own two axes (the rect's axes were covered above).
  const t = i.rotation * RAD;
  const cx = i.x + i.w / 2;
  const cy = i.y + i.h / 2;
  const ux = [Math.cos(t), Math.sin(t)];
  const uy = [-Math.sin(t), Math.cos(t)];
  const pts = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  for (const [ax, half] of [
    [ux, i.w / 2],
    [uy, i.h / 2],
  ] as const) {
    const c = cx * ax[0] + cy * ax[1];
    const proj = pts.map(([x, y]) => x * ax[0] + y * ax[1]);
    if (Math.max(...proj) < c - half || Math.min(...proj) > c + half) return false;
  }
  return true;
}

export const normDeg = (d: number) => {
  const n = ((((d + 180) % 360) + 360) % 360) - 180;
  return Math.abs(n) < 1e-6 ? 0 : n;
};

/** Lay new images out in tidy rows of equal height, centered on a point. */
export function layout(assets: Asset[], center: { x: number; y: number }, zoom: number, gapPx = 20, scale = 1) {
  const single = assets.length === 1;
  const rowH = ((single ? 420 : 300) * scale) / zoom;
  const maxW = ((single ? 560 : 520) * scale) / zoom;
  const gap = gapPx / zoom;
  const sizes = assets.map((a) => {
    const s = Math.min(1, rowH / a.height, maxW / a.width);
    return { w: a.width * s, h: a.height * s };
  });
  const rowLimit = Math.max(maxW, Math.min(assets.length, Math.ceil(Math.sqrt(assets.length * 1.4))) * (rowH * 1.1 + gap));
  const rows: number[][] = [[]];
  let rowW = 0;
  sizes.forEach((s, i) => {
    const row = rows[rows.length - 1];
    if (row.length && rowW + gap + s.w > rowLimit) {
      rows.push([i]);
      rowW = s.w;
    } else {
      row.push(i);
      rowW += (row.length > 1 ? gap : 0) + s.w;
    }
  });
  const rowHeights = rows.map((r) => Math.max(...r.map((i) => sizes[i].h)));
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
  const out: Rect[] = [];
  let y = center.y - totalH / 2;
  rows.forEach((r, ri) => {
    const width = r.reduce((a, i) => a + sizes[i].w, 0) + gap * (r.length - 1);
    let x = center.x - width / 2;
    for (const i of r) {
      out[i] = {
        x,
        y: y + (rowHeights[ri] - sizes[i].h) / 2,
        w: sizes[i].w,
        h: sizes[i].h,
      };
      x += sizes[i].w + gap;
    }
    y += rowHeights[ri] + gap;
  });
  return out;
}

/** Shift a block of rects to the nearest spot (spiraling outward) where it covers nothing. */
export function avoidOverlap(rects: Rect[], existing: Rect[], zoom: number, gapPx = 20): Rect[] {
  const block = boundsOf(rects);
  if (!block || !existing.length) return rects;
  const gap = gapPx / zoom;
  const hits = (dx: number, dy: number) =>
    existing.some(
      (e) =>
        block.x + dx < e.x + e.w + gap &&
        block.x + dx + block.w + gap > e.x &&
        block.y + dy < e.y + e.h + gap &&
        block.y + dy + block.h + gap > e.y,
    );
  if (!hits(0, 0)) return rects;
  const step = Math.max(40 / zoom, Math.min(block.w, block.h) / 4);
  for (let ring = 1; ring < 60; ring++) {
    const n = ring * 8;
    let best: { dx: number; dy: number } | null = null;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const dx = Math.cos(a) * ring * step;
      const dy = Math.sin(a) * ring * step;
      if (!hits(dx, dy) && (!best || Math.abs(dy) < Math.abs(best.dy))) best = { dx, dy };
    }
    if (best) return rects.map((r) => ({ ...r, x: r.x + best.dx, y: r.y + best.dy }));
  }
  return rects;
}

/**
 * Background pattern in screen space: spacing and dot size never change with
 * zoom (only images scale), but it follows the canvas when you pan.
 */
