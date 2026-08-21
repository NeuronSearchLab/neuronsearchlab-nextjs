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
