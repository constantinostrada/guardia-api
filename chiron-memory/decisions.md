# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## Own minimal SQL migration runner instead of an ORM or migration tool

What: Migrations are plain SQL files `migrations/<NNNN>_<name>.up.sql` + `.down.sql`, applied by `src/db/migrate.ts` (`npm run migrate` / `npm run migrate:down`), tracked in the `schema_migrations` table, each migration in its own transaction under a Postgres advisory lock · Why: the work order ruled out ORMs and external migration tools; a ~100-line runner keeps the schema readable as raw SQL · Where: src/db/migrate.ts, migrations/ · Learned: versions are zero-padded so lexical order equals version order; `down` reverts only the last applied migration

## Severity and status stored as text + CHECK, not Postgres enums

What: `incidents.severity` is text CHECK IN ('baja','media','alta','crítica') and `status` is text CHECK IN ('abierto','cerrado'); a CHECK ties `closed_at` to status (required when cerrado, forbidden when abierto) · Why: mirrors the guardia-shared domain contract; changing allowed values is a plain constraint swap instead of an enum ALTER TYPE · Where: migrations/0001_init.up.sql
