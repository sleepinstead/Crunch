import { HttpError } from './assets.ts';

const MAX_BYTES = 80 * 1024 * 1024;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** Unwrap common "viewer" URLs to the underlying image. */
function normalize(raw: string): string {
  const url = new URL(raw.trim());
  // Google Images result links: /imgres?imgurl=...
  const imgurl = url.searchParams.get('imgurl') ?? url.searchParams.get('mediaurl');
  if (imgurl && /^https?:/i.test(imgurl)) return imgurl;
  return url.toString();
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/gi, '/');
}

/** Find a representative image in an HTML page (og:image and friends). */
function findPageImage(html: string, base: string): string | null {
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

async function readLimited(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new HttpError(413, 'Image is too large (over 80 MB).');
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new HttpError(413, 'Image is too large (over 80 MB).');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Download an image from the web. Follows a page's og:image when given an HTML page. */
export async function fetchImage(raw: string, depth = 0): Promise<{ buf: Buffer; url: string }> {
  if (raw.startsWith('data:')) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(raw);
    if (!m) throw new HttpError(400, 'Invalid data URL.');
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    return { buf, url: '' };
  }

  let url: string;
  try {
    url = normalize(raw);
  } catch {
    throw new HttpError(400, 'That doesn’t look like a valid URL.');
  }
  if (!/^https?:$/i.test(new URL(url).protocol)) throw new HttpError(400, 'Only http(s) URLs are supported.');

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,text/html;q=0.8,*/*;q=0.5',
        Referer: new URL(url).origin + '/',
      },
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new HttpError(502, timedOut ? 'The download timed out.' : `Couldn’t reach ${new URL(url).hostname}.`);
  }
  if (!res.ok) throw new HttpError(502, `${new URL(url).hostname} responded with ${res.status}.`);

  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('text/html') || type.includes('application/xhtml')) {
    if (depth > 0) throw new HttpError(422, 'No image found at that link.');
    const html = (await readLimited(res)).toString('utf8');
    const img = findPageImage(html, res.url || url);
    if (!img) throw new HttpError(422, 'No image found on that page.');
    return fetchImage(img, depth + 1);
  }
  return { buf: await readLimited(res), url: res.url || url };
}
