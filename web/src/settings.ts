import type { Pattern } from './api';

export interface Settings {
  imageRadius: number; // world px
  imageShadow: boolean;
  imageGap: 'tight' | 'normal' | 'loose';
  imageSize: 'small' | 'medium' | 'large';
  wheel: 'pan' | 'zoom';
  showName: boolean;
  fadeDock: boolean;
  newPattern: Pattern;
  newColor: string;
  // Canvas
  snapping: boolean;
  snapSpacing: boolean;
  showSizeLabel: boolean;
  pasteAt: 'cursor' | 'center';
  // Adding images
  preferOriginal: boolean;
  // Text
  textSize: 'small' | 'medium' | 'large';
  // Appearance
  uiTheme: 'auto' | 'light' | 'dark';
  reduceMotion: 'system' | 'on';
  motionSpeed: 'snappy' | 'normal' | 'relaxed';
  // Library
  trashDays: 0 | 30 | 90;
}

export const DEFAULT_SETTINGS: Settings = {
  imageRadius: 0,
  imageShadow: false,
  imageGap: 'normal',
  imageSize: 'medium',
  wheel: 'pan',
  showName: true,
  fadeDock: true,
  newPattern: 'dots',
  newColor: '#F7F7F5',
  snapping: true,
  snapSpacing: true,
  showSizeLabel: true,
  pasteAt: 'cursor',
  preferOriginal: true,
  textSize: 'medium',
  uiTheme: 'auto',
  reduceMotion: 'system',
  motionSpeed: 'snappy',
  trashDays: 0,
};

const oneOf = <T>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Merge stored values over defaults, discarding anything invalid. */
export function normalizeSettings(raw: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    imageRadius: oneOf(raw.imageRadius, [0, 4, 10] as const, d.imageRadius as 0),
    imageShadow: typeof raw.imageShadow === 'boolean' ? raw.imageShadow : d.imageShadow,
    imageGap: oneOf(raw.imageGap, ['tight', 'normal', 'loose'] as const, d.imageGap),
    imageSize: oneOf(raw.imageSize, ['small', 'medium', 'large'] as const, d.imageSize),
    wheel: oneOf(raw.wheel, ['pan', 'zoom'] as const, d.wheel),
    showName: typeof raw.showName === 'boolean' ? raw.showName : d.showName,
    fadeDock: typeof raw.fadeDock === 'boolean' ? raw.fadeDock : d.fadeDock,
    newPattern: oneOf(raw.newPattern, ['dots', 'grid', 'plain'] as const, d.newPattern),
    newColor: typeof raw.newColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.newColor) ? raw.newColor : d.newColor,
    snapping: typeof raw.snapping === 'boolean' ? raw.snapping : d.snapping,
    snapSpacing: typeof raw.snapSpacing === 'boolean' ? raw.snapSpacing : d.snapSpacing,
    showSizeLabel: typeof raw.showSizeLabel === 'boolean' ? raw.showSizeLabel : d.showSizeLabel,
    pasteAt: oneOf(raw.pasteAt, ['cursor', 'center'] as const, d.pasteAt),
    preferOriginal: typeof raw.preferOriginal === 'boolean' ? raw.preferOriginal : d.preferOriginal,
    textSize: oneOf(raw.textSize, ['small', 'medium', 'large'] as const, d.textSize),
    uiTheme: oneOf(raw.uiTheme, ['auto', 'light', 'dark'] as const, d.uiTheme),
    reduceMotion: oneOf(raw.reduceMotion, ['system', 'on'] as const, d.reduceMotion),
    motionSpeed: oneOf(raw.motionSpeed, ['snappy', 'normal', 'relaxed'] as const, d.motionSpeed),
    trashDays: oneOf(raw.trashDays, [0, 30, 90] as const, d.trashDays),
  };
}

export const GAP_PX = { tight: 8, normal: 20, loose: 44 } as const;
export const SIZE_SCALE = { small: 0.65, medium: 1, large: 1.45 } as const;

export const TEXT_SIZE_PX = { small: 16, medium: 24, large: 40 } as const;

/** Reduced motion: the app setting, or the system preference. */
export const reducedMotion = () =>
  document.documentElement.dataset.reduceMotion === 'on' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Multiplier for panel, menu and popup animation durations. */
export const MOTION_SCALE = { snappy: 1, normal: 1.6, relaxed: 2.4 } as const;
