import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { api, type TrashItem } from '../api';
import { ConfirmDialog } from './ui';

function ago(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

/** Slide-in drawer listing images removed from canvases, with restore and permanent delete. */
export function TrashPanel(props: {
  open: boolean;
  activeProjectId: string | null;
  onRestored: (restored: { id: string; projectId: string }[]) => void;
  onClose: () => void;
  toast: (text: string, tone?: 'info' | 'error') => void;
}) {
  const [mounted, setMounted] = useState(props.open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (props.open) {
      setMounted(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => (raf2 = requestAnimationFrame(() => setShown(true))));
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setShown(false);
  }, [props.open]);

  if (!mounted) return null;
  return <Panel {...props} shown={shown} onExited={() => !props.open && setMounted(false)} />;
}

function Panel({
  open,
  shown,
  activeProjectId,
  onRestored,
  onClose,
  onExited,
  toast,
}: {
  open: boolean;
  shown: boolean;
  activeProjectId: string | null;
  onRestored: (restored: { id: string; projectId: string }[]) => void;
  onClose: () => void;
  onExited: () => void;
  toast: (text: string, tone?: 'info' | 'error') => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[] } | { all: true } | null>(null);

  const load = () =>
    api
      .listTrash()
      .then(setItems)
      .catch((err) => toast(err.message, 'error'));

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.scrim') && onClose();
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest('[data-trash-toggle], .scrim')) return;
      onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down, true);
    };
  }, [open, onClose]);

  const restore = async (ids: string[]) => {
    if (!activeProjectId) return;
    try {
      const { restored } = await api.restoreTrash(ids, activeProjectId);
      setItems((list) => list && list.filter((i) => !ids.includes(i.id)));
      onRestored(restored);
      toast(restored.length > 1 ? `Restored ${restored.length} images` : 'Image restored');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const purge = async (target: { ids: string[] } | { all: true }) => {
    try {
      await api.purgeTrash(target);
      setItems((list) => ('all' in target ? [] : list && list.filter((i) => !target.ids.includes(i.id))));
      toast('Deleted forever');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const count = items?.length ?? 0;

  return (
    <aside
      ref={ref}
      className={`settings trash${shown ? ' shown' : ''}`}
      aria-label="Recently deleted"
      aria-hidden={!open}
      inert={!open}
      onTransitionEnd={(e) => e.target === ref.current && e.propertyName === 'opacity' && onExited()}
    >
      <header className="settings-head">
        <div>
          <div className="settings-title">Recently deleted</div>
          <div className="settings-sub">Images removed from canvases stay here until you delete them forever.</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close recently deleted">
          <X />
        </button>
      </header>

      <div className="settings-body trash-body">
        {items === null ? null : count === 0 ? (
          <div className="trash-empty">Nothing here. Deleted images will show up in this list.</div>
        ) : (
          <div className="trash-grid">
            {items.map((t) => (
              <figure key={t.id} className="trash-card">
                <div className="trash-thumb">
                  <img
                    src={t.src}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={(e) => e.currentTarget.classList.add('missing')}
                  />
                  <div className="trash-actions">
                    <button className="btn secondary small" onClick={() => restore([t.id])} data-tip="Restore">
                      <RotateCcw size={13} /> Restore
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => setConfirm({ ids: [t.id] })}
                      data-tip="Delete forever"
                      aria-label="Delete forever"
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
                <figcaption>
                  <span className="trash-project">
                    {t.projectName}
                    {!t.projectExists && <em> (deleted)</em>}
                  </span>
                  <span className="trash-when">{ago(t.deletedAt)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      {count > 0 && (
        <footer className="trash-foot">
          <button className="btn secondary" onClick={() => restore(items!.map((i) => i.id))}>
            Restore all
          </button>
          <button className="btn danger-ghost" onClick={() => setConfirm({ all: true })}>
            Empty
          </button>
        </footer>
      )}

      {confirm &&
        createPortal(
        <ConfirmDialog
          title={'all' in confirm ? `Delete all ${count} images forever?` : 'Delete this image forever?'}
          text="This can’t be undone. Image files that no canvas uses are removed from disk."
          confirmLabel="Delete forever"
          onConfirm={() => purge(confirm)}
          onClose={() => setConfirm(null)}
        />,
          // Outside the drawer: its slide transform would trap a fixed-position dialog.
          document.querySelector('.app') ?? document.body,
        )}
    </aside>
  );
}
