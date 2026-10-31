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

import { createNSL, MAX_RECOMMENDATION_SETS_PER_BATCH } from '../src/server';

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

describe('recommendation sets', () => {
  const config = { clientId: 'id', clientSecret: 'secret', apiUrl: 'https://api.example.com/v1' };

  function batchFetch() {
    const calls: Array<{ url: string; body: any }> = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('oauth2')) return Response.json({ access_token: 't', expires_in: 3600 });
      const body = JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      return Response.json({
        object: 'recommendation_set_list',
        results: body.requests.map((set: any) => ({ key: set.key, status: 200, request_id: `${set.key}-id`, context_id: set.context_id, data: [] })),
        usage: { sets: body.requests.length, computed: body.requests.length, reused: 0, coalesced: 0 },
      });
    });
    return { calls, fetcher: fetcher as unknown as typeof fetch };
  }

  it('sends every rail in one batch request', async () => {
    const { calls, fetcher } = batchFetch();
    const response = await createNSL({ ...config, fetch: fetcher }).recommendSets({
      userId: 'u1',
      requestId: '11111111-1111-4111-8111-111111111111',
      sets: [{ key: 'for_you', contextId: 101, limit: 12 }, { key: 'similar', contextId: 102, itemId: 55, filters: ['type:van'] }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.com/v1/recommendations/batch');
    expect(calls[0].body).toEqual({
      user_id: 'u1',
      request_id: '11111111-1111-4111-8111-111111111111',
      requests: [{ key: 'for_you', context_id: 101, limit: 12 }, { key: 'similar', context_id: 102, item_id: 55, filters: ['type:van'] }],
    });
    expect(response.sets.similar.request_id).toBe('similar-id');
    expect(response.usage).toEqual({ sets: 2, computed: 2, reused: 0, coalesced: 0 });
  });

  it('splits a page with more rails than one batch holds', async () => {
    const { calls, fetcher } = batchFetch();
    const sets = Array.from({ length: MAX_RECOMMENDATION_SETS_PER_BATCH + 1 }, (_, i) => ({ key: `rail_${i}`, contextId: i + 1 }));
    const response = await createNSL({ ...config, fetch: fetcher }).recommendSets({ userId: 'u1', sets });
    expect(calls.map(call => call.body.requests.length)).toEqual([MAX_RECOMMENDATION_SETS_PER_BATCH, 1]);
    expect(response.results.map(result => result.key)).toEqual(sets.map(set => set.key));
    expect(response.usage.sets).toBe(sets.length);
  });

  it('rejects sets the API would refuse before calling it', async () => {
    const { calls, fetcher } = batchFetch();
    const nsl = createNSL({ ...config, fetch: fetcher });
    await expect(nsl.recommendSets({ userId: 'u', sets: [] })).rejects.toThrow(/non-empty/);
    await expect(nsl.recommendSets({ userId: 'u', sets: [{ key: 'bad key', contextId: 1 }] })).rejects.toThrow(/must match/);
    await expect(nsl.recommendSets({ userId: 'u', sets: [{ key: 'a', contextId: 1 }, { key: 'a', contextId: 2 }] })).rejects.toThrow(/Duplicate/);
    await expect(nsl.recommendSets({ userId: 'u', sets: [{ key: 'a' }] })).rejects.toThrow(/contextId/);
    expect(calls).toHaveLength(0);
  });
});
