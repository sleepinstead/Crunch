import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openStore, type Store } from '../server/db.ts';
import { createApp } from '../server/app.ts';

/** A throwaway library and a running server on a random port. */
export async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunch-test-'));
  const store = openStore(dir);
  const { app, autoEmptyTrash } = createApp(store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const isBuf = body instanceof Uint8Array;
    const res = await fetch(base + url, {
      method,
      headers: {
        'X-Crunch': '1',
        ...(body === undefined
          ? {}
          : {
              'Content-Type': isBuf ? 'application/octet-stream' : 'application/json',
            }),
        ...headers,
      },
      body: body === undefined ? undefined : isBuf ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body),
    });
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }

  return {
    dir,
    store,
    base,
    call,
    autoEmptyTrash,
    async stop() {
      await new Promise((r) => server.close(r));
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A valid 1×1 PNG (optionally made unique so it is not deduplicated). */
export function png(seed = 0): Buffer {
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  return seed ? Buffer.concat([base, Buffer.from(`seed${seed}`)]) : base;
}

export type Server = Awaited<ReturnType<typeof startServer>>;
export type { Store };
