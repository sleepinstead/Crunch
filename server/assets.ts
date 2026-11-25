import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import { db, IMAGES_DIR } from './db.ts';

export interface AssetRow {
  id: string;
  hash: string;
  file: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  source_url: string | null;
  created_at: number;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TYPES: Record<string, { ext: string; mime: string }> = {
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  gif: { ext: 'gif', mime: 'image/gif' },
  webp: { ext: 'webp', mime: 'image/webp' },
  svg: { ext: 'svg', mime: 'image/svg+xml' },
  avif: { ext: 'avif', mime: 'image/avif' },
  bmp: { ext: 'bmp', mime: 'image/bmp' },
  ico: { ext: 'ico', mime: 'image/x-icon' },
  tiff: { ext: 'tiff', mime: 'image/tiff' },
  heif: { ext: 'heic', mime: 'image/heic' },
  jxl: { ext: 'jxl', mime: 'image/jxl' },
};

function detect(buf: Buffer) {
  let info;
  try {
    info = imageSize(buf);
  } catch {
    throw new HttpError(415, 'That file is not a supported image.');
  }
  let type = info.type ?? '';
  // image-size reports AVIF as heif; check the ftyp brand so browsers get the right type.
  if (type === 'heif' && /avi[fs]/.test(buf.subarray(8, 12).toString('latin1'))) type = 'avif';
  const t = TYPES[type];
  if (!t) throw new HttpError(415, `Unsupported image type${type ? `: ${type}` : ''}.`);
  let width = info.width ?? 0;
  let height = info.height ?? 0;
  // EXIF orientations 5–8 are rotated 90°; browsers render them swapped.
  if (info.orientation && info.orientation >= 5) [width, height] = [height, width];
  if (!width || !height) {
    width = 800;
    height = 600;
  }
  return { ...t, width, height };
}

/** Write an image to permanent storage (deduplicated by content) and record it in SQLite. */
export function storeAsset(buf: Buffer, sourceUrl: string | null): AssetRow {
  if (!buf.length) throw new HttpError(400, 'Empty image.');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const existing = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash) as AssetRow | undefined;
  if (existing) {
    // Self-heal if the file went missing on disk.
    const p = path.join(IMAGES_DIR, existing.file);
    if (!fs.existsSync(p)) writeAtomic(p, buf);
    if (!existing.source_url && sourceUrl) {
      db.prepare('UPDATE assets SET source_url = ? WHERE id = ?').run(sourceUrl, existing.id);
      existing.source_url = sourceUrl;
    }
    return existing;
  }

  const { ext, mime, width, height } = detect(buf);
  const file = `${hash.slice(0, 32)}.${ext}`;
  writeAtomic(path.join(IMAGES_DIR, file), buf);

  const row: AssetRow = {
    id: crypto.randomUUID(),
    hash,
    file,
    mime,
    width,
    height,
    bytes: buf.length,
    source_url: sourceUrl,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO assets (id, hash, file, mime, width, height, bytes, source_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.hash, row.file, row.mime, row.width, row.height, row.bytes, row.source_url, row.created_at);
  return row;
}

function writeAtomic(target: string, buf: Buffer) {
  // Recreate the folder if it was removed while the server was running.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

export function assetJson(a: AssetRow) {
  return {
    id: a.id,
    src: `/files/${a.file}`,
    width: a.width,
    height: a.height,
    mime: a.mime,
    sourceUrl: a.source_url,
  };
}
