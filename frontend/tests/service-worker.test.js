// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');

function worker() {
  const stores = new Map();
  const listeners = {};
  const fetch = vi.fn();
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const entries = [];
        stores.set(name, {
          async put(request, response) {
            const key = request.url + ':' + (request.headers.get('X-DeepSea-Wallet') ?? '');
            const index = entries.findIndex((entry) => entry.key === key);
            if (index !== -1) entries.splice(index, 1);
            entries.push({ key, request, response: response.clone() });
          },
          async match(request) {
            const entry = entries.find(({ request: cachedRequest, response }) => {
              if (cachedRequest.url !== request.url) return false;
              const vary = response.headers.get('Vary') ?? '';
              return !vary.includes('X-DeepSea-Wallet') ||
                cachedRequest.headers.get('X-DeepSea-Wallet') === request.headers.get('X-DeepSea-Wallet');
            });
            return entry?.response.clone();
          },
          async keys() { return entries.map((entry) => entry.request); },
          async delete(request) {
            const index = entries.findIndex((entry) => entry.request.url === request.url);
            if (index !== -1) entries.splice(index, 1);
          },
        });
      }
      return stores.get(name);
    },
    async delete(name) { return stores.delete(name); },
    async keys() { return [...stores.keys()]; },
  };
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://app.test' }, addEventListener: (name, fn) => { listeners[name] = fn; } },
    caches, fetch, Request, Response, Headers, URL, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {} },
  });
  function dispatch(request) {
    let response;
    listeners.fetch({ request, respondWith(value) { response = value; } });
    return response;
  }
  return { dispatch, fetch };
}

function scopedRequest(wallet = 'wallet-a') {
  return new Request('https://app.test/api/metrics', { headers: { 'X-DeepSea-Wallet': wallet } });
}

describe('service worker snapshot caching', () => {
  it('marks fallback as stale while retaining the original snapshot timestamp', async () => {
    const sw = worker();
    sw.fetch.mockResolvedValueOnce(Response.json({ wallet: 'wallet-a', data_status: 'fresh', data_updated_at: 1234, hashrate_60sec: 100 }));
    expect((await sw.dispatch(scopedRequest())).status).toBe(200);
    sw.fetch.mockRejectedValue(new Error('network unavailable'));
    const fallback = await sw.dispatch(scopedRequest());
    expect(fallback.headers.get('X-DeepSea-Cache')).toBe('stale');
    expect(Number(fallback.headers.get('X-DeepSea-Cached-At'))).toBeGreaterThan(0);
    expect(await fallback.json()).toMatchObject({ data_status: 'stale', data_updated_at: 1234, hashrate_60sec: 100 });
  });

  it('cannot replay one wallet snapshot into another wallet', async () => {
    const sw = worker();
    sw.fetch.mockResolvedValueOnce(Response.json({ wallet: 'wallet-a', data_status: 'fresh', data_updated_at: 1234 }));
    await sw.dispatch(scopedRequest());
    sw.fetch.mockRejectedValue(new Error('network unavailable'));
    expect((await sw.dispatch(scopedRequest('wallet-b'))).status).toBe(503);
  });

  it('does not cache a response for a different wallet than requested', async () => {
    const sw = worker();
    sw.fetch.mockResolvedValueOnce(Response.json({ wallet: 'wallet-b', data_status: 'fresh', data_updated_at: 1234 }));
    await sw.dispatch(scopedRequest('wallet-a'));
    sw.fetch.mockRejectedValue(new Error('network unavailable'));
    expect((await sw.dispatch(scopedRequest('wallet-a'))).status).toBe(503);
  });

  it('never caches settings, mutations, or unscoped snapshots', () => {
    const sw = worker();
    for (const path of ['/api/config', '/api/workers/settings', '/api/health', '/api/earnings', '/api/metrics']) {
      expect(sw.dispatch(new Request('https://app.test' + path))).toBeUndefined();
    }
    expect(sw.dispatch(new Request('https://app.test/api/workers/settings', { method: 'PUT', body: '{}' }))).toBeUndefined();
  });

  it('invalidates saved snapshots on configuration changes, including in-flight responses', async () => {
    const sw = worker();
    let resolveOld;
    sw.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const pendingOld = sw.dispatch(scopedRequest());
    // Wait until the old read has passed its asynchronous cache lookup.
    await vi.waitFor(() => expect(sw.fetch).toHaveBeenCalledOnce());
    sw.fetch.mockResolvedValueOnce(Response.json({ wallet: 'wallet-b' }));
    await sw.dispatch(new Request('https://app.test/api/config', { method: 'POST', body: '{}' }));
    resolveOld(Response.json({ wallet: 'wallet-a', data_status: 'fresh', data_updated_at: 1234 }));
    await pendingOld;
    sw.fetch.mockRejectedValue(new Error('network unavailable'));
    expect((await sw.dispatch(scopedRequest('wallet-a'))).status).toBe(503);
  });
});
