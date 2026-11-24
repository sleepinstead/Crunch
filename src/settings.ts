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
  };
}

export const GAP_PX = { tight: 8, normal: 20, loose: 44 } as const;
export const SIZE_SCALE = { small: 0.65, medium: 1, large: 1.45 } as const;
