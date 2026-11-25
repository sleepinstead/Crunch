import { useEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';

/* ---------- color math ---------- */

type HSV = { h: number; s: number; v: number };

export function hexToHsv(hex: string): HSV {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (
    '#' +
    [f(5), f(3), f(1)]
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Drag helper: calls `onMove` with 0–1 coordinates inside `el` while the pointer is down. */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onMove);
  cb.current = onMove;
  const handle = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    cb.current(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      handle(e);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) handle(e);
    },
  };
}

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

/** In-app color picker: saturation/brightness field, hue slider, eyedropper and hex input. */
export function ColorPicker({
  value,
  onChange,
  showHex = true,
}: {
  value: string;
  onChange: (hex: string) => void;
  showHex?: boolean;
}) {
  // Keep HSV locally so hue survives greys/black, where hex alone loses it.
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [hex, setHex] = useState(value);
  const last = useRef(value);

  useEffect(() => {
    if (value.toUpperCase() !== last.current.toUpperCase()) {
      setHsv(hexToHsv(value));
      last.current = value;
    }
    setHex(value);
  }, [value]);

  const commit = (next: HSV) => {
    setHsv(next);
    const out = hsvToHex(next);
    last.current = out;
    setHex(out);
    onChange(out);
  };

  const field = useDrag((x, y) => commit({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => commit({ ...hsv, h: Math.min(359.9, x * 360) }));

  const keyNudge = (e: React.KeyboardEvent, which: 'field' | 'hue') => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    if (which === 'hue') commit({ ...hsv, h: Math.min(359.9, Math.max(0, hsv.h + (d[0] || d[1]) * 360)) });
    else commit({ ...hsv, s: clamp01(hsv.s + d[0]), v: clamp01(hsv.v + d[1]) });
  };

  const Dropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const pureHue = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className="cp">
      <div
        {...field}
        className="cp-field"
        style={{ backgroundColor: pureHue }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={hex}
        onKeyDown={(e) => keyNudge(e, 'field')}
      >
        <div className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>

      <div className="cp-row">
        {Dropper && (
          <button
            className="icon-btn"
            title="Pick a color from the screen"
            aria-label="Pick a color from the screen"
            onClick={async () => {
              try {
                const { sRGBHex } = await new Dropper().open();
                if (/^#[0-9a-f]{6}$/i.test(sRGBHex)) commit(hexToHsv(sRGBHex));
              } catch {
                /* cancelled */
              }
            }}
          >
            <Pipette />
          </button>
        )}
        <div
          {...hue}
          className="cp-hue"
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onKeyDown={(e) => keyNudge(e, 'hue')}
        >
          <div className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: pureHue }} />
        </div>
      </div>

      {showHex && (
      <div className="cp-row">
        <span className="cp-preview" style={{ background: hex }} />
        <input
          className="input hex"
          value={hex}
          spellCheck={false}
          maxLength={7}
          aria-label="Hex color"
          onChange={(e) => {
            const v = (e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`).toUpperCase();
            setHex(v);
            if (/^#[0-9A-F]{6}$/.test(v)) {
              setHsv(hexToHsv(v));
              last.current = v;
              onChange(v);
            }
          }}
          onBlur={() => setHex(value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      )}
    </div>
  );
}
