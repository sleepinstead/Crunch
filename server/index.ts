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

/* ---------- serialization ---------- */

interface ProjectRow {
  id: string;
  name: string;
  position: number;
  pattern: string;
  bg_color: string;
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
  view: { x: p.view_x, y: p.view_y, zoom: p.zoom },
});

interface ItemRow {
  id: string;
  project_id: string;
  asset_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation: number;
  file: string;
  nw: number;
  nh: number;
  source_url: string | null;
}

const itemJson = (i: ItemRow) => ({
  id: i.id,
  projectId: i.project_id,
  assetId: i.asset_id,
  x: i.x,
  y: i.y,
  w: i.w,
  h: i.h,
  z: i.z,
  rotation: i.rotation,
  src: `/files/${i.file}`,
  naturalW: i.nw,
  naturalH: i.nh,
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
  if (b.view) {
    next.view_x = num(b.view.x, 'view');
    next.view_y = num(b.view.y, 'view');
    next.zoom = num(b.view.zoom, 'zoom');
  }
  db.prepare(
    `UPDATE projects SET name = ?, pattern = ?, bg_color = ?, view_x = ?, view_y = ?, zoom = ?, updated_at = ? WHERE id = ?`,
  ).run(next.name, next.pattern, next.bg_color, next.view_x, next.view_y, next.zoom, Date.now(), p.id);
  res.json(projectJson(getProject(p.id)!));
});

api.post('/projects/reorder', (req, res) => {
  const ids: unknown = req.body?.ids;
  if (!Array.isArray(ids)) throw new HttpError(400, 'ids required.');
  const stmt = db.prepare('UPDATE projects SET position = ? WHERE id = ?');
  tx(() => ids.forEach((id, i) => stmt.run(i + 1, String(id))));
  res.json({ ok: true });
});

// Removes the canvas and its placements. Image files stay in storage.
api.delete('/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

api.get('/projects/:id/items', (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, a.file, a.width AS nw, a.height AS nh, a.source_url
       FROM items i JOIN assets a ON a.id = i.asset_id
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
    `INSERT INTO items (id, project_id, asset_id, x, y, w, h, z, rotation, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
       z = excluded.z, rotation = excluded.rotation, updated_at = excluded.updated_at`,
  );
  tx(() => {
    for (const it of list) {
      if (!it || typeof it.id !== 'string') throw new HttpError(400, 'Invalid item.');
      stmt.run(
        it.id,
        String(it.projectId),
        String(it.assetId),
        num(it.x, 'x'),
        num(it.y, 'y'),
        num(it.w, 'w'),
        num(it.h, 'h'),
        num(it.z, 'z'),
        it.rotation === undefined ? 0 : num(it.rotation, 'rotation'),
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
  tx(() => ids.forEach((id) => stmt.run(String(id))));
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
  const status = err instanceof HttpError ? err.status : (err as { status?: number })?.status ?? 500;
  const message =
    err instanceof HttpError
      ? err.message
      : status === 413
        ? 'That file is too large.'
        : String((err as Error)?.message ?? 'Something went wrong.');
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  Crunch  →  http://localhost:${PORT}`);
  console.log(`  data    →  ${DATA_DIR}\n`);
});
