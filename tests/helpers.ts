/**
 * Arnés de tests de integración: app real escuchando en un puerto efímero,
 * requests HTTP reales (fetch) y la base Postgres del compose (5433), sin mocks.
 *
 * Los tests usan su propia base `guardia_test` en el mismo servidor, para no
 * tocar los datos de desarrollo: se crea si falta y se migra al arrancar.
 */
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import pg from "pg";
import { loadDotEnv } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { buildServer } from "../src/server.js";

loadDotEnv();

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://guardia:guardia@localhost:5433/guardia_test";

// La misma clave que usa la app (INCIDENTS_API_KEY); si no hay, una aleatoria.
export const API_KEY = process.env.INCIDENTS_API_KEY?.trim() || `test-${randomUUID()}`;

const DUPLICATE_DATABASE = "42P04";

async function ensureTestDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`).catch((err: { code?: string }) => {
        if (err.code !== DUPLICATE_DATABASE) throw err;
      });
    }
  } finally {
    await admin.end();
  }
  await runMigrations(TEST_DATABASE_URL, "up", () => {});
}

export interface TestApp {
  url: string;
  /** Pool directo a la base, para sembrar y consultar sin pasar por la API. */
  db: pg.Pool;
  /** Líneas de log emitidas por la app. */
  logs: string[];
  close(): Promise<void>;
}

/**
 * Levanta la app. Con `databaseUrl` se puede apuntar a una base inexistente
 * para probar fallos; en ese caso no se prepara la base de tests.
 */
export async function startApp(options: { databaseUrl?: string } = {}): Promise<TestApp> {
  const databaseUrl = options.databaseUrl ?? TEST_DATABASE_URL;
  if (!options.databaseUrl) await ensureTestDatabase();

  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      const line = String(chunk);
      logs.push(line);
      // TEST_LOGS=1 los vuelca a stderr (p. ej. para grepear la clave).
      if (process.env.TEST_LOGS === "1") process.stderr.write(line);
      callback();
    },
  });
  const pool = createPool(databaseUrl, () => {});
  const app = buildServer({ apiKey: API_KEY, pool, logStream });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    db: pool,
    logs,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export async function truncateShifts(db: pg.Pool): Promise<void> {
  await db.query("TRUNCATE shifts");
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-api-key": API_KEY, ...extra };
}

export function postShift(app: TestApp, body: unknown, headers = authHeaders()): Promise<Response> {
  return fetch(`${app.url}/shifts`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function getCurrent(app: TestApp, headers = authHeaders()): Promise<Response> {
  return fetch(`${app.url}/shifts/current`, { headers });
}

export async function countShifts(db: pg.Pool, persona?: string): Promise<number> {
  const { rows } = persona
    ? await db.query<{ n: number }>("SELECT count(*)::int AS n FROM shifts WHERE person = $1", [persona])
    : await db.query<{ n: number }>("SELECT count(*)::int AS n FROM shifts");
  return rows[0]!.n;
}

export interface Issue {
  path: (string | number)[];
  message: string;
  keys?: string[];
}
