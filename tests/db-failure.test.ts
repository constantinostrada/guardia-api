import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { API_KEY, getCurrent, postShift, startApp, type TestApp } from "./helpers.js";

// Base inalcanzable (nada escucha en ese puerto): simula la base detenida sin
// tocar el contenedor que usan los demás tests.
const DOWN_DATABASE_URL = "postgres://guardia:guardia@127.0.0.1:1/guardia_test";

let app: TestApp;

before(async () => {
  app = await startApp({ databaseUrl: DOWN_DATABASE_URL });
});
after(async () => {
  await app.close();
});

async function assertGeneric500(res: Response): Promise<void> {
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: "Error interno del servidor" });
  assert.ok(!text.includes(API_KEY));
}

test("POST /shifts con la base caída: 500 genérico", async () => {
  await assertGeneric500(
    await postShift(app, { persona: "ana", desde: "2030-01-01T08:00:00Z", hasta: "2030-01-01T16:00:00Z" }),
  );
});

test("GET /shifts/current con la base caída: 500 genérico", async () => {
  await assertGeneric500(await getCurrent(app));
});

test("el fallo queda en el log y el log no contiene la clave", () => {
  const log = app.logs.join("");
  assert.match(log, /"level":50/);
  assert.match(log, /ECONNREFUSED/);
  assert.ok(!log.includes(API_KEY));
});
