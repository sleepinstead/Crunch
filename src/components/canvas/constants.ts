// Canvas constants and small helpers (zoom limits, platform modifier, focus checks, undo history).
import type { Entry } from './types';

export const TAB_DRAG_TYPE = 'application/x-crunch-tab';
export const MIN_ZOOM = 0.03;
export const MAX_ZOOM = 10;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const uid = (): string => crypto.randomUUID();
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
export const MOD = IS_MAC ? '⌘' : 'Ctrl ';
export const DOCK_SPACE = 88;

export const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
// A dialog or the landing page is on top: the canvas ignores keys and paste.
export const modalOpen = () => !!document.querySelector('.scrim, .landing');
/** Focus is inside settings, a popover or a menu: canvas shortcuts stay out of the way. */
export const inPanel = (t: EventTarget | null) => t instanceof Element && !!t.closest('.settings, .popover, .menu');
export const onControl = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('button, a, [role="tab"], [role="switch"], [role="radio"]');

export const RAD = Math.PI / 180;

/** Undo history per project, kept for the whole session (survives switching tabs). */
export const histories = new Map<string, { undo: Entry[]; redo: Entry[] }>();
export const historyFor = (id: string) => {
  let h = histories.get(id);
  if (!h) histories.set(id, (h = { undo: [], redo: [] }));
  return h;
};
