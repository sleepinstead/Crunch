import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Grid3x3, Grip, Keyboard, Settings2, Archive, Type, Maximize, Minus, Pencil, Plus, Search, Square, Trash2 } from 'lucide-react';
import type { Pattern, Project } from '../api';
import { TAB_DRAG_TYPE, type CanvasApi } from './Canvas';
import { Menu, Popover } from './ui';
import { FillRow } from './FillRow';

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

export function Dock(p: Props) {
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [bgOpen, setBgOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const bgBtn = useRef<HTMLButtonElement>(null);
  const zoomBtn = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);


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

  /** Move a board one place left or right (menu, keyboard). */
  const shift = (id: string, by: -1 | 1) => {
    const ids = p.projects.map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    p.onReorder(ids);
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus());
  };
  const longPress = useRef<number | undefined>(undefined);

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
                // Keyboard: Enter/Space open, ←/→ move focus, ⌥←/⌥→ reorder, F2 rename,
                // Delete asks to delete, Shift+F10 or the Menu key opens the menu.
                onKeyDown={(e) => {
                  if (editing) return;
                  const tabs = [...(tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
                  const at = tabs.indexOf(e.currentTarget);
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    p.onSelect(proj.id);
                  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
                    e.preventDefault();
                    shift(proj.id, e.key === 'ArrowLeft' ? -1 : 1);
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    tabs[(at + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length]?.focus();
                  } else if (e.key === 'F2') {
                    e.preventDefault();
                    p.setRenameId(proj.id);
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    p.onDelete(proj);
                  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setTabMenu({ x: r.left, y: r.top, project: proj });
                  }
                }}
                // Touch: press and hold opens the same menu.
                onPointerDown={(e) => {
                  if (e.pointerType !== 'touch') return;
                  const { clientX: x, clientY: y } = e;
                  longPress.current = window.setTimeout(() => setTabMenu({ x, y, project: proj }), 500);
                }}
                onPointerUp={() => window.clearTimeout(longPress.current)}
                onPointerCancel={() => window.clearTimeout(longPress.current)}
                onPointerLeave={() => window.clearTimeout(longPress.current)}
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
                data-tip={editing ? undefined : proj.name}
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
          data-tip="New project"
          aria-label="New project"
        >
          <Plus />
        </button>

        <div className="dock-sep" />

        <button
          className={`icon-btn${p.canvas.textTool ? ' on' : ''}`}
          onClick={(e) => {
            e.currentTarget.blur();
            p.canvas.setTextTool(!p.canvas.textTool);
          }}
          data-tip="Text (T)"
          aria-label="Text"
          aria-pressed={p.canvas.textTool}
        >
          <Type />
        </button>
        <button
          ref={bgBtn}
          className={`icon-btn${bgOpen ? ' on' : ''}`}
          onClick={() => setBgOpen((o) => !o)}
          data-tip="Background"
          aria-label="Background"
        >
          <span className="bg-chip" style={{ background: p.active.bgColor }} data-pattern={p.active.pattern} />
        </button>
        <button
          ref={zoomBtn}
          className={`zoom-btn${zoomOpen ? ' on' : ''}`}
          aria-label={`Zoom, ${zoomPct}%`}
          aria-haspopup="menu"
          aria-expanded={zoomOpen}
          onClick={() => setZoomOpen((o) => !o)}
          data-tip="Zoom"
        >
          {zoomPct}%
        </button>
        <button
          data-trash-toggle
          className={`icon-btn${p.trashOpen ? ' on' : ''}`}
          onClick={p.onToggleTrash}
          data-tip="Recently deleted"
          aria-label="Recently deleted"
        >
          <Archive />
        </button>
        <button
          data-settings-toggle
          className={`icon-btn${p.settingsOpen ? ' on' : ''}`}
          onClick={p.onToggleSettings}
          data-tip="Settings (⌘,)"
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
                data-tip={c}
              />
            ))}
          </div>
          <div className="pop-fill">
            <FillRow
              color={p.active.bgColor}
              autoColor={p.active.bgColor}
              allowAuto={false}
              title="Canvas color"
              swatches={SWATCHES}
              open={pickerOpen}
              onOpen={setPickerOpen}
              onCommit={(c) => c && p.onBackground({ bgColor: c })}
              onPreview={(c) => p.onBackground({ bgColor: c })}
            />
          </div>
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
          y={tabMenu.y - 150}
          onClose={() => setTabMenu(null)}
          entries={[
            { label: 'Rename', icon: <Pencil />, shortcut: 'F2', onSelect: () => p.setRenameId(tabMenu.project.id) },
            {
              label: 'Move left',
              icon: <ChevronLeft />,
              shortcut: '⌥←',
              disabled: p.projects[0]?.id === tabMenu.project.id,
              onSelect: () => shift(tabMenu.project.id, -1),
            },
            {
              label: 'Move right',
              icon: <ChevronRight />,
              shortcut: '⌥→',
              disabled: p.projects[p.projects.length - 1]?.id === tabMenu.project.id,
              onSelect: () => shift(tabMenu.project.id, 1),
            },
            'sep',
            { label: 'Delete board', icon: <Trash2 />, danger: true, onSelect: () => p.onDelete(tabMenu.project) },
          ]}
        />
      )}
    </>
  );
}
