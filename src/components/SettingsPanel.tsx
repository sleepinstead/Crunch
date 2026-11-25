import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { api, type Stats } from '../api';
import type { Settings } from '../settings';
import { PATTERNS, SWATCHES } from './Dock';
import { FillRow } from './FillRow';

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
  // Built once in idle time and kept, parked off-screen: opening is then only a
  // class change, so the slide never loses its first frames to a heavy mount.
  const [mounted, setMounted] = useState(props.open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ric(() => setMounted(true));
    return () => cancel(id);
  }, [mounted]);

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
  }, [props.open]);

  if (!mounted) return null;
  return <Panel {...props} shown={shown} onExited={() => {}} />;
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
  const [colorOpen, setColorOpen] = useState(false);

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
      onTransitionEnd={(e) => e.target === ref.current && e.propertyName === 'opacity' && onExited()}
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
            <Row title="Shadow">
              <Toggle label="Shadow" on={s.imageShadow} onChange={(v) => onChange({ imageShadow: v })} />
            </Row>
            <Row title="New image size">
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
            <Row title="New image spacing">
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
            <Row title="Keep original web file" text="Downloads the source image instead of the copied preview. Keeps GIFs animated.">
              <Toggle label="Keep original web file" on={s.preferOriginal} onChange={(v) => onChange({ preferOriginal: v })} />
            </Row>
          </div>
        </section>

        <section>
          <h3>Canvas</h3>
          <div className="set-card">
            <Row title="Snapping" text="Align to other items while moving. Hold ⌘ to move freely.">
              <Toggle label="Snapping" on={s.snapping} onChange={(v) => onChange({ snapping: v })} />
            </Row>
            <Row title="Snap to equal spacing">
              <span className={s.snapping ? '' : 'set-disabled'}>
                <Toggle label="Snap to equal spacing" on={s.snapping && s.snapSpacing} onChange={(v) => s.snapping && onChange({ snapSpacing: v })} />
              </span>
            </Row>
            <Row title="Show size while selected">
              <Toggle label="Show size while selected" on={s.showSizeLabel} onChange={(v) => onChange({ showSizeLabel: v })} />
            </Row>
            <Row title="Paste images">
              <Seg
                value={s.pasteAt}
                onChange={(v) => onChange({ pasteAt: v })}
                options={[
                  { value: 'cursor', label: 'At cursor' },
                  { value: 'center', label: 'In center' },
                ]}
              />
            </Row>
            <Row title="Scroll wheel" text="Pinch always zooms.">
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
          <h3>Text</h3>
          <div className="set-card">
            <Row title="New text size">
              <Seg
                value={s.textSize}
                onChange={(v) => onChange({ textSize: v })}
                options={[
                  { value: 'small', label: 'S' },
                  { value: 'medium', label: 'M' },
                  { value: 'large', label: 'L' },
                ]}
              />
            </Row>
          </div>
        </section>

        <section>
          <h3>Appearance</h3>
          <div className="set-card">
            <Row title="Interface theme" text="Auto follows the canvas color.">
              <Seg
                value={s.uiTheme}
                onChange={(v) => onChange({ uiTheme: v })}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </Row>
            <Row title="Animation speed" text="Panels, menus and popups.">
              <Seg
                value={s.motionSpeed}
                onChange={(v) => onChange({ motionSpeed: v })}
                options={[
                  { value: 'snappy', label: 'Snappy' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'relaxed', label: 'Relaxed' },
                ]}
              />
            </Row>
            <Row title="Reduce motion">
              <Seg
                value={s.reduceMotion}
                onChange={(v) => onChange({ reduceMotion: v })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'on', label: 'Always' },
                ]}
              />
            </Row>
            <Row title="Show app name">
              <Toggle label="Show app name" on={s.showName} onChange={(v) => onChange({ showName: v })} />
            </Row>
            <Row title="Fade dock while dragging">
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
              <FillRow
                color={s.newColor}
                autoColor={s.newColor}
                allowAuto={false}
                title="New canvas color"
                swatches={SWATCHES}
                open={colorOpen}
                onOpen={setColorOpen}
                onCommit={(c) => c && onChange({ newColor: c })}
                onPreview={(c) => onChange({ newColor: c })}
              />
            </Row>
          </div>
        </section>

        <section>
          <h3>Library</h3>
          <div className="set-card">
            <Row title="Empty Recently deleted" text="Permanently removes old deleted images.">
              <Seg
                value={s.trashDays}
                onChange={(v) => onChange({ trashDays: v })}
                options={[
                  { value: 0, label: 'Never' },
                  { value: 30, label: '30 days' },
                  { value: 90, label: '90 days' },
                ]}
              />
            </Row>
            <Row title="Library" text={stats ? `${stats.images} images · ${formatBytes(stats.bytes)} · ${stats.projects} projects` : '…'}>
              <span />
            </Row>
          </div>
        </section>
      </div>
    </aside>
  );
}
