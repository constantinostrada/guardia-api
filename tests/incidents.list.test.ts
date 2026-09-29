/**
 * Tests de integración de GET /incidents: app real en un puerto efímero,
 * requests HTTP reales y el Postgres del compose (base guardia_test), sin mocks.
 * Los incidentes se siembran directamente en la tabla; se vacía antes de cada caso.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { IncidenteSchema, SEVERIDADES, type EstadoIncidente, type Severidad } from "guardia-shared";
import { API_KEY, authHeaders, startApp, type TestApp } from "./helpers.js";

const ESTADOS: EstadoIncidente[] = ["abierto", "cerrado"];

let app: TestApp;

before(async () => {
  app = await startApp();
});
beforeEach(async () => {
  await app.db.query("TRUNCATE incidents");
});
after(async () => {
  await app.db.query("TRUNCATE incidents").catch(() => {});
  await app.close();
});

interface Semilla {
  id: string;
  severidad: Severidad;
  estado: EstadoIncidente;
  /** ISO con microsegundos: la precisión real de la columna. */
  creadoEn: string;
}

/** Inserta un incidente directamente en la tabla (los cerrados con fecha de cierre). */
async function sembrar(severidad: Severidad, estado: EstadoIncidente, creadoEn: string): Promise<Semilla> {
  const id = randomUUID();
  await app.db.query(
    `INSERT INTO incidents (id, title, severity, status, created_at, closed_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, CASE WHEN $4 = 'cerrado' THEN $5::timestamptz + interval '1 hour' END)`,
    [id, `Incidente ${severidad} ${estado}`, severidad, estado, creadoEn],
  );
  return { id, severidad, estado, creadoEn };
}

/** Instante distinto por índice, con microsegundos no nulos. */
function instante(i: number): string {
  const segundos = String(i % 60).padStart(2, "0");
  const minutos = String(Math.floor(i / 60)).padStart(2, "0");
  return `2026-03-01T10:${minutos}:${segundos}.${String(100_000 + i * 7).padStart(6, "0")}Z`;
}

/** Orden documentado: creado descendente y, en empate, id descendente. */
function ordenEsperado(semillas: Semilla[]): string[] {
  return [...semillas]
    .sort((a, b) => (a.creadoEn === b.creadoEn ? (a.id < b.id ? 1 : -1) : a.creadoEn < b.creadoEn ? 1 : -1))
    .map((s) => s.id);
}

/** Query string conservando las comas literales de las listas. */
function qs(params: Record<string, string>): string {
  const partes = Object.entries(params).map(
    ([k, v]) => `${encodeURIComponent(k)}=${v.split(",").map(encodeURIComponent).join(",")}`,
  );
  return partes.length ? `?${partes.join("&")}` : "";
}

interface Respuesta {
  status: number;
  text: string;
  json: Record<string, unknown>;
}

async function listar(query: string, headers: Record<string, string> = authHeaders(), url = app.url): Promise<Respuesta> {
  const res = await fetch(`${url}/incidents${query}`, { headers });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

interface Pagina {
  incidentes: Record<string, unknown>[];
  siguienteCursor: string | null;
}

async function pagina(params: Record<string, string>): Promise<Pagina> {
  const res = await listar(qs(params));
  assert.equal(res.status, 200, res.text);
  const body = res.json as unknown as Pagina;
  assert.ok(Array.isArray(body.incidentes));
  assert.ok(body.siguienteCursor === null || typeof body.siguienteCursor === "string");
  for (const incidente of body.incidentes) {
    const check = IncidenteSchema.safeParse(incidente);
    assert.ok(check.success, JSON.stringify(check.error?.issues));
  }
  return body;
}

/** Sigue el cursor hasta null; devuelve todas las páginas. */
async function recorrer(params: Record<string, string>): Promise<Pagina[]> {
  const paginas: Pagina[] = [];
  let cursor: string | null = null;
  do {
    const p = await pagina(cursor ? { ...params, cursor } : params);
    paginas.push(p);
    cursor = p.siguienteCursor;
    assert.ok(paginas.length < 100, "demasiadas páginas: el cursor no avanza");
  } while (cursor);
  return paginas;
}

async function idsRecorridos(params: Record<string, string>): Promise<string[]> {
  const ids = (await recorrer(params)).flatMap((p) => p.incidentes.map((i) => String(i.id)));
  assert.equal(new Set(ids).size, ids.length, "un incidente apareció en más de una página");
  return ids;
}

function issues(res: Respuesta): { path: (string | number)[]; message: string; code: string; keys?: string[] }[] {
  assert.equal(res.status, 400, res.text);
  assert.equal(typeof res.json.error, "string");
  const list = res.json.issues as { path: (string | number)[]; message: string; code: string }[];
  assert.ok(Array.isArray(list) && list.length > 0, "se esperaba el detalle de zod");
  for (const issue of list) assert.equal(typeof issue.message, "string");
  assert.doesNotMatch(res.text, /stack|\bat \/|node_modules|FST_/);
  return list;
}

/** Siembra las cuatro severidades en ambos estados, con cantidades distintas por combinación. */
async function sembrarTodas(omitir?: [Severidad, EstadoIncidente]): Promise<Semilla[]> {
  const semillas: Semilla[] = [];
  let i = 0;
  for (const [s, severidad] of SEVERIDADES.entries()) {
    for (const [e, estado] of ESTADOS.entries()) {
      if (omitir && omitir[0] === severidad && omitir[1] === estado) continue;
      const cantidad = 1 + ((s + e) % 3);
      for (let n = 0; n < cantidad; n++) semillas.push(await sembrar(severidad, estado, instante(i++)));
    }
  }
  return semillas;
}

describe("GET /incidents: filtros", () => {
  test("sin filtros: recorriendo el cursor devuelve todos exactamente una vez, en orden", async () => {
    const semillas = await sembrarTodas();
    assert.deepEqual(await idsRecorridos({ limite: "4" }), ordenEsperado(semillas));
  });

  for (const severidad of SEVERIDADES) {
    test(`severidad=${severidad}: sólo esa severidad, abiertos y cerrados`, async () => {
      const semillas = await sembrarTodas();
      const esperados = semillas.filter((s) => s.severidad === severidad);
      assert.ok(new Set(esperados.map((s) => s.estado)).size === 2);
      assert.deepEqual(await idsRecorridos({ severidad, limite: "2" }), ordenEsperado(esperados));
    });
  }

  for (const lista of ["alta,crítica", "baja,media,crítica", "crítica,alta,alta"]) {
    test(`severidad=${lista}: cualquiera de las severidades indicadas`, async () => {
      const semillas = await sembrarTodas();
      const valores = lista.split(",");
      const esperados = semillas.filter((s) => valores.includes(s.severidad));
      assert.deepEqual(await idsRecorridos({ severidad: lista, limite: "3" }), ordenEsperado(esperados));
    });
  }

  test("estado=abierto: sólo abiertos, sin fecha de cierre", async () => {
    const semillas = await sembrarTodas();
    const [p] = await recorrer({ estado: "abierto", limite: "100" });
    assert.deepEqual(
      p!.incidentes.map((i) => i.id),
      ordenEsperado(semillas.filter((s) => s.estado === "abierto")),
    );
    for (const i of p!.incidentes) {
      assert.equal(i.estado, "abierto");
      assert.ok(!("cerradoEn" in i));
    }
  });

  test("estado=cerrado: sólo cerrados, todos con fecha de cierre", async () => {
    const semillas = await sembrarTodas();
    const [p] = await recorrer({ estado: "cerrado", limite: "100" });
    assert.deepEqual(
      p!.incidentes.map((i) => i.id),
      ordenEsperado(semillas.filter((s) => s.estado === "cerrado")),
    );
    for (const i of p!.incidentes) {
      assert.equal(i.estado, "cerrado");
      assert.equal(typeof i.cerradoEn, "string");
    }
  });

  for (const severidad of SEVERIDADES) {
    for (const estado of ESTADOS) {
      test(`severidad=${severidad} × estado=${estado}: exactamente la intersección`, async () => {
        const semillas = await sembrarTodas();
        const esperados = semillas.filter((s) => s.severidad === severidad && s.estado === estado);
        assert.ok(esperados.length > 0);
        assert.deepEqual(await idsRecorridos({ severidad, estado, limite: "1" }), ordenEsperado(esperados));
      });
    }
  }

  test("severidad varias × estado", async () => {
    const semillas = await sembrarTodas();
    const esperados = semillas.filter((s) => ["baja", "crítica"].includes(s.severidad) && s.estado === "cerrado");
    assert.deepEqual(
      await idsRecorridos({ severidad: "baja,crítica", estado: "cerrado", limite: "2" }),
      ordenEsperado(esperados),
    );
  });

  test("una combinación sin incidentes sembrados: 200 con lista vacía y sin cursor", async () => {
    await sembrarTodas(["crítica", "cerrado"]);
    const p = await pagina({ severidad: "crítica", estado: "cerrado" });
    assert.deepEqual(p, { incidentes: [], siguienteCursor: null });
  });

  test("tabla vacía: 200 con lista vacía y cursor null", async () => {
    assert.deepEqual(await pagina({}), { incidentes: [], siguienteCursor: null });
  });
});

describe("GET /incidents: paginación", () => {
  test("7 incidentes con limite=3: páginas de 3, 3 y 1; el último cursor es null", async () => {
    const semillas: Semilla[] = [];
    for (let i = 0; i < 7; i++) semillas.push(await sembrar(SEVERIDADES[i % 4]!, ESTADOS[i % 2]!, instante(i)));

    const paginas = await recorrer({ limite: "3" });
    assert.deepEqual(
      paginas.map((p) => p.incidentes.length),
      [3, 3, 1],
    );
    assert.equal(typeof paginas[0]!.siguienteCursor, "string");
    assert.equal(typeof paginas[1]!.siguienteCursor, "string");
    assert.equal(paginas[2]!.siguienteCursor, null);
    assert.deepEqual(
      paginas.flatMap((p) => p.incidentes.map((i) => i.id)),
      ordenEsperado(semillas),
    );
  });

  test("empates de creado (y microsegundos dentro del mismo ms): nada se repite ni se omite", async () => {
    const semillas: Semilla[] = [];
    semillas.push(await sembrar("alta", "abierto", "2026-03-01T12:00:00.000000Z"));
    for (let i = 0; i < 5; i++) {
      semillas.push(await sembrar(SEVERIDADES[i % 4]!, ESTADOS[i % 2]!, "2026-03-01T11:00:00.123456Z"));
    }
    semillas.push(await sembrar("baja", "cerrado", "2026-03-01T11:00:00.123457Z"));
    semillas.push(await sembrar("media", "abierto", "2026-03-01T11:00:00.123455Z"));
    semillas.push(await sembrar("crítica", "cerrado", "2026-03-01T10:00:00.000000Z"));

    for (const limite of ["1", "2", "3"]) {
      assert.deepEqual(await idsRecorridos({ limite }), ordenEsperado(semillas), `limite=${limite}`);
    }
  });

  test("sin limite se aplican 20 por página", async () => {
    for (let i = 0; i < 25; i++) await sembrar("media", "abierto", instante(i));
    const primera = await pagina({});
    assert.equal(primera.incidentes.length, 20);
    assert.equal(typeof primera.siguienteCursor, "string");
    const segunda = await pagina({ cursor: primera.siguienteCursor! });
    assert.equal(segunda.incidentes.length, 5);
    assert.equal(segunda.siguienteCursor, null);
  });

  test("limite=100 es válido", async () => {
    await sembrar("baja", "abierto", instante(0));
    assert.equal((await pagina({ limite: "100" })).incidentes.length, 1);
  });

  test("el cursor es opaco: no contiene ids ni fechas en claro", async () => {
    const semillas: Semilla[] = [];
    for (let i = 0; i < 3; i++) semillas.push(await sembrar("alta", "abierto", instante(i)));
    const { siguienteCursor } = await pagina({ limite: "1" });
    const cursor = siguienteCursor!;
    const decodificado = Buffer.from(cursor, "base64url").toString("latin1");
    for (const s of semillas) {
      for (const texto of [cursor, decodificado]) {
        assert.ok(!texto.includes(s.id) && !texto.includes(s.id.replaceAll("-", "")));
        assert.ok(!texto.includes("2026"));
      }
    }
  });

  test("la misma lista de severidades en otro orden sigue el cursor", async () => {
    for (let i = 0; i < 3; i++) await sembrar(i % 2 ? "alta" : "baja", "abierto", instante(i));
    const primera = await pagina({ severidad: "alta,baja", limite: "2" });
    const segunda = await pagina({ severidad: "baja,alta", limite: "2", cursor: primera.siguienteCursor! });
    assert.equal(segunda.incidentes.length, 1);
  });
});

describe("GET /incidents: 401 sin clave válida", () => {
  const cases: [string, string | null][] = [
    ["sin cabecera x-api-key", null],
    ["con x-api-key vacía", ""],
    ["con una clave distinta", "otra-clave"],
    ["con la clave correcta y un carácter cambiado", `${API_KEY.slice(0, -1)}${API_KEY.endsWith("0") ? "1" : "0"}`],
  ];

  for (const [name, key] of cases) {
    test(name, async () => {
      await sembrar("alta", "abierto", instante(0));
      const res = await listar("", key === null ? {} : { "x-api-key": key });
      assert.equal(res.status, 401);
      assert.deepEqual(res.json, { error: "No autorizado" });
      assert.ok(!res.text.includes(API_KEY));
    });
  }

  test("gana sobre el 400: parámetros inválidos sin clave válida → 401 sin detalle", async () => {
    for (const headers of [{}, { "x-api-key": "otra-clave" }] as Record<string, string>[]) {
      for (const query of ["?severidad=urgente", "?foo=bar", "?limite=0", "?cursor=abc"]) {
        const res = await listar(query, headers);
        assert.equal(res.status, 401, query);
        assert.deepEqual(res.json, { error: "No autorizado" });
      }
    }
  });
});

describe("GET /incidents: 400", () => {
  for (const severidad of ["urgente", "ALTA", "critica", "alta,urgente", "", "alta,"]) {
    test(`severidad="${severidad}" señala severidad`, async () => {
      const list = issues(await listar(qs({ severidad })));
      assert.ok(list.every((i) => i.path[0] === "severidad"), JSON.stringify(list));
    });
  }

  test("estado=pendiente señala estado", async () => {
    const list = issues(await listar("?estado=pendiente"));
    assert.deepEqual(
      list.map((i) => i.path),
      [["estado"]],
    );
  });

  test("foo=bar señala el parámetro desconocido", async () => {
    const list = issues(await listar("?foo=bar"));
    assert.equal(list.length, 1);
    assert.equal(list[0]!.code, "unrecognized_keys");
    assert.deepEqual(list[0]!.keys, ["foo"]);
  });

  for (const query of ["?estado=abierto&estado=cerrado", "?severidad=alta&severidad=baja", "?limite=2&limite=3"]) {
    test(`parámetro repetido ${query}`, async () => {
      const nombre = query.slice(1, query.indexOf("="));
      const list = issues(await listar(query));
      assert.deepEqual(
        list.map((i) => i.path),
        [[nombre]],
      );
    });
  }

  for (const limite of ["0", "-1", "abc", "101", "1.5", ""]) {
    test(`limite="${limite}" señala limite`, async () => {
      const list = issues(await listar(`?limite=${limite}`));
      assert.deepEqual(
        list.map((i) => i.path),
        [["limite"]],
      );
    });
  }

  for (const cursor of ["abc", "", "%%%", Buffer.from('{"c":"2026-01-01","i":"x"}').toString("base64url")]) {
    test(`cursor malformado "${cursor}"`, async () => {
      const list = issues(await listar(`?cursor=${encodeURIComponent(cursor)}`));
      assert.deepEqual(
        list.map((i) => i.path),
        [["cursor"]],
      );
    });
  }

  test("cursor válido manipulado (un carácter cambiado)", async () => {
    for (let i = 0; i < 3; i++) await sembrar("alta", "abierto", instante(i));
    const cursor = (await pagina({ limite: "1" })).siguienteCursor!;
    const pos = Math.floor(cursor.length / 2);
    const manipulado = cursor.slice(0, pos) + (cursor[pos] === "A" ? "B" : "A") + cursor.slice(pos + 1);
    const list = issues(await listar(qs({ limite: "1", cursor: manipulado })));
    assert.deepEqual(
      list.map((i) => i.path),
      [["cursor"]],
    );
  });

  describe("cursor con filtros distintos a los originales", () => {
    const cambios: [string, Record<string, string>, Record<string, string>][] = [
      ["cambia la severidad", { severidad: "alta" }, { severidad: "baja" }],
      ["agrega una severidad a la lista", { severidad: "alta" }, { severidad: "alta,baja" }],
      ["quita la severidad", { severidad: "alta" }, {}],
      ["agrega severidad", {}, { severidad: "alta" }],
      ["cambia el estado", { estado: "abierto" }, { estado: "cerrado" }],
      ["quita el estado", { severidad: "alta", estado: "abierto" }, { severidad: "alta" }],
      ["agrega estado", {}, { estado: "abierto" }],
    ];

    for (const [name, originales, nuevos] of cambios) {
      test(name, async () => {
        const semillas = await sembrarTodas();
        assert.ok(semillas.length > 0);
        const cursor = (await pagina({ ...originales, limite: "1" })).siguienteCursor;
        assert.equal(typeof cursor, "string");
        const res = await listar(qs({ ...nuevos, limite: "1", cursor: cursor! }));
        const list = issues(res);
        assert.deepEqual(
          list.map((i) => i.path),
          [["cursor"]],
        );
        assert.match(String(res.json.error), /filtros/);
        assert.ok(!("incidentes" in res.json));
      });
    }
  });
});

describe("GET /incidents: base caída", () => {
  test("500 genérico, registrado en el log, sin la clave en respuesta ni log", async () => {
    const down = await startApp({ databaseUrl: "postgres://guardia:guardia@127.0.0.1:1/guardia_test" });
    try {
      const res = await listar("?severidad=alta", authHeaders(), down.url);
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { error: "Error interno del servidor" });
      assert.ok(!res.text.includes(API_KEY));

      const errores = down.logs.filter((line) => JSON.parse(line).level >= 50);
      assert.ok(
        errores.some((line) => line.includes("ECONNREFUSED")),
        "el fallo debe quedar en el log",
      );
      assert.deepEqual(
        down.logs.filter((line) => line.includes(API_KEY)),
        [],
      );
    } finally {
      await down.close();
    }
  });
});
