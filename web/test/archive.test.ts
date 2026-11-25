import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, png } from './helpers.ts';

test('export then import into a fresh library brings everything across', async () => {
  const a = await startServer();
  const b = await startServer();
  try {
    const project = (await a.call('POST', '/api/projects', { name: 'Moodboard' })).data.id;
    const asset = (await a.call('POST', '/api/assets/upload', png(3))).data;
    await a.call('PUT', '/api/groups', [{ id: 'g1', projectId: project, name: 'Hero' }]);
    await a.call('PUT', '/api/items', [
      {
        id: 'i1',
        projectId: project,
        kind: 'image',
        assetId: asset.id,
        x: 10,
        y: 20,
        w: 30,
        h: 40,
        z: 1,
        groupId: 'g1',
        name: 'Poster',
        opacity: 0.8,
      },
      {
        id: 't1',
        projectId: project,
        kind: 'text',
        text: 'Warm, flat shapes.',
        fontSize: 32,
        x: 0,
        y: 0,
        w: 200,
        h: 40,
        z: 2,
      },
      {
        id: 't2',
        projectId: project,
        kind: 'text',
        text: 'gone',
        fontSize: 20,
        x: 0,
        y: 0,
        w: 50,
        h: 20,
        z: 3,
      },
    ]);
    await a.call('DELETE', '/api/items', { ids: ['t2'] });

    const exported = await a.call('GET', '/api/export');
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') ?? '', /crunch-backup-.*\.crunch/);

    const r = await b.call('POST', '/api/import', exported.data, {
      'Content-Type': 'application/x-tar',
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.images, 1);
    assert.equal(r.data.items, 3 - 1);
    assert.equal(r.data.trash, 1);

    const projects = (await b.call('GET', '/api/projects')).data;
    const mood = projects.find((p: { name: string }) => p.name === 'Moodboard');
    assert.ok(mood);
    const items = (await b.call('GET', `/api/projects/${mood.id}/items`)).data;
    const img = items.find((i: { kind: string }) => i.kind === 'image');
    assert.equal(img.name, 'Poster');
    assert.equal(img.opacity, 0.8);
    assert.ok(img.groupId, 'group carried over');
    const groups = (await b.call('GET', `/api/projects/${mood.id}/groups`)).data;
    assert.equal(groups[0].name, 'Hero');
    const file = await fetch(b.base + img.src);
    assert.equal(file.status, 200);

    // Importing twice adds a second copy of the boards but stores the image once.
    const again = await b.call('POST', '/api/import', exported.data, {
      'Content-Type': 'application/x-tar',
    });
    assert.equal(again.status, 200);
    const stats = (await b.call('GET', '/api/stats')).data;
    assert.equal(stats.images, 1);
  } finally {
    await a.stop();
    await b.stop();
  }
});

test('a file that is not a backup is refused and changes nothing', async () => {
  const s = await startServer();
  try {
    const before = (await s.call('GET', '/api/projects')).data.length;
    const r = await s.call('POST', '/api/import', Buffer.from('hello'), {
      'Content-Type': 'application/x-tar',
    });
    assert.equal(r.status, 400);
    assert.equal((await s.call('GET', '/api/projects')).data.length, before);
  } finally {
    await s.stop();
  }
});
