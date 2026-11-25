// Saving layers: an ordered outbox, recovery after a failed write, other tabs kept
// in step, and a last flush when the page is closing.
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { api, type Item, type View } from '../../api';
import type { Change, Entry, Mode } from './types';

export function useLayerSync(o: {
  projectId: string;
  reloadSignal?: number;
  toast: (text: string, tone?: 'info' | 'error') => void;
  itemsRef: MutableRefObject<Record<string, Item>>;
  setItems: (next: Record<string, Item>) => void;
  newTextId: MutableRefObject<string | null>;
  measureSave: MutableRefObject<Map<string, number>>;
  saveTimer: MutableRefObject<number | undefined>;
  viewRef: MutableRefObject<View>;
  mode: MutableRefObject<Mode | null>;
  hist: { undo: Entry[]; redo: Entry[] };
  queue: MutableRefObject<Promise<unknown>>;
}) {
  const { reloadSignal, toast, itemsRef, newTextId, measureSave, saveTimer, viewRef, mode, hist, queue } = o;
  const project = { id: o.projectId };
  // The canvas's setter changes identity every render; always call the latest.
  const setItemsRef = useRef(o.setItems);
  setItemsRef.current = o.setItems;
  const setItems = (next: Record<string, Item>) => setItemsRef.current(next);

  /** Unsent changes, latest per layer. Sent in order through `queue`. */
  const outbox = useRef<Change>({});
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const splitChange = (change: Change) => ({
    ups: Object.values(change).filter((i): i is Item => !!i),
    dels: Object.keys(change).filter((id) => !change[id]),
  });

  // After a failed save, reload from the server (once every queued write has finished),
  // so the screen never shows unsaved state. A text box still being typed survives.
  const resync = useCallback(() => {
    queue.current = queue.current
      .then(() => api.listItems(project.id))
      .then((list) => {
        if (!alive.current) return;
        const next = Object.fromEntries(list.map((i) => [i.id, i]));
        const editingNew = newTextId.current && itemsRef.current[newTextId.current];
        if (editingNew) next[editingNew.id] = editingNew;
        setItems(next);
      })
      .catch(() => {});
  }, [project.id]);

  useEffect(() => {
    if (!reloadSignal) return;
    // Layers came back from Recently deleted: old undo steps may describe a state that no longer exists.
    hist.undo.length = 0;
    hist.redo.length = 0;
    resync();
  }, [reloadSignal, resync, hist]);

  const sendOutbox = useCallback(async () => {
    const change = outbox.current;
    outbox.current = {};
    const { ups, dels } = splitChange(change);
    if (ups.length) await api.upsertItems(ups);
    if (dels.length) await api.deleteItems(dels);
  }, []);

  // Other tabs on the same board reload after this one saves (and vice versa).
  // The channel is opened by the effect itself, so React's mount/unmount/remount in
  // development never leaves a closed channel behind.
  const channel = useRef<BroadcastChannel | null>(null);
  const tabId = useMemo(() => Math.random().toString(36).slice(2), []);
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('crunch');
    channel.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data as { project?: string; from?: string };
      if (msg.project === project.id && msg.from !== tabId && !mode.current && !Object.keys(outbox.current).length) resync();
    };
    return () => {
      if (channel.current === ch) channel.current = null;
      ch.close();
    };
  }, [project.id, resync, tabId]);
  // Telling other tabs is best-effort: it must never turn a successful save into an error.
  const announce = useCallback(() => {
    try {
      channel.current?.postMessage({ project: project.id, from: tabId });
    } catch {
      /* channel closed: nothing to tell */
    }
  }, [project.id, tabId]);

  // Closing or hiding the tab: send everything still waiting, in a way that survives the page going away.
  useEffect(() => {
    const flush = () => {
      for (const [id, t] of measureSave.current) {
        window.clearTimeout(t);
        const cur = itemsRef.current[id];
        if (cur) outbox.current[id] = cur;
      }
      measureSave.current.clear();
      const typing = newTextId.current ? itemsRef.current[newTextId.current] : null;
      if (typing && typing.text?.trim()) outbox.current[typing.id] = typing;
      const { ups, dels } = splitChange(outbox.current);
      outbox.current = {};
      if (ups.length) api.upsertItems(ups, true).catch(() => {});
      if (dels.length) api.deleteItems(dels, true).catch(() => {});
      if (saveTimer.current !== undefined) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
        api.updateProject(project.id, { view: viewRef.current }, true).catch(() => {});
      }
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [project.id]);

  const persist = useCallback(
    (change: Change) => {
      const valid = Object.values(change).every((i) => !i || [i.x, i.y, i.w, i.h, i.z, i.rotation ?? 0].every(Number.isFinite));
      if (!valid) {
        toast('Couldn’t save: a layer had an invalid size or position.', 'error');
        resync();
        return;
      }
      Object.assign(outbox.current, change);
      queue.current = queue.current
        .then(sendOutbox)
        .then(announce)
        .catch((err: Error) => {
          toast(`Couldn’t save: ${err.message}`, 'error');
          resync();
        });
    },
    [toast, resync, sendOutbox, announce],
  );

  return { persist, resync };
}
