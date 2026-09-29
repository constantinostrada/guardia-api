# architecture

How the system is put together — layers, boundaries, and how data flows.

## Protected routes live in one encapsulated Fastify scope with the x-api-key hook

What: `buildServer` registers one child scope that adds `apiKeyGuard(INCIDENTS_API_KEY)` as an `onRequest` hook and removes the text/plain parser; every keyed route plugin (incidentsRoutes, shiftRoutes) is registered inside that scope instead of adding its own check · Why: the key check must exist once in the repo and run before body parsing/validation (so bad key + bad body → 401, never 400) · Where: src/server.ts, src/auth.ts
