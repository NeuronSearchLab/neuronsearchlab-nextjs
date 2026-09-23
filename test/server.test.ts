import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createEventRoute } from '../src/server';

describe('event route', () => {
  it('rejects malformed browser payloads before credentials are read', async () => {
    const response = await createEventRoute()(new Request('http://localhost/api/nsl/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(400);
  });
  it('requires JSON', async () => {
    const response = await createEventRoute()(new Request('http://localhost/api/nsl/events', { method: 'POST', body: 'x' }));
    expect(response.status).toBe(415);
  });
});

import { createNSL } from '../src/server';

function recordingFetch() {
  const calls: Array<{ url: string; body: any }> = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body });
    if (String(url).includes('oauth2')) return Response.json({ access_token: 't', expires_in: 3600 });
    return Response.json({ ok: true, search: { source: 'client' } });
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}

describe('searches', () => {
  const config = { clientId: 'id', clientSecret: 'secret', apiUrl: 'https://api.example.com/v1' };

  it('records a search as an event with no item', async () => {
    const { calls, fetcher } = recordingFetch();
    await createNSL({ ...config, fetch: fetcher }).trackSearch({ userId: 'u1', query: ' trail shoes ', resultItemIds: [3, 1] });
    const event = calls.find(call => call.url.endsWith('/events'))!.body;
    expect(event).toMatchObject({ user_id: 'u1', query: 'trail shoes', result_item_ids: [3, 1] });
    expect(event).not.toHaveProperty('item_id');
    expect(event).not.toHaveProperty('event_id');
  });

  it('sends your engine\'s results with a search', async () => {
    const { calls, fetcher } = recordingFetch();
    const result = await createNSL({ ...config, fetch: fetcher }).search({ query: 'trail shoes', userId: 'u1', resultItemIds: [7, 8] });
    expect(calls.find(call => call.url.endsWith('/search'))!.body).toEqual({ query: 'trail shoes', user_id: 'u1', result_item_ids: [7, 8] });
    expect(result.search).toEqual({ source: 'client' });
  });

  it('rejects malformed searches before calling the API', async () => {
    const { calls, fetcher } = recordingFetch();
    const client = createNSL({ ...config, fetch: fetcher });
    await expect(client.trackSearch({ userId: 'u1', query: '  ' })).rejects.toThrow('query must contain text');
    await expect(client.trackSearch({ userId: 'u1', query: 'x', resultItemIds: [0] })).rejects.toThrow('resultItemIds');
    await expect(client.search({ query: 'x', resultItemIds: [-1] })).rejects.toThrow('resultItemIds');
    expect(calls).toHaveLength(0);
  });

  it('the event route rejects a malformed search before credentials are read', async () => {
    const response = await createEventRoute()(new Request('http://localhost/api/nsl/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', query: 'shoes', resultItemIds: ['sku-1'] }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('resultItemIds');
  });
});
