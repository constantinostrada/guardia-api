import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TurnoSchema } from "guardia-shared";
import { API_KEY, getCurrent, startApp, truncateShifts, type TestApp } from "./helpers.js";

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

/** Siembra un turno con desde/hasta relativos a now() de la base (p. ej. '-1 hour'). */
async function seed(persona: string, desde: string, hasta: string): Promise<string> {
  const { rows } = await app.db.query<{ id: string }>(
    `INSERT INTO shifts (person, starts_at, ends_at)
     VALUES ($1, now() + $2::interval, now() + $3::interval)
     RETURNING id`,
    [persona, desde, hasta],
  );
  return rows[0]!.id;
}

async function expect204(): Promise<void> {
  const res = await getCurrent(app);
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
}

async function expect200(): Promise<{ id: string; persona: string; desde: string; hasta: string }[]> {
  const res = await getCurrent(app);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  for (const turno of body) {
    assert.ok(TurnoSchema.safeParse(turno).success, `valida contra TurnoSchema: ${JSON.stringify(turno)}`);
  }
  return body;
}

test("sin turnos: 204 sin cuerpo", async () => {
  await expect204();
});

test("sólo turnos pasados y futuros: 204", async () => {
  await seed("ana", "-3 hours", "-1 hour");
  await seed("bruno", "1 hour", "3 hours");
  await expect204();
});

test("un turno activo: 200 con exactamente ese turno", async () => {
  const id = await seed("ana", "-1 hour", "1 hour");
  await seed("ana", "2 hours", "4 hours");
  const body = await expect200();
  assert.equal(body.length, 1);
  assert.equal(body[0]!.id, id);
  assert.equal(body[0]!.persona, "ana");
});

test("varias personas activas: 200 con todas, ordenadas por desde ascendente", async () => {
  const bruno = await seed("bruno", "-30 minutes", "2 hours");
  const ana = await seed("ana", "-2 hours", "1 hour");
  const body = await expect200();
  assert.deepEqual(
    body.map((t) => t.id),
    [ana, bruno],
  );
  assert.ok(Date.parse(body[0]!.desde) < Date.parse(body[1]!.desde));
});

test("mismo desde: desempate por id", async () => {
  await app.db.query(
    `INSERT INTO shifts (person, starts_at, ends_at)
     SELECT p, date_trunc('second', now()) - interval '1 hour', now() + interval '1 hour'
     FROM unnest(ARRAY['ana', 'bruno', 'carla']) AS p`,
  );
  const ids = (await expect200()).map((t) => t.id);
  assert.equal(ids.length, 3);
  assert.deepEqual(ids, [...ids].sort());
});

test("uno terminó hace 5 s y otro empezó hace 5 s: sólo aparece el segundo", async () => {
  await seed("ana", "-2 hours", "-5 seconds");
  const bruno = await seed("bruno", "-5 seconds", "2 hours");
  const body = await expect200();
  assert.deepEqual(
    body.map((t) => t.id),
    [bruno],
  );
});

test("los logs de la app no contienen la clave", () => {
  assert.ok(!app.logs.join("").includes(API_KEY));
});
