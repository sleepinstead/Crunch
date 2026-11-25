import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer, png, type Server } from './helpers.ts';

let s: Server;
let project: string;

before(async () => {
  s = await startServer();
  const { data } = await s.call('GET', '/api/projects');
  project = data[0].id;
});
after(() => s.stop());

const text = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectId: project,
  kind: 'text',
  text: 'hello',
  fontSize: 24,
  x: 0,
  y: 0,
  w: 100,
  h: 30,
  z: 1,
  ...extra,
});

test('a fresh library has one board', async () => {
  const { status, data } = await s.call('GET', '/api/projects');
  assert.equal(status, 200);
  assert.equal(data.length, 1);
  assert.equal(data[0].name, 'Inspiration');
});

test('writes without the app header or from another site are refused', async () => {
  const r1 = await fetch(s.base + '/api/items', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '[]',
  });
  assert.equal(r1.status, 403);
  const r2 = await s.call('PUT', '/api/items', [], {
    Origin: 'https://evil.example',
  });
  assert.equal(r2.status, 403);
  const r3 = await s.call('PUT', '/api/items', [], {
    'Sec-Fetch-Site': 'cross-site',
  });
  assert.equal(r3.status, 403);
});

test('requests for another host name are refused (DNS rebinding)', async () => {
  // fetch() won't let a Host header be overridden, so use a raw request.
  const url = new URL(s.base);
  const status = await new Promise<number>((resolve, reject) => {
    http
      .get(
        {
          host: '127.0.0.1',
          port: url.port,
          path: '/api/projects',
          headers: { Host: 'evil.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
      .on('error', reject);
  });
  assert.equal(status, 403);
});

test('security headers are set', async () => {
  const r = await s.call('GET', '/api/projects');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
});

test('invalid numbers and ids are rejected without changing anything', async () => {
  assert.equal((await s.call('PUT', '/api/items', [text('bad1', { fontSize: -5 })])).status, 400);
  assert.equal((await s.call('PUT', '/api/items', [text('bad2', { w: 0 })])).status, 400);
  assert.equal((await s.call('PUT', '/api/items', [text('../x')])).status, 400);
  assert.equal(
    (
      await s.call('PATCH', `/api/projects/${project}`, {
        view: { x: 0, y: 0, zoom: 0 },
      })
    ).status,
    400,
  );
  // A batch with one bad item leaves nothing behind.
  assert.equal((await s.call('PUT', '/api/items', [text('ok1'), text('bad3', { x: 'nope' })])).status, 400);
  const items = (await s.call('GET', `/api/projects/${project}/items`)).data;
  assert.ok(!items.some((i: { id: string }) => i.id === 'ok1'));
});

test('malformed JSON gets a 400', async () => {
  const r = await fetch(s.base + '/api/items', {
    method: 'PUT',
    headers: { 'X-Crunch': '1', 'Content-Type': 'application/json' },
    body: '{bad',
  });
  assert.equal(r.status, 400);
});

test('a layer cannot be moved onto another board by id reuse', async () => {
  assert.equal((await s.call('PUT', '/api/items', [text('own1')])).status, 200);
  const other = (await s.call('POST', '/api/projects', { name: 'Other' })).data.id;
  const r = await s.call('PUT', '/api/items', [{ ...text('own1'), projectId: other }]);
  assert.equal(r.status, 409);
});

test('deleted text goes to Recently deleted and restores with its layer properties', async () => {
  await s.call('PUT', '/api/groups', [{ id: 'grp1', projectId: project, name: 'Moodboard' }]);
  const t = text('txt1', {
    name: 'Title',
    locked: true,
    hidden: true,
    opacity: 0.5,
    groupId: 'grp1',
    fontWeight: 600,
  });
  assert.equal((await s.call('PUT', '/api/items', [t])).status, 200);
  await s.call('DELETE', '/api/items', { ids: ['txt1'] });

  const trash = (await s.call('GET', '/api/trash')).data;
  const entry = trash.find((e: { id: string }) => e.id === 'txt1');
  assert.ok(entry, 'text is in Recently deleted');
  assert.equal(entry.kind, 'text');
  assert.equal(entry.text, 'hello');

  const r = await s.call('POST', '/api/trash/restore', {
    ids: ['txt1'],
    fallbackProjectId: project,
  });
  assert.deepEqual(r.data.restored, [{ id: 'txt1', projectId: project }]);
  const back = (await s.call('GET', `/api/projects/${project}/items`)).data.find((i: { id: string }) => i.id === 'txt1');
  assert.equal(back.name, 'Title');
  assert.equal(back.locked, true);
  assert.equal(back.hidden, true);
  assert.equal(back.opacity, 0.5);
  assert.equal(back.groupId, 'grp1');
  assert.equal(back.fontWeight, 600);
});

test('deleting a board keeps its text and images in Recently deleted', async () => {
  const board = (await s.call('POST', '/api/projects', { name: 'Doomed' })).data.id;
  const asset = (await s.call('POST', '/api/assets/upload', png(1))).data;
  await s.call('PUT', '/api/items', [
    { ...text('d-text'), projectId: board },
    {
      id: 'd-img',
      projectId: board,
      kind: 'image',
      assetId: asset.id,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 0,
    },
  ]);
  await s.call('DELETE', `/api/projects/${board}`);
  const ids = (await s.call('GET', '/api/trash')).data.map((e: { id: string }) => e.id);
  assert.ok(ids.includes('d-text'));
  assert.ok(ids.includes('d-img'));
});

test('emptying with a cutoff keeps entries deleted afterwards (another tab)', async () => {
  await s.call('PUT', '/api/items', [text('late1'), text('late2')]);
  await s.call('DELETE', '/api/items', { ids: ['late1'] });
  const seen = (await s.call('GET', '/api/trash')).data;
  const before = Math.max(...seen.map((e: { deletedAt: number }) => e.deletedAt));
  await new Promise((r) => setTimeout(r, 5));
  await s.call('DELETE', '/api/items', { ids: ['late2'] }); // after the user confirmed
  await s.call('DELETE', '/api/trash', { before });
  const left = (await s.call('GET', '/api/trash')).data.map((e: { id: string }) => e.id);
  assert.deepEqual(left, ['late2']);
});

test('uploads are deduplicated and purged files are removed only when unused', async () => {
  const a = (await s.call('POST', '/api/assets/upload', png(7))).data;
  const b = (await s.call('POST', '/api/assets/upload', png(7))).data;
  assert.equal(a.id, b.id);
  const file = path.join(s.store.imagesDir, path.basename(a.src));
  assert.ok(fs.existsSync(file));

  const place = (id: string) => ({
    id,
    projectId: project,
    kind: 'image',
    assetId: a.id,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    z: 0,
  });
  await s.call('PUT', '/api/items', [place('p1'), place('p2')]);
  await s.call('DELETE', '/api/items', { ids: ['p1'] });
  await s.call('DELETE', '/api/trash', { ids: ['p1'] });
  assert.ok(fs.existsSync(file), 'still used by p2');
  await s.call('DELETE', '/api/items', { ids: ['p2'] });
  await s.call('DELETE', '/api/trash', { ids: ['p2'] });
  assert.ok(!fs.existsSync(file), 'removed once nothing uses it');
});

test('non-images are refused', async () => {
  const r = await s.call('POST', '/api/assets/upload', Buffer.from('not an image'));
  assert.equal(r.status, 415);
});

test('image files are served sandboxed and path traversal is blocked', async () => {
  const a = (await s.call('POST', '/api/assets/upload', png(9))).data;
  const r = await fetch(s.base + a.src);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy') ?? '', /sandbox/);
  const bad = await fetch(s.base + '/files/..%2fcrunch.db');
  assert.notEqual(bad.status, 200);
});

test('downloads from private addresses are refused', async () => {
  for (const url of [
    'http://127.0.0.1/x',
    'http://localhost/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://2130706433/',
    'http://10.0.0.1/',
    'http://example.com:22/',
    'file:///etc/passwd',
  ]) {
    const r = await s.call('POST', '/api/assets/url', { url });
    assert.equal(r.status, 400, url);
  }
});

test('settings keep only simple known-shaped values', async () => {
  const r = await s.call('PATCH', '/api/settings', {
    imageRadius: 4,
    weird: { nested: true },
    'bad key': 1,
    long: 'x'.repeat(500),
  });
  assert.equal(r.data.imageRadius, 4);
  assert.ok(!('weird' in r.data));
  assert.ok(!('bad key' in r.data));
  assert.ok(!('long' in r.data));
});

test('stats do not reveal file paths', async () => {
  const r = await s.call('GET', '/api/stats');
  assert.ok(!('dataDir' in r.data));
  assert.ok(!('imagesDir' in r.data));
});
