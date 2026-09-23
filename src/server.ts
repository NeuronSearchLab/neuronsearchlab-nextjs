import 'server-only';
import type { ItemUpsertPayload, RecommendationsResponse } from '@neuronsearchlab/sdk';

export type NSLTrackInput = {
  userId: string | number;
  eventId: number;
  itemId: number;
  contextId?: number;
  requestId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * A search, recorded as an event. It steers the user's recommendations by the
 * weight of your Search event, like any click or purchase. eventId is optional
 * and defaults to the event your `search` signal is bound to.
 */
export type NSLSearchEventInput = {
  userId: string | number;
  query: string;
  /** Item IDs your own search engine showed for `query`, in rank order. */
  resultItemIds?: number[];
  eventId?: number;
  contextId?: number;
  requestId?: string;
  sessionId?: string;
};

export type NSLSearchInput = {
  query: string;
  userId?: string | number;
  contextId?: number;
  limit?: number;
  filter?: string | string[];
  /**
   * Your own engine ran `query` and showed these item IDs. NSL records the
   * search and returns recommendations that complement them (these IDs are
   * left out of the response).
   */
  resultItemIds?: number[];
};

const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function validResultItemIds(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isPositiveInteger);
}

/** The error message for a malformed search event, or null when it is valid. */
export function searchEventError(body: Partial<NSLSearchEventInput> | null | undefined): string | null {
  if (!body || !['string', 'number'].includes(typeof body.userId)) return 'userId is required';
  if (typeof body.query !== 'string' || !body.query.trim()) return 'query must contain text';
  if (body.eventId !== undefined && (!Number.isSafeInteger(body.eventId) || body.eventId === 0)) return 'eventId must be a non-zero integer when provided';
  if (body.contextId !== undefined && !isPositiveInteger(body.contextId)) return 'contextId must be a positive integer';
  if (body.resultItemIds !== undefined && !validResultItemIds(body.resultItemIds)) return 'resultItemIds must be positive integer item IDs returned by NSL';
  return null;
}

export type NSLRecommendInput = { userId: string | number; contextId?: number; limit?: number; scope?: Record<string, unknown> };
export type NSLServerConfig = { apiUrl?: string; clientId?: string; clientSecret?: string; tokenUrl?: string; contextId?: number; fetch?: typeof fetch };

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required. Connect an NSL Vercel resource or set it server-side.`);
  return value.trim();
}

export function createNSL(config: NSLServerConfig = {}) {
  const apiUrl = (config.apiUrl ?? process.env.NSL_API_URL ?? 'https://api.neuronsearchlab.com/v1').replace(/\/$/, '');
  const clientId = required(config.clientId ?? process.env.NSL_CLIENT_ID, 'NSL_CLIENT_ID');
  const clientSecret = required(config.clientSecret ?? process.env.NSL_CLIENT_SECRET, 'NSL_CLIENT_SECRET');
  const tokenUrl = config.tokenUrl ?? process.env.NSL_TOKEN_URL ?? 'https://auth.neuronsearchlab.com/oauth2/token';
  const fetcher = config.fetch ?? fetch;
  const envContextId = Number(process.env.NSL_CONTEXT_ID);
  const defaultContextId = config.contextId ?? (Number.isSafeInteger(envContextId) && envContextId > 0 ? envContextId : undefined);
  let cached: { value: string; expiresAt: number } | undefined;
  async function token(force = false) {
    if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    const response = await fetcher(tokenUrl, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&scope=neuronsearchlab-api%2Fread%20neuronsearchlab-api%2Fwrite' });
    if (!response.ok) throw new Error(`NSL OAuth token request failed (${response.status})`);
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('NSL OAuth response did not include access_token');
    cached = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return cached.value;
  }
  async function request<T>(path: string, init: RequestInit, retry = true, acceptedStatuses: number[] = []): Promise<T> {
    const response = await fetcher(`${apiUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers, authorization: `Bearer ${await token()}` } });
    if (response.status === 401 && retry) { await token(true); return request<T>(path, init, false, acceptedStatuses); }
    if (!response.ok && !acceptedStatuses.includes(response.status)) throw new Error(`NSL API request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response.json() as Promise<T>;
  }

  return {
    track(input: NSLTrackInput) {
      return request('/events', { method: 'POST', body: JSON.stringify({
        user_id: input.userId, event_id: input.eventId, item_id: input.itemId,
        ...(input.contextId ? { context_id: input.contextId } : {}),
        ...(input.requestId ? { request_id: input.requestId } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        client_ts: new Date().toISOString(),
      }) });
    },
    trackSearch(input: NSLSearchEventInput) {
      const error = searchEventError(input);
      if (error) return Promise.reject(new Error(error));
      return request('/events', { method: 'POST', body: JSON.stringify({
        user_id: input.userId, query: input.query.trim(),
        ...(input.resultItemIds ? { result_item_ids: input.resultItemIds } : {}),
        ...(input.eventId !== undefined ? { event_id: input.eventId } : {}),
        ...(input.contextId ? { context_id: input.contextId } : {}),
        ...(input.requestId ? { request_id: input.requestId } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        client_ts: new Date().toISOString(),
      }) });
    },
    search(input: NSLSearchInput): Promise<RecommendationsResponse & { query?: string; search?: Record<string, unknown> }> {
      if (typeof input.query !== 'string' || !input.query.trim()) return Promise.reject(new Error('query is required'));
      if (input.resultItemIds !== undefined && !validResultItemIds(input.resultItemIds)) {
        return Promise.reject(new Error('resultItemIds must be positive integer item IDs returned by NSL'));
      }
      const contextId = input.contextId ?? defaultContextId;
      return request('/search', { method: 'POST', body: JSON.stringify({
        query: input.query.trim(),
        ...(input.userId !== undefined ? { user_id: String(input.userId) } : {}),
        ...(contextId ? { context_id: contextId } : {}),
        ...(input.limit ? { limit: String(input.limit) } : {}),
        ...(input.filter ? { filter: input.filter } : {}),
        ...(input.resultItemIds ? { result_item_ids: input.resultItemIds } : {}),
      }) });
    },
    recommend(input: NSLRecommendInput): Promise<RecommendationsResponse> {
      const query = new URLSearchParams({ user_id: String(input.userId), limit: String(input.limit ?? 10) });
      const resolvedContextId = input.contextId ?? defaultContextId;
      if (!resolvedContextId) throw new Error('contextId is required and must be the integer ID created by NSL');
      query.set('context_id', String(resolvedContextId));
      if (input.scope) query.set('scope', JSON.stringify(input.scope));
      return request<RecommendationsResponse>(`/recommendations?${query}`, { method: 'GET' });
    },
    syncContent(items: ItemUpsertPayload | ItemUpsertPayload[]) { return request('/items', { method: 'POST', body: JSON.stringify(items) }, true, [409]); },
    flush() { return Promise.resolve(); },
  };
}

let singleton: ReturnType<typeof createNSL> | undefined;
export const nsl = new Proxy({} as ReturnType<typeof createNSL>, { get(_target, property) { singleton ??= createNSL(); return singleton[property as keyof typeof singleton]; } });

export function createEventRoute(options: { path?: string; maxBodyBytes?: number } = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? 16_384;
  return async function POST(request: Request) {
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return Response.json({ error: 'content_type_must_be_json' }, { status: 415 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return Response.json({ error: 'payload_too_large' }, { status: 413 });
    let body: Partial<NSLTrackInput> & Partial<NSLSearchEventInput>;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
    // A query with no item is a search event.
    if (body && body.itemId === undefined && typeof body.query === 'string') {
      const error = searchEventError(body);
      if (error) return Response.json({ error }, { status: 400 });
      await nsl.trackSearch(body as NSLSearchEventInput);
      await nsl.flush();
      return Response.json({ ok: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!body || !['string', 'number'].includes(typeof body.userId) || !Number.isSafeInteger(body.itemId) || (body.itemId as number) <= 0 || !Number.isSafeInteger(body.eventId) || body.eventId === 0 || (body.contextId !== undefined && (!Number.isSafeInteger(body.contextId) || body.contextId <= 0))) {
      return Response.json({ error: 'userId is required; eventId must be a non-zero integer; itemId and optional contextId must be positive integers' }, { status: 400 });
    }
    await nsl.track(body as NSLTrackInput);
    await nsl.flush();
    return Response.json({ ok: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  };
}
