import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ColorPicker } from './ColorPicker';
import { useEscapeLayer } from './ui';

export const TEXT_COLORS = ['#191919', '#FFFFFF', '#6B6B6B', '#E03E3E', '#D9730D', '#DFAB01', '#0F7B6C', '#2383E2', '#9065B0'];

/* ---------- Figma-style fill: chip + hex, picker in a popup ---------- */

export function FillRow({
  color,
  mixed = false,
  autoColor,
  allowAuto = true,
  title = 'Color',
  swatches = TEXT_COLORS,
  open,
  onOpen,
  onCommit,
  onPreview,
}: {
  color: string | null; // null = Auto (follows the canvas)
  mixed?: boolean;
  autoColor: string;
  /** Offer "Auto" (follow the canvas). Off for plain colors like backgrounds. */
  allowAuto?: boolean;
  /** Title in the popup. */
  title?: string;
  swatches?: string[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onCommit: (c: string | null) => void;
  onPreview: (c: string) => void;
}) {
  const chip = useRef<HTMLButtonElement>(null);
  const shown = color ?? autoColor;
  const [hex, setHex] = useState('');
  useEffect(() => setHex(mixed ? '' : color ? color.replace('#', '').toUpperCase() : ''), [color, mixed]);

  return (
    <>
      <div className="fill-row">
        <button
          ref={chip}
          className={`fill-chip${open ? ' on' : ''}`}
          style={{ background: mixed ? undefined : shown }}
          data-tip="Color"
          aria-label="Open color picker"
          aria-expanded={open}
          onClick={() => onOpen(!open)}
        >
          {mixed && <span className="fill-mixed" />}
        </button>
        <input
          className="fill-hex"
          value={hex}
          placeholder={mixed ? 'Mixed' : 'Auto'}
          spellCheck={false}
          maxLength={7}
          aria-label="Hex color"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setHex(e.target.value.replace('#', '').toUpperCase())}
          onBlur={() => {
            if (/^[0-9A-F]{6}$/.test(hex)) onCommit(`#${hex}`);
            else if (/^[0-9A-F]{3}$/.test(hex)) onCommit(`#${[...hex].map((c) => c + c).join('')}`);
            else setHex(mixed ? '' : color ? color.replace('#', '').toUpperCase() : '');
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {allowAuto &&
          (color ? (
            <button className="fill-auto" data-tip="Follow the canvas color (Auto)" onClick={() => onCommit(null)}>
              Auto
            </button>
          ) : (
            !mixed && <span className="fill-auto-tag">Auto</span>
          ))}
      </div>
      {open && chip.current && (
        <FillPopup
          anchor={chip.current}
          value={shown}
          isAuto={allowAuto && !color && !mixed}
          allowAuto={allowAuto}
          title={title}
          swatches={swatches}
          onClose={() => onOpen(false)}
          onPreview={onPreview}
          onCommit={onCommit}
        />
      )}
    </>
  );
}

function FillPopup({
  anchor,
  value,
  isAuto,
  allowAuto,
  title,
  swatches,
  onClose,
  onPreview,
  onCommit,
}: {
  anchor: HTMLElement;
  value: string;
  isAuto: boolean;
  allowAuto: boolean;
  title: string;
  swatches: string[];
  onClose: () => void;
  onPreview: (c: string) => void;
  onCommit: (c: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Sit beside the panel it came from (left of right-hand panels), level with the chip.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host = (anchor.closest('.sidebar, .settings, .bg-pop, .popover') ?? anchor).getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const onRight = host.left + host.width / 2 > window.innerWidth / 2;
    let left = onRight ? host.left - 10 - r.width : host.right + 10;
    if (left < 8 || left + r.width > window.innerWidth - 8) left = Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(a.top - 12, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [anchor, onClose]);
  // Escape closes only the picker, not the popover or panel it sits in.
  useEscapeLayer(onClose);

  return (
    <div
      ref={ref}
      className="popover fill-pop pop-in"
      style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}
      role="dialog"
      aria-label={title}
    >
      <div className="fill-pop-head">
        <span>{title}</span>
        {allowAuto && (
          <button className={`chip${isAuto ? ' on' : ''}`} data-tip="Follow the canvas color" onClick={() => onCommit(null)}>
            Auto
          </button>
        )}
      </div>
      <ColorPicker value={value} onChange={onPreview} />
      <div className="fill-pop-label">Swatches</div>
      <div className="fill-swatches" style={{ gridTemplateColumns: `repeat(${swatches.length}, 1fr)` }}>
        {swatches.map((c) => (
          <button
            key={c}
            className={`swatch small${!isAuto && value.toUpperCase() === c ? ' on' : ''}`}
            aria-pressed={!isAuto && value.toUpperCase() === c}
            style={{ background: c }}
            aria-label={c}
            data-tip={c}
            onClick={() => onCommit(c)}
          />
        ))}
      </div>
    </div>
  );
}

