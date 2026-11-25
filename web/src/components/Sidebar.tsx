import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Lock,
  LockOpen,
  PanelLeft,
  PanelLeftClose,
  SendToBack,
  SlidersHorizontal,
  Trash2,
  Type,
  Ungroup,
  RotateCw,
  Pencil,
  Focus,
  CopyPlus,
  Blend,
} from 'lucide-react';
import type { Item } from '../api';
import { boundsOf, type AlignMode } from '../geometry';
import { hostOf } from '../ingest';
import { FillRow } from './FillRow';
import { Menu, type MenuEntry } from './ui';

interface Props {
  open: boolean;
  tab: 'layers' | 'design';
  onToggle: () => void;
  /** Open/close without remembering it (hover peeks, click-outside). */
  onSetOpen: (open: boolean) => void;
  /** Keep it open (and remember that). */
  onPin: () => void;
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
  onDuplicate: () => void;
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
  tip,
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
  tip?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const shown = value === null ? '' : String(Math.round(value / Math.min(1, step)) * Math.min(1, step));
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
        data-tip={tip ? `${tip} · drag to adjust` : undefined}
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
        onPointerCancel={() => {
          if (!scrub.current) return;
          scrub.current = null;
          onScrubEnd?.();
        }}
        onLostPointerCapture={() => {
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
          // Re-confirming the displayed (rounded) value is not an edit.
          if (Number.isFinite(v) && text.trim() !== shown) onCommit(clamp(v));
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
    <button className={`icon-btn${active ? ' on' : ''}`} data-tip={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------- layers ---------- */

type Row = { kind: 'group'; id: string; name: string; members: Item[] } | { kind: 'item'; item: Item; depth: number };

function LayersTab(p: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<{
    id: string;
    place: 'above' | 'below';
  } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    ids: string[];
    key: string;
    isGroup: boolean;
  } | null>(null);

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
        out.push({
          kind: 'group',
          id: it.groupId,
          name: p.groups[it.groupId] ?? 'Group',
          members,
        });
        if (open.has(it.groupId)) for (const m of members) out.push({ kind: 'item', item: m, depth: 1 });
      } else out.push({ kind: 'item', item: it, depth: 0 });
    }
    return out;
  }, [p.items, p.groups, open]);

  if (!p.items.length) return <div className="side-empty">Nothing on this canvas yet.</div>;

  const rowIds = (r: Row) => (r.kind === 'group' ? r.members.map((m) => m.id) : [r.item.id]);
  const anchorId = (r: Row) => (r.kind === 'group' ? r.members[0].id : r.item.id);

  const menuEntries = (): MenuEntry[] => {
    if (!menu) return [];
    const members = p.items.filter((i) => menu.ids.includes(i.id));
    const sel = p.items.filter((i) => p.selection.has(i.id));
    const units = new Set(sel.map((i) => i.groupId || i.id)).size;
    const locked = members.every((i) => i.locked);
    const hidden = members.every((i) => i.hidden);
    return [
      {
        label: 'Rename',
        icon: <Pencil />,
        onSelect: () => setRenaming(menu.key),
      },
      {
        label: 'Zoom to',
        icon: <Focus />,
        onSelect: () => p.onFocus(menu.ids),
      },
      'sep',
      ...(sel.some((i) => i.groupId)
        ? ([
            {
              label: 'Ungroup',
              icon: <Ungroup />,
              shortcut: '⇧⌘G',
              onSelect: p.onUngroup,
            },
          ] as MenuEntry[])
        : []),
      ...(units > 1
        ? ([
            {
              label: 'Group',
              icon: <Group />,
              shortcut: '⌘G',
              onSelect: p.onGroup,
            },
          ] as MenuEntry[])
        : []),
      {
        label: locked ? 'Unlock' : 'Lock',
        icon: locked ? <LockOpen /> : <Lock />,
        shortcut: '⇧⌘L',
        onSelect: () => p.onToggleFlag(menu.ids, 'locked'),
      },
      {
        label: hidden ? 'Show' : 'Hide',
        icon: hidden ? <Eye /> : <EyeOff />,
        shortcut: '⇧⌘H',
        onSelect: () => p.onToggleFlag(menu.ids, 'hidden'),
      },
      'sep',
      {
        label: 'Bring to front',
        icon: <BringToFront />,
        shortcut: ']',
        onSelect: () => p.onArrange('front'),
      },
      {
        label: 'Send to back',
        icon: <SendToBack />,
        shortcut: '[',
        onSelect: () => p.onArrange('back'),
      },
      {
        label: 'Duplicate',
        icon: <CopyPlus />,
        shortcut: '⌘D',
        onSelect: p.onDuplicate,
      },
      'sep',
      {
        label: 'Delete',
        icon: <Trash2 />,
        shortcut: '⌫',
        danger: true,
        onSelect: p.onDelete,
      },
    ];
  };

  return (
    <div className="layers" role="tree">
      {menu && <Menu x={menu.x} y={menu.y} entries={menuEntries()} onClose={() => setMenu(null)} />}
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
              setDrop({
                id: anchorId(r),
                place: e.clientY < rect.top + rect.height / 2 ? 'above' : 'below',
              });
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
            // Keyboard: arrows move between rows, Enter/Space select, F2 renames, Shift+F10 opens the menu.
            tabIndex={renaming === key ? -1 : 0}
            aria-label={name}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              const rowsEls = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('.layer') ?? [])];
              const at = rowsEls.indexOf(e.currentTarget);
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                rowsEls[Math.max(0, Math.min(rowsEls.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
              } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                p.onSelect(ids, e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace');
              } else if (e.key === 'F2') {
                e.preventDefault();
                setRenaming(key);
              } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                e.preventDefault();
                if (!ids.every((id) => p.selection.has(id))) p.onSelect(ids, 'replace');
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({ x: rect.left + 24, y: rect.bottom, ids, key, isGroup: r.kind === 'group' });
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Right-clicking an unselected row selects it first (like Figma).
              if (!ids.every((id) => p.selection.has(id))) p.onSelect(ids, 'replace');
              setMenu({
                x: e.clientX,
                y: e.clientY,
                ids,
                key,
                isGroup: r.kind === 'group',
              });
            }}
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
              <span className="layer-name" data-tip={name}>
                {name}
              </span>
            )}
            <span className="layer-actions">
              {r.kind === 'group' && (
                <button
                  className="layer-act"
                  data-tip="Ungroup (⇧⌘G)"
                  aria-label="Ungroup"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onSelect(ids, 'replace');
                    // Selection updates synchronously via ref, so ungroup acts on this group.
                    requestAnimationFrame(() => p.onUngroup());
                  }}
                >
                  <Ungroup />
                </button>
              )}
              <button
                className={`layer-act${locked ? ' on' : ''}`}
                data-tip={locked ? 'Unlock' : 'Lock'}
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
                data-tip={hidden ? 'Show' : 'Hide'}
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

const same = <T,>(xs: T[]): T | null => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : null);

function DesignTab(p: Props) {
  const sel = p.items.filter((i) => p.selection.has(i.id));
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
  const live = boundsOf(sel)!;
  // While scrubbing, previews are built from the items as they were when the scrub began,
  // so offsets must be measured from those bounds too (not the already-previewed ones).
  const scrubBase = useRef<typeof live | null>(null);
  const b = scrubBase.current ?? live;
  const texts = sel.filter((i) => i.kind === 'text');
  const allText = texts.length === sel.length;
  const units = new Set(sel.map((i) => i.groupId || i.id)).size;
  const grouped = sel.some((i) => i.groupId);

  // Move / scale the whole selection relative to its bounds.
  const moveTo = (axis: 'x' | 'y', v: number) => (it: Item) => ({
    ...it,
    [axis]: it[axis] + (v - b[axis]),
  });
  const scaleTo = (axis: 'w' | 'h', v: number) => (it: Item) => {
    const k = v / b[axis];
    const fs = it.kind === 'text' ? (it.fontSize ?? 24) * k : it.fontSize;
    return {
      ...it,
      x: b.x + (it.x - b.x) * k,
      y: b.y + (it.y - b.y) * k,
      w: it.w * k,
      h: it.h * k,
      fontSize: fs,
    };
  };
  const resizeOne = (axis: 'w' | 'h', v: number) => (it: Item) => {
    // Always keep proportions.
    const w = axis === 'w' ? v : (v * it.w) / it.h;
    const h = axis === 'h' ? v : (v * it.h) / it.w;
    const fs = it.kind === 'text' ? (it.fontSize ?? 24) * (w / it.w) : it.fontSize;
    return { ...it, w: Math.max(1, w), h: Math.max(1, h), fontSize: fs };
  };

  const TIPS: Record<string, string> = {
    X: 'X position',
    Y: 'Y position',
    W: 'Width',
    H: 'Height',
    Size: 'Font size',
  };
  const field = (
    label: ReactNode,
    value: number | null,
    fn: (v: number) => (it: Item) => Item,
    extra: Partial<Parameters<typeof NumberField>[0]> = {},
  ) => (
    <NumberField
      tip={typeof label === 'string' ? TIPS[label] : undefined}
      label={label}
      value={value}
      onCommit={(v) => p.onPatch(ids, fn(v))}
      onScrub={(v) => {
        if (!scrubBase.current) scrubBase.current = live;
        p.onPreview(ids, fn(v));
      }}
      onScrubEnd={() => {
        scrubBase.current = null;
        p.onPreviewEnd();
      }}
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
        </div>
        <div className="grid2">
          {one ? field('W', one.w, (v) => resizeOne('w', v), { min: 1 }) : field('W', b.w, (v) => scaleTo('w', v), { min: 1 })}
          {one ? field('H', one.h, (v) => resizeOne('h', v), { min: 1 }) : field('H', b.h, (v) => scaleTo('h', v), { min: 1 })}
        </div>
        <div className="grid2">
          {field(
            <RotateCw aria-label="Rotation" />,
            same(sel.map((i) => Math.round((i.rotation ?? 0) * 10) / 10)),
            (v) => (it) => ({
              ...it,
              rotation: ((((v + 180) % 360) + 360) % 360) - 180,
            }),
            { suffix: '°', tip: 'Rotation' },
          )}
          {field(
            <Blend aria-label="Opacity" />,
            same(sel.map((i) => Math.round((i.opacity ?? 1) * 100))),
            (v) => (it) => ({ ...it, opacity: v / 100 }),
            { min: 0, max: 100, suffix: '%', tip: 'Opacity' },
          )}
        </div>
      </section>

      {allText && (
        <section>
          <div className="side-label">Text</div>
          <div className="grid2">
            {field(
              'Size',
              same(texts.map((t) => Math.round((t.fontSize ?? 24) * 10) / 10)),
              (v) => (it) => ({ ...it, fontSize: Math.max(1, v) }),
              { min: 1 },
            )}
            <label className="num select">
              <span className="num-label">Weight</span>
              <select
                value={same(texts.map((t) => t.fontWeight ?? 500)) ?? ''}
                onChange={(e) =>
                  p.onPatch(ids, (it) => ({
                    ...it,
                    fontWeight: Number(e.target.value),
                  }))
                }
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
          <FillRow
            color={same(texts.map((t) => t.color ?? null))}
            mixed={new Set(texts.map((t) => t.color ?? '')).size > 1}
            autoColor={p.dark ? '#EDEDEC' : '#191919'}
            open={pickerOpen}
            onOpen={setPickerOpen}
            onCommit={(c) => p.onPatch(ids, (it) => ({ ...it, color: c }))}
            onPreview={(c) => p.onPreview(ids, (it) => ({ ...it, color: c }))}
          />
        </section>
      )}

      <section>
        <div className="side-label">Arrange</div>
        <div className="action-grid">
          {grouped && sel.length > 0 && units === 1 ? (
            <button className="act" data-tip="Ungroup (⇧⌘G)" onClick={p.onUngroup}>
              <Ungroup /> Ungroup
            </button>
          ) : (
            <button className="act" data-tip="Group (⌘G)" disabled={sel.length < 2} onClick={p.onGroup}>
              <Group /> Group
            </button>
          )}
          <button className="act" data-tip="Lock (⇧⌘L)" onClick={() => p.onToggleFlag(ids, 'locked')}>
            {sel.every((i) => i.locked) ? <LockOpen /> : <Lock />} {sel.every((i) => i.locked) ? 'Unlock' : 'Lock'}
          </button>
          <button className="act" data-tip="Hide (⇧⌘H)" onClick={() => p.onToggleFlag(ids, 'hidden')}>
            {sel.every((i) => i.hidden) ? <Eye /> : <EyeOff />} {sel.every((i) => i.hidden) ? 'Show' : 'Hide'}
          </button>
          <button className="act" data-tip="Bring to front (])" onClick={() => p.onArrange('front')}>
            <BringToFront /> To front
          </button>
          <button className="act" data-tip="Send to back ([)" onClick={() => p.onArrange('back')}>
            <SendToBack /> To back
          </button>
          <button className="act danger" data-tip="Delete (⌫)" onClick={p.onDelete}>
            <Trash2 /> Delete
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------- shell ---------- */

export function Sidebar(p: Props) {
  const ref = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Opened by hovering (not clicked): closes again when the pointer leaves.
  const peek = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const openRef = useRef(p.open);
  openRef.current = p.open;
  const { onSetOpen } = p;

  // Something in the panel is mid-use: typing, a popup, or a scrub in progress.
  const busy = () =>
    !!document.querySelector('.fill-pop') ||
    (!!ref.current && ref.current.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT');

  const enter = () => {
    window.clearTimeout(timer.current);
    if (openRef.current) return;
    timer.current = window.setTimeout(() => {
      peek.current = true;
      onSetOpen(true);
    }, 80);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    if (!peek.current) return;
    const tryClose = () => {
      if (!peek.current) return;
      if (busy()) {
        timer.current = window.setTimeout(tryClose, 300);
        return;
      }
      peek.current = false;
      onSetOpen(false);
    };
    timer.current = window.setTimeout(tryClose, 350);
  };

  // Click anywhere outside the panel (and its popups) collapses it.
  useEffect(() => {
    if (!p.open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || toggleRef.current?.contains(t)) return;
      if (t.closest('.fill-pop, .menu, .scrim, .tooltip')) return;
      window.clearTimeout(timer.current);
      peek.current = false;
      onSetOpen(false);
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [p.open, onSetOpen]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <aside
        ref={ref}
        className={`sidebar${p.open ? ' shown' : ''}`}
        aria-label="Layers and design"
        aria-hidden={!p.open}
        inert={!p.open}
        onPointerEnter={enter}
        onPointerLeave={leave}
        // Interacting with the panel keeps it open.
        onPointerDown={() => (peek.current = false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="side-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={p.tab === 'layers'}
            className={`side-tab${p.tab === 'layers' ? ' on' : ''}`}
            onClick={() => p.onTab('layers')}
          >
            <Layers /> Layers
          </button>
          <button
            role="tab"
            aria-selected={p.tab === 'design'}
            className={`side-tab${p.tab === 'design' ? ' on' : ''}`}
            onClick={() => p.onTab('design')}
          >
            <SlidersHorizontal /> Design
          </button>
        </div>
        <div className="side-body">{p.tab === 'layers' ? <LayersTab {...p} /> : <DesignTab {...p} />}</div>
      </aside>
      <button
        ref={toggleRef}
        className={`side-toggle${p.open ? ' on' : ''}`}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={(e) => {
          e.currentTarget.blur();
          window.clearTimeout(timer.current);
          // Clicking while it's only peeking pins it open.
          if (peek.current) {
            peek.current = false;
            p.onPin();
            return;
          }
          p.onToggle();
        }}
        data-tip={p.open ? 'Hide sidebar (⌘\\)' : 'Show layers & design (⌘\\)'}
        aria-label={p.open ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={p.open}
      >
        {/* Both icons stay mounted and crossfade, so nothing jumps. */}
        <PanelLeft className="ic-closed" aria-hidden />
        <PanelLeftClose className="ic-open" aria-hidden />
      </button>
    </>
  );
}
