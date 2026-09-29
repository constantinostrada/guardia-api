# gotcha

A non-obvious pitfall or trap, learned the hard way.

## Wait for Postgres over TCP, not the unix socket, on first container start

What: dev-up.sh probes with `pg_isready -h 127.0.0.1` inside the container · Why: on first init the postgres image runs a temporary server that listens only on the unix socket and then restarts, so a socket probe reports "ready" too early and migrations hit a restarting server · Where: scripts/dev-up.sh, docker-compose.yml healthcheck

## Docker commands can hang forever when the daemon is wedged

What: dev-up.sh wraps `docker compose up` and each readiness probe in a portable bash watchdog (`with_timeout`), with the watchdog disowned to avoid "Terminated" noise · Why: with Docker Desktop hung, `docker compose up -d` never returns, so a timeout only on the wait loop would not fire; macOS has no `timeout` binary by default · Where: scripts/dev-up.sh · Learned: any "fail within N seconds" guarantee must cover every external call, not just the polling loop

## IncidenteSchema is a ZodEffects: pick from innerType()

What: guardia-shared's `IncidenteSchema` ends in `.superRefine(...)`, so in zod 3 it is a `ZodEffects` without `.pick`/`.omit`; derive sub-schemas from `IncidenteSchema.innerType()` · Why: the refinement (estado ↔ cerradoEn) wraps the object; the inner object keeps field rules and `.strict()` · Where: src/incidents/schema.ts

## API-key check must be an onRequest hook, and text/plain must be unregistered

What: the x-api-key guard is an `onRequest` hook in the incidents scope, and that scope calls `removeContentTypeParser("text/plain")`; body-parse errors (`FST_ERR_CTP_*`, incl. 415) are mapped to 400 in src/errors.ts · Why: `preHandler`/`preValidation` run after body parsing, so a bad JSON body or content-type would answer 400/415 before 401 and leak that the endpoint parsed it; Fastify ships a default text/plain parser, so plain text would reach zod as a string · Where: src/server.ts, src/auth.ts, src/errors.ts
