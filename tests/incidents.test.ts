/**
 * Tests de integración de POST /incidents: app real escuchando en un puerto
 * efímero, requests HTTP reales y Postgres real (la base del compose, 5433).
 * Sin mocks. Vacían la tabla incidents antes de cada caso y al terminar.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { IncidenteSchema } from "guardia-shared";
import pg from "pg";
import { loadDotEnv } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

loadDotEnv();
const DATABASE_URL = process.env.DATABASE_URL?.trim() || "postgres://guardia:guardia@localhost:5433/guardia";
// Clave propia de cada corrida: así buscarla en los logs capturados es significativo.
const API_KEY = `test-key-${randomUUID()}`;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Todo lo que la app escribe en su log durante la corrida. */
const logs: string[] = [];
const logStream = new Writable({
  write(chunk, _encoding, callback) {
    logs.push(String(chunk));
    callback();
  },
});

let db: pg.Pool;
let app: FastifyInstance;
let baseUrl: string;

async function start(databaseUrl: string): Promise<{ app: FastifyInstance; url: string }> {
  const pool = createPool(databaseUrl, () => {});
  const server = buildServer({ apiKey: API_KEY, pool, logStream });
  server.addHook("onClose", async () => {
    await pool.end();
  });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const { port } = server.server.address() as AddressInfo;
  return { app: server, url: `http://127.0.0.1:${port}` };
}

interface PostOptions {
  key?: string | null;
  contentType?: string;
  url?: string;
}

async function post(body: unknown, { key = API_KEY, contentType = "application/json", url = baseUrl }: PostOptions = {}) {
  const headers: Record<string, string> = { "content-type": contentType };
  if (key !== null) headers["x-api-key"] = key;
  const res = await fetch(`${url}/incidents`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

async function countRows(): Promise<number> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM incidents");
  return rows[0]!.n;
}

function issuePaths(json: Record<string, unknown>): string[] {
  const issues = json.issues as { path: (string | number)[]; message: string }[];
  assert.ok(Array.isArray(issues) && issues.length > 0, "se esperaba una lista de issues de zod");
  for (const issue of issues) assert.equal(typeof issue.message, "string");
  return issues.map((i) => i.path.join("."));
}

before(async () => {
  db = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await db.query("SELECT 1 FROM incidents LIMIT 1");
  } catch (err) {
    await db.end();
    const { hostname, port } = new URL(DATABASE_URL);
    // Un ECONNREFUSED sobre ::1 y 127.0.0.1 llega como AggregateError con message vacío.
    const reason = (err as { code?: string }).code || (err instanceof Error && err.message) || String(err);
    throw new Error(
      `La base del compose no está disponible en ${hostname}:${port} (${reason}). ` +
        "Levantala y migrala con ./scripts/dev-up.sh antes de correr los tests de integración.",
    );
  }
  ({ app, url: baseUrl } = await start(DATABASE_URL));
});

beforeEach(async () => {
  await db.query("TRUNCATE incidents");
});

after(async () => {
  await app?.close();
  if (db) {
    await db.query("TRUNCATE incidents").catch(() => {});
    await db.end();
  }
});

describe("POST /incidents", () => {
  test("201: crea el incidente, válido según guardia-shared y persistido", async () => {
    const res = await post({ titulo: "Caída del servicio", severidad: "alta" });

    assert.equal(res.status, 201);
    const body = res.json;
    assert.match(String(body.id), UUID_V4);
    assert.equal(body.titulo, "Caída del servicio");
    assert.equal(body.severidad, "alta");
    assert.equal(body.estado, "abierto");
    assert.ok(!("cerradoEn" in body), "un incidente abierto no lleva cerradoEn");
    assert.match(String(body.creadoEn), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    const age = Date.now() - Date.parse(String(body.creadoEn));
    assert.ok(age >= 0 && age < 10_000, `creadoEn debería ser de hace segundos (${age} ms)`);

    const check = IncidenteSchema.safeParse(body);
    assert.ok(check.success, JSON.stringify(check.error?.issues));

    const { rows } = await db.query("SELECT * FROM incidents WHERE id = $1", [body.id]);
    assert.equal(rows.length, 1);
    assert.equal(await countRows(), 1);
    assert.equal(rows[0].title, "Caída del servicio");
    assert.equal(rows[0].severity, "alta");
    assert.equal(rows[0].status, "abierto");
    assert.equal(rows[0].closed_at, null);
    assert.equal((rows[0].created_at as Date).toISOString(), body.creadoEn);
  });

  describe("401 sin clave válida", () => {
    const cases: [string, string | null][] = [
      ["sin cabecera x-api-key", null],
      ["con x-api-key vacía", ""],
      ["con una clave distinta", "otra-clave"],
      ["con la clave correcta y un carácter cambiado", `${API_KEY.slice(0, -1)}${API_KEY.endsWith("0") ? "1" : "0"}`],
    ];

    for (const [name, key] of cases) {
      test(name, async () => {
        const res = await post({ titulo: "Caída del servicio", severidad: "alta" }, { key });
        assert.equal(res.status, 401);
        assert.deepEqual(res.json, { error: "No autorizado" });
        assert.equal(await countRows(), 0);
      });
    }

    test("gana sobre el 400: cuerpo inválido sin clave válida → 401 sin detalle de validación", async () => {
      for (const key of [null, "otra-clave"]) {
        const invalid = await post({ severidad: "urgente", id: "x" }, { key });
        assert.equal(invalid.status, 401);
        assert.deepEqual(invalid.json, { error: "No autorizado" });

        const notJson = await post("hola", { key, contentType: "text/plain" });
        assert.equal(notJson.status, 401);
        assert.deepEqual(notJson.json, { error: "No autorizado" });
      }
      assert.equal(await countRows(), 0);
    });
  });

  describe("400 con el detalle de zod", () => {
    for (const severidad of ["urgente", "critica", "ALTA"]) {
      test(`severidad "${severidad}"`, async () => {
        const res = await post({ titulo: "Caída del servicio", severidad });
        assert.equal(res.status, 400);
        assert.deepEqual(issuePaths(res.json), ["severidad"]);
        assert.equal(await countRows(), 0);
      });
    }

    test("severidad ausente", async () => {
      const res = await post({ titulo: "Caída del servicio" });
      assert.equal(res.status, 400);
      assert.deepEqual(issuePaths(res.json), ["severidad"]);
      assert.equal(await countRows(), 0);
    });

    for (const [name, body] of [
      ["título ausente", { severidad: "alta" }],
      ["título vacío", { titulo: "", severidad: "alta" }],
      ["título sólo con espacios", { titulo: "   ", severidad: "alta" }],
    ] as const) {
      test(name, async () => {
        const res = await post(body);
        assert.equal(res.status, 400);
        assert.deepEqual(issuePaths(res.json), ["titulo"]);
        assert.equal(await countRows(), 0);
      });
    }

    const extras: Record<string, unknown> = {
      id: randomUUID(),
      creadoEn: "2020-01-01T00:00:00.000Z",
      estado: "cerrado",
      cerradoEn: "2020-01-02T00:00:00.000Z",
      desconocido: 1,
    };
    for (const [field, value] of Object.entries(extras)) {
      test(`campo extra "${field}" rechazado`, async () => {
        const res = await post({ titulo: "Caída del servicio", severidad: "alta", [field]: value });
        assert.equal(res.status, 400);
        const issues = res.json.issues as { code: string; message: string }[];
        assert.ok(
          issues.some((i) => i.code === "unrecognized_keys" && i.message.includes(field)),
          JSON.stringify(issues),
        );
        assert.equal(await countRows(), 0);
      });
    }
  });

  describe("400 con cuerpo no JSON", () => {
    for (const [name, contentType] of [
      ["texto plano", "text/plain"],
      ["JSON mal formado", "application/json"],
    ] as const) {
      test(name, async () => {
        const res = await post("hola", { contentType });
        assert.equal(res.status, 400);
        assert.equal(typeof res.json.error, "string");
        assert.doesNotMatch(res.text, /stack|\bat \/|node_modules|FST_/);
        assert.equal(await countRows(), 0);
      });
    }
  });

  test("500 genérico y registrado en el log si la base no responde", async () => {
    // Pool real contra un puerto donde no escucha nadie: el fallo de conexión es real.
    const down = await start("postgres://guardia:guardia@127.0.0.1:1/guardia");
    try {
      const logsBefore = logs.length;
      const res = await post({ titulo: "Caída del servicio", severidad: "alta" }, { url: down.url });
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { error: "Error interno del servidor" });
      assert.ok(!res.text.includes(API_KEY));

      const errorLogs = logs.slice(logsBefore).filter((line) => JSON.parse(line).level >= 50);
      assert.ok(errorLogs.some((line) => line.includes("ECONNREFUSED")), "el fallo debe quedar en el log");
    } finally {
      await down.app.close();
    }
  });

  test("la clave nunca aparece en los logs de la corrida", () => {
    assert.ok(logs.length > 0, "se esperaban logs capturados");
    const leaks = logs.filter((line) => line.includes(API_KEY) || line.includes(API_KEY.slice(0, -1)));
    assert.deepEqual(leaks, []);
  });
});
