import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { TurnoSchema } from "guardia-shared";
import { API_KEY, authHeaders, countShifts, postShift, startApp, truncateShifts, type Issue, type TestApp } from "./helpers.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = "2030-01-01";
const at = (hhmmss: string) => `${DIA}T${hhmmss}Z`;
const turno = (persona: string, desde: string, hasta: string) => ({ persona, desde: at(desde), hasta: at(hasta) });
const ANA_BASE = turno("ana", "08:00:00", "16:00:00");

let app: TestApp;

before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await truncateShifts(app.db);
});

describe("POST /shifts: creación", () => {
  test("caso feliz: 201 con id v4, los valores enviados y una fila en la tabla", async () => {
    const res = await postShift(app, ANA_BASE);
    assert.equal(res.status, 201);
    const body = await res.json();

    assert.match(body.id, UUID_V4);
    assert.equal(body.persona, "ana");
    assert.equal(Date.parse(body.desde), Date.parse(ANA_BASE.desde));
    assert.equal(Date.parse(body.hasta), Date.parse(ANA_BASE.hasta));
    assert.ok(TurnoSchema.safeParse(body).success, "la respuesta valida contra TurnoSchema");

    const { rows } = await app.db.query("SELECT person, starts_at, ends_at FROM shifts WHERE id = $1", [body.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].starts_at.toISOString(), body.desde);
    assert.equal(rows[0].ends_at.toISOString(), body.hasta);
    assert.equal(await countShifts(app.db), 1);
  });

  test("turnos de la misma persona que se tocan en el borde exacto: ambos 201", async () => {
    assert.equal((await postShift(app, ANA_BASE)).status, 201);
    assert.equal((await postShift(app, turno("ana", "16:00:00", "22:00:00"))).status, 201);
    // Y el borde en el otro sentido: termina justo cuando empieza el de 08:00.
    assert.equal((await postShift(app, turno("ana", "06:00:00", "08:00:00"))).status, 201);
    assert.equal(await countShifts(app.db, "ana"), 3);
  });

  test("misma franja para personas distintas: 201", async () => {
    assert.equal((await postShift(app, ANA_BASE)).status, 201);
    assert.equal((await postShift(app, turno("bruno", "08:00:00", "16:00:00"))).status, 201);
    assert.equal(await countShifts(app.db), 2);
  });

  test("la persona se compara sin normalizar: 'Ana' y ' ana' no chocan con 'ana'", async () => {
    assert.equal((await postShift(app, ANA_BASE)).status, 201);
    assert.equal((await postShift(app, { ...ANA_BASE, persona: "Ana" })).status, 201);
    const res = await postShift(app, { ...ANA_BASE, persona: " ana" });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).persona, " ana", "se persiste el valor recibido");
    assert.equal(await countShifts(app.db, " ana"), 1);
  });
});

describe("POST /shifts: solapamientos (409)", () => {
  const casos: [string, ReturnType<typeof turno>][] = [
    ["pisa el inicio", turno("ana", "07:00:00", "09:00:00")],
    ["pisa el final", turno("ana", "15:00:00", "18:00:00")],
    ["contenido dentro del existente", turno("ana", "10:00:00", "12:00:00")],
    ["contiene al existente", turno("ana", "06:00:00", "20:00:00")],
    ["idéntico", turno("ana", "08:00:00", "16:00:00")],
    ["se pasa un segundo del borde", turno("ana", "07:00:00", "08:00:01")],
  ];

  for (const [nombre, nuevo] of casos) {
    test(`${nombre}: 409 con el turno en conflicto y sin fila nueva`, async () => {
      const existente = await (await postShift(app, ANA_BASE)).json();

      const res = await postShift(app, nuevo);
      assert.equal(res.status, 409);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/);
      const body = await res.json();
      assert.deepEqual(body.conflicto, existente);
      assert.equal(typeof body.error, "string");
      assert.ok(!JSON.stringify(body).includes("at "), "sin traza interna");

      assert.equal(await countShifts(app.db), 1);
    });
  }
});

describe("POST /shifts: validación (400)", () => {
  async function expect400(body: unknown, campo: string | null): Promise<Issue[]> {
    const res = await postShift(app, body);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.ok(Array.isArray(json.detalles), "incluye el detalle de zod");
    const issues = json.detalles as Issue[];
    for (const issue of issues) {
      assert.ok(Array.isArray(issue.path));
      assert.equal(typeof issue.message, "string");
    }
    if (campo !== null) {
      assert.ok(
        issues.some((i) => i.path.includes(campo) || i.keys?.includes(campo)),
        `el detalle señala "${campo}": ${JSON.stringify(issues)}`,
      );
    }
    assert.equal(await countShifts(app.db), 0, "no se inserta fila");
    return issues;
  }

  test("hasta igual a desde", async () => {
    const issues = await expect400(turno("ana", "08:00:00", "08:00:00"), "hasta");
    assert.ok(issues.some((i) => /posterior a desde/.test(i.message)));
  });

  test("hasta anterior a desde", async () => {
    const issues = await expect400(turno("ana", "16:00:00", "08:00:00"), "hasta");
    assert.ok(issues.some((i) => /posterior a desde/.test(i.message)));
  });

  test("sin persona", async () => {
    await expect400({ desde: ANA_BASE.desde, hasta: ANA_BASE.hasta }, "persona");
  });

  test("persona vacía", async () => {
    await expect400({ ...ANA_BASE, persona: "" }, "persona");
  });

  test("sin desde", async () => {
    await expect400({ persona: "ana", hasta: ANA_BASE.hasta }, "desde");
  });

  test("sin hasta", async () => {
    await expect400({ persona: "ana", desde: ANA_BASE.desde }, "hasta");
  });

  test('desde "ayer"', async () => {
    await expect400({ ...ANA_BASE, desde: "ayer" }, "desde");
  });

  test('desde "2024-13-01"', async () => {
    await expect400({ ...ANA_BASE, desde: "2024-13-01" }, "desde");
  });

  test("campo extra id", async () => {
    await expect400({ ...ANA_BASE, id: "8f92110d-122f-4a9f-aa0f-6356762e8def" }, "id");
  });

  test("campo extra desconocido", async () => {
    await expect400({ ...ANA_BASE, notas: "x" }, "notas");
  });

  test("cuerpo JSON que no es un objeto", async () => {
    await expect400("[]", null);
  });

  test("cuerpo no JSON (texto plano): 400 con error JSON sin traza", async () => {
    const res = await postShift(app, "esto no es json", authHeaders({ "content-type": "text/plain" }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.stack, undefined);
    assert.equal(await countShifts(app.db), 0);
  });

  test("JSON mal formado: 400 con error JSON sin traza", async () => {
    const res = await postShift(app, '{"persona": "ana",');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.stack, undefined);
    assert.equal(await countShifts(app.db), 0);
  });
});

describe("POST /shifts: concurrencia", () => {
  test("5 POST simultáneos con la misma franja: un 201, cuatro 409 y una sola fila", async () => {
    const nuevo = turno("carla", "08:00:00", "16:00:00");
    const statuses = (await Promise.all(Array.from({ length: 5 }, () => postShift(app, nuevo)))).map(
      (r) => r.status,
    );
    assert.deepEqual(
      [...statuses].sort((a, b) => a - b),
      [201, 409, 409, 409, 409],
    );
    assert.equal(await countShifts(app.db, "carla"), 1);
  });

  test("5 POST simultáneos con franjas distintas que se pisan: exactamente un 201", async () => {
    const franjas = [
      turno("dario", "08:00:00", "12:00:00"),
      turno("dario", "09:00:00", "13:00:00"),
      turno("dario", "10:00:00", "14:00:00"),
      turno("dario", "11:00:00", "15:00:00"),
      turno("dario", "11:30:00", "12:30:00"),
    ];
    const statuses = (await Promise.all(franjas.map((f) => postShift(app, f)))).map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 201).length, 1);
    assert.equal(statuses.filter((s) => s === 409).length, 4);
    assert.equal(await countShifts(app.db, "dario"), 1);
  });
});

test("los logs de la app no contienen la clave", () => {
  assert.ok(app.logs.length > 0);
  assert.ok(!app.logs.join("").includes(API_KEY));
});
