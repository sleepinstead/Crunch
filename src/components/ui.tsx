import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- dismiss helpers ---------- */

function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  ignore?: React.RefObject<HTMLElement | null>,
  closeOnBlur = true,
) {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || ignore?.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    if (closeOnBlur) window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
    };
  }, [ref, ignore, onClose, closeOnBlur]);
}

/** Keep a fixed-position element inside the viewport. */
function useClamp(ref: React.RefObject<HTMLElement | null>, x: number, y: number, deps: unknown[] = []) {
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const m = 8;
    setPos({
      left: Math.max(m, Math.min(x, window.innerWidth - r.width - m)),
      top: Math.max(m, Math.min(y, window.innerHeight - r.height - m)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps]);
  return pos;
}

/* ---------- context menu ---------- */

export type MenuEntry =
  | 'sep'
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

export function Menu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const pos = useClamp(ref, x, y, [entries.length]);
  return (
    <div ref={ref} className="menu pop-in" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {entries.map((e, i) =>
        e === 'sep' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${e.danger ? ' danger' : ''}`}
            disabled={e.disabled}
            onClick={() => {
              onClose();
              e.onSelect();
            }}
          >
            <span className="menu-icon">{e.icon}</span>
            <span className="menu-label">{e.label}</span>
            {e.shortcut && <kbd className="menu-kbd">{e.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

/* ---------- popover anchored above an element ---------- */

export function Popover({
  anchor,
  onClose,
  children,
  className = '',
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement>(anchor);
  anchorRef.current = anchor;
  // Stay open on window blur: the system color picker takes focus while in use.
  useDismiss(ref, onClose, anchorRef, false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(a.left + a.width / 2 - r.width / 2, window.innerWidth - r.width - 8));
      setPos({ left, top: Math.max(8, a.top - r.height - 10) });
    };
    place();
    // Re-anchor when the content changes size (e.g. a section expands).
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor]);
  return (
    <div ref={ref} className={`popover pop-in ${className}`} style={pos ?? { visibility: 'hidden' }}>
      {children}
    </div>
  );
}

/* ---------- modal dialog ---------- */

export function Dialog({ onClose, children, width = 380 }: { onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog pop-in" style={{ width }} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function UrlDialog({ onSubmit, onClose }: { onSubmit: (url: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const valid = /^(https?:\/\/|data:image\/)\S+$/i.test(value.trim());
  return (
    <Dialog onClose={onClose} width={440}>
      <form
        className="url-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSubmit(value.trim());
          onClose();
        }}
      >
        <div className="dialog-title">Add image from URL</div>
        <div className="dialog-text">Paste an image link or a page link. The image is downloaded and kept on this machine.</div>
        <div className="input-row">
          <input
            autoFocus
            className="input"
            placeholder="https://…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
          />
          <button className="btn primary" type="submit" disabled={!valid}>
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={onClose}>
      <div className="dialog-title">{title}</div>
      <div className="dialog-text">{text}</div>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn danger"
          autoFocus
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- toasts ---------- */

export interface ToastMsg {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export function Toasts({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast pop-in ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
