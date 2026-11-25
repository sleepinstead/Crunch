import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';
import { HttpError } from './assets.ts';

const MAX_BYTES = 80 * 1024 * 1024;
const MAX_HTML = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 25_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** Every way to say "this machine or a private network" that a URL could resolve to. */
const BLOCKED = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const)
  BLOCKED.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can reach IPv4 private space
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const)
  BLOCKED.addSubnet(addr, bits, 'ipv6');

/** True for any address that is not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (!family) return true;
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms are checked as IPv4.
    const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  return BLOCKED.check(address, 'ipv4');
}

/**
 * DNS lookup that refuses private addresses. Used as the socket's lookup, so the
 * address that was checked is the one that gets connected (no rebinding window).
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const ok = addresses.filter((a) => !isPrivateAddress(a.address));
    if (!ok.length || ok.length !== addresses.length) {
      const e = Object.assign(new Error('blocked address'), {
        code: 'EBLOCKED',
      });
      return callback(e, '', 0);
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
};

/** Unwrap common "viewer" URLs to the underlying image. */
function normalize(raw: string): URL {
  const url = new URL(raw.trim());
  // Google Images result links: /imgres?imgurl=...
  const inner = url.searchParams.get('imgurl') ?? url.searchParams.get('mediaurl');
  if (inner && /^https?:/i.test(inner)) return new URL(inner);
  return url;
}

/** Only plain web URLs on the standard ports, to hosts that are not IP literals of private ranges. */
function checkUrl(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) links are supported.');
  if (url.username || url.password) throw new HttpError(400, 'Links with a username or password aren’t supported.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new HttpError(400, 'That link uses a port Crunch won’t download from.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) throw new HttpError(400, 'Crunch only downloads from public websites.');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host))
    throw new HttpError(400, 'Crunch only downloads from public websites.');
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

/** Find a representative image in an HTML page (og:image and friends). */
export function findPageImage(html: string, base: string): string | null {
  const wanted = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'];
  const found: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key && content && !found[key]) found[key] = content;
  }
  let hit = wanted.map((k) => found[k]).find(Boolean);
  if (!hit) {
    const link = /<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/i.exec(html)?.[0];
    hit = link ? /href\s*=\s*["']([^"']+)["']/i.exec(link)?.[1] : undefined;
  }
  if (!hit) return null;
  try {
    return new URL(decodeEntities(hit), base).toString();
  } catch {
    return null;
  }
}

interface Got {
  status: number;
  location: string | null;
  type: string;
  body: Buffer;
}

/** One GET, no redirects followed, body capped. Connects only to public addresses. */
function get(url: URL, limit: number, signal: AbortSignal): Promise<Got> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      {
        lookup: safeLookup,
        signal,
        headers: {
          'User-Agent': UA,
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,text/html;q=0.8,*/*;q=0.5',
          'Accept-Encoding': 'identity',
          Referer: url.origin + '/',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers['content-type'] ?? '').toLowerCase();
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, type, body: Buffer.alloc(0) });
        }
        const cap = type.includes('html') ? Math.min(limit, MAX_HTML) : limit;
        if (Number(res.headers['content-length'] ?? 0) > cap) {
          res.destroy();
          return reject(new HttpError(413, 'Image is too large (over 80 MB).'));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > cap) {
            res.destroy();
            reject(new HttpError(413, 'Image is too large (over 80 MB).'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, location, type, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

const FAILED = 'Couldn’t download that image.';

/** Download an image from the web. Follows redirects and a page's og:image, checking every hop. */
export async function fetchImage(raw: string): Promise<{ buf: Buffer; url: string }> {
  if (raw.startsWith('data:')) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(raw);
    if (!m) throw new HttpError(400, 'Invalid data URL.');
    try {
      const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
      if (buf.length > MAX_BYTES) throw new HttpError(413, 'Image is too large (over 80 MB).');
      return { buf, url: '' };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'Invalid data URL.');
    }
  }

  let url: URL;
  try {
    url = normalize(raw);
  } catch {
    throw new HttpError(400, 'That doesn’t look like a valid URL.');
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let followedPage = false;
  for (let hop = 0; hop <= MAX_REDIRECTS + 1; hop++) {
    checkUrl(url);
    let got: Got;
    try {
      got = await get(url, MAX_BYTES, signal);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EBLOCKED') throw new HttpError(400, 'Crunch only downloads from public websites.');
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError(504, 'The download timed out.');
      throw new HttpError(502, FAILED);
    }
    if (got.status >= 300 && got.status < 400 && got.location) {
      try {
        url = new URL(got.location, url);
      } catch {
        throw new HttpError(502, FAILED);
      }
      continue;
    }
    if (got.status < 200 || got.status >= 300) throw new HttpError(502, FAILED);
    if (got.type.includes('text/html') || got.type.includes('application/xhtml')) {
      if (followedPage) throw new HttpError(422, 'No image found at that link.');
      const img = findPageImage(got.body.toString('utf8'), url.toString());
      if (!img) throw new HttpError(422, 'No image found on that page.');
      followedPage = true;
      url = new URL(img);
      continue;
    }
    return { buf: got.body, url: url.toString() };
  }
  throw new HttpError(502, 'That link redirects too many times.');
}
