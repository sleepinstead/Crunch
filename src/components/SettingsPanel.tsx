import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { api, type Stats } from '../api';
import type { Settings } from '../settings';
import { PATTERNS, SWATCHES } from './Dock';

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg compact" role="radiogroup" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          className={`seg-btn${value === o.value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Row({ title, text, children, stack }: { title: string; text?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row${stack ? ' stack' : ''}`}>
      <div className="set-copy">
        <div className="set-title">{title}</div>
        {text && <div className="set-text">{text}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

const formatBytes = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;

/**
 * Stays mounted through the exit so it can slide out. Uses CSS transitions
 * (not keyframes) so reopening mid-close reverses smoothly from where it is.
 */
export function SettingsPanel(props: {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(props.open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (props.open) {
      setMounted(true);
      // Two frames so the off-screen start position is painted before transitioning.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => (raf2 = requestAnimationFrame(() => setShown(true))));
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setShown(false);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) setMounted(false);
  }, [props.open]);

  if (!mounted) return null;
  return <Panel {...props} shown={shown} onExited={() => !props.open && setMounted(false)} />;
}

function Panel({
  open,
  shown,
  settings,
  onChange,
  onClose,
  onExited,
}: {
  open: boolean;
  shown: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onExited: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) api.stats().then(setStats).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.scrim') && onClose();
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest('[data-settings-toggle]')) return;
      onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down, true);
    };
  }, [open, onClose]);

  const s = settings;

  return (
    <aside
      ref={ref}
      className={`settings${shown ? ' shown' : ''}`}
      aria-label="Settings"
      aria-hidden={!open}
      inert={!open}
      onTransitionEnd={(e) => e.target === ref.current && e.propertyName === 'transform' && onExited()}
    >
      <header className="settings-head">
        <div>
          <div className="settings-title">Settings</div>
          <div className="settings-sub">Saved automatically on this machine.</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings">
          <X />
        </button>
      </header>

      <div className="settings-body">
        <section>
          <h3>Images</h3>
          <div className="set-card">
            <Row title="Corners">
              <Seg
                value={s.imageRadius}
                onChange={(v) => onChange({ imageRadius: v })}
                options={[
                  { value: 0, label: 'Square' },
                  { value: 4, label: 'Soft' },
                  { value: 10, label: 'Round' },
                ]}
              />
            </Row>
            <Row title="Shadow" text="Lift images off the canvas.">
              <Toggle label="Shadow" on={s.imageShadow} onChange={(v) => onChange({ imageShadow: v })} />
            </Row>
            <Row title="Size" text="For newly added images.">
              <Seg
                value={s.imageSize}
                onChange={(v) => onChange({ imageSize: v })}
                options={[
                  { value: 'small', label: 'S' },
                  { value: 'medium', label: 'M' },
                  { value: 'large', label: 'L' },
                ]}
              />
            </Row>
            <Row title="Spacing" text="Between images added together.">
              <Seg
                value={s.imageGap}
                onChange={(v) => onChange({ imageGap: v })}
                options={[
                  { value: 'tight', label: 'Tight' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'loose', label: 'Loose' },
                ]}
              />
            </Row>
          </div>
        </section>

        <section>
          <h3>Navigation</h3>
          <div className="set-card">
            <Row title="Scroll wheel" text="Zoom suits a mouse. Pan suits a trackpad; pinch still zooms.">
              <Seg
                value={s.wheel}
                onChange={(v) => onChange({ wheel: v })}
                options={[
                  { value: 'pan', label: 'Pan' },
                  { value: 'zoom', label: 'Zoom' },
                ]}
              />
            </Row>
          </div>
        </section>

        <section>
          <h3>Interface</h3>
          <div className="set-card">
            <Row title="Show app name">
              <Toggle label="Show app name" on={s.showName} onChange={(v) => onChange({ showName: v })} />
            </Row>
            <Row title="Fade dock while arranging" text="Dims the dock while you drag images.">
              <Toggle label="Fade dock while arranging" on={s.fadeDock} onChange={(v) => onChange({ fadeDock: v })} />
            </Row>
          </div>
        </section>

        <section>
          <h3>New projects</h3>
          <div className="set-card">
            <Row title="Pattern" stack>
              <Seg
                value={s.newPattern}
                onChange={(v) => onChange({ newPattern: v })}
                options={PATTERNS.map((p) => ({
                  value: p.id,
                  label: (
                    <>
                      {p.icon}
                      {p.label}
                    </>
                  ),
                }))}
              />
            </Row>
            <Row title="Background color" stack>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    className={`swatch${s.newColor.toUpperCase() === c ? ' on' : ''}`}
                    style={{ background: c }}
                    onClick={() => onChange({ newColor: c })}
                    aria-label={c}
                    title={c}
                  />
                ))}
              </div>
            </Row>
          </div>
        </section>

        <section>
          <h3>Storage</h3>
          <div className="set-card">
            <Row title="Library" text={stats ? `${stats.images} images · ${formatBytes(stats.bytes)} · ${stats.projects} projects` : '…'}>
              <span />
            </Row>
            <Row title="Location" text={stats?.imagesDir ?? '…'} stack>
              <button
                className="btn secondary small"
                disabled={!stats}
                onClick={async () => {
                  if (!stats) return;
                  try {
                    await navigator.clipboard.writeText(stats.imagesDir);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy path'}
              </button>
            </Row>
          </div>
        </section>
      </div>
    </aside>
  );
}
