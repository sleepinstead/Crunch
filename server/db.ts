import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

/** Everything the server needs to reach one library on disk. */
export interface Store {
  db: DatabaseSync;
  dataDir: string;
  imagesDir: string;
  backupsDir: string;
  tx<T>(fn: () => T): T;
  close(): void;
}

/** The schema version this code expects (PRAGMA user_version). */
export const SCHEMA_VERSION = 2;

const BASE_SCHEMA = `
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

  CREATE TABLE IF NOT EXISTS trash (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL,
    project_name TEXT NOT NULL,
    asset_id     TEXT NOT NULL REFERENCES assets(id),
    x            REAL NOT NULL,
    y            REAL NOT NULL,
    w            REAL NOT NULL,
    h            REAL NOT NULL,
    z            REAL NOT NULL,
    rotation     REAL NOT NULL DEFAULT 0,
    deleted_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const cols = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

/**
 * Numbered migrations. Each runs once, inside a transaction, after a backup of
 * the database. Version 1 brings any database written by earlier releases (which
 * detected missing columns instead of numbering) up to one known shape.
 */
const MIGRATIONS: {
  version: number;
  name: string;
  run: (db: DatabaseSync) => void;
}[] = [
  {
    version: 1,
    name: 'baseline',
    run(db) {
      if (!cols(db, 'projects').includes('density')) db.exec('ALTER TABLE projects ADD COLUMN density REAL NOT NULL DEFAULT 1');
      let item = cols(db, 'items');
      if (!item.includes('rotation')) db.exec('ALTER TABLE items ADD COLUMN rotation REAL NOT NULL DEFAULT 0');
      item = cols(db, 'items');
      // Text items: asset_id becomes optional, which SQLite only allows by rebuilding the table.
      if (!item.includes('kind')) {
        db.exec(`
          CREATE TABLE items_new (
            id         TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            kind       TEXT NOT NULL DEFAULT 'image',
            asset_id   TEXT REFERENCES assets(id),
            text       TEXT,
            font_size  REAL,
            color      TEXT,
            x          REAL NOT NULL,
            y          REAL NOT NULL,
            w          REAL NOT NULL,
            h          REAL NOT NULL,
            z          REAL NOT NULL DEFAULT 0,
            rotation   REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          INSERT INTO items_new (id, project_id, asset_id, x, y, w, h, z, rotation, created_at, updated_at)
            SELECT id, project_id, asset_id, x, y, w, h, z, rotation, created_at, updated_at FROM items;
          DROP TABLE items;
          ALTER TABLE items_new RENAME TO items;
        `);
      }
      item = cols(db, 'items');
      const add: [string, string][] = [
        ['group_id', 'TEXT'],
        ['name', 'TEXT'],
        ['locked', 'INTEGER NOT NULL DEFAULT 0'],
        ['hidden', 'INTEGER NOT NULL DEFAULT 0'],
        ['opacity', 'REAL NOT NULL DEFAULT 1'],
        ['font_weight', 'INTEGER'],
      ];
      for (const [c, type] of add) if (!item.includes(c)) db.exec(`ALTER TABLE items ADD COLUMN ${c} ${type}`);
      if (cols(db, 'items').includes('free_ratio')) db.exec('ALTER TABLE items DROP COLUMN free_ratio');
    },
  },
  {
    version: 2,
    name: 'trash keeps text and layer properties; indexes; file-delete journal',
    run(db) {
      // Recently deleted holds text items too, and everything a layer had.
      db.exec(`
        CREATE TABLE trash_new (
          id           TEXT PRIMARY KEY,
          project_id   TEXT NOT NULL,
          project_name TEXT NOT NULL,
          kind         TEXT NOT NULL DEFAULT 'image',
          asset_id     TEXT REFERENCES assets(id),
          text         TEXT,
          font_size    REAL,
          color        TEXT,
          font_weight  INTEGER,
          group_id     TEXT,
          group_name   TEXT,
          name         TEXT,
          locked       INTEGER NOT NULL DEFAULT 0,
          hidden       INTEGER NOT NULL DEFAULT 0,
          opacity      REAL NOT NULL DEFAULT 1,
          x            REAL NOT NULL,
          y            REAL NOT NULL,
          w            REAL NOT NULL,
          h            REAL NOT NULL,
          z            REAL NOT NULL,
          rotation     REAL NOT NULL DEFAULT 0,
          deleted_at   INTEGER NOT NULL
        );
        INSERT INTO trash_new (id, project_id, project_name, asset_id, x, y, w, h, z, rotation, deleted_at)
          SELECT id, project_id, project_name, asset_id, x, y, w, h, z, rotation, deleted_at FROM trash;
        DROP TABLE trash;
        ALTER TABLE trash_new RENAME TO trash;

        -- Files whose rows were deleted; removed after commit, retried at start-up.
        CREATE TABLE IF NOT EXISTS pending_file_deletes (file TEXT PRIMARY KEY);

        CREATE INDEX IF NOT EXISTS items_project ON items(project_id, z);
        CREATE INDEX IF NOT EXISTS items_asset ON items(asset_id);
        CREATE INDEX IF NOT EXISTS trash_asset ON trash(asset_id);
        CREATE INDEX IF NOT EXISTS trash_deleted ON trash(deleted_at);
        CREATE INDEX IF NOT EXISTS groups_project ON groups(project_id);
      `);
    },
  },
];

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** A consistent copy of the live database (safe while it is open, WAL included). */
export function backupDatabase(store: Pick<Store, 'db' | 'backupsDir'>, label: string): string {
  fs.mkdirSync(store.backupsDir, { recursive: true });
  const file = path.join(store.backupsDir, `crunch-${label}-${stamp()}.db`);
  store.db.prepare('VACUUM INTO ?').run(file);
  return file;
}

/** Keep the newest `keep` backups whose name starts with `prefix`. */
export function pruneBackups(backupsDir: string, prefix: string, keep: number) {
  if (!fs.existsSync(backupsDir)) return;
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) fs.rmSync(path.join(backupsDir, f), { force: true });
}

/** Open (and if needed create and migrate) the library in `dataDir`. */
export function openStore(dataDir: string): Store {
  dataDir = path.resolve(dataDir);
  const imagesDir = path.join(dataDir, 'images');
  const backupsDir = path.join(dataDir, 'backups');
  fs.mkdirSync(imagesDir, { recursive: true });

  const dbFile = path.join(dataDir, 'crunch.db');
  const fresh = !fs.existsSync(dbFile);
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  const store: Store = {
    db,
    dataDir,
    imagesDir,
    backupsDir,
    tx,
    close: () => db.close(),
  };

  db.exec(BASE_SCHEMA);
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current > SCHEMA_VERSION) {
    db.close();
    throw new Error(`This library was written by a newer version of Crunch (schema ${current}). Update Crunch to open it.`);
  }
  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length && !fresh) backupDatabase(store, `before-v${pending[pending.length - 1].version}`);
  for (const m of pending) {
    // Table rebuilds need foreign keys off; it can only change outside a transaction.
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      tx(() => {
        m.run(db);
        db.exec(`PRAGMA user_version = ${m.version}`);
      });
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) console.warn(`  Migration ${m.version}: ${broken.length} row(s) point at missing records.`);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return store;
}
