import 'server-only';
import type { ItemUpsertPayload, RecommendationsResponse } from '@neuronsearchlab/sdk';

export type NSLTrackInput = {
  userId: string | number;
  event: string;
  itemId: string | number;
  requestId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type NSLRecommendInput = { userId: string | number; context?: string; contextId?: string; limit?: number; scope?: Record<string, unknown> };
export type NSLServerConfig = { apiUrl?: string; clientId?: string; clientSecret?: string; tokenUrl?: string; fetch?: typeof fetch };

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
  async function request<T>(path: string, init: RequestInit, retry = true): Promise<T> {
    const response = await fetcher(`${apiUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers, authorization: `Bearer ${await token()}` } });
    if (response.status === 401 && retry) { await token(true); return request<T>(path, init, false); }
    if (!response.ok) throw new Error(`NSL API request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response.json() as Promise<T>;
  }

  return {
    track(input: NSLTrackInput) {
      return request('/events', { method: 'POST', body: JSON.stringify({
        user_id: input.userId, type: input.event, item_id: input.itemId,
        ...(input.requestId ? { request_id: input.requestId } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        ...(input.metadata ?? {}), client_ts: new Date().toISOString(),
      }) });
    },
    recommend(input: NSLRecommendInput): Promise<RecommendationsResponse> {
      const query = new URLSearchParams({ user_id: String(input.userId), context_key: input.context ?? 'homepage', limit: String(input.limit ?? 10) });
      if (input.contextId) query.set('context_id', input.contextId);
      if (input.scope) query.set('scope', JSON.stringify(input.scope));
      return request<RecommendationsResponse>(`/recommendations?${query}`, { method: 'GET' });
    },
    syncContent(items: ItemUpsertPayload | ItemUpsertPayload[]) { return request('/items', { method: 'POST', body: JSON.stringify(items) }); },
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
    let body: NSLTrackInput;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
    if (!body || !['string', 'number'].includes(typeof body.userId) || !['string', 'number'].includes(typeof body.itemId) || typeof body.event !== 'string' || !body.event.trim()) {
      return Response.json({ error: 'userId, itemId and event are required' }, { status: 400 });
    }
    await nsl.track(body);
    await nsl.flush();
    return Response.json({ ok: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  };
}
