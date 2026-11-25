import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Grid3x3, Grip, Keyboard, Settings2, Archive, Maximize, Minus, Pencil, Plus, Search, Square, Trash2 } from 'lucide-react';
import type { Pattern, Project } from '../api';
import { TAB_DRAG_TYPE, type CanvasApi } from './Canvas';
import { Menu, Popover } from './ui';
import { ColorPicker } from './ColorPicker';

export const SWATCHES = ['#FFFFFF', '#F7F7F5', '#F1EEE8', '#ECEEF1', '#E8ECE6', '#2B2B29', '#191919', '#0D0D0F'];
const DENSITIES = [
  { value: 0.5, name: 'Sparse' },
  { value: 0.7, name: 'Airy' },
  { value: 1, name: 'Default' },
  { value: 1.4, name: 'Tight' },
  { value: 2, name: 'Dense' },
];
const densityIndex = (d: number) =>
  DENSITIES.reduce((best, x, i) => (Math.abs(x.value - d) < Math.abs(DENSITIES[best].value - d) ? i : best), 0);
const densityName = (d: number) => DENSITIES[densityIndex(d)].name;

export const PATTERNS: { id: Pattern; label: string; icon: React.ReactNode }[] = [
  { id: 'dots', label: 'Dots', icon: <Grip /> },
  { id: 'grid', label: 'Grid', icon: <Grid3x3 /> },
  { id: 'plain', label: 'Plain', icon: <Square /> },
];

interface Props {
  projects: Project[];
  active: Project;
  renameId: string | null;
  setRenameId: (id: string | null) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (p: Project) => void;
  onReorder: (ids: string[]) => void;
  onBackground: (patch: Partial<Pick<Project, 'pattern' | 'bgColor' | 'density'>>) => void;
  onShowKeys: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  trashOpen: boolean;
  onToggleTrash: () => void;
  canvas: CanvasApi;
  quiet: boolean;
}

function TabName({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (val: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(val);
  };
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <span className="tab-edit">
      <span className="tab-measure">{v || ' '}</span>
      <input
        ref={ref}
        autoFocus
        value={v}
        maxLength={120}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => finish(v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(v);
          if (e.key === 'Escape') finish(null);
          e.stopPropagation();
        }}
      />
    </span>
  );
}

/**
 * Floating popup beside the background panel. It lives inside that panel's DOM so
 * clicks in it don't dismiss the panel, but is positioned against the viewport.
 */
function PickerPopup({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.closest('.bg-pop');
    if (!el || !host) return;
    const place = () => {
      const h = host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const gap = 10;
      const right = h.right + gap + r.width <= window.innerWidth - 8;
      setPos({
        left: right ? h.right + gap : Math.max(8, h.left - gap - r.width),
        top: Math.max(8, h.bottom - r.height),
      });
    };
    place();
    // The panel may still be finishing its entrance; settle once it has.
    const t = window.setTimeout(place, 180);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={ref} className="popover picker-pop pop-in" style={pos ?? { visibility: 'hidden' }} role="dialog" aria-label="Custom color">
      {children}
    </div>
  );
}

export function Dock(p: Props) {
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [bgOpen, setBgOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const [hex, setHex] = useState(p.active.bgColor);
  const [pickerOpen, setPickerOpen] = useState(false);
  const bgBtn = useRef<HTMLButtonElement>(null);
  const zoomBtn = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHex(p.active.bgColor), [p.active.bgColor]);

  useLayoutEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${p.active.id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [p.active.id, p.projects.length]);

  const drop = (targetId: string, after: boolean) => {
    if (!dragId || dragId === targetId) return;
    const ids = p.projects.map((x) => x.id).filter((id) => id !== dragId);
    const i = ids.indexOf(targetId) + (after ? 1 : 0);
    ids.splice(i, 0, dragId);
    p.onReorder(ids);
  };

  const zoomPct = Math.round(p.canvas.zoom * 100);

  return (
    <>
    <div className={`dock-wrap${p.quiet ? ' quiet' : ''}`}>
      <nav className="dock" aria-label="Projects">
        <div className="tabs" ref={tabsRef} role="tablist">
          {p.projects.map((proj) => {
            const active = proj.id === p.active.id;
            const editing = p.renameId === proj.id;
            return (
              <div
                key={proj.id}
                data-tab={proj.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                className={[
                  'tab',
                  active && 'active',
                  dragId === proj.id && 'dragging',
                  dropAt?.id === proj.id && (dropAt.after ? 'drop-after' : 'drop-before'),
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={!editing}
                onClick={() => p.onSelect(proj.id)}
                onKeyDown={(e) => {
                  if (editing || (e.key !== 'Enter' && e.key !== ' ')) return;
                  e.preventDefault();
                  p.onSelect(proj.id);
                }}
                onDoubleClick={() => p.setRenameId(proj.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({ x: e.clientX, y: e.clientY, project: proj });
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAB_DRAG_TYPE, proj.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragId(proj.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropAt(null);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt({ id: proj.id, after: e.clientX > r.left + r.width / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dropAt) drop(dropAt.id, dropAt.after);
                  setDropAt(null);
                }}
                title={editing ? undefined : proj.name}
              >
                {editing ? (
                  <TabName
                    value={proj.name}
                    onDone={(v) => {
                      p.setRenameId(null);
                      if (v !== null && v.trim() && v.trim() !== proj.name) p.onRename(proj.id, v.trim());
                    }}
                  />
                ) : (
                  <span className="tab-label">{proj.name}</span>
                )}
              </div>
            );
          })}
        </div>
        <button
          className="icon-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            p.onCreate();
          }}
          title="New project"
          aria-label="New project"
        >
          <Plus />
        </button>

        <div className="dock-sep" />

        <button
          ref={bgBtn}
          className={`icon-btn${bgOpen ? ' on' : ''}`}
          onClick={() => setBgOpen((o) => !o)}
          title="Background"
          aria-label="Background"
        >
          <span className="bg-chip" style={{ background: p.active.bgColor }} data-pattern={p.active.pattern} />
        </button>
        <button
          ref={zoomBtn}
          className={`zoom-btn${zoomOpen ? ' on' : ''}`}
          onClick={() => setZoomOpen((o) => !o)}
          title="Zoom"
        >
          {zoomPct}%
        </button>
        <button
          data-trash-toggle
          className={`icon-btn${p.trashOpen ? ' on' : ''}`}
          onClick={p.onToggleTrash}
          title="Recently deleted"
          aria-label="Recently deleted"
        >
          <Archive />
        </button>
        <button
          data-settings-toggle
          className={`icon-btn${p.settingsOpen ? ' on' : ''}`}
          onClick={p.onToggleSettings}
          title="Settings (⌘,)"
          aria-label="Settings"
        >
          <Settings2 />
        </button>
      </nav>
    </div>

      {bgOpen && bgBtn.current && (
        <Popover
          anchor={bgBtn.current}
          onClose={() => {
            setBgOpen(false);
            setPickerOpen(false);
          }}
          className="bg-pop"
        >
          <div className="seg" role="radiogroup" aria-label="Pattern">
            {PATTERNS.map((pt) => (
              <button
                key={pt.id}
                role="radio"
                aria-checked={p.active.pattern === pt.id}
                className={`seg-btn${p.active.pattern === pt.id ? ' on' : ''}`}
                onClick={() => p.onBackground({ pattern: pt.id })}
              >
                {pt.icon}
                {pt.label}
              </button>
            ))}
          </div>
          {p.active.pattern !== 'plain' && (
            <>
              <div className="pop-label row">
                <span>Density</span>
                <span className="pop-value">{densityName(p.active.density)}</span>
              </div>
              <input
                type="range"
                className="slider"
                min={0}
                max={DENSITIES.length - 1}
                step={1}
                value={densityIndex(p.active.density)}
                onChange={(e) => p.onBackground({ density: DENSITIES[Number(e.target.value)].value })}
                onDoubleClick={() => p.onBackground({ density: 1 })}
                aria-label="Pattern density"
                style={{ ['--fill' as string]: `${(densityIndex(p.active.density) / (DENSITIES.length - 1)) * 100}%` }}
              />
            </>
          )}
          <div className="pop-label">Color</div>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`swatch${p.active.bgColor.toUpperCase() === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => p.onBackground({ bgColor: c })}
                aria-label={c}
                title={c}
              />
            ))}
          </div>
          <div className="hex-row">
            <button
              className={`swatch custom${pickerOpen ? ' on' : ''}`}
              title="Custom color"
              aria-label="Custom color"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((o) => !o)}
            />
            <input
              className="input hex"
              value={hex}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                setHex(v);
                if (/^#[0-9a-f]{6}$/i.test(v)) p.onBackground({ bgColor: v.toUpperCase() });
              }}
              onBlur={() => setHex(p.active.bgColor)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          {pickerOpen && (
            <PickerPopup>
              <ColorPicker value={p.active.bgColor} onChange={(c) => p.onBackground({ bgColor: c })} showHex={false} />
            </PickerPopup>
          )}
        </Popover>
      )}

      {zoomOpen && zoomBtn.current && (
        <Popover anchor={zoomBtn.current} onClose={() => setZoomOpen(false)} className="menu-pop">
          {[
            { label: 'Zoom in', icon: <Plus />, kbd: '+', run: () => p.canvas.zoomBy(1.25) },
            { label: 'Zoom out', icon: <Minus />, kbd: '−', run: () => p.canvas.zoomBy(0.8) },
            { label: 'Zoom to 100%', icon: <Search />, kbd: '⇧0', run: () => p.canvas.zoomTo(1) },
            { label: 'Zoom to fit', icon: <Maximize />, kbd: '⇧1', run: p.canvas.zoomToFit },
          ].map((it) => (
            <button key={it.label} className="menu-item" onClick={it.run}>
              <span className="menu-icon">{it.icon}</span>
              <span className="menu-label">{it.label}</span>
              <kbd className="menu-kbd">{it.kbd}</kbd>
            </button>
          ))}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              setZoomOpen(false);
              p.onShowKeys();
            }}
          >
            <span className="menu-icon">
              <Keyboard />
            </span>
            <span className="menu-label">Shortcuts</span>
            <kbd className="menu-kbd">?</kbd>
          </button>
        </Popover>
      )}

      {tabMenu && (
        <Menu
          x={tabMenu.x}
          y={tabMenu.y - 96}
          onClose={() => setTabMenu(null)}
          entries={[
            { label: 'Rename', icon: <Pencil />, onSelect: () => p.setRenameId(tabMenu.project.id) },
            'sep',
            { label: 'Delete project', icon: <Trash2 />, danger: true, onSelect: () => p.onDelete(tabMenu.project) },
          ]}
        />
      )}
    </>
  );
}
