/**
 * Runner mínimo de migraciones SQL (lo usan el CLI src/db/migrate.ts y los tests).
 *
 * Archivos en migrations/: <versión>_<nombre>.up.sql y <versión>_<nombre>.down.sql,
 * donde <versión> es numérica con ceros a la izquierda (0001, 0002, ...) para que
 * el orden alfabético coincida con el de versión.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");
const FILE_RE = /^(\d+)_([\w-]+)\.up\.sql$/;
// Clave arbitraria para el advisory lock: evita dos runners en paralelo.
const LOCK_KEY = 72_616_001;

type Log = (message: string) => void;

interface Migration {
  version: string;
  name: string;
  upPath: string;
}

async function listMigrations(): Promise<Migration[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .map((file) => FILE_RE.exec(file))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([file, version, name]) => ({
      version,
      name,
      upPath: path.join(MIGRATIONS_DIR, file),
    }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function ensureControlTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function inTransaction(client: pg.Client, fn: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await fn();
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function up(client: pg.Client, log: Log): Promise<void> {
  const { rows } = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.version));
  const pending = (await listMigrations()).filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    log("migrate: no hay migraciones pendientes.");
    return;
  }

  for (const m of pending) {
    const sql = await readFile(m.upPath, "utf8");
    await inTransaction(client, async () => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
    });
    log(`migrate: aplicada ${m.version}_${m.name}`);
  }
}

async function down(client: pg.Client, log: Log): Promise<void> {
  const { rows } = await client.query<{ version: string; name: string }>(
    "SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  const last = rows[0];
  if (!last) {
    log("migrate: no hay migraciones aplicadas para revertir.");
    return;
  }

  const downPath = path.join(MIGRATIONS_DIR, `${last.version}_${last.name}.down.sql`);
  const sql = await readFile(downPath, "utf8");
  await inTransaction(client, async () => {
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE version = $1", [last.version]);
  });
  log(`migrate: revertida ${last.version}_${last.name}`);
}

export type MigrationCommand = "up" | "down";

/** `up` aplica todas las pendientes; `down` revierte sólo la última aplicada. */
export async function runMigrations(
  databaseUrl: string,
  command: MigrationCommand,
  log: Log = console.log,
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureControlTable(client);
    await (command === "up" ? up(client, log) : down(client, log));
  } finally {
    await client.end();
  }
}
