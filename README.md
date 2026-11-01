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

## Several rails on one page

Ask for every rail in one request. Each set is billed as its own recommendation set; the work they share (the visitor's history, identical sets) is done once. Up to eight sets go in one batch, and larger pages are split for you.

```ts
import { nsl } from '@neuronsearchlab/nextjs/server';

const { sets } = await nsl.recommendSets({
  userId: 'visitor-1',
  sets: [
    { key: 'for_you', contextId: 101, limit: 12 },
    { key: 'similar', contextId: 102, itemId: 3187, limit: 6 },
  ],
});
// sets.for_you.data, sets.similar.data; a failed set carries its own status and error.
```

Load a context group (grouped on the Contexts page) by its ID instead: every rail comes back under its context key, in the group's order, under the group's rules. A keyless set adjusts one of the group's rails.

```ts
const { sets } = await nsl.recommendSets({ userId: 'visitor-1', groupId: 12, limit: 12, sets: [{ contextId: 102, itemId: 3187 }] });
```

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
