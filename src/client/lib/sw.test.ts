import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Menjalankan public/sw.js di lingkungan service worker tiruan (caches/fetch/self) untuk menguji
 * strategi cache tanpa browser: API tidak pernah di-cache, navigasi offline jatuh ke app shell,
 * dan aset ber-hash dilayani dari cache.
 */

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  request?: FakeRequest;
  respondWith?: (p: Promise<Response | undefined>) => void;
  waitUntil: (p: Promise<unknown>) => void;
  responded?: Promise<Response | undefined>;
  pending: Promise<unknown>[];
}

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

const ORIGIN = 'https://moneytrack.test';
const swSource = fs.readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8');

function setup(online: { value: boolean }) {
  const stores = new Map<string, Map<string, Response>>();
  const listeners = new Map<string, Listener[]>();
  const network: string[] = [];

  const keyOf = (req: FakeRequest | string) => (typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);
  const openStore = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (req: FakeRequest | string, res: Response) => void store.set(keyOf(req), res),
      match: async (req: FakeRequest | string) => store.get(keyOf(req))?.clone(),
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (req: { url: string }) => store.delete(req.url),
      addAll: async (urls: string[]) => {
        for (const url of urls) store.set(keyOf(url), new Response(`shell:${url}`));
      },
    };
  };

  const context = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
    },
    caches: {
      open: async (name: string) => openStore(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (req: FakeRequest | string) => {
        for (const store of stores.values()) {
          const hit = store.get(keyOf(req));
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
    fetch: async (req: FakeRequest) => {
      network.push(new URL(req.url).pathname);
      if (!online.value) throw new TypeError('Failed to fetch');
      return new Response(`network:${new URL(req.url).pathname}`, { status: 200 });
    },
    URL,
    Promise,
    Math,
  };
  vm.runInNewContext(swSource, context);

  async function dispatch(type: string, request?: FakeRequest) {
    const event: FakeEvent = {
      request,
      pending: [],
      waitUntil: (p) => void event.pending.push(p),
    };
    event.respondWith = (p) => {
      event.responded = p;
    };
    for (const fn of listeners.get(type) ?? []) fn(event);
    await Promise.all(event.pending);
    const response = event.responded ? await event.responded : undefined;
    // Biarkan cache.put yang berjalan di latar belakang selesai.
    await new Promise((r) => setTimeout(r, 0));
    return { event, response };
  }

  const req = (pathname: string, mode = 'no-cors', method = 'GET'): FakeRequest => ({
    url: `${ORIGIN}${pathname}`,
    method,
    mode,
  });

  return { dispatch, req, stores, network };
}

describe('service worker', () => {
  const online = { value: true };
  let sw: ReturnType<typeof setup>;

  beforeEach(async () => {
    online.value = true;
    sw = setup(online);
    await sw.dispatch('install');
    await sw.dispatch('activate');
  });

  it('precaches the app shell on install', () => {
    const shell = [...(sw.stores.get('moneytrack-shell-v1')?.keys() ?? [])].map((u) => new URL(u).pathname);
    expect(shell).toEqual(expect.arrayContaining(['/', '/manifest.webmanifest', '/icon-192.png']));
  });

  it('never intercepts or caches API requests (financial data stays on the server)', async () => {
    const { event } = await sw.dispatch('fetch', sw.req('/api/workspaces/1/transactions'));
    expect(event.responded).toBeUndefined();
    const { event: post } = await sw.dispatch('fetch', sw.req('/api/auth/logout', 'cors', 'POST'));
    expect(post.responded).toBeUndefined();
  });

  it('serves the latest page online and falls back to the cached shell offline', async () => {
    const live = await sw.dispatch('fetch', sw.req('/', 'navigate'));
    expect(await live.response?.text()).toBe('network:/');

    online.value = false;
    const offline = await sw.dispatch('fetch', sw.req('/invite/abc', 'navigate'));
    // App shell terakhir dari jaringan (disimpan saat online) dipakai untuk rute apa pun.
    expect(await offline.response?.text()).toBe('network:/');
  });

  it('caches hashed assets on first use and serves them offline', async () => {
    const first = await sw.dispatch('fetch', sw.req('/assets/index-abc123.js'));
    expect(await first.response?.text()).toBe('network:/assets/index-abc123.js');

    online.value = false;
    const again = await sw.dispatch('fetch', sw.req('/assets/index-abc123.js'));
    expect(await again.response?.text()).toBe('network:/assets/index-abc123.js');
    // Cache-first: permintaan kedua tidak menyentuh jaringan sama sekali.
    expect(sw.network.filter((p) => p === '/assets/index-abc123.js')).toHaveLength(1);
  });

  it('ignores cross-origin requests (e.g. Google avatars)', async () => {
    const { event } = await sw.dispatch('fetch', {
      url: 'https://lh3.googleusercontent.com/a/photo.jpg',
      method: 'GET',
      mode: 'no-cors',
    });
    expect(event.responded).toBeUndefined();
  });
});
