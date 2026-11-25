import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, SCHEMA_VERSION } from '../server/db.ts';

/** The oldest schema Crunch shipped: image-only items, no rotation, layers or text. */
const LEGACY = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, position REAL NOT NULL,
    pattern TEXT NOT NULL DEFAULT 'dots', bg_color TEXT NOT NULL DEFAULT '#F7F7F5',
    view_x REAL NOT NULL DEFAULT 0, view_y REAL NOT NULL DEFAULT 0, zoom REAL NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE assets (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, file TEXT NOT NULL, mime TEXT NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL, source_url TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id), x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
    z REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE trash (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(id), x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
    z REAL NOT NULL, rotation REAL NOT NULL DEFAULT 0, deleted_at INTEGER NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO projects VALUES ('p1', 'Old board', 1, 'grid', '#FFFFFF', 5, 6, 2, 1, 1);
  INSERT INTO assets VALUES ('a1', 'h1', '00000000000000000000000000000000.png', 'image/png', 10, 20, 100, NULL, 1);
  INSERT INTO items VALUES ('i1', 'p1', 'a1', 1, 2, 3, 4, 5, 1, 1);
  INSERT INTO trash VALUES ('t1', 'p1', 'Old board', 'a1', 1, 2, 3, 4, 5, 0, 1);
`;

test('a legacy library upgrades in place, keeps its rows, and is backed up first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunch-mig-'));
  try {
    const legacy = new DatabaseSync(path.join(dir, 'crunch.db'));
    legacy.exec(LEGACY);
    legacy.close();

    const store = openStore(dir);
    const { db } = store;
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);

    const item = db.prepare("SELECT * FROM items WHERE id = 'i1'").get() as Record<string, unknown>;
    assert.equal(item.kind, 'image');
    assert.equal(item.rotation, 0);
    assert.equal(item.opacity, 1);
    assert.equal(item.x, 1);
    const trash = db.prepare("SELECT * FROM trash WHERE id = 't1'").get() as Record<string, unknown>;
    assert.equal(trash.kind, 'image');
    assert.equal(trash.asset_id, 'a1');
    assert.equal((db.prepare('SELECT density FROM projects').get() as { density: number }).density, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const backups = fs.readdirSync(path.join(dir, 'backups'));
    assert.ok(
      backups.some((f) => f.startsWith('crunch-before-v')),
      'backup taken before migrating',
    );
    store.close();

    // Opening again is a no-op.
    const again = openStore(dir);
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, backups.length);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a library from a newer Crunch is refused rather than damaged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunch-mig-'));
  try {
    const db = new DatabaseSync(path.join(dir, 'crunch.db'));
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    assert.throws(() => openStore(dir), /newer version/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
