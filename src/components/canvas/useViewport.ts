// The viewport: pan and zoom state, saving it, animating between views, fitting content.
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { api, type Item, type View } from '../../api';
import { boundsOf, type Rect } from '../../geometry';
import { reducedMotion } from '../../settings';
import { clampZoom, DOCK_SPACE } from './constants';

export function useViewport(o: {
  projectId: string;
  onViewSaved: (v: View) => void;
  rootRef: RefObject<HTMLDivElement | null>;
  viewRef: MutableRefObject<View>;
  setViewState: Dispatch<SetStateAction<View>>;
  setBgOffset: Dispatch<SetStateAction<{ x: number; y: number }>>;
  saveTimer: MutableRefObject<number | undefined>;
  anim: MutableRefObject<number | undefined>;
  itemsRef: MutableRefObject<Record<string, Item>>;
  selRef: MutableRefObject<Set<string>>;
}) {
  const { onViewSaved, rootRef, viewRef, setViewState, setBgOffset, saveTimer, anim, itemsRef, selRef } = o;
  const project = { id: o.projectId };

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
    const r = rootRef.current?.getBoundingClientRect() ?? {
      width: window.innerWidth,
      height: window.innerHeight,
      left: 0,
      top: 0,
    };
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  };

  const toWorld = useCallback((cx: number, cy: number) => {
    const v = viewRef.current;
    const r = rootRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
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
      const c0 = {
        x: (w / 2 - from.x) / from.zoom,
        y: (h / 2 - from.y) / from.zoom,
      };
      const c1 = {
        x: (w / 2 - target.x) / target.zoom,
        y: (h / 2 - target.y) / target.zoom,
      };
      const start = performance.now();
      const dur = reducedMotion() ? 0 : 320;
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
      animateTo({
        zoom,
        x: w / 2 - (b.x + b.w / 2) * zoom,
        y: (h - DOCK_SPACE) / 2 - (b.y + b.h / 2) * zoom,
      });
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

  return { saveView, setView, size, toWorld, zoomAt, animateTo, fitRect, zoomToFit, zoomBy, zoomTo };
}
