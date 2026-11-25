import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- dismiss helpers ---------- */

/**
 * Escape closes only the topmost open layer (a colour picker inside a popover inside
 * a panel closes just the picker). Layers register in mount order; one window listener,
 * installed before any component's, hands Escape to the newest and stops it there.
 */
const escapeStack: { current: () => void }[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !escapeStack.length) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      escapeStack[escapeStack.length - 1].current();
    },
    true,
  );
}

export function useEscapeLayer(onEscape: () => void, active = true) {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    if (!active) return;
    escapeStack.push(handler);
    return () => {
      const i = escapeStack.lastIndexOf(handler);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

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
    window.addEventListener('pointerdown', down, true);
    if (closeOnBlur) window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', onClose);
    };
  }, [ref, ignore, onClose, closeOnBlur]);
  useEscapeLayer(onClose);
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
  // Close immediately for the app, but let a copy fade out where it stood (no lingering state).
  const close = useCallback(() => {
    const el = ref.current;
    if (el?.parentElement) {
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.classList.add('menu-out');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.pointerEvents = 'none';
      el.parentElement.appendChild(ghost);
      window.setTimeout(() => ghost.remove(), 160);
    }
    onClose();
  }, [onClose]);
  useDismiss(ref, close);
  const pos = useClamp(ref, x, y, [entries.length]);
  // Grow from the corner nearest the cursor (flips when the menu is pushed left/up by the screen edge).
  const origin = `${pos.left < x - 1 ? 'right' : 'left'} ${pos.top < y - 1 ? 'bottom' : 'top'}`;
  return (
    <div
      ref={ref}
      className="menu menu-in"
      style={{ ...pos, transformOrigin: origin }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
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
              close();
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

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus: moves focus in (to an autofocus element, else the first control),
 * keeps Tab inside, and returns focus to whatever opened it when it closes.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const back = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      if (el.contains(document.activeElement)) return;
      (el.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [ref]);
}

export function Dialog({
  onClose,
  children,
  width = 380,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** Accessible name when the dialog has no `.dialog-title`. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref);
  useEscapeLayer(onClose);
  useEffect(() => {
    const title = ref.current?.querySelector('.dialog-title');
    if (title && !title.id) title.id = titleId;
  });
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="dialog pop-in"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        tabIndex={-1}
      >
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
        {/* Focus starts on Cancel: Enter right away must never destroy anything. */}
        <button className="btn secondary" autoFocus onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn danger"
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
  // Errors are announced right away; other messages wait for a pause.
  return (
    <div className="toasts">
      <div aria-live="polite">
        {toasts
          .filter((t) => t.tone !== 'error')
          .map((t) => (
            <div key={t.id} className="toast pop-in info">
              {t.text}
            </div>
          ))}
      </div>
      <div role="alert">
        {toasts
          .filter((t) => t.tone === 'error')
          .map((t) => (
            <div key={t.id} className="toast pop-in error">
              {t.text}
            </div>
          ))}
      </div>
    </div>
  );
}

/* ---------- tooltips ---------- */

/**
 * One app-wide tooltip for anything with `data-tip`. A trailing "(…)" is shown as a
 * shortcut chip. Appears after a short pause, then instantly while moving between controls.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ label: string; keys?: string; x: number; y: number; below: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const warmUntil = useRef(0);
  const target = useRef<Element | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      if (target.current) warmUntil.current = performance.now() + 500;
      target.current = null;
      setTip(null);
    };
    const show = (el: Element) => {
      const raw = el.getAttribute('data-tip');
      if (!raw) return;
      const m = /^(.*?)\s*\(([^()]+)\)$/.exec(raw);
      const r = el.getBoundingClientRect();
      const below = r.top < 44;
      setTip({
        label: m ? m[1] : raw,
        keys: m ? m[2] : undefined,
        x: r.left + r.width / 2,
        y: below ? r.bottom + 8 : r.top - 8,
        below,
      });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null;
      if (el === target.current) return;
      window.clearTimeout(timer.current);
      if (!el) return hide();
      target.current = el;
      setTip(null);
      const delay = performance.now() < warmUntil.current ? 0 : 800;
      timer.current = window.setTimeout(() => target.current === el && show(el), delay);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Keep it on screen once its size is known.
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    const left = tip.x - r.width / 2;
    setDx(left < 8 ? 8 - left : left + r.width > window.innerWidth - 8 ? window.innerWidth - 8 - (left + r.width) : 0);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className={`tooltip${tip.below ? ' below' : ''}`}
      role="tooltip"
      style={{ left: tip.x + dx, top: tip.y }}
    >
      {tip.label}
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  );
}
