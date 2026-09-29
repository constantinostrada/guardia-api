# config

Setup and configuration — env vars, flags, how to run the project.

## Dev Postgres runs in Docker on host port 5433; the API runs on the host

What: docker-compose.yml starts only Postgres 16 (user/pass/db `guardia`) published as 5433:5432 with named volume `guardia-db-data`; `scripts/dev-up.sh` does compose up, waits, and migrates · Why: 5433 avoids clashing with a developer's local Postgres on 5432 · Where: docker-compose.yml, scripts/dev-up.sh, .env.example

## App refuses to start without DATABASE_URL or INCIDENTS_API_KEY

What: `loadConfig` reports every missing or empty required var in one message (pointing to .env / .env.example) and exits 1 before `listen`; `.env` is loaded with `process.loadEnvFile` (Node ≥ 20.12, no dotenv), and real env vars take precedence over the file · Why: fail fast instead of breaking on the first request; config values (especially the API key) are never printed · Where: src/config.ts
