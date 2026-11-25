import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, tx, DATA_DIR, IMAGES_DIR, DIST_DIR, PROJECT_ROOT } from './db.ts';
import { storeAsset, assetJson, HttpError, type AssetRow } from './assets.ts';
import { fetchImage } from './fetch-image.ts';

const PORT = Number(process.env.PORT ?? 3210);
const HOST = process.env.HOST ?? '127.0.0.1';
const PROD = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');

/* ---------- request guards ---------- */

// Only answer requests addressed to this machine (blocks DNS-rebinding).
// Add hostnames via CRUNCH_ALLOWED_HOSTS (comma-separated) to reach Crunch another way.
const ALLOWED_HOSTS = new Set(
  ['localhost', '127.0.0.1', '[::1]', ...(process.env.CRUNCH_ALLOWED_HOSTS ?? '').split(',')]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
const hostname = (host: string) => host.toLowerCase().replace(/:\d+$/, '');

app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(hostname(req.headers.host ?? ''))) {
    res.status(403).json({ error: 'Host not allowed.' });
    return;
  }
  next();
});

/* ---------- serialization ---------- */

interface ProjectRow {
  id: string;
  name: string;
  position: number;
  pattern: string;
  bg_color: string;
  density: number;
  view_x: number;
  view_y: number;
  zoom: number;
}

const projectJson = (p: ProjectRow) => ({
  id: p.id,
  name: p.name,
  position: p.position,
  pattern: p.pattern,
  bgColor: p.bg_color,
  density: p.density ?? 1,
  view: { x: p.view_x, y: p.view_y, zoom: p.zoom },
});

interface ItemRow {
  id: string;
  project_id: string;
  kind: string;
  asset_id: string | null;
  text: string | null;
  font_size: number | null;
  color: string | null;
  group_id: string | null;
  name: string | null;
  locked: number;
  hidden: number;
  opacity: number;
  font_weight: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation: number;
  file: string | null;
  nw: number | null;
  nh: number | null;
  source_url: string | null;
}

const itemJson = (i: ItemRow) => ({
  id: i.id,
  projectId: i.project_id,
  kind: i.kind === 'text' ? 'text' : 'image',
  assetId: i.asset_id ?? '',
  text: i.text,
  fontSize: i.font_size,
  color: i.color,
  groupId: i.group_id,
  name: i.name,
  locked: !!i.locked,
  hidden: !!i.hidden,
  opacity: i.opacity ?? 1,
  fontWeight: i.font_weight,
  x: i.x,
  y: i.y,
  w: i.w,
  h: i.h,
  z: i.z,
  rotation: i.rotation,
  src: i.file ? `/files/${i.file}` : '',
  naturalW: i.nw ?? i.w,
  naturalH: i.nh ?? i.h,
  sourceUrl: i.source_url,
});

const getProject = (id: string) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

function readSettings(): Record<string, unknown> {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
  try {
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

function createProject(name: string) {
  const max = db.prepare('SELECT MAX(position) AS m FROM projects').get() as { m: number | null };
  const now = Date.now();
  const id = crypto.randomUUID();
  const s = readSettings();
  const pattern = ['dots', 'grid', 'plain'].includes(s.newPattern as string) ? (s.newPattern as string) : 'dots';
  const color = typeof s.newColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.newColor) ? s.newColor : '#F7F7F5';
  db.prepare(
    'INSERT INTO projects (id, name, position, pattern, bg_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, (max.m ?? 0) + 1, pattern, color, now, now);
  return getProject(id)!;
}

const num = (v: unknown, name: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `Invalid ${name}.`);
  return v;
};

/* ---------- API ---------- */

const api = express.Router();

// Other websites must not be able to change anything (blocks cross-site requests).
api.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  const site = req.get('sec-fetch-site');
  let ok = true;
  if (origin) {
    try {
      ok = new URL(origin).host.toLowerCase() === (req.headers.host ?? '').toLowerCase();
    } catch {
      ok = false;
    }
  } else if (site) {
    ok = site === 'same-origin' || site === 'none';
  }
  if (!ok) {
    res.status(403).json({ error: 'Cross-site request blocked.' });
    return;
  }
  next();
});

api.use(express.json({ limit: '4mb' }));

api.get('/settings', (_req, res) => {
  res.json(readSettings());
});

api.patch('/settings', (req, res) => {
  const patch = req.body;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Expected an object.');
  const next = { ...readSettings(), ...patch };
  db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(next),
  );
  if ('trashDays' in patch) autoEmptyTrash();
  res.json(next);
});

api.get('/stats', (_req, res) => {
  const a = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM assets').get() as { n: number; bytes: number };
  const p = db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
  res.json({ images: a.n, bytes: a.bytes, projects: p.n, dataDir: DATA_DIR, imagesDir: IMAGES_DIR });
});

api.get('/projects', (_req, res) => {
  let rows = db.prepare('SELECT * FROM projects ORDER BY position').all() as unknown as ProjectRow[];
  if (!rows.length) rows = [createProject('Inspiration')];
  res.json(rows.map(projectJson));
});

api.post('/projects', (req, res) => {
  const name = String(req.body?.name ?? '').trim() || 'Untitled';
  res.status(201).json(projectJson(createProject(name.slice(0, 120))));
});

api.patch('/projects/:id', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) throw new HttpError(404, 'Project not found.');
  const b = req.body ?? {};
  const next = { ...p };
  if (typeof b.name === 'string') next.name = b.name.trim().slice(0, 120) || 'Untitled';
  if (['dots', 'grid', 'plain'].includes(b.pattern)) next.pattern = b.pattern;
  if (typeof b.bgColor === 'string' && /^#[0-9a-f]{6}$/i.test(b.bgColor)) next.bg_color = b.bgColor;
  if (typeof b.density === 'number' && b.density >= 0.25 && b.density <= 4) next.density = b.density;
  if (b.view) {
    next.view_x = num(b.view.x, 'view');
    next.view_y = num(b.view.y, 'view');
    next.zoom = num(b.view.zoom, 'zoom');
  }
  db.prepare(
    `UPDATE projects SET name = ?, pattern = ?, bg_color = ?, density = ?, view_x = ?, view_y = ?, zoom = ?, updated_at = ? WHERE id = ?`,
  ).run(next.name, next.pattern, next.bg_color, next.density, next.view_x, next.view_y, next.zoom, Date.now(), p.id);
  res.json(projectJson(getProject(p.id)!));
});

api.post('/projects/reorder', (req, res) => {
  const ids: unknown = req.body?.ids;
  if (!Array.isArray(ids)) throw new HttpError(400, 'ids required.');
  const stmt = db.prepare('UPDATE projects SET position = ? WHERE id = ?');
  tx(() => ids.forEach((id, i) => stmt.run(i + 1, String(id))));
  res.json({ ok: true });
});

/* ---------- recently deleted ---------- */

const trashItems = db.prepare(
  `INSERT OR REPLACE INTO trash (id, project_id, project_name, asset_id, x, y, w, h, z, rotation, deleted_at)
   SELECT i.id, i.project_id, p.name, i.asset_id, i.x, i.y, i.w, i.h, i.z, i.rotation, ?
   FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = ? AND i.asset_id IS NOT NULL`,
);

// Removes the canvas. Its images move to Recently deleted.
api.delete('/projects/:id', (req, res) => {
  tx(() => {
    const ids = db.prepare('SELECT id FROM items WHERE project_id = ?').all(req.params.id) as { id: string }[];
    const now = Date.now();
    for (const { id } of ids) trashItems.run(now, id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  });
  res.json({ ok: true });
});

api.get('/trash', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT t.id, t.project_id, t.project_name, t.deleted_at, a.file, a.width, a.height, a.source_url,
              (SELECT 1 FROM projects p WHERE p.id = t.project_id) AS project_exists
       FROM trash t JOIN assets a ON a.id = t.asset_id ORDER BY t.deleted_at DESC`,
    )
    .all() as {
    id: string;
    project_id: string;
    project_name: string;
    deleted_at: number;
    file: string;
    width: number;
    height: number;
    source_url: string | null;
    project_exists: number | null;
  }[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      projectExists: !!r.project_exists,
      deletedAt: r.deleted_at,
      src: `/files/${r.file}`,
      width: r.width,
      height: r.height,
      sourceUrl: r.source_url,
    })),
  );
});

// Put images back on their canvas (or onto `fallbackProjectId` if that project is gone).
api.post('/trash/restore', (req, res) => {
  const ids: unknown = req.body?.ids;
  const fallback = String(req.body?.fallbackProjectId ?? '');
  if (!Array.isArray(ids)) throw new HttpError(400, 'ids required.');
  const restored: { id: string; projectId: string }[] = [];
  tx(() => {
    const get = db.prepare('SELECT * FROM trash WHERE id = ?');
    const exists = db.prepare('SELECT 1 FROM projects WHERE id = ?');
    const ins = db.prepare(
      `INSERT OR REPLACE INTO items (id, project_id, asset_id, x, y, w, h, z, rotation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const del = db.prepare('DELETE FROM trash WHERE id = ?');
    const now = Date.now();
    for (const id of ids) {
      const t = get.get(String(id)) as
        | { id: string; project_id: string; asset_id: string; x: number; y: number; w: number; h: number; z: number; rotation: number }
        | undefined;
      if (!t) continue;
      const projectId = exists.get(t.project_id) ? t.project_id : fallback;
      if (!exists.get(projectId)) throw new HttpError(409, 'No project to restore into.');
      ins.run(t.id, projectId, t.asset_id, t.x, t.y, t.w, t.h, t.z, t.rotation, now, now);
      del.run(t.id);
      restored.push({ id: t.id, projectId });
    }
  });
  res.json({ restored });
});

// Permanently delete. Image files are removed only when nothing else uses them.
/** Permanently delete trash rows; image files go only when nothing else uses them. */
function purgeTrash(targets: { id: string; asset_id: string }[]): number {
  const files: string[] = [];
  tx(() => {
    const del = db.prepare('DELETE FROM trash WHERE id = ?');
    for (const t of targets) del.run(t.id);
    for (const assetId of new Set(targets.map((t) => t.asset_id))) {
      const used =
        db.prepare('SELECT 1 FROM items WHERE asset_id = ? LIMIT 1').get(assetId) ||
        db.prepare('SELECT 1 FROM trash WHERE asset_id = ? LIMIT 1').get(assetId);
      if (used) continue;
      const a = db.prepare('SELECT file FROM assets WHERE id = ?').get(assetId) as { file: string } | undefined;
      db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
      if (a) files.push(a.file);
    }
  });
  for (const f of files) fs.rmSync(path.join(IMAGES_DIR, f), { force: true });
  return files.length;
}

// Permanently delete. Image files are removed only when nothing else uses them.
api.delete('/trash', (req, res) => {
  const all = req.body?.all === true;
  const ids: unknown = req.body?.ids;
  if (!all && !Array.isArray(ids)) throw new HttpError(400, 'ids or all required.');
  const targets = all
    ? (db.prepare('SELECT id, asset_id FROM trash').all() as { id: string; asset_id: string }[])
    : (ids as unknown[])
        .map((id) => db.prepare('SELECT id, asset_id FROM trash WHERE id = ?').get(String(id)) as { id: string; asset_id: string } | undefined)
        .filter((t): t is { id: string; asset_id: string } => !!t);
  res.json({ ok: true, filesRemoved: purgeTrash(targets) });
});

/** "Empty Recently deleted after N days" setting: run at start-up and hourly. */
function autoEmptyTrash() {
  const days = Number(readSettings().trashDays);
  if (![30, 90].includes(days)) return;
  const cutoff = Date.now() - days * 86_400_000;
  const old = db.prepare('SELECT id, asset_id FROM trash WHERE deleted_at < ?').all(cutoff) as { id: string; asset_id: string }[];
  if (old.length) console.log(`  Emptied ${old.length} item(s) from Recently deleted (older than ${days} days).`);
  if (old.length) purgeTrash(old);
}
autoEmptyTrash();
setInterval(autoEmptyTrash, 3_600_000).unref();

api.get('/projects/:id/items', (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, a.file, a.width AS nw, a.height AS nh, a.source_url
       FROM items i LEFT JOIN assets a ON a.id = i.asset_id
       WHERE i.project_id = ? ORDER BY i.z`,
    )
    .all(req.params.id) as unknown as ItemRow[];
  res.json(rows.map(itemJson));
});

// Upsert placements (move, resize, reorder, create, undo).
api.put('/items', (req, res) => {
  const list: unknown = req.body;
  if (!Array.isArray(list)) throw new HttpError(400, 'Expected an array of items.');
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO items (id, project_id, kind, asset_id, text, font_size, color, x, y, w, h, z, rotation,
       group_id, name, locked, hidden, opacity, font_weight, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
       z = excluded.z, rotation = excluded.rotation, text = excluded.text, font_size = excluded.font_size,
       color = excluded.color, group_id = excluded.group_id, name = excluded.name, locked = excluded.locked,
       hidden = excluded.hidden, opacity = excluded.opacity, font_weight = excluded.font_weight,
       updated_at = excluded.updated_at`,
  );
  const untrash = db.prepare('DELETE FROM trash WHERE id = ?');
  tx(() => {
    for (const it of list) {
      if (!it || typeof it.id !== 'string') throw new HttpError(400, 'Invalid item.');
      untrash.run(it.id);
      const isText = it.kind === 'text';
      if (isText && (typeof it.text !== 'string' || it.text.length > 20000)) throw new HttpError(400, 'Invalid text.');
      const color = typeof it.color === 'string' && /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : null;
      stmt.run(
        it.id,
        String(it.projectId),
        isText ? 'text' : 'image',
        isText ? null : String(it.assetId),
        isText ? it.text : null,
        isText ? num(it.fontSize, 'font size') : null,
        isText ? color : null,
        num(it.x, 'x'),
        num(it.y, 'y'),
        num(it.w, 'w'),
        num(it.h, 'h'),
        num(it.z, 'z'),
        it.rotation === undefined ? 0 : num(it.rotation, 'rotation'),
        typeof it.groupId === 'string' && it.groupId ? it.groupId : null,
        typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 200) : null,
        it.locked ? 1 : 0,
        it.hidden ? 1 : 0,
        typeof it.opacity === 'number' ? Math.min(1, Math.max(0, it.opacity)) : 1,
        isText && [300, 400, 500, 600, 700].includes(it.fontWeight) ? it.fontWeight : null,
        now,
        now,
      );
    }
  });
  res.json({ ok: true });
});

api.delete('/items', (req, res) => {
  const ids: unknown = req.body?.ids;
  if (!Array.isArray(ids)) throw new HttpError(400, 'ids required.');
  const stmt = db.prepare('DELETE FROM items WHERE id = ?');
  const now = Date.now();
  tx(() =>
    ids.forEach((id) => {
      trashItems.run(now, String(id));
      stmt.run(String(id));
    }),
  );
  res.json({ ok: true });
});

/* ---------- groups ---------- */

api.get('/projects/:id/groups', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM groups WHERE project_id = ?').all(req.params.id);
  res.json(rows);
});

api.put('/groups', (req, res) => {
  const list: unknown = req.body;
  if (!Array.isArray(list)) throw new HttpError(400, 'Expected an array of groups.');
  const stmt = db.prepare(
    `INSERT INTO groups (id, project_id, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  );
  tx(() => {
    for (const g of list) {
      if (!g || typeof g.id !== 'string') throw new HttpError(400, 'Invalid group.');
      stmt.run(g.id, String(g.projectId), String(g.name ?? 'Group').trim().slice(0, 200) || 'Group', Date.now());
    }
  });
  res.json({ ok: true });
});

api.get('/assets/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id) as AssetRow | undefined;
  if (!a) throw new HttpError(404, 'Image not found.');
  res.json(assetJson(a));
});

// Raw image bytes (drag & drop, clipboard paste).
api.post('/assets/upload', express.raw({ type: () => true, limit: '100mb' }), (req, res) => {
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf)) throw new HttpError(400, 'No image data.');
  const source = req.get('x-source-url');
  res.status(201).json(assetJson(storeAsset(buf, source ? decodeURIComponent(source) : null)));
});

// Download from the web and store locally.
api.post('/assets/url', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!url) throw new HttpError(400, 'URL required.');
  const { buf, url: finalUrl } = await fetchImage(url);
  const source = url.startsWith('data:') ? null : finalUrl || url;
  res.status(201).json(assetJson(storeAsset(buf, source)));
});

api.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use('/api', api);

/* ---------- image files ---------- */

app.use(
  '/files',
  (_req, res, next) => {
    // Files are content-addressed, so they never change.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  },
  express.static(IMAGES_DIR, { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
);

/* ---------- frontend ---------- */

if (PROD) {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('No build found. Run `npm run build` first.');
    process.exit(1);
  }
  app.use(express.static(DIST_DIR, { index: 'index.html' }));
  app.use((_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: PROJECT_ROOT, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const raw = String((err as Error)?.message ?? '');
  const constraint = /constraint failed/i.test(raw);
  const status = err instanceof HttpError ? err.status : constraint ? 409 : (err as { status?: number })?.status ?? 500;
  const message =
    err instanceof HttpError
      ? err.message
      : constraint
        ? /FOREIGN KEY/i.test(raw)
          ? 'That project or image no longer exists.'
          : 'That change conflicts with saved data.'
        : status === 413
          ? 'That file is too large.'
          : status >= 500
            ? 'Something went wrong on the server.'
            : raw || 'Something went wrong.';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  Crunch  →  http://localhost:${PORT}`);
  console.log(`  data    →  ${DATA_DIR}\n`);
});
