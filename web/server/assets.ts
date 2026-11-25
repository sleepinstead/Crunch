import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import type { Store } from './db.ts';

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

/** Stored file names: 32 hex characters of the content hash and a known extension. */
export const FILE_NAME = /^[0-9a-f]{32}\.(jpg|png|gif|webp|svg|avif|bmp|ico|tiff|heic|jxl)$/;

/** Small previews, drawn at low zoom instead of the full file: images/thumbs/<hash>.webp */
export const thumbName = (file: string) => `${file.slice(0, 32)}.webp`;
export const thumbPath = (store: Pick<Store, 'imagesDir'>, file: string) => path.join(store.imagesDir, 'thumbs', thumbName(file));

/** Save a preview made by the browser. Only small WebP/PNG/JPEG images are accepted. */
export function storeThumb(store: Store, file: string, buf: Buffer) {
  if (!FILE_NAME.test(file)) throw new HttpError(400, 'Invalid image.');
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'Preview too large.');
  let info;
  try {
    info = imageSize(buf);
  } catch {
    throw new HttpError(415, 'Not an image.');
  }
  if (!['webp', 'png', 'jpg'].includes(info.type ?? '') || (info.width ?? 0) > 1024 || (info.height ?? 0) > 1024)
    throw new HttpError(415, 'Previews must be WebP, PNG or JPEG, at most 1024 px.');
  writeAtomic(thumbPath(store, file), buf);
}

/** Absolute path of a stored image, or null if the name is not one Crunch writes. */
export function imagePath(store: Pick<Store, 'imagesDir'>, file: string): string | null {
  if (!FILE_NAME.test(file)) return null;
  const p = path.join(store.imagesDir, file);
  return p.startsWith(store.imagesDir + path.sep) ? p : null;
}

const MAX_SIDE = 100_000;

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
  if (!(width > 0 && height > 0)) {
    width = 800;
    height = 600;
  }
  width = Math.min(Math.round(width), MAX_SIDE);
  height = Math.min(Math.round(height), MAX_SIDE);
  return { ...t, width, height };
}

/** Write an image to permanent storage (deduplicated by content) and record it in SQLite. */
export function storeAsset(store: Store, buf: Buffer, sourceUrl: string | null): AssetRow {
  if (!buf.length) throw new HttpError(400, 'Empty image.');
  const { db } = store;
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const existing = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash) as AssetRow | undefined;
  if (existing) {
    // Self-heal if the file went missing or was cut short on disk.
    const p = imagePath(store, existing.file);
    if (p) {
      const size = fs.existsSync(p) ? fs.statSync(p).size : -1;
      if (size !== buf.length) writeAtomic(p, buf);
    }
    // A pending delete of this file (from a purge) must not remove it now that it is used again.
    db.prepare('DELETE FROM pending_file_deletes WHERE file = ?').run(existing.file);
    if (!existing.source_url && sourceUrl) {
      db.prepare('UPDATE assets SET source_url = ? WHERE id = ?').run(sourceUrl, existing.id);
      existing.source_url = sourceUrl;
    }
    return existing;
  }

  const { ext, mime, width, height } = detect(buf);
  const file = `${hash.slice(0, 32)}.${ext}`;
  writeAtomic(path.join(store.imagesDir, file), buf);
  db.prepare('DELETE FROM pending_file_deletes WHERE file = ?').run(file);

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
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, buf);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if ((err as NodeJS.ErrnoException).code === 'ENOSPC') throw new HttpError(507, 'The disk is full, so the image wasn’t saved.');
    throw err;
  }
}

/** Remove files queued for deletion. Rows stay queued if a delete fails, and are retried later. */
/** Removed image files are kept this long, so a database snapshot from that time still has its images. */
export const KEEP_REMOVED_MS = 14 * 86_400_000;
const retiredDir = (store: Pick<Store, 'backupsDir'>) => path.join(store.backupsDir, 'images');

/** Move an image out of the library into the backup folder (instead of deleting it). */
function retire(store: Pick<Store, 'backupsDir'>, p: string) {
  // Previews are cheap to make again; they never need keeping.
  fs.rmSync(path.join(path.dirname(p), 'thumbs', thumbName(path.basename(p))), { force: true });
  if (!fs.existsSync(p)) return;
  const dir = retiredDir(store);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(p));
  try {
    fs.renameSync(p, dest);
  } catch {
    fs.copyFileSync(p, dest);
    fs.rmSync(p, { force: true });
  }
  const now = new Date();
  fs.utimesSync(dest, now, now); // its age counts from removal
}

export function flushFileDeletes(store: Store) {
  const rows = store.db.prepare('SELECT file FROM pending_file_deletes').all() as { file: string }[];
  const done = store.db.prepare('DELETE FROM pending_file_deletes WHERE file = ?');
  const inUse = store.db.prepare('SELECT 1 FROM assets WHERE file = ? LIMIT 1');
  for (const { file } of rows) {
    if (inUse.get(file)) {
      done.run(file);
      continue;
    }
    const p = imagePath(store, file);
    try {
      if (p) retire(store, p);
      done.run(file);
    } catch (err) {
      console.warn(`  Couldn’t remove ${file}: ${(err as Error).message}. Will retry.`);
    }
  }
}

/**
 * Start-up housekeeping: drop asset rows nothing has used for an hour (uploads
 * whose placement never arrived), and image files no row knows about.
 */
export function collectGarbage(store: Store, olderThanMs = 3_600_000) {
  const { db, tx } = store;
  const cutoff = Date.now() - olderThanMs;
  tx(() => {
    const unused = db
      .prepare(
        `SELECT id, file FROM assets a WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM items i WHERE i.asset_id = a.id)
           AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.asset_id = a.id)`,
      )
      .all(cutoff) as { id: string; file: string }[];
    const del = db.prepare('DELETE FROM assets WHERE id = ?');
    const queue = db.prepare('INSERT OR IGNORE INTO pending_file_deletes (file) VALUES (?)');
    for (const a of unused) {
      del.run(a.id);
      queue.run(a.file);
    }
  });
  const known = new Set((db.prepare('SELECT file FROM assets').all() as { file: string }[]).map((r) => r.file));
  const retired = retiredDir(store);
  // A restored snapshot may point at images that were removed since: bring them back.
  for (const f of known) {
    const live = imagePath(store, f);
    const kept = path.join(retired, f);
    if (live && !fs.existsSync(live) && FILE_NAME.test(f) && fs.existsSync(kept)) {
      fs.mkdirSync(store.imagesDir, { recursive: true });
      fs.copyFileSync(kept, live);
    }
  }
  if (fs.existsSync(store.imagesDir)) {
    for (const f of fs.readdirSync(store.imagesDir)) {
      const p = path.join(store.imagesDir, f);
      if (f.endsWith('.tmp')) {
        // A write interrupted by a crash.
        if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
      } else if (FILE_NAME.test(f) && !known.has(f) && fs.statSync(p).mtimeMs < cutoff) {
        retire(store, p); // no row knows this image: keep it aside rather than delete it
      }
    }
  }
  flushFileDeletes(store);
  // Removed images are only deleted for good after two weeks.
  if (fs.existsSync(retired)) {
    for (const f of fs.readdirSync(retired)) {
      const p = path.join(retired, f);
      if (Date.now() - fs.statSync(p).mtimeMs > KEEP_REMOVED_MS) fs.rmSync(p, { force: true });
    }
  }
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
