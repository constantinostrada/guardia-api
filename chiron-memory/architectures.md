# architecture

How the system is put together — layers, boundaries, and how data flows.

## Protected routes live in one encapsulated Fastify scope with the x-api-key hook

What: `buildServer` registers a child scope that adds `requireApiKey(INCIDENTS_API_KEY)` as an `onRequest` hook; every keyed route plugin (shifts now, incidents later) is registered inside that scope instead of adding its own check · Why: the key check must exist once in the repo and run before body parsing/validation (so bad key + bad body → 401, never 400) · Where: src/server.ts, src/auth/api-key.ts
