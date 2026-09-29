# gotcha

A non-obvious pitfall or trap, learned the hard way.

## Wait for Postgres over TCP, not the unix socket, on first container start

What: dev-up.sh probes with `pg_isready -h 127.0.0.1` inside the container · Why: on first init the postgres image runs a temporary server that listens only on the unix socket and then restarts, so a socket probe reports "ready" too early and migrations hit a restarting server · Where: scripts/dev-up.sh, docker-compose.yml healthcheck

## Docker commands can hang forever when the daemon is wedged

What: dev-up.sh wraps `docker compose up` and each readiness probe in a portable bash watchdog (`with_timeout`), with the watchdog disowned to avoid "Terminated" noise · Why: with Docker Desktop hung, `docker compose up -d` never returns, so a timeout only on the wait loop would not fire; macOS has no `timeout` binary by default · Where: scripts/dev-up.sh · Learned: any "fail within N seconds" guarantee must cover every external call, not just the polling loop

## Concurrent inserts on a GiST exclusion constraint can deadlock (40P01)

What: 5 simultaneous overlapping INSERTs for the same person sometimes ended in `deadlock detected` (→ 500) instead of 23P01; fixed by taking `pg_advisory_xact_lock(72616002, hashtext(person))` in the insert transaction · Why: exclusion-constraint checks on competing uncommitted rows wait on each other and Postgres aborts the cycle · Where: src/shifts/repository.ts · Learned: the constraint is the guarantee, the per-key lock only serializes contenders so they fail cleanly; repeat concurrency tests many times, one run hides it

## TurnoSchema trims persona, so persist the raw received value

What: guardia-shared's `persona: z.string().trim().min(1)` transforms the value; POST /shifts validates with the derived schema but stores `request.body.persona` as sent · Why: the overlap rule compares persona by exact equality of what was received (like the column), and " ana" must not collide with "ana" · Where: src/shifts/routes.ts

## Fastify 5 parses text/plain by default and names bad JSON FST_ERR_CTP_INVALID_JSON_BODY

What: the server removes the `text/plain` parser so non-JSON bodies hit FST_ERR_CTP_INVALID_MEDIA_TYPE (mapped to 400), and maps FST_ERR_CTP_INVALID_JSON_BODY / EMPTY_JSON_BODY to 400 · Why: otherwise a text body reaches zod as a string and 415 would be returned for other types · Where: src/server.ts
