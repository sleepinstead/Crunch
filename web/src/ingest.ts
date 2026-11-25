/**
 * Turns whatever the user pasted or dropped into a list of image sources.
 * Web images are preferred by URL (original quality, animated GIFs survive),
 * with the clipboard bitmap kept as a fallback if the download fails.
 */
import { api, type Asset } from './api';

export type Source =
  | { kind: 'file'; file: Blob; sourceUrl?: string }
  | { kind: 'url'; url: string; fallback?: Blob }
  | { kind: 'asset'; assetId: string };

export const CRUNCH_ASSET_ATTR = 'data-crunch-asset';
const URLISH = /^(https?:\/\/\S+|data:image\/[^\s]+)$/i;

function bestFromSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  let best: { url: string; score: number } | null = null;
  for (const part of srcset.split(/,\s+/)) {
    const [url, desc = '1x'] = part.trim().split(/\s+/);
    const score = parseFloat(desc) * (desc.endsWith('w') ? 1 : 1000);
    if (url && (!best || score > best.score)) best = { url, score };
  }
  return best?.url ?? null;
}

function absolute(u: string | null): string | null {
  if (!u) return null;
  if (u.startsWith('data:image/')) return u;
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
  } catch {
    return null;
  }
}

interface Parts {
  files: Blob[];
  html: string;
  text: string;
}

function fromParts({ files, html, text }: Parts, preferOriginal = true): Source[] {
  const imgSrcs: string[] = [];
  const assetIds: string[] = [];
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('img').forEach((img) => {
      const asset = img.getAttribute(CRUNCH_ASSET_ATTR);
      if (asset) return void assetIds.push(asset);
      const src = absolute(bestFromSrcset(img.getAttribute('srcset'))) ?? absolute(img.getAttribute('src'));
      if (src && !imgSrcs.includes(src)) imgSrcs.push(src);
    });
  }

  // Copied from Crunch itself: reuse the stored file.
  if (assetIds.length) return assetIds.map((assetId) => ({ kind: 'asset', assetId }));

  const asSource = (u: string): Source | null => {
    if (u.startsWith('data:')) {
      const file = dataUrlToBlob(u);
      return file ? { kind: 'file', file } : null;
    }
    return { kind: 'url', url: u };
  };

  if (files.length) {
    const web = imgSrcs.filter((s) => !s.startsWith('data:'));
    if (files.length === 1 && web.length === 1)
      return preferOriginal
        ? [{ kind: 'url', url: web[0], fallback: files[0] }]
        : [{ kind: 'file', file: files[0], sourceUrl: web[0] }];
    return files.map((file) => ({ kind: 'file', file }));
  }
  if (imgSrcs.length) return imgSrcs.map(asSource).filter((s): s is Source => !!s);

  const urls = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && URLISH.test(l)))];
  return urls.map(asSource).filter((s): s is Source => !!s);
}

const isImage = (b: Blob) => b.type.startsWith('image/');

/** Must be called synchronously inside the paste/drop event. */
export function readTransfer(dt: DataTransfer | null, preferOriginal = true): Source[] {
  if (!dt) return [];
  const files: Blob[] = Array.from(dt.files).filter(isImage);
  if (!files.length) {
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return fromParts({
    files,
    html: dt.getData('text/html'),
    text: dt.getData('text/uri-list') || dt.getData('text/plain'),
  }, preferOriginal);
}

/** Async Clipboard API, used by the "Paste" menu command. */
export async function readClipboard(preferOriginal = true): Promise<Source[]> {
  const items = await navigator.clipboard.read();
  const files: Blob[] = [];
  let html = '';
  let text = '';
  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith('image/')) files.push(await item.getType(type));
      else if (type === 'text/html') html += await (await item.getType(type)).text();
      else if (type === 'text/plain' || type === 'text/uri-list') text += (await (await item.getType(type)).text()) + '\n';
    }
  }
  return fromParts({ files, html, text }, preferOriginal);
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'that link';
  }
}

export async function resolveSource(src: Source): Promise<Asset> {
  if (src.kind === 'asset') return api.getAsset(src.assetId);
  if (src.kind === 'file') return api.uploadAsset(src.file, src.sourceUrl);
  try {
    return await api.assetFromUrl(src.url);
  } catch (err) {
    if (src.fallback) return api.uploadAsset(src.fallback, src.url);
    throw err;
  }
}
