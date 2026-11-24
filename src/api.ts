export type Pattern = 'dots' | 'grid' | 'plain';

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface Project {
  id: string;
  name: string;
  position: number;
  pattern: Pattern;
  bgColor: string;
  view: View;
}

export interface Asset {
  id: string;
  src: string;
  width: number;
  height: number;
  sourceUrl: string | null;
}

export interface Item {
  id: string;
  projectId: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  src: string;
  naturalW: number;
  naturalH: number;
  sourceUrl: string | null;
}

async function req<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const isBlob = body instanceof Blob;
  const res = await fetch(url, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': isBlob ? body.type || 'application/octet-stream' : 'application/json', ...headers },
    body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.json();
}

export interface Stats {
  images: number;
  bytes: number;
  projects: number;
  dataDir: string;
  imagesDir: string;
}

export const api = {
  getSettings: () => req<Record<string, unknown>>('GET', '/api/settings'),
  updateSettings: (patch: Record<string, unknown>) => req<Record<string, unknown>>('PATCH', '/api/settings', patch),
  stats: () => req<Stats>('GET', '/api/stats'),

  listProjects: () => req<Project[]>('GET', '/api/projects'),
  createProject: (name?: string) => req<Project>('POST', '/api/projects', { name }),
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'pattern' | 'bgColor' | 'view'>>) =>
    req<Project>('PATCH', `/api/projects/${id}`, patch),
  reorderProjects: (ids: string[]) => req('POST', '/api/projects/reorder', { ids }),
  deleteProject: (id: string) => req('DELETE', `/api/projects/${id}`),

  listItems: (projectId: string) => req<Item[]>('GET', `/api/projects/${projectId}/items`),
  upsertItems: (items: Item[]) => req('PUT', '/api/items', items),
  deleteItems: (ids: string[]) => req('DELETE', '/api/items', { ids }),

  getAsset: (id: string) => req<Asset>('GET', `/api/assets/${id}`),
  uploadAsset: (blob: Blob, sourceUrl?: string) =>
    req<Asset>('POST', '/api/assets/upload', blob, sourceUrl ? { 'X-Source-Url': encodeURIComponent(sourceUrl) } : {}),
  assetFromUrl: (url: string) => req<Asset>('POST', '/api/assets/url', { url }),
};
