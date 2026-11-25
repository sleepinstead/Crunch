import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { openStore, backupDatabase, pruneBackups, DIST_DIR, PROJECT_ROOT } from './db.ts';
import { collectGarbage } from './assets.ts';
import { createApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3210);
const HOST = process.env.HOST ?? '127.0.0.1';
const PROD = process.env.NODE_ENV === 'production';
const TOKEN = process.env.CRUNCH_TOKEN || undefined;
// The library lives at the repository root (data/), shared by the web app and, later, the Mac app.
const DATA_DIR = path.resolve(process.env.CRUNCH_DATA_DIR ?? path.join(PROJECT_ROOT, '..', 'data'));

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
if (!LOOPBACK.has(HOST) && !TOKEN) {
  console.error(`Refusing to listen on ${HOST} without CRUNCH_TOKEN: anyone on that network could read and change your library.`);
  process.exit(1);
}
if (PROD && !fs.existsSync(DIST_DIR)) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

// One server per library: a second one would race the first on the same files.
fs.mkdirSync(DATA_DIR, { recursive: true });
const lockFile = path.join(DATA_DIR, '.lock');
try {
  const fd = fs.openSync(lockFile, 'wx');
  fs.writeSync(fd, String(process.pid));
  fs.closeSync(fd);
} catch {
  const pid = Number(fs.readFileSync(lockFile, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = pid !== process.pid;
  } catch {
    alive = false;
  }
  if (alive) {
    console.error(`Another Crunch server (pid ${pid}) is already using ${DATA_DIR}.`);
    process.exit(1);
  }
  fs.writeFileSync(lockFile, String(process.pid)); // stale lock from a crash
}

const store = openStore(DATA_DIR);

let frontend;
if (!PROD) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: PROJECT_ROOT,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  frontend = vite.middlewares;
}

const { app, autoEmptyTrash } = createApp(store, {
  allowedHosts: (process.env.CRUNCH_ALLOWED_HOSTS ?? '').split(','),
  distDir: PROD ? DIST_DIR : undefined,
  frontend,
  token: TOKEN,
});

/** Housekeeping that must never take the server down. */
const safely = (name: string, fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    console.error(`  ${name} failed:`, err);
  }
};

/** A dated copy of the database once a day, keeping the last 14. */
function dailyBackup() {
  const day = new Date().toISOString().slice(0, 10);
  const have = fs.existsSync(store.backupsDir) && fs.readdirSync(store.backupsDir).some((f) => f.startsWith(`crunch-daily-${day}`));
  if (have) return;
  backupDatabase(store, `daily-${day}`);
  pruneBackups(store.backupsDir, 'crunch-daily-', 14);
}

safely('Cleanup', () => collectGarbage(store));
safely('Backup', dailyBackup);
safely('Emptying Recently deleted', () => {
  const n = autoEmptyTrash();
  if (n) console.log(`  Emptied ${n} item(s) from Recently deleted.`);
});
const hourly = setInterval(() => {
  safely('Emptying Recently deleted', autoEmptyTrash);
  safely('Backup', dailyBackup);
}, 3_600_000);
hourly.unref();

const server: Server = app.listen(PORT, HOST, () => {
  console.log(`\n  Crunch  →  http://localhost:${PORT}`);
  console.log(`  data    →  ${DATA_DIR}\n`);
});
server.on('error', (err) => {
  console.error(`  Couldn’t start: ${(err as Error).message}`);
  shutdown(1);
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(hourly);
  server.close();
  safely('Closing the database', () => {
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    store.close();
  });
  fs.rmSync(lockFile, { force: true });
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (err) => console.error('  Unhandled rejection:', err));
