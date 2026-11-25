import { api, type Item } from './api';

/** Longest side of a preview. Items drawn smaller than this on screen use the preview. */
export const THUMB_SIDE = 512;

const done = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

/** Whether an image is worth a preview: big enough, and not animated or vector. */
export function wantsThumb(it: Item) {
  return (
    it.kind === 'image' &&
    !it.thumb &&
    !!it.assetId &&
    Math.max(it.naturalW, it.naturalH) > THUMB_SIDE * 1.5 &&
    !/\.(gif|svg)$/i.test(it.src)
  );
}

async function render(src: string): Promise<Blob | null> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  const k = THUMB_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  if (k >= 1) return null;
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
}

/**
 * Make and save previews for these images, one at a time while the browser is idle.
 * `onReady` gets each preview's URL so the item can switch to it.
 */
export function makeThumbs(items: Item[], onReady: (assetId: string, thumb: string) => void) {
  for (const it of items) {
    if (!wantsThumb(it) || done.has(it.assetId)) continue;
    done.add(it.assetId);
    queue = queue
      .then(() => new Promise((r) => (window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 50)))(() => r(null))))
      .then(() => render(it.src))
      .then((blob) => (blob ? api.uploadThumb(it.assetId, blob) : null))
      .then((res) => res && onReady(it.assetId, res.thumb))
      .catch(() => done.delete(it.assetId)); // try again another time
  }
}
