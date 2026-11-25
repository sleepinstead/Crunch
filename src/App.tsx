import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Project, type View } from './api';
import { isDark } from './color';
import { Canvas } from './components/Canvas';
import { Dock } from './components/Dock';
import { ConfirmDialog, Dialog, Toasts, Tooltips, type ToastMsg } from './components/ui';
import { SettingsPanel } from './components/SettingsPanel';
import { TrashPanel } from './components/TrashPanel';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './settings';

const ACTIVE_KEY = 'crunch.activeProject';
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const M = IS_MAC ? '⌘' : 'Ctrl';
const SHORTCUTS: [string, string][] = [
  [`${M} V`, 'Paste image or link'],
  ['Drop', 'Add files or web images'],
  ['Drag empty canvas', 'Select area'],
  ['Space + drag', 'Pan'],
  ['Scroll', 'Pan'],
  [`Pinch / ${M} scroll`, 'Zoom'],
  ['⇧ 1', 'Zoom to fit'],
  ['⇧ 0', 'Zoom to 100%'],
  ['Double-click', 'Focus an image'],
  ['⌥ drag', 'Duplicate while moving'],
  ['Drag outside a corner', 'Rotate (⇧ snaps 15°)'],
  ['⇧ R', 'Rotate 90°'],
  ['T, then click', 'Add text'],
  ['Double-click / ↵', 'Edit text'],
  [`${M} D`, 'Duplicate'],
  ['[  ]', 'Send back / bring front'],
  [`${M} Z`, 'Undo'],
  [`${M} ,`, 'Settings'],
  ['⌫', 'Delete'],
  ['⌥ 1–9', 'Switch project'],
];

export function App() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => store.get(ACTIVE_KEY));
  const [renameId, setRenameId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [panel, setPanel] = useState<'settings' | 'trash' | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const settingsOpen = panel === 'settings';
  const togglePanel = (which: 'settings' | 'trash') => setPanel((p) => (p === which ? null : which));
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 2600);
  }, []);

  useEffect(() => {
    api
      .listProjects()
      .then((ps) => {
        setProjects(ps);
        setActiveId((cur) => (ps.some((p) => p.id === cur) ? cur : ps[0].id));
      })
      .catch((err) => toast(`Couldn’t load projects: ${err.message}`, 'error'));
  }, [toast]);

  useEffect(() => {
    api
      .getSettings()
      .then((raw) => setSettings(normalizeSettings(raw)))
      .catch(() => {});
  }, []);

  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((s) => ({ ...s, ...patch }));
      api.updateSettings(patch).catch((err) => toast(`Couldn’t save settings: ${err.message}`, 'error'));
    },
    [toast],
  );
  const closePanel = useCallback(() => setPanel(null), []);

  // App-level "reduce motion" (in addition to the system setting).
  useEffect(() => {
    if (settings.reduceMotion === 'on') document.documentElement.dataset.reduceMotion = 'on';
    else delete document.documentElement.dataset.reduceMotion;
  }, [settings.reduceMotion]);

  useEffect(() => {
    if (activeId) store.set(ACTIVE_KEY, activeId);
  }, [activeId]);

  // Pinch / ⌘-scroll anywhere outside the canvas (dock, settings, popovers) must not zoom the
  // whole page. The canvas handles its own zoom.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && !(e.target as Element | null)?.closest?.('.canvas')) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault(); // Safari pinch
    window.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('gesturestart', onGesture);
    document.addEventListener('gesturechange', onGesture);
    return () => {
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('gesturestart', onGesture);
      document.removeEventListener('gesturechange', onGesture);
    };
  }, []);

  // Never let the browser navigate away when something is dropped outside the canvas.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const patchLocal = useCallback((id: string, patch: Partial<Project>) => {
    setProjects((ps) => ps && ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  // Changes apply instantly; the server write is batched per project (color dragging fires many).
  const pendingSave = useRef(new Map<string, { patch: Partial<Project>; timer: number }>());
  const save = useCallback(
    (id: string, patch: Partial<Pick<Project, 'name' | 'pattern' | 'bgColor' | 'density'>>) => {
      patchLocal(id, patch);
      const prev = pendingSave.current.get(id);
      if (prev) window.clearTimeout(prev.timer);
      const merged = { ...prev?.patch, ...patch };
      const timer = window.setTimeout(() => {
        pendingSave.current.delete(id);
        api.updateProject(id, merged).catch((err) => toast(`Couldn’t save: ${err.message}`, 'error'));
      }, 250);
      pendingSave.current.set(id, { patch: merged, timer });
    },
    [patchLocal, toast],
  );

  const create = useCallback(async () => {
    try {
      const p = await api.createProject('Untitled');
      setProjects((ps) => [...(ps ?? []), p]);
      setActiveId(p.id);
      setRenameId(p.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [toast]);

  const remove = useCallback(
    async (target: Project) => {
      try {
        await api.deleteProject(target.id);
        const rest = (projects ?? []).filter((p) => p.id !== target.id);
        if (!rest.length) {
          const p = await api.createProject('Inspiration');
          rest.push(p);
        }
        setProjects(rest);
        if (activeId === target.id) {
          const idx = (projects ?? []).findIndex((p) => p.id === target.id);
          setActiveId(rest[Math.max(0, Math.min(idx, rest.length - 1))].id);
        }
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    },
    [projects, activeId, toast],
  );

  const reorder = useCallback(
    (ids: string[]) => {
      setProjects((ps) => ps && ids.map((id) => ps.find((p) => p.id === id)!).filter(Boolean));
      api.reorderProjects(ids).catch((err) => toast(err.message, 'error'));
    },
    [toast],
  );

  // ⌥1–9 switches project; ? shows shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setPanel((p) => (p === 'settings' ? null : 'settings'));
        return;
      }
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector('.scrim')) return;
      if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code) && projects) {
        const p = projects[Number(e.code.slice(5)) - 1];
        if (p) {
          e.preventDefault();
          setActiveId(p.id);
        }
      } else if (e.key === '?') setShowKeys((s) => !s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projects]);

  const active = projects?.find((p) => p.id === activeId) ?? null;

  useEffect(() => {
    document.title = active ? `${active.name} — Crunch` : 'Crunch';
  }, [active?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const onViewSaved = useCallback((v: View) => activeId && patchLocal(activeId, { view: v }), [activeId, patchLocal]);

  return (
    <div
      className="app"
      data-tone={
        settings.uiTheme === 'auto' ? (active && isDark(active.bgColor) ? 'dark' : 'light') : settings.uiTheme
      }
      data-shadow={settings.imageShadow || undefined}
      style={{ ['--item-radius' as string]: `${settings.imageRadius}px` }}
    >
      {active && projects && (
        <Canvas
          key={active.id}
          project={active}
          onViewSaved={onViewSaved}
          toast={toast}
          settings={settings}
          reloadSignal={reloadSignal}
          chrome={(canvas, interacting) => (
            <Dock
              projects={projects}
              active={active}
              renameId={renameId}
              setRenameId={setRenameId}
              onSelect={setActiveId}
              onCreate={create}
              onRename={(id, name) => save(id, { name })}
              onDelete={setConfirmDelete}
              onReorder={reorder}
              onBackground={(patch) => save(active.id, patch)}
              onShowKeys={() => setShowKeys(true)}
              settingsOpen={settingsOpen}
              onToggleSettings={() => togglePanel('settings')}
              trashOpen={panel === 'trash'}
              onToggleTrash={() => togglePanel('trash')}
              canvas={canvas}
              quiet={interacting && settings.fadeDock}
            />
          )}
        />
      )}
      {settings.showName && <div className="brand">Crunch</div>}
      <SettingsPanel open={settingsOpen} settings={settings} onChange={changeSettings} onClose={closePanel} />
      <TrashPanel
        open={panel === 'trash'}
        activeProjectId={activeId}
        toast={toast}
        onClose={closePanel}
        onRestored={(restored) => {
          if (restored.some((r) => r.projectId === activeId)) setReloadSignal((n) => n + 1);
          const elsewhere = restored.find((r) => r.projectId !== activeId);
          if (elsewhere) {
            const name = projects?.find((p) => p.id === elsewhere.projectId)?.name;
            if (name) toast(`Restored to “${name}”`);
          }
        }}
      />
      <Toasts toasts={toasts} />
      <Tooltips />
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${confirmDelete.name}”?`}
          text="This removes the project and its canvas. Its images move to Recently deleted."
          confirmLabel="Delete project"
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
      {showKeys && (
        <Dialog onClose={() => setShowKeys(false)} width={400}>
          <div className="dialog-title">Shortcuts</div>
          <dl className="keys">
            {SHORTCUTS.map(([k, label]) => (
              <div key={label + k} className="keys-row">
                <dt>{label}</dt>
                <dd>
                  <kbd>{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
    </div>
  );
}
