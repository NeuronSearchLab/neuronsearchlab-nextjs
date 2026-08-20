# @neuronsearchlab/nextjs

Server-first Next.js bindings for NeuronSearchLab. OAuth client secrets are read only by the server entry point; browser events pass through a Route Handler.

```ts
// app/api/nsl/events/route.ts
import { createEventRoute } from '@neuronsearchlab/nextjs/server';
export const POST = createEventRoute();
```

```tsx
import { nsl } from '@neuronsearchlab/nextjs/server';
const result = await nsl.recommend({ userId: 'visitor-1', context: 'homepage', limit: 10 });
```

Vercel Marketplace injects `NSL_API_URL`, `NSL_CLIENT_ID`, `NSL_CLIENT_SECRET`, and `NSL_TOKEN_URL`. Never rename the secret to `NEXT_PUBLIC_*`.
