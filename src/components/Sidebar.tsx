import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  ChevronRight,
  Eye,
  EyeOff,
  Frame,
  Group,
  Image as ImageIcon,
  Layers,
  Link,
  Link2Off,
  Lock,
  LockOpen,
  PanelLeft,
  PanelLeftClose,
  SendToBack,
  SlidersHorizontal,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react';
import type { Item } from '../api';
import { boundsOf, type AlignMode } from '../geometry';
import { hostOf } from '../ingest';
import { ColorPicker } from './ColorPicker';

interface Props {
  open: boolean;
  tab: 'layers' | 'design';
  onToggle: () => void;
  onTab: (tab: 'layers' | 'design') => void;
  items: Item[]; // sorted by z, bottom first
  groups: Record<string, string>;
  selection: Set<string>;
  dark: boolean;
  onSelect: (ids: string[], how: 'replace' | 'toggle') => void;
  onRenameItem: (id: string, name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onPatch: (ids: string[], fn: (it: Item) => Item) => void;
  onPreview: (ids: string[], fn: (it: Item) => Item) => void;
  onPreviewEnd: () => void;
  onAlign: (mode: AlignMode | 'dx' | 'dy') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleFlag: (ids: string[], flag: 'locked' | 'hidden') => void;
  onArrange: (where: 'front' | 'back') => void;
  onDelete: () => void;
  onReorder: (dragIds: string[], targetId: string, place: 'above' | 'below') => void;
  onFocus: (ids: string[]) => void;
}

export const layerName = (it: Item) =>
  it.name ||
  (it.kind === 'text'
    ? (it.text || 'Text').split('\n')[0].slice(0, 48)
    : it.sourceUrl && /^https?:/.test(it.sourceUrl)
      ? hostOf(it.sourceUrl)
      : 'Image');

/* ---------- small controls ---------- */

function InlineName({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (x: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(x);
  };
  return (
    <input
      className="layer-rename"
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(null);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Number field with Figma-style scrubbing: drag the label left/right to change the value. */
function NumberField({
  label,
  value,
  onCommit,
  onScrub,
  onScrubEnd,
  suffix,
  step = 1,
  min,
  max,
}: {
  label: ReactNode;
  value: number | null; // null = mixed
  onCommit: (v: number) => void;
  onScrub?: (v: number) => void;
  onScrubEnd?: () => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const shown = value === null ? '' : String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const scrub = useRef<{ x: number; v: number } | null>(null);

  return (
    <label className="num">
      <span
        className="num-label"
        onPointerDown={(e) => {
          if (value === null || !onScrub) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          if (!scrub.current || !onScrub) return;
          const d = (e.clientX - scrub.current.x) * step * (e.shiftKey ? 10 : 1);
          onScrub(clamp(Math.round((scrub.current.v + d) / step) * step));
        }}
        onPointerUp={() => {
          if (!scrub.current) return;
          scrub.current = null;
          onScrubEnd?.();
        }}
        style={{ cursor: onScrub && value !== null ? 'ew-resize' : undefined }}
      >
        {label}
      </span>
      <input
        value={text}
        placeholder={value === null ? 'Mixed' : undefined}
        inputMode="decimal"
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          const v = parseFloat(text);
          if (Number.isFinite(v) && v !== value) onCommit(clamp(v));
          else setText(shown);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(shown);
            e.currentTarget.blur();
          }
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== null) {
            e.preventDefault();
            const v = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            onCommit(v);
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  );
}

function IconButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button className={`icon-btn${active ? ' on' : ''}`} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------- layers ---------- */

type Row =
  | { kind: 'group'; id: string; name: string; members: Item[] }
  | { kind: 'item'; item: Item; depth: number };

function LayersTab(p: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: 'above' | 'below' } | null>(null);

  // Expand a group when one of its members is selected on its own.
  useEffect(() => {
    const gids = p.items.filter((i) => p.selection.has(i.id) && i.groupId).map((i) => i.groupId!);
    const partial = gids.filter((g) => p.items.some((i) => i.groupId === g && !p.selection.has(i.id)));
    if (partial.length) setOpen((o) => new Set([...o, ...partial]));
  }, [p.selection, p.items]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    const top = [...p.items].reverse(); // top of the stack first, like Figma
    for (const it of top) {
      if (it.groupId) {
        if (seen.has(it.groupId)) continue;
        seen.add(it.groupId);
        const members = top.filter((m) => m.groupId === it.groupId);
        out.push({ kind: 'group', id: it.groupId, name: p.groups[it.groupId] ?? 'Group', members });
        if (open.has(it.groupId)) for (const m of members) out.push({ kind: 'item', item: m, depth: 1 });
      } else out.push({ kind: 'item', item: it, depth: 0 });
    }
    return out;
  }, [p.items, p.groups, open]);

  if (!p.items.length) return <div className="side-empty">Nothing on this canvas yet.</div>;

  const rowIds = (r: Row) => (r.kind === 'group' ? r.members.map((m) => m.id) : [r.item.id]);
  const anchorId = (r: Row) => (r.kind === 'group' ? r.members[0].id : r.item.id);

  return (
    <div className="layers" role="tree">
      {rows.map((r) => {
        const ids = rowIds(r);
        const key = r.kind === 'group' ? `g:${r.id}` : r.item.id;
        const selected = ids.every((id) => p.selection.has(id));
        const partly = !selected && ids.some((id) => p.selection.has(id));
        const members = r.kind === 'group' ? r.members : [r.item];
        const hidden = members.every((m) => m.hidden);
        const locked = members.every((m) => m.locked);
        const name = r.kind === 'group' ? r.name : layerName(r.item);
        return (
          <div
            key={key}
            role="treeitem"
            aria-selected={selected}
            className={[
              'layer',
              selected && 'sel',
              partly && 'partly',
              hidden && 'is-hidden',
              r.kind === 'item' && r.depth && 'child',
              drop?.id === anchorId(r) && `drop-${drop.place}`,
            ]
              .filter(Boolean)
              .join(' ')}
            draggable={renaming !== key}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-crunch-layer', '1');
              e.dataTransfer.effectAllowed = 'move';
              setDrag(ids);
            }}
            onDragEnd={() => {
              setDrag(null);
              setDrop(null);
            }}
            onDragOver={(e) => {
              if (!drag || ids.some((id) => drag.includes(id))) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setDrop({ id: anchorId(r), place: e.clientY < rect.top + rect.height / 2 ? 'above' : 'below' });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drop) {
                // Dropping "above" a row in the list means higher in the stack.
                const target = r.kind === 'group' ? (drop.place === 'above' ? r.members[0] : r.members[r.members.length - 1]) : r.item;
                p.onReorder(drag, target.id, drop.place);
              }
              setDrop(null);
            }}
            onClick={(e) => p.onSelect(ids, e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace')}
            onDoubleClick={() => setRenaming(key)}
          >
            {r.kind === 'group' ? (
              <button
                className={`layer-twisty${open.has(r.id) ? ' open' : ''}`}
                aria-label={open.has(r.id) ? 'Collapse group' : 'Expand group'}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((o) => {
                    const n = new Set(o);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    return n;
                  });
                }}
              >
                <ChevronRight />
              </button>
            ) : (
              <span className="layer-twisty-space" />
            )}
            <span className="layer-thumb">
              {r.kind === 'group' ? (
                <Frame />
              ) : r.item.kind === 'text' ? (
                <Type />
              ) : (
                <img src={r.item.src} alt="" loading="lazy" draggable={false} onError={(e) => (e.currentTarget.style.display = 'none')} />
              )}
              {r.kind === 'item' && r.item.kind === 'image' && <ImageIcon className="layer-thumb-fallback" />}
            </span>
            {renaming === key ? (
              <InlineName
                value={name}
                onDone={(v) => {
                  setRenaming(null);
                  if (v === null) return;
                  if (r.kind === 'group') p.onRenameGroup(r.id, v.trim() || 'Group');
                  else p.onRenameItem(r.item.id, v.trim());
                }}
              />
            ) : (
              <span className="layer-name" title={name}>
                {name}
              </span>
            )}
            <span className="layer-actions">
              <button
                className={`layer-act${locked ? ' on' : ''}`}
                title={locked ? 'Unlock' : 'Lock'}
                aria-label={locked ? 'Unlock' : 'Lock'}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onToggleFlag(ids, 'locked');
                }}
              >
                {locked ? <Lock /> : <LockOpen />}
              </button>
              <button
                className={`layer-act${hidden ? ' on' : ''}`}
                title={hidden ? 'Show' : 'Hide'}
                aria-label={hidden ? 'Show' : 'Hide'}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onToggleFlag(ids, 'hidden');
                }}
              >
                {hidden ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- design ---------- */

const WEIGHTS = [
  { v: 300, label: 'Light' },
  { v: 400, label: 'Regular' },
  { v: 500, label: 'Medium' },
  { v: 600, label: 'Semibold' },
  { v: 700, label: 'Bold' },
];
const TEXT_COLORS = ['#191919', '#FFFFFF', '#6B6B6B', '#E03E3E', '#D9730D', '#DFAB01', '#0F7B6C', '#2383E2', '#9065B0'];

const same = <T,>(xs: T[]): T | null => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : null);

function DesignTab(p: Props) {
  const sel = p.items.filter((i) => p.selection.has(i.id));
  const [lockRatio, setLockRatio] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { onPreviewEnd } = p;
  // A color drag is one undo step: commit when the pointer is released.
  useEffect(() => {
    if (!pickerOpen) return;
    const up = () => onPreviewEnd();
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointerup', up);
      onPreviewEnd();
    };
  }, [pickerOpen, onPreviewEnd]);
  if (!sel.length) return <div className="side-empty">Select a layer to edit it.</div>;

  const ids = sel.map((i) => i.id);
  const one = sel.length === 1 ? sel[0] : null;
  const b = boundsOf(sel)!;
  const texts = sel.filter((i) => i.kind === 'text');
  const allText = texts.length === sel.length;
  const units = new Set(sel.map((i) => i.groupId || i.id)).size;
  const grouped = sel.some((i) => i.groupId);

  // Move / scale the whole selection relative to its bounds.
  const moveTo = (axis: 'x' | 'y', v: number) => (it: Item) => ({ ...it, [axis]: it[axis] + (v - b[axis]) });
  const scaleTo = (axis: 'w' | 'h', v: number) => (it: Item) => {
    const k = v / b[axis];
    const fs = it.kind === 'text' ? (it.fontSize ?? 24) * k : it.fontSize;
    return { ...it, x: b.x + (it.x - b.x) * k, y: b.y + (it.y - b.y) * k, w: it.w * k, h: it.h * k, fontSize: fs };
  };
  const resizeOne = (axis: 'w' | 'h', v: number) => (it: Item) => {
    const keep = lockRatio || it.kind === 'text';
    const w = axis === 'w' ? v : keep ? (v * it.w) / it.h : it.w;
    const h = axis === 'h' ? v : keep ? (v * it.h) / it.w : it.h;
    const fs = it.kind === 'text' ? (it.fontSize ?? 24) * (w / it.w) : it.fontSize;
    return { ...it, w: Math.max(1, w), h: Math.max(1, h), fontSize: fs };
  };

  const field = (label: string, value: number | null, fn: (v: number) => (it: Item) => Item, extra: Partial<Parameters<typeof NumberField>[0]> = {}) => (
    <NumberField
      label={label}
      value={value}
      onCommit={(v) => p.onPatch(ids, fn(v))}
      onScrub={(v) => p.onPreview(ids, fn(v))}
      onScrubEnd={p.onPreviewEnd}
      {...extra}
    />
  );

  return (
    <div className="design">
      <section>
        <div className="side-h">{one ? layerName(one) : `${sel.length} layers`}</div>
        <div className="align-row">
          <IconButton title="Align left (⌥A)" disabled={units < 2} onClick={() => p.onAlign('left')}>
            <AlignStartVertical />
          </IconButton>
          <IconButton title="Align horizontal centers (⌥H)" disabled={units < 2} onClick={() => p.onAlign('hcenter')}>
            <AlignCenterVertical />
          </IconButton>
          <IconButton title="Align right (⌥D)" disabled={units < 2} onClick={() => p.onAlign('right')}>
            <AlignEndVertical />
          </IconButton>
          <IconButton title="Align top (⌥W)" disabled={units < 2} onClick={() => p.onAlign('top')}>
            <AlignStartHorizontal />
          </IconButton>
          <IconButton title="Align vertical centers (⌥V)" disabled={units < 2} onClick={() => p.onAlign('vcenter')}>
            <AlignCenterHorizontal />
          </IconButton>
          <IconButton title="Align bottom (⌥S)" disabled={units < 2} onClick={() => p.onAlign('bottom')}>
            <AlignEndHorizontal />
          </IconButton>
          <span className="align-sep" />
          <IconButton title="Distribute horizontally (⌥⇧H)" disabled={units < 3} onClick={() => p.onAlign('dx')}>
            <AlignHorizontalDistributeCenter />
          </IconButton>
          <IconButton title="Distribute vertically (⌥⇧V)" disabled={units < 3} onClick={() => p.onAlign('dy')}>
            <AlignVerticalDistributeCenter />
          </IconButton>
        </div>
      </section>

      <section>
        <div className="side-label">Layout</div>
        <div className="grid2">
          {one ? field('X', one.x, (v) => (it) => ({ ...it, x: v })) : field('X', b.x, (v) => moveTo('x', v))}
          {one ? field('Y', one.y, (v) => (it) => ({ ...it, y: v })) : field('Y', b.y, (v) => moveTo('y', v))}
          {one ? field('W', one.w, (v) => resizeOne('w', v), { min: 1 }) : field('W', b.w, (v) => scaleTo('w', v), { min: 1 })}
          {one ? field('H', one.h, (v) => resizeOne('h', v), { min: 1 }) : field('H', b.h, (v) => scaleTo('h', v), { min: 1 })}
        </div>
        <div className="grid2">
          {field('°', same(sel.map((i) => Math.round((i.rotation ?? 0) * 100) / 100)), (v) => (it) => ({ ...it, rotation: ((v + 540) % 360) - 180 }))}
          {one && one.kind !== 'text' && (
            <button className={`ratio${lockRatio ? ' on' : ''}`} onClick={() => setLockRatio((x) => !x)} title="Keep proportions">
              {lockRatio ? <Link /> : <Link2Off />}
              <span>{lockRatio ? 'Proportions locked' : 'Free resize'}</span>
            </button>
          )}
        </div>
      </section>

      <section>
        <div className="side-label">Layer</div>
        <div className="grid2">
          {field('Opacity', same(sel.map((i) => Math.round((i.opacity ?? 1) * 100))), (v) => (it) => ({ ...it, opacity: v / 100 }), {
            min: 0,
            max: 100,
            suffix: '%',
          })}
        </div>
      </section>

      {allText && (
        <section>
          <div className="side-label">Text</div>
          <div className="grid2">
            {field('Size', same(texts.map((t) => Math.round((t.fontSize ?? 24) * 10) / 10)), (v) => (it) => ({ ...it, fontSize: Math.max(1, v) }), { min: 1 })}
            <label className="num select">
              <span className="num-label">Weight</span>
              <select
                value={same(texts.map((t) => t.fontWeight ?? 500)) ?? ''}
                onChange={(e) => p.onPatch(ids, (it) => ({ ...it, fontWeight: Number(e.target.value) }))}
              >
                {same(texts.map((t) => t.fontWeight ?? 500)) === null && <option value="">Mixed</option>}
                {WEIGHTS.map((w) => (
                  <option key={w.v} value={w.v}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="text-colors">
            <button
              className={`chip${texts.every((t) => !t.color) ? ' on' : ''}`}
              onClick={() => p.onPatch(ids, (it) => ({ ...it, color: null }))}
              title="Follow the canvas"
            >
              Auto
            </button>
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch small${texts.every((t) => t.color?.toUpperCase() === c) ? ' on' : ''}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => p.onPatch(ids, (it) => ({ ...it, color: c }))}
              />
            ))}
            <button className={`swatch small custom${pickerOpen ? ' on' : ''}`} aria-label="Custom color" onClick={() => setPickerOpen((o) => !o)} />
          </div>
          {pickerOpen && (
            <ColorPicker
              value={same(texts.map((t) => t.color ?? '')) || (p.dark ? '#EDEDEC' : '#191919')}
              onChange={(c) => p.onPreview(ids, (it) => ({ ...it, color: c }))}
            />
          )}
        </section>
      )}

      <section>
        <div className="side-label">Arrange</div>
        <div className="action-grid">
          {grouped && sel.length > 0 && units === 1 ? (
            <button className="act" onClick={p.onUngroup}>
              <Ungroup /> Ungroup <kbd>⇧⌘G</kbd>
            </button>
          ) : (
            <button className="act" disabled={sel.length < 2} onClick={p.onGroup}>
              <Group /> Group <kbd>⌘G</kbd>
            </button>
          )}
          <button className="act" onClick={() => p.onToggleFlag(ids, 'locked')}>
            {sel.every((i) => i.locked) ? <LockOpen /> : <Lock />} {sel.every((i) => i.locked) ? 'Unlock' : 'Lock'} <kbd>⇧⌘L</kbd>
          </button>
          <button className="act" onClick={() => p.onToggleFlag(ids, 'hidden')}>
            {sel.every((i) => i.hidden) ? <Eye /> : <EyeOff />} {sel.every((i) => i.hidden) ? 'Show' : 'Hide'} <kbd>⇧⌘H</kbd>
          </button>
          <button className="act" onClick={() => p.onArrange('front')}>
            <BringToFront /> To front <kbd>]</kbd>
          </button>
          <button className="act" onClick={() => p.onArrange('back')}>
            <SendToBack /> To back <kbd>[</kbd>
          </button>
          <button className="act danger" onClick={p.onDelete}>
            <Trash2 /> Delete <kbd>⌫</kbd>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------- shell ---------- */

export function Sidebar(p: Props) {
  const ref = useRef<HTMLElement>(null);
  return (
    <>
      <aside ref={ref} className={`sidebar${p.open ? ' shown' : ''}`} aria-label="Layers and design" aria-hidden={!p.open} inert={!p.open}>
        <div className="side-tabs" role="tablist">
          <button role="tab" aria-selected={p.tab === 'layers'} className={`side-tab${p.tab === 'layers' ? ' on' : ''}`} onClick={() => p.onTab('layers')}>
            <Layers /> Layers
          </button>
          <button role="tab" aria-selected={p.tab === 'design'} className={`side-tab${p.tab === 'design' ? ' on' : ''}`} onClick={() => p.onTab('design')}>
            <SlidersHorizontal /> Design
          </button>
        </div>
        <div className="side-body">{p.tab === 'layers' ? <LayersTab {...p} /> : <DesignTab {...p} />}</div>
      </aside>
      <button
        className={`side-toggle${p.open ? ' on' : ''}`}
        onClick={(e) => {
          e.currentTarget.blur();
          p.onToggle();
        }}
        title={p.open ? 'Hide sidebar (⌘\\)' : 'Show layers & design (⌘\\)'}
        aria-label={p.open ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={p.open}
      >
        {p.open ? <PanelLeftClose /> : <PanelLeft />}
      </button>
    </>
  );
}
