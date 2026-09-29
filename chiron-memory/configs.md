# config

Setup and configuration — env vars, flags, how to run the project.

## Dev Postgres runs in Docker on host port 5433; the API runs on the host

What: docker-compose.yml starts only Postgres 16 (user/pass/db `guardia`) published as 5433:5432 with named volume `guardia-db-data`; `scripts/dev-up.sh` does compose up, waits, and migrates · Why: 5433 avoids clashing with a developer's local Postgres on 5432 · Where: docker-compose.yml, scripts/dev-up.sh, .env.example

## App refuses to start without DATABASE_URL or INCIDENTS_API_KEY

What: `loadConfig` reports every missing or empty required var in one message (pointing to .env / .env.example) and exits 1 before `listen`; `.env` is loaded with `process.loadEnvFile` (Node ≥ 20.12, no dotenv), and real env vars take precedence over the file · Why: fail fast instead of breaking on the first request; config values (especially the API key) are never printed · Where: src/config.ts

## Incidents integration tests run against the dev compose DB and truncate incidents

What: tests/incidents.test.ts (run with the rest by `npm run test:integration`, node:test via `node --import tsx --test`, no extra deps) starts the app on an ephemeral port and uses `DATABASE_URL` (default localhost:5433); it TRUNCATEs `incidents` before each case and at the end, and aborts with "La base del compose no está disponible…" if the DB is down; `npm run typecheck` uses tsconfig.test.json to cover tests too · Why: the work order requires real HTTP + real Postgres, no mocks; shift tests use a separate `guardia_test` DB instead (see decisions) · Where: tests/incidents.test.ts, tsconfig.test.json · Learned: a refused connection on localhost is an AggregateError with an empty message — report `err.code`
