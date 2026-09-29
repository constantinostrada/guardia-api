/**
 * Runner mínimo de migraciones SQL.
 *
 * Archivos en migrations/: <versión>_<nombre>.up.sql y <versión>_<nombre>.down.sql,
 * donde <versión> es numérica con ceros a la izquierda (0001, 0002, ...) para que
 * el orden alfabético coincida con el de versión.
 *
 * Uso:
 *   tsx src/db/migrate.ts up     aplica todas las migraciones pendientes
 *   tsx src/db/migrate.ts down   revierte la última migración aplicada
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { loadDotEnv } from "../config.js";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");
const FILE_RE = /^(\d+)_([\w-]+)\.up\.sql$/;
// Clave arbitraria para el advisory lock: evita dos runners en paralelo.
const LOCK_KEY = 72_616_001;

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

async function up(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.version));
  const pending = (await listMigrations()).filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    console.log("migrate: no hay migraciones pendientes.");
    return;
  }

  for (const m of pending) {
    const sql = await readFile(m.upPath, "utf8");
    await inTransaction(client, async () => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
    });
    console.log(`migrate: aplicada ${m.version}_${m.name}`);
  }
}

async function down(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ version: string; name: string }>(
    "SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  const last = rows[0];
  if (!last) {
    console.log("migrate: no hay migraciones aplicadas para revertir.");
    return;
  }

  const downPath = path.join(MIGRATIONS_DIR, `${last.version}_${last.name}.down.sql`);
  const sql = await readFile(downPath, "utf8");
  await inTransaction(client, async () => {
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE version = $1", [last.version]);
  });
  console.log(`migrate: revertida ${last.version}_${last.name}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "up" && command !== "down") {
    console.error("Uso: migrate.ts <up|down>");
    process.exit(2);
  }

  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error(
      "Error de configuración: falta DATABASE_URL.\n" +
        "Definila en un archivo .env en la raíz del proyecto (copiá .env.example: cp .env.example .env).",
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureControlTable(client);
    await (command === "up" ? up(client) : down(client));
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error("migrate: error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
