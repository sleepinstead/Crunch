import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './db.ts';
import { backupDatabase } from './db.ts';
import { storeAsset, assetJson, flushFileDeletes, HttpError, storeThumb, thumbName, thumbPath, type AssetRow } from './assets.ts';
import { fetchImage } from './fetch-image.ts';
import { exportLibrary, importLibrary, saveUpload } from './archive.ts';

export interface AppOptions {
  /** Extra hostnames the app answers to (besides localhost). */
  allowedHosts?: string[];
  /** Serve the built frontend from this folder (production). */
  distDir?: string;
  /** Mounted after the API in development (Vite's middleware). */
  frontend?: RequestHandler;
  /** Required on /api when set (for use beyond this machine). */
  token?: string;
}

/* ---------- validation ---------- */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const id = (v: unknown, name = 'id') => {
  if (typeof v !== 'string' || !ID.test(v)) throw new HttpError(400, `Invalid ${name}.`);
  return v;
};
const num = (v: unknown, name: string, min = -1e9, max = 1e9) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `Invalid ${name}.`);
  return v;
};
const ids = (v: unknown, max = 10_000) => {
  if (!Array.isArray(v) || v.length > max) throw new HttpError(400, 'ids required.');
  return v.map((x) => id(x));
};
const hexColor = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
const httpUrl = (v: unknown) => (typeof v === 'string' && v.length <= 2048 && /^https?:\/\//i.test(v) ? v : null);
const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** At most `n` of a kind of request at once; the rest get a 429 instead of piling up in memory. */
function limit(n: number, message: string): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= n) {
      res.status(429).json({ error: message });
      return;
    }
    active++;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        active--;
      }
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}

/* ---------- rows ---------- */

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

const itemJson = (i: ItemRow, hasThumb: (file: string) => boolean) => ({
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
  thumb: i.file && hasThumb(i.file) ? `/files/thumbs/${thumbName(i.file)}` : null,
  naturalW: i.nw ?? i.w,
  naturalH: i.nh ?? i.h,
  sourceUrl: i.source_url,
});

/** Settings are a flat bag of small values the client understands; anything else is dropped. */
function cleanSettings(patch: Record<string, unknown>) {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(patch).slice(0, 100)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(k)) continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string' && v.length <= 200) out[k] = v;
  }
  return out;
}

export function createApp(store: Store, opts: AppOptions = {}) {
  const { db, tx, imagesDir } = store;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  /* ---------- request guards ---------- */

  // Only answer requests addressed to this machine (blocks DNS rebinding).
  const allowedHosts = new Set(
    ['localhost', '127.0.0.1', '[::1]', ...(opts.allowedHosts ?? [])].map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  const hostname = (host: string) => host.toLowerCase().replace(/:\d+$/, '');
  app.use((req, res, next) => {
    if (!allowedHosts.has(hostname(req.headers.host ?? ''))) {
      res.status(403).json({ error: 'Host not allowed.' });
      return;
    }
    // No framing (clickjacking), no MIME sniffing, no referrer leaks.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      opts.distDir
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        : "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
    );
    next();
  });

  /* ---------- statements ---------- */

  const q = {
    project: db.prepare('SELECT * FROM projects WHERE id = ?'),
    projectExists: db.prepare('SELECT 1 FROM projects WHERE id = ?'),
    projects: db.prepare('SELECT * FROM projects ORDER BY position'),
    maxPosition: db.prepare('SELECT MAX(position) AS m FROM projects'),
    insertProject: db.prepare(
      'INSERT INTO projects (id, name, position, pattern, bg_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    updateProject: db.prepare(
      `UPDATE projects SET name = ?, pattern = ?, bg_color = ?, density = ?, view_x = ?, view_y = ?, zoom = ?, updated_at = ? WHERE id = ?`,
    ),
    settings: db.prepare("SELECT value FROM settings WHERE key = 'app'"),
    saveSettings: db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    itemOwner: db.prepare('SELECT project_id FROM items WHERE id = ?'),
    groupOwner: db.prepare('SELECT project_id FROM groups WHERE id = ?'),
    items: db.prepare(
      `SELECT i.*, a.file, a.width AS nw, a.height AS nh, a.source_url
       FROM items i LEFT JOIN assets a ON a.id = i.asset_id
       WHERE i.project_id = ? ORDER BY i.z`,
    ),
    trashItem: db.prepare(
      `INSERT OR REPLACE INTO trash (id, project_id, project_name, kind, asset_id, text, font_size, color, font_weight,
         group_id, group_name, name, locked, hidden, opacity, x, y, w, h, z, rotation, deleted_at)
       SELECT i.id, i.project_id, p.name, i.kind, i.asset_id, i.text, i.font_size, i.color, i.font_weight,
         i.group_id, g.name, i.name, i.locked, i.hidden, i.opacity, i.x, i.y, i.w, i.h, i.z, i.rotation, ?
       FROM items i JOIN projects p ON p.id = i.project_id LEFT JOIN groups g ON g.id = i.group_id
       WHERE i.id = ?`,
    ),
    deleteItem: db.prepare('DELETE FROM items WHERE id = ?'),
    untrash: db.prepare('DELETE FROM trash WHERE id = ?'),
    trashRow: db.prepare('SELECT * FROM trash WHERE id = ?'),
    trashTarget: db.prepare('SELECT id, asset_id FROM trash WHERE id = ?'),
    assetUsed: db.prepare('SELECT 1 FROM items WHERE asset_id = ? UNION ALL SELECT 1 FROM trash WHERE asset_id = ? LIMIT 1'),
    assetFile: db.prepare('SELECT file FROM assets WHERE id = ?'),
    deleteAsset: db.prepare('DELETE FROM assets WHERE id = ?'),
    queueFile: db.prepare('INSERT OR IGNORE INTO pending_file_deletes (file) VALUES (?)'),
    upsertItem: db.prepare(
      `INSERT INTO items (id, project_id, kind, asset_id, text, font_size, color, x, y, w, h, z, rotation,
         group_id, name, locked, hidden, opacity, font_weight, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
         z = excluded.z, rotation = excluded.rotation, text = excluded.text, font_size = excluded.font_size,
         color = excluded.color, group_id = excluded.group_id, name = excluded.name, locked = excluded.locked,
         hidden = excluded.hidden, opacity = excluded.opacity, font_weight = excluded.font_weight,
         updated_at = excluded.updated_at`,
    ),
    restoreItem: db.prepare(
      `INSERT OR REPLACE INTO items (id, project_id, kind, asset_id, text, font_size, color, font_weight, group_id, name,
         locked, hidden, opacity, x, y, w, h, z, rotation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertGroup: db.prepare('INSERT INTO groups (id, project_id, name, created_at) VALUES (?, ?, ?, ?)'),
    upsertGroup: db.prepare(
      `INSERT INTO groups (id, project_id, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    ),
    groups: db.prepare('SELECT id, name FROM groups WHERE project_id = ?'),
    dropEmptyGroups: db.prepare(
      `DELETE FROM groups WHERE project_id = ? AND NOT EXISTS (SELECT 1 FROM items i WHERE i.group_id = groups.id)
         AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.group_id = groups.id)`,
    ),
    asset: db.prepare('SELECT * FROM assets WHERE id = ?'),
  };

  const getProject = (pid: string) => q.project.get(pid) as ProjectRow | undefined;

  function readSettings(): Record<string, unknown> {
    const row = q.settings.get() as { value: string } | undefined;
    try {
      return row ? JSON.parse(row.value) : {};
    } catch {
      return {};
    }
  }

  function createProject(name: string) {
    const max = q.maxPosition.get() as { m: number | null };
    const now = Date.now();
    const pid = crypto.randomUUID();
    const s = readSettings();
    const pattern = ['dots', 'grid', 'plain'].includes(s.newPattern as string) ? (s.newPattern as string) : 'dots';
    const color = hexColor(s.newColor) ?? '#F7F7F5';
    q.insertProject.run(pid, name, (max.m ?? 0) + 1, pattern, color, now, now);
    return getProject(pid)!;
  }

  /** Permanently delete trash rows; files are queued and removed only when nothing else uses them. */
  function purgeTrash(targets: { id: string; asset_id: string | null }[]): number {
    let queued = 0;
    tx(() => {
      for (const t of targets) q.untrash.run(t.id);
      for (const assetId of new Set(targets.map((t) => t.asset_id).filter((a): a is string => !!a))) {
        if (q.assetUsed.get(assetId, assetId)) continue;
        const a = q.assetFile.get(assetId) as { file: string } | undefined;
        q.deleteAsset.run(assetId);
        if (a) {
          q.queueFile.run(a.file);
          queued++;
        }
      }
    });
    flushFileDeletes(store);
    return queued;
  }

  /** "Empty Recently deleted after N days": run at start-up and hourly by the caller. */
  function autoEmptyTrash() {
    const days = Number(readSettings().trashDays);
    if (![30, 90].includes(days)) return 0;
    const cutoff = Date.now() - days * 86_400_000;
    const old = db.prepare('SELECT id, asset_id FROM trash WHERE deleted_at < ?').all(cutoff) as { id: string; asset_id: string | null }[];
    if (old.length) purgeTrash(old);
    return old.length;
  }

  /* ---------- API ---------- */

  const api = express.Router();

  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (opts.token && req.get('x-crunch-token') !== opts.token) {
      res.status(401).json({ error: 'Not authorised.' });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    // Writes must come from this app: same origin, and a custom header a cross-site
    // form or <img> can't send without a CORS preflight (which is never granted).
    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    let ok = req.get('x-crunch') === '1';
    if (ok && origin) {
      try {
        ok = new URL(origin).host.toLowerCase() === (req.headers.host ?? '').toLowerCase();
      } catch {
        ok = false;
      }
    } else if (ok && site) {
      ok = site === 'same-origin' || site === 'none';
    }
    if (!ok) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }
    next();
  });

  const json = express.json({ limit: '8mb' });

  api.get('/settings', (_req, res) => {
    res.json(readSettings());
  });

  api.patch('/settings', json, (req, res) => {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Expected an object.');
    const next = cleanSettings({ ...readSettings(), ...patch });
    q.saveSettings.run(JSON.stringify(next));
    if ('trashDays' in patch) autoEmptyTrash();
    res.json(next);
  });

  api.get('/stats', (_req, res) => {
    const a = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM assets').get() as { n: number; bytes: number };
    const p = db.prepare('SELECT COUNT(*) AS n FROM projects').get() as {
      n: number;
    };
    res.json({ images: a.n, bytes: a.bytes, projects: p.n });
  });

  api.get('/projects', (_req, res) => {
    let rows = q.projects.all() as unknown as ProjectRow[];
    if (!rows.length) rows = [createProject('Inspiration')];
    res.json(rows.map(projectJson));
  });

  api.post('/projects', json, (req, res) => {
    const name = String(req.body?.name ?? '').trim() || 'Untitled';
    res.status(201).json(projectJson(createProject(name.slice(0, 120))));
  });

  api.patch('/projects/:id', json, (req, res) => {
    const p = getProject(id(req.params.id));
    if (!p) throw new HttpError(404, 'Project not found.');
    const b = req.body ?? {};
    const next = { ...p };
    if (typeof b.name === 'string') next.name = b.name.trim().slice(0, 120) || 'Untitled';
    if (['dots', 'grid', 'plain'].includes(b.pattern)) next.pattern = b.pattern;
    if (hexColor(b.bgColor)) next.bg_color = b.bgColor;
    if (typeof b.density === 'number' && b.density >= 0.25 && b.density <= 4) next.density = b.density;
    if (b.view) {
      next.view_x = num(b.view.x, 'view');
      next.view_y = num(b.view.y, 'view');
      next.zoom = num(b.view.zoom, 'zoom', 0.01, 64);
    }
    q.updateProject.run(next.name, next.pattern, next.bg_color, next.density, next.view_x, next.view_y, next.zoom, Date.now(), p.id);
    res.json(projectJson(getProject(p.id)!));
  });

  api.post('/projects/reorder', json, (req, res) => {
    const list = ids(req.body?.ids, 1000);
    const stmt = db.prepare('UPDATE projects SET position = ? WHERE id = ?');
    tx(() => list.forEach((pid, i) => stmt.run(i + 1, pid)));
    res.json({ ok: true });
  });

  // Removes the canvas. Its layers (images and text) move to Recently deleted.
  api.delete('/projects/:id', (req, res) => {
    const pid = id(req.params.id);
    tx(() => {
      const rows = db.prepare('SELECT id FROM items WHERE project_id = ?').all(pid) as { id: string }[];
      const now = Date.now();
      for (const r of rows) q.trashItem.run(now, r.id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
    });
    res.json({ ok: true });
  });

  /* ---------- recently deleted ---------- */

  api.get('/trash', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, a.file, a.width AS nw, a.height AS nh, a.source_url,
                (SELECT 1 FROM projects p WHERE p.id = t.project_id) AS project_exists
         FROM trash t LEFT JOIN assets a ON a.id = t.asset_id ORDER BY t.deleted_at DESC`,
      )
      .all() as Record<string, unknown>[];
    res.json(
      rows
        .filter((r) => r.kind === 'text' || r.file)
        .map((r) => ({
          id: r.id,
          kind: r.kind === 'text' ? 'text' : 'image',
          text: r.text ?? null,
          name: r.name ?? null,
          projectId: r.project_id,
          projectName: r.project_name,
          projectExists: !!r.project_exists,
          deletedAt: r.deleted_at,
          src: r.file ? `/files/${r.file}` : '',
          width: r.nw ?? r.w,
          height: r.nh ?? r.h,
          sourceUrl: r.source_url ?? null,
        })),
    );
  });

  // Put layers back on their canvas (or onto `fallbackProjectId` if that project is gone),
  // with their name, lock, visibility, opacity and group.
  api.post('/trash/restore', json, (req, res) => {
    const list = ids(req.body?.ids);
    const fallback = typeof req.body?.fallbackProjectId === 'string' ? req.body.fallbackProjectId : '';
    const restored: { id: string; projectId: string }[] = [];
    tx(() => {
      const now = Date.now();
      for (const tid of list) {
        const t = q.trashRow.get(tid) as Record<string, any> | undefined;
        if (!t) continue;
        const projectId = q.projectExists.get(t.project_id) ? t.project_id : fallback;
        if (!q.projectExists.get(projectId)) throw new HttpError(409, 'No project to restore into.');
        let groupId: string | null = t.group_id ?? null;
        if (groupId) {
          const owner = q.groupOwner.get(groupId) as { project_id: string } | undefined;
          if (!owner) q.insertGroup.run(groupId, projectId, t.group_name || 'Group', now);
          else if (owner.project_id !== projectId) groupId = null;
        }
        q.restoreItem.run(
          t.id,
          projectId,
          t.kind === 'text' ? 'text' : 'image',
          t.asset_id,
          t.text,
          t.font_size,
          t.color,
          t.font_weight,
          groupId,
          t.name,
          t.locked ? 1 : 0,
          t.hidden ? 1 : 0,
          t.opacity ?? 1,
          t.x,
          t.y,
          t.w,
          t.h,
          t.z,
          t.rotation ?? 0,
          now,
          now,
        );
        q.untrash.run(t.id);
        restored.push({ id: t.id, projectId });
      }
    });
    res.json({ restored });
  });

  // Permanently delete the listed entries, or everything deleted at or before `before`
  // (so entries another tab adds after the user confirmed are not swept up).
  api.delete('/trash', json, (req, res) => {
    const before = req.body?.before;
    let targets: { id: string; asset_id: string | null }[];
    if (typeof before === 'number' && Number.isFinite(before)) {
      targets = db.prepare('SELECT id, asset_id FROM trash WHERE deleted_at <= ?').all(before) as typeof targets;
    } else {
      targets = ids(req.body?.ids)
        .map((tid) => q.trashTarget.get(tid) as { id: string; asset_id: string | null } | undefined)
        .filter((t): t is { id: string; asset_id: string | null } => !!t);
    }
    res.json({ ok: true, filesRemoved: purgeTrash(targets) });
  });

  /* ---------- layers ---------- */

  api.get('/projects/:id/items', (req, res) => {
    const rows = q.items.all(id(req.params.id)) as unknown as ItemRow[];
    res.json(rows.map((r) => itemJson(r, (file) => fs.existsSync(thumbPath(store, file)))));
  });

  // Upsert layers (move, resize, reorder, create, undo).
  api.put('/items', json, (req, res) => {
    const list: unknown = req.body;
    if (!Array.isArray(list) || list.length > 5000) throw new HttpError(400, 'Expected an array of up to 5000 items.');
    const now = Date.now();
    tx(() => {
      for (const it of list as Record<string, any>[]) {
        if (!it || typeof it !== 'object') throw new HttpError(400, 'Invalid item.');
        const iid = id(it.id);
        const projectId = id(it.projectId, 'project');
        // A layer belongs to one board; a write that names another board is a bug or tampering.
        const owner = q.itemOwner.get(iid) as { project_id: string } | undefined;
        if (owner && owner.project_id !== projectId) throw new HttpError(409, 'That layer belongs to another board.');
        q.untrash.run(iid);
        const isText = it.kind === 'text';
        if (isText && (typeof it.text !== 'string' || it.text.length > 20000)) throw new HttpError(400, 'Invalid text.');
        let groupId = typeof it.groupId === 'string' && it.groupId ? id(it.groupId, 'group') : null;
        if (groupId) {
          const g = q.groupOwner.get(groupId) as { project_id: string } | undefined;
          if (g && g.project_id !== projectId) groupId = null;
        }
        q.upsertItem.run(
          iid,
          projectId,
          isText ? 'text' : 'image',
          isText ? null : id(it.assetId, 'image'),
          isText ? it.text : null,
          isText ? num(it.fontSize, 'font size', 1, 2000) : null,
          isText ? hexColor(it.color) : null,
          num(it.x, 'x'),
          num(it.y, 'y'),
          num(it.w, 'width', 0.1, 1e6),
          num(it.h, 'height', 0.1, 1e6),
          num(it.z, 'z', -1e15, 1e15),
          it.rotation === undefined ? 0 : normDeg(num(it.rotation, 'rotation', -1e6, 1e6)),
          groupId,
          typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 200) : null,
          it.locked ? 1 : 0,
          it.hidden ? 1 : 0,
          typeof it.opacity === 'number' && Number.isFinite(it.opacity) ? Math.min(1, Math.max(0, it.opacity)) : 1,
          isText && [300, 400, 500, 600, 700].includes(it.fontWeight) ? it.fontWeight : null,
          now,
          now,
        );
      }
    });
    res.json({ ok: true });
  });

  api.delete('/items', json, (req, res) => {
    const list = ids(req.body?.ids);
    const now = Date.now();
    tx(() =>
      list.forEach((iid) => {
        q.trashItem.run(now, iid);
        q.deleteItem.run(iid);
      }),
    );
    res.json({ ok: true });
  });

  /* ---------- groups ---------- */

  api.get('/projects/:id/groups', (req, res) => {
    res.json(q.groups.all(id(req.params.id)));
  });

  api.put('/groups', json, (req, res) => {
    const list: unknown = req.body;
    if (!Array.isArray(list) || list.length > 5000) throw new HttpError(400, 'Expected an array of groups.');
    tx(() => {
      for (const g of list as Record<string, any>[]) {
        const gid = id(g?.id, 'group');
        const projectId = id(g?.projectId, 'project');
        const owner = q.groupOwner.get(gid) as { project_id: string } | undefined;
        if (owner && owner.project_id !== projectId) throw new HttpError(409, 'That group belongs to another board.');
        q.upsertGroup.run(
          gid,
          projectId,
          String(g.name ?? 'Group')
            .trim()
            .slice(0, 200) || 'Group',
          Date.now(),
        );
      }
    });
    res.json({ ok: true });
  });

  /* ---------- images ---------- */

  // A small preview of an image, made by the browser, used at low zoom.
  api.put('/assets/:id/thumb', express.raw({ type: () => true, limit: '2mb' }), (req, res) => {
    const a = q.asset.get(id(req.params.id)) as AssetRow | undefined;
    if (!a) throw new HttpError(404, 'Image not found.');
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'No preview data.');
    storeThumb(store, a.file, req.body);
    res.json({ thumb: `/files/thumbs/${thumbName(a.file)}` });
  });

  api.get('/assets/:id', (req, res) => {
    const a = q.asset.get(id(req.params.id)) as AssetRow | undefined;
    if (!a) throw new HttpError(404, 'Image not found.');
    res.json(assetJson(a));
  });

  // Raw image bytes (drag and drop, clipboard paste). A few at a time keeps memory bounded.
  api.post(
    '/assets/upload',
    limit(4, 'Too many uploads at once. Try again in a moment.'),
    express.raw({ type: () => true, limit: '100mb' }),
    (req, res) => {
      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf)) throw new HttpError(400, 'No image data.');
      let source: string | null = null;
      const raw = req.get('x-source-url');
      if (raw) {
        try {
          source = httpUrl(decodeURIComponent(raw));
        } catch {
          source = null;
        }
      }
      res.status(201).json(assetJson(storeAsset(store, buf, source)));
    },
  );

  // Download from the web and store locally.
  api.post('/assets/url', limit(4, 'Too many downloads at once. Try again in a moment.'), json, async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!url) throw new HttpError(400, 'URL required.');
    if (url.length > 8 * 1024 * 1024) throw new HttpError(413, 'That link is too long.');
    const { buf, url: finalUrl } = await fetchImage(url);
    res.status(201).json(assetJson(storeAsset(store, buf, url.startsWith('data:') ? null : httpUrl(finalUrl || url))));
  });

  /* ---------- export / import ---------- */

  api.get('/export', async (_req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/x-tar');
    res.setHeader('Content-Disposition', `attachment; filename="crunch-backup-${day}.crunch"`);
    try {
      const { missing } = await exportLibrary(store, res);
      if (missing.length) console.warn(`  Export: ${missing.length} image file(s) were missing on disk.`);
      res.end();
    } catch (err) {
      console.error('  Export failed:', err);
      res.destroy(err as Error);
    }
  });

  api.post('/import', limit(1, 'An import is already running.'), async (req, res) => {
    const file = await saveUpload(store, req, 20 * 1024 * 1024 * 1024);
    try {
      backupDatabase(store, 'before-import');
      res.json(importLibrary(store, file));
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use('/api', api);

  /* ---------- image files ---------- */

  app.use(
    '/files',
    (_req, res, next) => {
      // Files are content-addressed, so they never change. Sandboxed so an SVG can't run script.
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      next();
    },
    express.static(imagesDir, {
      immutable: true,
      maxAge: '365d',
      index: false,
      dotfiles: 'deny',
      fallthrough: false,
      setHeaders(res, p) {
        if (p.endsWith('.svg')) res.setHeader('Content-Disposition', 'inline; filename="image.svg"');
      },
    }),
  );

  /* ---------- frontend ---------- */

  if (opts.distDir) {
    const dist = opts.distDir;
    // Hashed build files never change; everything else must be revalidated.
    app.use(
      '/assets',
      express.static(path.join(dist, 'assets'), {
        immutable: true,
        maxAge: '1y',
        fallthrough: false,
      }),
    );
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
      }),
    );
    app.use((_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else if (opts.frontend) {
    app.use(opts.frontend);
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as {
      message?: string;
      status?: number;
      type?: string;
      code?: string;
    };
    const raw = String(e?.message ?? '');
    const constraint = /constraint failed/i.test(raw);
    const full = e?.code === 'ENOSPC' || /SQLITE_FULL|database or disk is full/i.test(raw);
    const status =
      err instanceof HttpError ? err.status : full ? 507 : constraint ? 409 : e?.type === 'entity.parse.failed' ? 400 : (e?.status ?? 500);
    const message =
      err instanceof HttpError
        ? err.message
        : full
          ? 'The disk is full, so that change wasn’t saved.'
          : constraint
            ? /FOREIGN KEY/i.test(raw)
              ? 'That project or image no longer exists.'
              : 'That change conflicts with saved data.'
            : e?.type === 'entity.parse.failed'
              ? 'The request wasn’t valid JSON.'
              : status === 413
                ? 'That file is too large.'
                : status === 404
                  ? 'Not found.'
                  : 'Something went wrong on the server.';
    if (status >= 500) console.error(new Date().toISOString(), err);
    if (res.headersSent) return res.destroy();
    res.status(status).json({ error: message });
  });

  return { app, autoEmptyTrash };
}
