import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  ExternalLink,
  Image as ImageIcon,
  ImageOff,
  Link2,
  Maximize,
  RotateCcw,
  RotateCw,
  MousePointer2,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, type Asset, type Item, type Project, type View } from '../api';
import { CRUNCH_ASSET_ATTR, hostOf, readClipboard, readTransfer, resolveSource, type Source } from '../ingest';
import { isDark } from '../color';
import { GAP_PX, SIZE_SCALE, type Settings } from '../settings';
import { Menu, UrlDialog, type MenuEntry } from './ui';

export interface CanvasApi {
  zoom: number;
  zoomBy: (factor: number) => void;
  zoomTo: (zoom: number) => void;
  zoomToFit: () => void;
}

type Change = Record<string, Item | null>;
interface Entry {
  before: Change;
  after: Change;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Mode =
  | { type: 'pan'; sx: number; sy: number; vx: number; vy: number; started: boolean }
  | {
      type: 'move';
      sx: number;
      sy: number;
      wx: number;
      wy: number;
      origIds: string[];
      ids: string[];
      base: Record<string, Item>;
      before: Change;
      moved: boolean;
      alt: boolean;
      reduceTo: string | null;
    }
  | {
      type: 'resize';
      id: string;
      before: Item;
      ax: number;
      ay: number;
      dirX: number;
      dirY: number;
      ratio: number;
    }
  | { type: 'rotate'; id: string; cx: number; cy: number; start: number; before: Item }
  | { type: 'marquee'; wx: number; wy: number; base: Set<string> };

interface Props {
  project: Project;
  onViewSaved: (view: View) => void;
  toast: (text: string, tone?: 'info' | 'error') => void;
  chrome: (api: CanvasApi, interacting: boolean) => ReactNode;
  settings: Settings;
  /** Bumped by the parent when items changed elsewhere (e.g. restored from Recently deleted). */
  reloadSignal?: number;
}

export const TAB_DRAG_TYPE = 'application/x-crunch-tab';
const MIN_ZOOM = 0.03;
const MAX_ZOOM = 10;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const uid = (): string => crypto.randomUUID();
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl ';
const DOCK_SPACE = 88;

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const modalOpen = () => !!document.querySelector('.scrim');
/** Focus is inside settings, a popover or a menu: canvas shortcuts stay out of the way. */
const inPanel = (t: EventTarget | null) => t instanceof Element && !!t.closest('.settings, .popover, .menu');
const onControl = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('button, a, [role="tab"], [role="switch"], [role="radio"]');

const RAD = Math.PI / 180;

/** Undo history per project, kept for the whole session (survives switching tabs). */
const histories = new Map<string, { undo: Entry[]; redo: Entry[] }>();
const historyFor = (id: string) => {
  let h = histories.get(id);
  if (!h) histories.set(id, (h = { undo: [], redo: [] }));
  return h;
};

/** Axis-aligned box around a (possibly rotated) item. */
function aabb(i: Rect & { rotation?: number }): Rect {
  const r = (i.rotation ?? 0) * RAD;
  if (!r) return { x: i.x, y: i.y, w: i.w, h: i.h };
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = i.w * c + i.h * s;
  const h = i.w * s + i.h * c;
  return { x: i.x + i.w / 2 - w / 2, y: i.y + i.h / 2 - h / 2, w, h };
}

function boundsOf(items: (Rect & { rotation?: number })[]): Rect | null {
  if (!items.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const it of items) {
    const i = aabb(it);
    x1 = Math.min(x1, i.x);
    y1 = Math.min(y1, i.y);
    x2 = Math.max(x2, i.x + i.w);
    y2 = Math.max(y2, i.y + i.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Does the (possibly rotated) item actually overlap an axis-aligned rect? */
function hitsRect(i: Item, r: Rect): boolean {
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

const normDeg = (d: number) => {
  const n = (((d + 180) % 360) + 360) % 360 - 180;
  return Math.abs(n) < 1e-6 ? 0 : n;
};

/** Lay new images out in tidy rows of equal height, centered on a point. */
function layout(assets: Asset[], center: { x: number; y: number }, zoom: number, gapPx = 20, scale = 1) {
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
      out[i] = { x, y: y + (rowHeights[ri] - sizes[i].h) / 2, w: sizes[i].w, h: sizes[i].h };
      x += sizes[i].w + gap;
    }
    y += rowHeights[ri] + gap;
  });
  return out;
}

/** Shift a block of rects to the nearest spot (spiraling outward) where it covers nothing. */
function avoidOverlap(rects: Rect[], existing: Rect[], zoom: number, gapPx = 20): Rect[] {
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
function backgroundStyle(project: Project, v: { x: number; y: number }): CSSProperties {
  const style: CSSProperties = { backgroundColor: project.bgColor };
  if (project.pattern === 'plain') return style;
  const dark = isDark(project.bgColor);
  const density = project.density || 1;
  const rgb = dark ? '255,255,255' : '0,0,0';
  const scale = Math.pow(density, 0.8);

  if (project.pattern === 'dots') {
    const step = 22 / scale;
    const r = 1.1 * Math.min(1, Math.pow(density, -0.3));
    style.backgroundImage = `radial-gradient(circle at ${step / 2}px ${step / 2}px, rgba(${rgb},0.17) ${r}px, transparent ${r + 0.7}px)`;
    style.backgroundSize = `${step}px ${step}px`;
    style.backgroundPosition = `${v.x - step / 2}px ${v.y - step / 2}px`;
  } else {
    const step = 32 / scale;
    const a = dark ? 0.07 : 0.065;
    style.backgroundImage = `linear-gradient(to right, rgba(${rgb},${a}) 1px, transparent 1px), linear-gradient(to bottom, rgba(${rgb},${a}) 1px, transparent 1px)`;
    style.backgroundSize = `${step}px ${step}px`;
    style.backgroundPosition = `${v.x}px ${v.y}px`;
  }
  return style;
}

const ItemView = memo(function ItemView({ item }: { item: Item }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className="item"
      data-item-id={item.id}
      style={{
        transform: `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`,
        width: item.w,
        height: item.h,
      }}
    >
      {broken ? (
        <div className="item-broken" title="The browser can’t display this file. It is still saved in your library.">
          <ImageOff />
          <span>Can’t display this image</span>
        </div>
      ) : (
        <img src={item.src} alt="" draggable={false} decoding="async" onError={() => setBroken(true)} />
      )}
    </div>
  );
});

export function Canvas({ project, onViewSaved, toast, chrome, settings, reloadSignal }: Props) {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [items, setItemsState] = useState<Record<string, Item>>({});
  const itemsRef = useRef(items);
  const setItems = (next: Record<string, Item>) => {
    itemsRef.current = next;
    setItemsState(next);
  };

  const [selection, setSelState] = useState<Set<string>>(new Set());
  const selRef = useRef(selection);
  const setSelection = (s: Set<string>) => {
    selRef.current = s;
    setSelState(s);
  };

  const [view, setViewState] = useState<View>(project.view);
  const viewRef = useRef(view);
  // The pattern is screen-sized, so it follows pans only; zooming leaves it still.
  const [bgOffset, setBgOffset] = useState({ x: project.view.x, y: project.view.y });
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<(Rect & { id: string })[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [rotLabel, setRotLabel] = useState<{ x: number; y: number; deg: number } | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'canvas' | 'item'; world: { x: number; y: number } } | null>(null);
  const [urlDialogAt, setUrlDialogAt] = useState<{ x: number; y: number } | null>(null);

  const mode = useRef<Mode | null>(null);
  const spaceRef = useRef(false);
  const pointer = useRef<{ x: number; y: number; inside: boolean }>({ x: 0, y: 0, inside: false });
  const hist = useMemo(() => historyFor(project.id), [project.id]);
  const lastNudge = useRef<{ key: string; t: number; entry: Entry } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimer = useRef<number | undefined>(undefined);
  const anim = useRef<number | undefined>(undefined);
  const uploadAt = useRef<{ x: number; y: number } | undefined>(undefined);

  /* ---------- viewport ---------- */

  const saveView = useCallback(
    (v: View) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined;
        api.updateProject(project.id, { view: v }).catch(() => {});
        onViewSaved(v);
      }, 350);
    },
    [project.id, onViewSaved],
  );

  const setView = useCallback(
    (v: View) => {
      const prev = viewRef.current;
      if (v.zoom === prev.zoom) {
        const dx = v.x - prev.x;
        const dy = v.y - prev.y;
        if (dx || dy) setBgOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
      }
      viewRef.current = v;
      setViewState(v);
      saveView(v);
    },
    [saveView],
  );

  // Flush the viewport when switching projects.
  useEffect(
    () => () => {
      if (saveTimer.current !== undefined) {
        window.clearTimeout(saveTimer.current);
        api.updateProject(project.id, { view: viewRef.current }).catch(() => {});
        onViewSaved(viewRef.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const size = () => {
    const r = rootRef.current!.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  };

  const toWorld = useCallback((cx: number, cy: number) => {
    const v = viewRef.current;
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  }, []);

  const zoomAt = useCallback(
    (sx: number, sy: number, zoom: number) => {
      const v = viewRef.current;
      const z = clampZoom(zoom);
      const wx = (sx - v.x) / v.zoom;
      const wy = (sy - v.y) / v.zoom;
      setView({ zoom: z, x: sx - wx * z, y: sy - wy * z });
    },
    [setView],
  );

  const animateTo = useCallback(
    (target: View) => {
      if (anim.current) cancelAnimationFrame(anim.current);
      const { w, h } = size();
      const from = viewRef.current;
      const c0 = { x: (w / 2 - from.x) / from.zoom, y: (h / 2 - from.y) / from.zoom };
      const c1 = { x: (w / 2 - target.x) / target.zoom, y: (h / 2 - target.y) / target.zoom };
      const start = performance.now();
      const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
      const step = (now: number) => {
        const t = dur ? Math.min(1, (now - start) / dur) : 1;
        const e = 1 - Math.pow(1 - t, 3);
        const z = from.zoom * Math.pow(target.zoom / from.zoom, e);
        const cx = c0.x + (c1.x - c0.x) * e;
        const cy = c0.y + (c1.y - c0.y) * e;
        setView({ zoom: z, x: w / 2 - cx * z, y: h / 2 - cy * z });
        if (t < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [setView],
  );

  const fitRect = useCallback(
    (b: Rect, maxZoom: number) => {
      const { w, h } = size();
      const pad = 64;
      const zoom = clampZoom(Math.min((w - pad * 2) / b.w, (h - pad * 2 - DOCK_SPACE) / b.h, maxZoom));
      animateTo({ zoom, x: w / 2 - (b.x + b.w / 2) * zoom, y: (h - DOCK_SPACE) / 2 - (b.y + b.h / 2) * zoom });
    },
    [animateTo],
  );

  const zoomToFit = useCallback(() => {
    const sel = [...selRef.current].map((id) => itemsRef.current[id]).filter(Boolean);
    const b = boundsOf(sel.length ? sel : Object.values(itemsRef.current));
    if (b) fitRect(b, 1);
    else {
      const { w, h } = size();
      animateTo({ zoom: 1, x: w / 2, y: h / 2 });
    }
  }, [fitRect, animateTo]);

  const zoomBy = useCallback(
    (f: number) => {
      const { w, h } = size();
      const v = viewRef.current;
      const z = clampZoom(v.zoom * f);
      const wx = (w / 2 - v.x) / v.zoom;
      const wy = (h / 2 - v.y) / v.zoom;
      animateTo({ zoom: z, x: w / 2 - wx * z, y: h / 2 - wy * z });
    },
    [animateTo],
  );

  /** Zoom to 100% returns to where the canvas started: origin centered on screen. */
  const zoomTo = useCallback(
    (zoom: number) => {
      const { w, h } = size();
      animateTo({ zoom: clampZoom(zoom), x: w / 2, y: (h - DOCK_SPACE) / 2 });
    },
    [animateTo],
  );

  /* ---------- load ---------- */

  useEffect(() => {
    let alive = true;
    api
      .listItems(project.id)
      .then((list) => {
        if (!alive) return;
        // Keep anything added while the canvas was still loading.
        setItems({ ...Object.fromEntries(list.map((i) => [i.id, i])), ...itemsRef.current });
        const v = viewRef.current;
        // Fresh project: put the world origin in the middle of the screen.
        if (v.x === 0 && v.y === 0 && v.zoom === 1) {
          const { w, h } = size();
          if (list.length) {
            const b = boundsOf(list)!;
            const zoom = clampZoom(Math.min((w - 128) / b.w, (h - 128 - DOCK_SPACE) / b.h, 1));
            setView({ zoom, x: w / 2 - (b.x + b.w / 2) * zoom, y: (h - DOCK_SPACE) / 2 - (b.y + b.h / 2) * zoom });
          } else setView({ zoom: 1, x: w / 2, y: (h - DOCK_SPACE) / 2 });
        }
        setLoaded(true);
      })
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  /* ---------- changes, persistence, history ---------- */

  // After a failed save, reload from the server so the screen never shows unsaved state.
  const resync = useCallback(() => {
    api
      .listItems(project.id)
      .then((list) => setItems(Object.fromEntries(list.map((i) => [i.id, i]))))
      .catch(() => {});
  }, [project.id]);

  useEffect(() => {
    if (reloadSignal) resync();
  }, [reloadSignal, resync]);

  const persist = useCallback(
    (change: Change) => {
      const ups = Object.values(change).filter((i): i is Item => !!i);
      const dels = Object.keys(change).filter((id) => !change[id]);
      const fail = (err: Error) => {
        toast(`Couldn’t save: ${err.message}`, 'error');
        resync();
      };
      if (ups.length) queue.current = queue.current.then(() => api.upsertItems(ups)).catch(fail);
      if (dels.length) queue.current = queue.current.then(() => api.deleteItems(dels)).catch(fail);
    },
    [toast, resync],
  );

  const apply = useCallback(
    (change: Change) => {
      const next = { ...itemsRef.current };
      for (const [id, it] of Object.entries(change)) {
        if (it) next[id] = it;
        else delete next[id];
      }
      setItems(next);
      persist(change);
    },
    [persist],
  );

  const commit = useCallback(
    (before: Change, after: Change) => {
      hist.undo.push({ before, after });
      if (hist.undo.length > 200) hist.undo.shift();
      hist.redo.length = 0;
      apply(after);
    },
    [apply, hist],
  );

  const travel = useCallback(
    (dir: 'undo' | 'redo') => {
      const from = dir === 'undo' ? hist.undo : hist.redo;
      const to = dir === 'undo' ? hist.redo : hist.undo;
      const entry = from.pop();
      if (!entry) return;
      to.push(entry);
      const target = dir === 'undo' ? entry.before : entry.after;
      apply(target);
      setSelection(new Set(Object.keys(target).filter((id) => target[id])));
    },
    [apply, hist],
  );

  const maxZ = () => Object.values(itemsRef.current).reduce((m, i) => Math.max(m, i.z), 0);
  const selectedItems = () =>
    [...selRef.current]
      .map((id) => itemsRef.current[id])
      .filter(Boolean)
      .sort((a, b) => a.z - b.z);

  const deleteSelection = useCallback(() => {
    const sel = selectedItems();
    if (!sel.length) return;
    commit(Object.fromEntries(sel.map((i) => [i.id, i])), Object.fromEntries(sel.map((i) => [i.id, null])));
    setSelection(new Set());
  }, [commit]);

  const duplicateSelection = useCallback(() => {
    const sel = selectedItems();
    if (!sel.length) return;
    const off = 24 / viewRef.current.zoom;
    let z = maxZ();
    const copies = sel.map((i) => ({ ...i, id: uid(), x: i.x + off, y: i.y + off, z: ++z }));
    commit(Object.fromEntries(copies.map((c) => [c.id, null])), Object.fromEntries(copies.map((c) => [c.id, c])));
    setSelection(new Set(copies.map((c) => c.id)));
  }, [commit]);

  const restack = useCallback(
    (where: 'front' | 'back') => {
      const sel = selectedItems();
      if (!sel.length) return;
      const all = Object.values(itemsRef.current);
      let z = where === 'front' ? maxZ() : Math.min(...all.map((i) => i.z)) - sel.length - 1;
      const after = Object.fromEntries(sel.map((i) => [i.id, { ...i, z: ++z }]));
      commit(Object.fromEntries(sel.map((i) => [i.id, i])), after);
    },
    [commit],
  );

  const rotateSelection = useCallback(
    (by: number | 'reset') => {
      const sel = selectedItems();
      if (!sel.length) return;
      commit(
        Object.fromEntries(sel.map((i) => [i.id, i])),
        Object.fromEntries(
          sel.map((i) => [i.id, { ...i, rotation: by === 'reset' ? 0 : normDeg((i.rotation ?? 0) + by) }]),
        ),
      );
    },
    [commit],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const sel = selectedItems();
      if (!sel.length) return;
      const k = 1 / viewRef.current.zoom;
      const after: Change = Object.fromEntries(sel.map((i) => [i.id, { ...i, x: i.x + dx * k, y: i.y + dy * k }]));
      // A run of nudges on the same selection is one undo step.
      const key = sel.map((i) => i.id).join();
      const now = performance.now();
      const last = lastNudge.current;
      if (last && last.key === key && now - last.t < 1000 && hist.undo[hist.undo.length - 1] === last.entry) {
        last.entry.after = after;
        last.t = now;
        apply(after);
        return;
      }
      commit(Object.fromEntries(sel.map((i) => [i.id, i])), after);
      lastNudge.current = { key, t: now, entry: hist.undo[hist.undo.length - 1] };
    },
    [commit, apply, hist],
  );

  const copySelection = useCallback(async () => {
    const sel = selectedItems();
    if (!sel.length) return;
    const html = sel
      .map((i) => `<img src="${location.origin}${i.src}" ${CRUNCH_ASSET_ATTR}="${i.assetId}">`)
      .join('');
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const png = (async () => {
      const blob = await (await fetch(sel[sel.length - 1].src)).blob();
      if (blob.type === 'image/png') return blob;
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      return c.convertToBlob({ type: 'image/png' });
    })();
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'image/png': png })]);
    } catch {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob })]);
      } catch {
        toast('Couldn’t copy to the clipboard', 'error');
        return;
      }
    }
    toast(sel.length > 1 ? `Copied ${sel.length} images` : 'Copied image');
  }, [toast]);

  /* ---------- adding images ---------- */

  const ingest = useCallback(
    async (sources: Source[], at?: { x: number; y: number }, exact = false) => {
      if (!sources.length) return;
      const v = viewRef.current;
      const { w, h } = size();
      const center = at ?? { x: (w / 2 - v.x) / v.zoom, y: ((h - DOCK_SPACE) / 2 - v.y) / v.zoom };

      // Placeholders while files upload / download.
      const gapPx = GAP_PX[settingsRef.current.imageGap];
      const scale = SIZE_SCALE[settingsRef.current.imageSize];
      const place = (rects: Rect[]) =>
        exact ? rects : avoidOverlap(rects, Object.values(itemsRef.current).map(aabb), v.zoom, gapPx);
      const ph = place(
        layout(
          sources.map(() => ({ id: '', src: '', width: 4, height: 3, sourceUrl: null })),
          center,
          v.zoom,
          gapPx,
          scale,
        ),
      ).map((r) => ({ ...r, id: uid() }));
      setPending((p) => [...p, ...ph]);

      const results = await Promise.allSettled(sources.map(resolveSource));
      setPending((p) => p.filter((x) => !ph.includes(x)));

      const assets: Asset[] = [];
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') assets.push(r.value);
        else {
          const s = sources[i];
          const where = s.kind === 'url' ? ` from ${hostOf(s.url)}` : '';
          errors.push(`Couldn’t add image${where} — ${(r.reason as Error).message}`);
        }
      });
      if (errors.length) toast(errors.length > 1 ? `${errors.length} images couldn’t be added. ${errors[0]}` : errors[0], 'error');
      if (!assets.length) return;

      const rects = place(layout(assets, center, v.zoom, gapPx, scale));
      let z = maxZ();
      const created: Item[] = assets.map((a, i) => ({
        id: uid(),
        projectId: project.id,
        assetId: a.id,
        ...rects[i],
        z: ++z,
        src: a.src,
        rotation: 0,
        naturalW: a.width,
        naturalH: a.height,
        sourceUrl: a.sourceUrl,
      }));
      commit(Object.fromEntries(created.map((c) => [c.id, null])), Object.fromEntries(created.map((c) => [c.id, c])));
      setSelection(new Set(created.map((c) => c.id)));

      // If the new images landed off-screen, glide them into view.
      const b = boundsOf(created)!;
      const cv = viewRef.current;
      const sx1 = b.x * cv.zoom + cv.x;
      const sy1 = b.y * cv.zoom + cv.y;
      const sx2 = sx1 + b.w * cv.zoom;
      const sy2 = sy1 + b.h * cv.zoom;
      const vw = size().w;
      const vh = size().h - DOCK_SPACE;
      if (sx1 < 0 || sy1 < 0 || sx2 > vw || sy2 > vh) {
        if (b.w * cv.zoom > vw - 64 || b.h * cv.zoom > vh - 64) fitRect(b, cv.zoom);
        else {
          const dx = sx1 < 32 ? 32 - sx1 : sx2 > vw - 32 ? vw - 32 - sx2 : 0;
          const dy = sy1 < 32 ? 32 - sy1 : sy2 > vh - 16 ? vh - 16 - sy2 : 0;
          animateTo({ ...cv, x: cv.x + dx, y: cv.y + dy });
        }
      }
    },
    [commit, project.id, toast, fitRect, animateTo],
  );

  /** Esc during a drag/resize/rotate/selection puts everything back. */
  const cancelGesture = () => {
    const m = mode.current;
    if (!m) return false;
    mode.current = null;
    setInteracting(false);
    setPanning(false);
    setRotLabel(null);
    if (m.type === 'move') {
      if (m.moved) {
        const next = { ...itemsRef.current };
        for (const [id, it] of Object.entries(m.before)) {
          if (it) next[id] = it;
          else delete next[id];
        }
        setItems(next);
      }
      setSelection(new Set(m.origIds));
    } else if (m.type === 'resize' || m.type === 'rotate') {
      setItems({ ...itemsRef.current, [m.id]: m.before });
    } else if (m.type === 'marquee') {
      setMarquee(null);
      setSelection(m.base);
    } else if (m.type === 'pan') {
      setView({ ...viewRef.current, x: m.vx, y: m.vy });
    }
    return true;
  };

  const pointerWorld = () => (pointer.current.inside ? toWorld(pointer.current.x, pointer.current.y) : undefined);

  const pasteFromMenu = useCallback(
    async (at: { x: number; y: number }) => {
      try {
        const sources = await readClipboard();
        if (sources.length) ingest(sources, at);
        else toast('The clipboard has no image or image link');
      } catch {
        toast(`Press ${MOD}V to paste`, 'info');
      }
    },
    [ingest, toast],
  );

  /* ---------- global listeners ---------- */

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || modalOpen()) return;
      const sources = readTransfer(e.clipboardData);
      if (!sources.length) {
        if (e.clipboardData?.getData('text/plain').trim()) toast('Paste an image or an image link to add it');
        return;
      }
      e.preventDefault();
      ingest(sources, pointerWorld());
    };
    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target) || modalOpen() || !selRef.current.size) return;
      e.preventDefault();
      copySelection();
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('copy', onCopy);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingest, copySelection, toast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target) || modalOpen() || inPanel(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (k === 'escape' && cancelGesture()) {
        e.preventDefault();
        return;
      }
      if (e.code === 'Space') {
        // Let a focused button or tab handle Space itself.
        if (onControl(e.target)) return;
        e.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceDown(true);
        }
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        travel(e.shiftKey ? 'redo' : 'undo');
      } else if (mod && k === 'y') {
        e.preventDefault();
        travel('redo');
      } else if (mod && k === 'a') {
        e.preventDefault();
        setSelection(new Set(Object.keys(itemsRef.current)));
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        zoomBy(1.25);
      } else if (mod && k === '-') {
        e.preventDefault();
        zoomBy(0.8);
      } else if (mod && k === '0') {
        e.preventDefault();
        zoomTo(1);
      } else if (mod) {
        return;
      } else if (k === 'backspace' || k === 'delete') {
        e.preventDefault();
        deleteSelection();
      } else if (k === 'escape') {
        if (!document.querySelector('.settings.shown')) setSelection(new Set());
      } else if (e.shiftKey && e.code === 'Digit1') {
        zoomToFit();
      } else if (e.shiftKey && e.code === 'Digit0') {
        zoomTo(1);
      } else if (e.shiftKey && e.code === 'KeyR') {
        rotateSelection(90);
      } else if (k === ']') {
        restack('front');
      } else if (k === '[') {
        restack('back');
      } else if (k === '=' || k === '+') {
        zoomBy(1.25);
      } else if (k === '-') {
        zoomBy(0.8);
      } else if (k.startsWith('arrow') && selRef.current.size) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };
    const onBlur = () => {
      spaceRef.current = false;
      setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [travel, duplicateSelection, deleteSelection, zoomBy, zoomTo, zoomToFit, restack, nudge, rotateSelection]);

  // Wheel: two-finger scroll pans, pinch / ⌘-scroll zooms toward the cursor.
  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (anim.current) cancelAnimationFrame(anim.current);
      const r = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      const v = viewRef.current;
      const wheelZooms = settingsRef.current.wheel === 'zoom' && !e.shiftKey;
      if (e.ctrlKey || e.metaKey || wheelZooms) {
        const dy = Math.max(-60, Math.min(60, e.deltaY * unit));
        zoomAt(e.clientX - r.left, e.clientY - r.top, v.zoom * Math.exp(-dy * 0.012));
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView({ ...v, x: v.x - dx * unit, y: v.y - dy * unit });
      }
    };
    // Safari pinch
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', prevent);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', prevent);
    };
  }, [zoomAt, setView]);

  /* ---------- pointer interactions ---------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (anim.current) cancelAnimationFrame(anim.current);
    const target = e.target as HTMLElement;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const v = viewRef.current;

    if (e.button === 1 || spaceRef.current) {
      e.preventDefault();
      mode.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, started: true };
      setPanning(true);
      setInteracting(true);
      return;
    }

    const handle = target.closest<HTMLElement>('[data-handle]');
    if (handle) {
      const id = handle.dataset.for!;
      const it = itemsRef.current[id];
      const name = handle.dataset.handle!; // corner (nw…) or edge (n, e, s, w)
      const dirX = name.includes('w') ? -1 : name.includes('e') ? 1 : 0;
      const dirY = name.includes('n') ? -1 : name.includes('s') ? 1 : 0;
      // The anchor is the opposite corner, in world space (accounting for rotation).
      const r = (it.rotation ?? 0) * RAD;
      const ox = (-dirX * it.w) / 2;
      const oy = (-dirY * it.h) / 2;
      mode.current = {
        type: 'resize',
        id,
        before: it,
        ax: it.x + it.w / 2 + ox * Math.cos(r) - oy * Math.sin(r),
        ay: it.y + it.h / 2 + ox * Math.sin(r) + oy * Math.cos(r),
        dirX,
        dirY,
        ratio: it.w / it.h,
      };
      setInteracting(true);
      return;
    }

    const rot = target.closest<HTMLElement>('[data-rotate]');
    if (rot) {
      const it = itemsRef.current[rot.dataset.for!];
      const p = toWorld(e.clientX, e.clientY);
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      mode.current = { type: 'rotate', id: it.id, cx, cy, start: Math.atan2(p.y - cy, p.x - cx), before: it };
      setInteracting(true);
      return;
    }

    const el = target.closest<HTMLElement>('[data-item-id]');
    if (el) {
      const id = el.dataset.itemId!;
      let sel = new Set(selRef.current);
      let reduceTo: string | null = null;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (sel.has(id)) {
          sel.delete(id);
          setSelection(sel);
          mode.current = null;
          return;
        }
        sel.add(id);
      } else if (!sel.has(id)) sel = new Set([id]);
      else if (sel.size > 1) reduceTo = id;
      setSelection(sel);
      const ids = [...sel].filter((i) => itemsRef.current[i]);
      const pw = toWorld(e.clientX, e.clientY);
      mode.current = {
        type: 'move',
        sx: e.clientX,
        sy: e.clientY,
        wx: pw.x,
        wy: pw.y,
        origIds: ids,
        ids,
        base: Object.fromEntries(ids.map((i) => [i, itemsRef.current[i]])),
        before: {},
        moved: false,
        alt: e.altKey,
        reduceTo,
      };
      return;
    }

    const w = toWorld(e.clientX, e.clientY);
    const base = e.shiftKey ? new Set(selRef.current) : new Set<string>();
    if (!e.shiftKey) setSelection(new Set());
    mode.current = { type: 'marquee', wx: w.x, wy: w.y, base };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    pointer.current = { x: e.clientX, y: e.clientY, inside: true };
    const m = mode.current;
    if (!m) return;
    const v = viewRef.current;

    if (m.type === 'pan') {
      if (!m.started) {
        if (Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 3) return;
        m.started = true;
        setInteracting(true);
      }
      setView({ ...v, x: m.vx + e.clientX - m.sx, y: m.vy + e.clientY - m.sy });
    } else if (m.type === 'move') {
      const dsx = e.clientX - m.sx;
      const dsy = e.clientY - m.sy;
      if (!m.moved) {
        if (Math.hypot(dsx, dsy) < 3) return;
        m.moved = true;
        setInteracting(true);
        let z = maxZ();
        const order = [...m.ids].sort((a, b) => m.base[a].z - m.base[b].z);
        if (m.alt) {
          // ⌥-drag duplicates
          const copies = order.map((id) => ({ ...m.base[id], id: uid(), z: ++z }));
          m.ids = copies.map((c) => c.id);
          m.base = Object.fromEntries(copies.map((c) => [c.id, c]));
          m.before = Object.fromEntries(copies.map((c) => [c.id, null]));
          setSelection(new Set(m.ids));
        } else {
          for (const id of order) {
            m.before[id] = m.base[id];
            m.base[id] = { ...m.base[id], z: ++z };
          }
        }
      }
      // Track the pointer in world space so zooming mid-drag doesn't make images jump.
      const pw = toWorld(e.clientX, e.clientY);
      const dx = pw.x - m.wx;
      const dy = pw.y - m.wy;
      const next = { ...itemsRef.current };
      for (const id of m.ids) next[id] = { ...m.base[id], x: m.base[id].x + dx, y: m.base[id].y + dy };
      setItems(next);
    } else if (m.type === 'resize') {
      const p = toWorld(e.clientX, e.clientY);
      const a = (m.before.rotation ?? 0) * RAD;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Pointer relative to the anchor, in the image's own (unrotated) frame.
      const dx = p.x - m.ax;
      const dy = p.y - m.ay;
      const sx = (dx * cos + dy * sin) * m.dirX;
      const sy = (-dx * sin + dy * cos) * m.dirY;
      // Project onto the diagonal so the aspect ratio is kept.
      const r = m.ratio;
      const min = 16 / v.zoom;
      let w: number;
      if (!m.dirY) w = Math.max(min, sx); // left/right edge
      else if (!m.dirX) w = Math.max(min, sy) * r; // top/bottom edge
      else w = Math.max(min, (sx + sy / r) / (1 + 1 / (r * r))); // corner
      const h = w / r;
      const hx = (m.dirX * w) / 2;
      const hy = (m.dirY * h) / 2;
      const cx = m.ax + hx * cos - hy * sin;
      const cy = m.ay + hx * sin + hy * cos;
      setItems({ ...itemsRef.current, [m.id]: { ...m.before, w, h, x: cx - w / 2, y: cy - h / 2 } });
    } else if (m.type === 'rotate') {
      const p = toWorld(e.clientX, e.clientY);
      let deg = (m.before.rotation ?? 0) + (Math.atan2(p.y - m.cy, p.x - m.cx) - m.start) / RAD;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else {
        // Gentle magnet at right angles.
        const right = Math.round(deg / 90) * 90;
        if (Math.abs(deg - right) < 2.5) deg = right;
      }
      deg = normDeg(deg);
      setRotLabel({ x: e.clientX, y: e.clientY, deg });
      setItems({ ...itemsRef.current, [m.id]: { ...m.before, rotation: deg } });
    } else if (m.type === 'marquee') {
      const p = toWorld(e.clientX, e.clientY);
      const rect = { x: Math.min(m.wx, p.x), y: Math.min(m.wy, p.y), w: Math.abs(p.x - m.wx), h: Math.abs(p.y - m.wy) };
      if (rect.w * v.zoom < 3 && rect.h * v.zoom < 3) return;
      if (!marquee) setInteracting(true);
      setMarquee(rect);
      const hit = new Set(m.base);
      for (const item of Object.values(itemsRef.current)) if (hitsRect(item, rect)) hit.add(item.id);
      setSelection(hit);
    }
  };

  const endPointer = () => {
    const m = mode.current;
    mode.current = null;
    setInteracting(false);
    setPanning(false);
    setRotLabel(null);
    if (!m) return;
    if (m.type === 'move') {
      if (m.moved) commit(m.before, Object.fromEntries(m.ids.map((id) => [id, itemsRef.current[id]])));
      else if (m.reduceTo) setSelection(new Set([m.reduceTo]));
    } else if (m.type === 'resize') {
      const now = itemsRef.current[m.id];
      if (now && (now.w !== m.before.w || now.h !== m.before.h)) commit({ [m.id]: m.before }, { [m.id]: now });
    } else if (m.type === 'rotate') {
      const now = itemsRef.current[m.id];
      if (now && now.rotation !== m.before.rotation) commit({ [m.id]: m.before }, { [m.id]: now });
    } else if (m.type === 'marquee') {
      setMarquee(null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
    if (!el) return;
    const it = itemsRef.current[el.dataset.itemId!];
    if (it) fitRect(aabb(it), Math.max(1, it.naturalW / it.w));
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const world = toWorld(e.clientX, e.clientY);
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
    if (el) {
      const id = el.dataset.itemId!;
      if (!selRef.current.has(id)) setSelection(new Set([id]));
      setMenu({ x: e.clientX, y: e.clientY, kind: 'item', world });
    } else {
      setMenu({ x: e.clientX, y: e.clientY, kind: 'canvas', world });
    }
  };

  /* ---------- drag & drop ---------- */

  const accepts = (dt: DataTransfer) =>
    !dt.types.includes(TAB_DRAG_TYPE) &&
    (dt.types.includes('Files') || dt.types.includes('text/uri-list') || dt.types.includes('text/html'));

  const onDragOver = (e: React.DragEvent) => {
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.relatedTarget || !rootRef.current!.contains(e.relatedTarget as Node)) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    setDragOver(false);
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    const sources = readTransfer(e.dataTransfer);
    if (!sources.length) return toast('Nothing to add — drop images or image links');
    ingest(sources, toWorld(e.clientX, e.clientY), true);
  };

  /* ---------- render ---------- */

  const sorted = useMemo(() => Object.values(items).sort((a, b) => a.z - b.z), [items]);
  const selected = sorted.filter((i) => selection.has(i.id));
  const empty = loaded && sorted.length === 0 && pending.length === 0;
  const dark = isDark(project.bgColor);

  const canvasApi: CanvasApi = { zoom: view.zoom, zoomBy, zoomTo, zoomToFit };

  const menuEntries = (): MenuEntry[] => {
    if (!menu) return [];
    if (menu.kind === 'canvas')
      return [
        { label: 'Paste', icon: <ClipboardPaste />, shortcut: `${MOD}V`, onSelect: () => pasteFromMenu(menu.world) },
        {
          label: 'Upload images…',
          icon: <Upload />,
          onSelect: () => {
            uploadAt.current = menu.world;
            fileInput.current?.click();
          },
        },
        { label: 'Add from URL…', icon: <Link2 />, onSelect: () => setUrlDialogAt(menu.world) },
        'sep',
        {
          label: 'Select all',
          icon: <MousePointer2 />,
          shortcut: `${MOD}A`,
          disabled: !sorted.length,
          onSelect: () => setSelection(new Set(Object.keys(itemsRef.current))),
        },
        { label: 'Zoom to fit', icon: <Maximize />, shortcut: '⇧1', onSelect: zoomToFit },
      ];
    const one = selected.length === 1 ? selected[0] : null;
    return [
      { label: 'Bring to front', icon: <ArrowUpToLine />, shortcut: ']', onSelect: () => restack('front') },
      { label: 'Send to back', icon: <ArrowDownToLine />, shortcut: '[', onSelect: () => restack('back') },
      'sep',
      { label: 'Rotate 90°', icon: <RotateCw />, shortcut: '⇧R', onSelect: () => rotateSelection(90) },
      ...(selected.some((i) => i.rotation)
        ? ([{ label: 'Reset rotation', icon: <RotateCcw />, onSelect: () => rotateSelection('reset') }] as MenuEntry[])
        : []),
      'sep',
      { label: 'Copy', icon: <Copy />, shortcut: `${MOD}C`, onSelect: copySelection },
      { label: 'Duplicate', icon: <CopyPlus />, shortcut: `${MOD}D`, onSelect: duplicateSelection },
      ...(one
        ? ([
            'sep',
            { label: 'Open image', icon: <ImageIcon />, onSelect: () => window.open(one.src, '_blank', 'noopener') },
            ...(one.sourceUrl && /^https?:/.test(one.sourceUrl)
              ? [
                  {
                    label: `Open source · ${hostOf(one.sourceUrl)}`,
                    icon: <ExternalLink />,
                    onSelect: () => window.open(one.sourceUrl!, '_blank', 'noopener'),
                  },
                ]
              : []),
          ] as MenuEntry[])
        : []),
      'sep',
      { label: 'Delete', icon: <Trash2 />, shortcut: '⌫', danger: true, onSelect: deleteSelection },
    ];
  };

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : undefined;

  return (
    <>
      <div
        ref={rootRef}
        className="canvas"
        data-tone={dark ? 'dark' : 'light'}
        style={{ ...backgroundStyle(project, bgOffset), cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => (pointer.current.inside = false)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          className={`world${interacting ? ' busy' : ''}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, ['--zoom' as string]: view.zoom }}
        >
          {sorted.map((it) => (
            <ItemView key={it.id} item={it} />
          ))}
          {pending.map((p) => (
            <div
              key={p.id}
              className="placeholder"
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: p.h }}
            />
          ))}
          <div className="overlay">
            {selected.map((it) => (
              <div
                key={it.id}
                className="sel-box"
                style={{
                  transform: `translate(${it.x}px, ${it.y}px)${it.rotation ? ` rotate(${it.rotation}deg)` : ''}`,
                  width: it.w,
                  height: it.h,
                }}
              >
                {selected.length === 1 &&
                  (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
                    <div key={`r${c}`} className={`rot ${c}`} data-rotate={c} data-for={it.id} />
                  ))}
                {selected.length === 1 &&
                  (['n', 'e', 's', 'w'] as const).map((e) => (
                    <div key={`e${e}`} className={`edge ${e}`} data-handle={e} data-for={it.id} />
                  ))}
                {selected.length === 1 &&
                  (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
                    <div key={c} className={`handle ${c}`} data-handle={c} data-for={it.id} />
                  ))}
              </div>
            ))}
            {marquee && (
              <div
                className="marquee"
                style={{ transform: `translate(${marquee.x}px, ${marquee.y}px)`, width: marquee.w, height: marquee.h }}
              />
            )}
          </div>
        </div>

        {empty && (
          <div className="empty">
            <div className="empty-title">Collect your first inspiration</div>
            <div className="empty-text">
              Paste an image or link with <kbd>{MOD}V</kbd>, or drop files anywhere.
            </div>
            <div className="empty-actions">
              <button
                className="btn secondary"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  uploadAt.current = undefined;
                  fileInput.current?.click();
                }}
              >
                <Upload size={14} /> Upload
              </button>
              <button
                className="btn secondary"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setUrlDialogAt(toWorld(window.innerWidth / 2, (window.innerHeight - DOCK_SPACE) / 2))}
              >
                <Link2 size={14} /> From URL
              </button>
            </div>
          </div>
        )}
        {selected.length > 0 &&
          !marquee &&
          (() => {
            const b = boundsOf(selected)!;
            const one = selected.length === 1 ? selected[0] : null;
            const w = one ? one.w : b.w;
            const h = one ? one.h : b.h;
            return (
              <div
                className="size-label"
                style={{ left: (b.x + b.w / 2) * view.zoom + view.x, top: (b.y + b.h) * view.zoom + view.y + 8 }}
              >
                {Math.round(w)} × {Math.round(h)}
              </div>
            );
          })()}
        {dragOver && <div className="drop-ring" />}
        {rotLabel && (
          <div className="rot-label" style={{ left: rotLabel.x + 14, top: rotLabel.y + 14 }}>
            {Math.round(rotLabel.deg)}°
          </div>
        )}
      </div>

      {chrome(canvasApi, interacting)}

      {menu && <Menu x={menu.x} y={menu.y} entries={menuEntries()} onClose={() => setMenu(null)} />}
      {urlDialogAt && (
        <UrlDialog
          onClose={() => setUrlDialogAt(null)}
          onSubmit={(url) => ingest([{ kind: 'url', url }], urlDialogAt)}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
          e.target.value = '';
          ingest(
            files.map((file) => ({ kind: 'file', file })),
            uploadAt.current,
          );
        }}
      />
    </>
  );
}
