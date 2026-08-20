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
