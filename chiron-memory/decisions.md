# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## Own minimal SQL migration runner instead of an ORM or migration tool

What: Migrations are plain SQL files `migrations/<NNNN>_<name>.up.sql` + `.down.sql`, applied by `src/db/migrate.ts` (`npm run migrate` / `npm run migrate:down`), tracked in the `schema_migrations` table, each migration in its own transaction under a Postgres advisory lock · Why: the work order ruled out ORMs and external migration tools; a ~100-line runner keeps the schema readable as raw SQL · Where: src/db/migrate.ts, migrations/ · Learned: versions are zero-padded so lexical order equals version order; `down` reverts only the last applied migration

## Severity and status stored as text + CHECK, not Postgres enums

What: `incidents.severity` is text CHECK IN ('baja','media','alta','crítica') and `status` is text CHECK IN ('abierto','cerrado'); a CHECK ties `closed_at` to status (required when cerrado, forbidden when abierto) · Why: mirrors the guardia-shared domain contract; changing allowed values is a plain constraint swap instead of an enum ALTER TYPE · Where: migrations/0001_init.up.sql

## Shift non-overlap enforced by a Postgres exclusion constraint

What: `shifts_no_overlap_per_person` = `EXCLUDE USING gist (person WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)` (needs `btree_gist`); POST /shifts just inserts and maps 23P01 on that constraint to 409, then looks up the colliding row for the body · Why: an app-level "check then insert" lets two concurrent POSTs both succeed; half-open `[)` ranges make touching shifts (end = next start) legal · Where: migrations/0002_shifts_no_overlap.up.sql, src/shifts/repository.ts

## guardia-shared consumed as a file: dependency on the sibling checkout

What: package.json has `"guardia-shared": "file:../guardia-shared"`; `npm run shared:build` (run by dev-up.sh when dist is missing) does `npm ci` + build in that repo · Why: guardia-shared does not commit `dist/` nor has a `prepare` script, so a git dependency would install a package with no code · Where: package.json, scripts/dev-up.sh · Learned: if guardia-shared ever publishes or adds `prepare`, switch to a versioned/git dependency

## Integration tests use a separate guardia_test database on the compose server

What: tests/helpers.ts creates `guardia_test` on the 5433 Postgres if missing, runs `runMigrations` (src/db/migrations.ts) on it, and TRUNCATEs shifts between cases; `npm test` runs node:test via tsx with `--test-concurrency=1` · Why: the user asked not to wipe dev data in the `guardia` DB; files share one table so they run serially · Where: tests/helpers.ts, package.json
