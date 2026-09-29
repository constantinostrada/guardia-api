import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { API_KEY, countShifts, getCurrent, postShift, startApp, truncateShifts, type TestApp } from "./helpers.js";

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

// Cambia el último carácter: misma longitud, un solo carácter distinto.
const unCaracterCambiado = API_KEY.slice(0, -1) + (API_KEY.endsWith("x") ? "y" : "x");

const VALID_BODY = { persona: "ana", desde: "2030-01-01T08:00:00Z", hasta: "2030-01-01T16:00:00Z" };

const casos: [string, Record<string, string>][] = [
  ["sin cabecera", {}],
  ["cabecera vacía", { "x-api-key": "" }],
  ["clave incorrecta", { "x-api-key": "no-es-la-clave" }],
  ["clave con un carácter cambiado", { "x-api-key": unCaracterCambiado }],
  ["prefijo de la clave correcta", { "x-api-key": API_KEY.slice(0, -1) }],
];

async function assertGeneric401(res: Response): Promise<void> {
  assert.equal(res.status, 401);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.ok(!text.includes(API_KEY), "no revela la clave");
  assert.ok(!/x-api-key|clave|missing|falta/i.test(body.error), "no indica si la clave existe");
}

describe("401 en POST /shifts", () => {
  for (const [nombre, headers] of casos) {
    test(nombre, async () => {
      const res = await postShift(app, VALID_BODY, headers);
      await assertGeneric401(res);
      assert.equal(await countShifts(app.db), 0);
    });
  }

  test("sin clave válida y con cuerpo inválido: 401, no 400, sin detalle de validación", async () => {
    const res = await postShift(app, { persona: "", id: "x" }, { "x-api-key": "mala" });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.detalles, undefined);
  });

  test("sin clave válida y con cuerpo no JSON: 401", async () => {
    const res = await postShift(app, "{roto", {});
    assert.equal(res.status, 401);
  });
});

describe("401 en GET /shifts/current", () => {
  for (const [nombre, headers] of casos) {
    test(nombre, async () => {
      await assertGeneric401(await getCurrent(app, headers));
    });
  }
});

test("todas las respuestas 401 son idénticas", async () => {
  const bodies = await Promise.all(casos.map(async ([, h]) => (await getCurrent(app, h)).text()));
  assert.equal(new Set(bodies).size, 1);
});

test("los logs de la app no contienen la clave", () => {
  assert.ok(!app.logs.join("").includes(API_KEY));
});
