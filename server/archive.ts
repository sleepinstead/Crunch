/**
 * Library export and import.
 *
 * An export is a plain (uncompressed) tar file, `.crunch`, holding
 *   crunch.json      projects, layers, groups, Recently deleted, settings, image list
 *   images/<file>    every image file, by its content-hash name
 * Images are already compressed, so tar keeps it simple, streamable and readable
 * with any archive tool. Import adds the backup's boards next to the current ones
 * (fresh ids, duplicate images stored once), so it never overwrites anything.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import type { Store } from './db.ts';
import { FILE_NAME, HttpError, imagePath, storeAsset, type AssetRow } from './assets.ts';

export const ARCHIVE_FORMAT = 'crunch-library';
export const ARCHIVE_VERSION = 1;
const MANIFEST = 'crunch.json';

/* ---------- tar ---------- */

function header(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 'ascii');
  h.write('0000000\0', 108, 'ascii');
  h.write('0000000\0', 116, 'ascii');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  h.write(
    Math.floor(mtime / 1000)
      .toString(8)
      .padStart(11, '0') + '\0',
    136,
    'ascii',
  );
  h.write('        ', 148, 'ascii');
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}

const pad = (size: number) => Buffer.alloc((512 - (size % 512)) % 512);

async function write(out: Writable, chunk: Buffer) {
  if (!out.write(chunk)) await once(out, 'drain');
}

/* ---------- export ---------- */

export function manifest(store: Store) {
  const { db } = store;
  const settings = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
  let parsed: unknown = {};
  try {
    parsed = settings ? JSON.parse(settings.value) : {};
  } catch {
    parsed = {};
  }
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: parsed,
    projects: db.prepare('SELECT * FROM projects ORDER BY position').all(),
    groups: db.prepare('SELECT * FROM groups').all(),
    items: db.prepare('SELECT * FROM items ORDER BY project_id, z').all(),
    trash: db.prepare('SELECT * FROM trash ORDER BY deleted_at').all(),
    assets: db.prepare('SELECT * FROM assets').all() as unknown as AssetRow[],
  };
}

/** Stream the whole library as a tar archive. Images missing on disk are skipped and listed. */
export async function exportLibrary(store: Store, out: Writable): Promise<{ missing: string[] }> {
  const m = manifest(store);
  const json = Buffer.from(JSON.stringify(m, null, 2));
  const now = Date.now();
  await write(out, header(MANIFEST, json.length, now));
  await write(out, json);
  await write(out, pad(json.length));
  const missing: string[] = [];
  for (const a of m.assets) {
    const p = imagePath(store, a.file);
    if (!p || !fs.existsSync(p)) {
      missing.push(a.file);
      continue;
    }
    const size = fs.statSync(p).size;
    await write(out, header(`images/${a.file}`, size, now));
    for await (const chunk of fs.createReadStream(p)) await write(out, chunk as Buffer);
    await write(out, pad(size));
  }
  await write(out, Buffer.alloc(1024)); // end-of-archive marker
  return { missing };
}

/* ---------- import ---------- */

interface Entry {
  name: string;
  offset: number;
  size: number;
}

/** List the entries of a tar file on disk (regular files only). */
function readEntries(file: string): Entry[] {
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const entries: Entry[] = [];
    const h = Buffer.alloc(512);
    let pos = 0;
    while (pos + 512 <= total) {
      fs.readSync(fd, h, 0, 512, pos);
      if (h.every((b) => b === 0)) break;
      const name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
      const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/s, '');
      const size = parseInt(h.toString('ascii', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
      const type = String.fromCharCode(h[156] || 48);
      if (!Number.isFinite(size) || size < 0) throw new HttpError(400, 'That backup file is damaged.');
      const full = prefix ? `${prefix}/${name}` : name;
      if (type === '0' || type === '\0') entries.push({ name: full, offset: pos + 512, size });
      pos += 512 + size + ((512 - (size % 512)) % 512);
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function readEntry(file: string, e: Entry): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(e.size);
    fs.readSync(fd, buf, 0, e.size, e.offset);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/* Coercion of untrusted manifest values (the archive may be hand-edited or damaged). */
const str = (v: unknown, max = 200, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const fin = (v: unknown, fallback: number, min = -1e7, max = 1e7) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const hex = (v: unknown, fallback: string | null) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
const pattern = (v: unknown) => (v === 'grid' || v === 'plain' ? v : 'dots');
const weight = (v: unknown) => ([300, 400, 500, 600, 700].includes(v as number) ? (v as number) : null);
const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((r) => r && typeof r === 'object') : []);

export interface ImportResult {
  projects: number;
  items: number;
  images: number;
  trash: number;
  skippedImages: number;
}

/** Add everything in a `.crunch` archive (already saved to `file`) to the library. */
export function importLibrary(store: Store, file: string): ImportResult {
  const entries = readEntries(file);
  const man = entries.find((e) => e.name === MANIFEST);
  if (!man) throw new HttpError(400, 'That isn’t a Crunch backup (crunch.json is missing).');
  if (man.size > 512 * 1024 * 1024) throw new HttpError(400, 'That backup file is damaged.');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readEntry(file, man).toString('utf8'));
  } catch {
    throw new HttpError(400, 'That backup file is damaged (crunch.json can’t be read).');
  }
  if (data.format !== ARCHIVE_FORMAT) throw new HttpError(400, 'That isn’t a Crunch backup.');
  if (typeof data.version !== 'number' || data.version > ARCHIVE_VERSION)
    throw new HttpError(400, 'That backup was made by a newer version of Crunch. Update Crunch to import it.');

  // 1. Images: store each file (deduplicated by content), mapping old asset ids to the stored rows.
  const files = new Map(entries.filter((e) => e.name.startsWith('images/')).map((e) => [e.name.slice(7), e]));
  const assetMap = new Map<string, string>();
  let images = 0;
  let skippedImages = 0;
  for (const a of list(data.assets)) {
    const name = str(a.file, 64);
    const e = FILE_NAME.test(name) ? files.get(name) : undefined;
    if (!e || e.size > 200 * 1024 * 1024) {
      skippedImages++;
      continue;
    }
    try {
      const row = storeAsset(store, readEntry(file, e), /^https?:\/\//i.test(str(a.source_url, 2048)) ? str(a.source_url, 2048) : null);
      assetMap.set(str(a.id, 64), row.id);
      images++;
    } catch {
      skippedImages++;
    }
  }

  // 2. Boards, groups, layers and Recently deleted, all with fresh ids, in one transaction.
  const { db, tx } = store;
  const result = { projects: 0, items: 0, images, trash: 0, skippedImages };
  tx(() => {
    const now = Date.now();
    const projectMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    let position =
      (
        db.prepare('SELECT MAX(position) AS m FROM projects').get() as {
          m: number | null;
        }
      ).m ?? 0;

    const insProject = db.prepare(
      `INSERT INTO projects (id, name, position, pattern, bg_color, density, view_x, view_y, zoom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of list(data.projects)) {
      const id = crypto.randomUUID();
      projectMap.set(str(p.id, 64), id);
      insProject.run(
        id,
        str(p.name, 120, 'Imported').trim() || 'Imported',
        ++position,
        pattern(p.pattern),
        hex(p.bg_color, '#F7F7F5'),
        fin(p.density, 1, 0.25, 4),
        fin(p.view_x, 0),
        fin(p.view_y, 0),
        fin(p.zoom, 1, 0.02, 64),
        fin(p.created_at, now, 0, 1e13),
        now,
      );
      result.projects++;
    }

    const insGroup = db.prepare('INSERT INTO groups (id, project_id, name, created_at) VALUES (?, ?, ?, ?)');
    for (const g of list(data.groups)) {
      const projectId = projectMap.get(str(g.project_id, 64));
      if (!projectId) continue;
      const id = crypto.randomUUID();
      groupMap.set(str(g.id, 64), id);
      insGroup.run(id, projectId, str(g.name, 200, 'Group').trim() || 'Group', now);
    }

    const insItem = db.prepare(
      `INSERT INTO items (id, project_id, kind, asset_id, text, font_size, color, font_weight, group_id, name,
         locked, hidden, opacity, x, y, w, h, z, rotation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const i of list(data.items)) {
      const projectId = projectMap.get(str(i.project_id, 64));
      if (!projectId) continue;
      const isText = i.kind === 'text';
      const assetId = isText ? null : assetMap.get(str(i.asset_id, 64));
      if (!isText && !assetId) continue;
      insItem.run(
        crypto.randomUUID(),
        projectId,
        isText ? 'text' : 'image',
        assetId ?? null,
        isText ? str(i.text, 20000) : null,
        isText ? fin(i.font_size, 32, 1, 1000) : null,
        isText ? hex(i.color, null) : null,
        isText ? weight(i.font_weight) : null,
        groupMap.get(str(i.group_id, 64)) ?? null,
        str(i.name, 200).trim() || null,
        i.locked ? 1 : 0,
        i.hidden ? 1 : 0,
        fin(i.opacity, 1, 0, 1),
        fin(i.x, 0),
        fin(i.y, 0),
        fin(i.w, 100, 1, 1e6),
        fin(i.h, 100, 1, 1e6),
        fin(i.z, 0, -1e12, 1e12),
        fin(i.rotation, 0, -180, 180),
        now,
        now,
      );
      result.items++;
    }

    const insTrash = db.prepare(
      `INSERT INTO trash (id, project_id, project_name, kind, asset_id, text, font_size, color, font_weight,
         group_id, group_name, name, locked, hidden, opacity, x, y, w, h, z, rotation, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of list(data.trash)) {
      const isText = t.kind === 'text';
      const assetId = isText ? null : assetMap.get(str(t.asset_id, 64));
      if (!isText && !assetId) continue;
      insTrash.run(
        crypto.randomUUID(),
        projectMap.get(str(t.project_id, 64)) ?? str(t.project_id, 64),
        str(t.project_name, 120, 'Imported'),
        isText ? 'text' : 'image',
        assetId ?? null,
        isText ? str(t.text, 20000) : null,
        isText ? fin(t.font_size, 32, 1, 1000) : null,
        isText ? hex(t.color, null) : null,
        isText ? weight(t.font_weight) : null,
        null,
        str(t.group_name, 200) || null,
        str(t.name, 200).trim() || null,
        t.locked ? 1 : 0,
        t.hidden ? 1 : 0,
        fin(t.opacity, 1, 0, 1),
        fin(t.x, 0),
        fin(t.y, 0),
        fin(t.w, 100, 1, 1e6),
        fin(t.h, 100, 1, 1e6),
        fin(t.z, 0, -1e12, 1e12),
        fin(t.rotation, 0, -180, 180),
        fin(t.deleted_at, now, 0, 1e13),
      );
      result.trash++;
    }
  });
  return result;
}

/** Save a request body to a temp file in the library folder, refusing anything over `limit` bytes. */
export async function saveUpload(store: Store, body: NodeJS.ReadableStream, limit: number): Promise<string> {
  const dir = path.join(store.dataDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `import-${crypto.randomUUID()}.tar`);
  const out = fs.createWriteStream(file);
  let total = 0;
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > limit) throw new HttpError(413, 'That backup is too large.');
      await write(out, chunk);
    }
    out.end();
    await once(out, 'finish');
    return file;
  } catch (err) {
    out.destroy();
    fs.rmSync(file, { force: true });
    throw err;
  }
}
