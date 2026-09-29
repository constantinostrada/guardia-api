# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## Own minimal SQL migration runner instead of an ORM or migration tool

What: Migrations are plain SQL files `migrations/<NNNN>_<name>.up.sql` + `.down.sql`, applied by `src/db/migrate.ts` (`npm run migrate` / `npm run migrate:down`), tracked in the `schema_migrations` table, each migration in its own transaction under a Postgres advisory lock · Why: the work order ruled out ORMs and external migration tools; a ~100-line runner keeps the schema readable as raw SQL · Where: src/db/migrate.ts, migrations/ · Learned: versions are zero-padded so lexical order equals version order; `down` reverts only the last applied migration

## Severity and status stored as text + CHECK, not Postgres enums

What: `incidents.severity` is text CHECK IN ('baja','media','alta','crítica') and `status` is text CHECK IN ('abierto','cerrado'); a CHECK ties `closed_at` to status (required when cerrado, forbidden when abierto) · Why: mirrors the guardia-shared domain contract; changing allowed values is a plain constraint swap instead of an enum ALTER TYPE · Where: migrations/0001_init.up.sql

## guardia-shared consumed as file:../guardia-shared, built by postinstall (temporary)

What: `package.json` depends on `"guardia-shared": "file:../guardia-shared"` (sibling checkout); `postinstall` runs `scripts/build-shared.sh`, which runs `npm install` + `npm run build` in `../guardia-shared` when its `dist/` is missing · Why: guardia-shared is not installable from git — it publishes only `files: ["dist"]`, dist is gitignored and there is no `prepare` script, so a git dependency arrives with just package.json and README (no src to compile) · Where: package.json, scripts/build-shared.sh · Learned: switch to a pinned git dependency and delete the script once guardia-shared adds `prepare`

## POST /incidents rejects extra fields instead of ignoring them

What: the create body is `IncidenteSchema.innerType().pick({ titulo, severidad }).strict()`; any other key (id, creadoEn, estado, cerradoEn, unknown) → 400 `unrecognized_keys`; the API sets id (`randomUUID`, v4), creadoEn (now) and estado `abierto` · Why: reusing the shared schema keeps API and guardia-shared from diverging, and strictness surfaces clients that think they can set server-owned fields · Where: src/incidents/schema.ts, src/incidents/routes.ts
