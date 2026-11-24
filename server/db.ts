import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Permanent storage. Override with CRUNCH_DATA_DIR to keep data elsewhere. */
export const DATA_DIR = path.resolve(process.env.CRUNCH_DATA_DIR ?? path.join(ROOT, 'data'));
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
export const DIST_DIR = path.join(ROOT, 'dist');
export const PROJECT_ROOT = ROOT;

fs.mkdirSync(IMAGES_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'crunch.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    position   REAL NOT NULL,
    pattern    TEXT NOT NULL DEFAULT 'dots',
    bg_color   TEXT NOT NULL DEFAULT '#F7F7F5',
    view_x     REAL NOT NULL DEFAULT 0,
    view_y     REAL NOT NULL DEFAULT 0,
    zoom       REAL NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- One row per unique image file on disk (deduplicated by content hash).
  CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    hash       TEXT NOT NULL UNIQUE,
    file       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    width      INTEGER NOT NULL,
    height     INTEGER NOT NULL,
    bytes      INTEGER NOT NULL,
    source_url TEXT,
    created_at INTEGER NOT NULL
  );

  -- A placement of an asset on a project's canvas.
  CREATE TABLE IF NOT EXISTS items (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id   TEXT NOT NULL REFERENCES assets(id),
    x          REAL NOT NULL,
    y          REAL NOT NULL,
    w          REAL NOT NULL,
    h          REAL NOT NULL,
    z          REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS items_project ON items(project_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrations for databases created by earlier versions.
const itemCols = (db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map((c) => c.name);
const projectCols = (db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name);
if (!projectCols.includes('density')) db.exec('ALTER TABLE projects ADD COLUMN density REAL NOT NULL DEFAULT 1');
if (!itemCols.includes('rotation')) db.exec('ALTER TABLE items ADD COLUMN rotation REAL NOT NULL DEFAULT 0');

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
