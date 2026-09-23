# @neuronsearchlab/nextjs

Server-first Next.js bindings for NeuronSearchLab. OAuth client secrets are read only by the server entry point; browser events pass through a Route Handler.

```ts
// app/api/nsl/events/route.ts
import { createEventRoute } from '@neuronsearchlab/nextjs/server';
export const POST = createEventRoute();
```

```tsx
import { nsl } from '@neuronsearchlab/nextjs/server';
const result = await nsl.recommend({ userId: 'visitor-1', contextId: 101, limit: 10 });
```

Vercel Marketplace injects the API/OAuth values plus the default context and event IDs used to support every deployed Core API version. Never rename a secret to `NEXT_PUBLIC_*`.

## Searches

A search is an event: it steers the user's recommendations by the weight of your Search event, like any click or purchase.

```ts
import { nsl } from '@neuronsearchlab/nextjs/server';

// NSL runs the search.
const results = await nsl.search({ query: 'waterproof trail shoes', userId: 'visitor-1' });

// Your own engine ran it: record it with the IDs it showed and get
// recommendations that complement them (those IDs are left out).
const extras = await nsl.search({ query: 'waterproof trail shoes', userId: 'visitor-1', resultItemIds: [3187, 3190] });

// Record only.
await nsl.trackSearch({ userId: 'visitor-1', query: 'waterproof trail shoes', resultItemIds: [3187, 3190] });
```

From the browser, the same event route accepts a search: a `query` with no `itemId`.

```tsx
import { trackNSLSearch } from '@neuronsearchlab/nextjs/react';
trackNSLSearch({ userId: 'visitor-1', query: 'waterproof trail shoes', resultItemIds: [3187, 3190] });
```
