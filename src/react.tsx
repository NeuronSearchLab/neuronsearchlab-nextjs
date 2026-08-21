'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type BrowserEvent = { userId: string | number; itemId: number; eventId: number; contextId?: number; requestId?: string; sessionId?: string };
export function trackNSLEvent(event: BrowserEvent, endpoint = '/api/nsl/events') {
  const body = JSON.stringify(event);
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const accepted = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    if (accepted) return Promise.resolve();
  }
  return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).then(response => { if (!response.ok) throw new Error(`NSL event proxy returned ${response.status}`); });
}

export function NSLTracker(props: BrowserEvent & { endpoint?: string; once?: boolean }) {
  const sent = useRef(false);
  useEffect(() => { if (props.once !== false && sent.current) return; sent.current = true; void trackNSLEvent(props, props.endpoint).catch(() => { sent.current = false; }); }, [props.userId, props.itemId, props.eventId, props.contextId, props.endpoint, props.once]);
  return null;
}

export function NSLRecommendations<T>({ userId, contextId, endpoint = '/api/nsl/recommendations', limit = 10, children, fallback = null }:
  { userId: string | number; contextId: number; endpoint?: string; limit?: number; children: (items: T[]) => ReactNode; fallback?: ReactNode }) {
  const [items, setItems] = useState<T[] | null>(null);
  useEffect(() => { const controller = new AbortController(); const url = new URL(endpoint, window.location.origin); url.searchParams.set('userId', String(userId)); url.searchParams.set('contextId', String(contextId)); url.searchParams.set('limit', String(limit)); fetch(url, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(data => setItems(Array.isArray(data) ? data : data.data ?? data.items ?? data.recommendations ?? [])).catch(error => { if (error.name !== 'AbortError') setItems([]); }); return () => controller.abort(); }, [userId, contextId, endpoint, limit]);
  return <>{items === null ? fallback : children(items)}</>;
}
