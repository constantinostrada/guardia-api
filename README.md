# guardia-api
Guardia · banco de pruebas del ADE

API de Guardia: Fastify + TypeScript sobre Postgres.

## Requisitos

- Node.js ≥ 20.12
- Docker (con `docker compose`)
- El repo [guardia-shared](https://github.com/constantinostrada/guardia-shared)
  clonado al lado (`../guardia-shared`): se consume como dependencia
  `file:../guardia-shared` y hay que compilarlo (`npm run shared:build`, que
  `scripts/dev-up.sh` corre si hace falta).

## Arranque en desarrollo

```sh
cp .env.example .env        # DATABASE_URL e INCIDENTS_API_KEY
./scripts/dev-up.sh         # levanta Postgres en localhost:5433 y aplica migraciones
npm run dev                 # API en http://127.0.0.1:3000 con recarga
curl -i http://127.0.0.1:3000/health   # → 200 {"status":"ok"}
```

`docker-compose.yml` levanta **sólo** Postgres, publicado en el puerto **5433**
del host para no chocar con un Postgres local en 5432. Los datos viven en el
volumen `guardia-api_guardia-db-data` y sobreviven a reinicios del contenedor.
`scripts/dev-up.sh` es idempotente; `DB_WAIT_TIMEOUT` (segundos, por defecto 60)
controla cuánto espera a la base.

La app no arranca si falta `DATABASE_URL` o `INCIDENTS_API_KEY` (ausente o
vacía): informa qué variables faltan y termina con código 1 sin abrir el puerto.
`HOST` y `PORT` son opcionales (por defecto `127.0.0.1:3000`).

## Scripts

| Comando                | Qué hace                                        |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Arranca la API con recarga (`tsx watch`)        |
| `npm run typecheck`    | Chequeo de tipos sin emitir (src y tests)       |
| `npm test`             | Tests de integración (requiere la base arriba)  |
| `npm run shared:build` | Instala y compila `../guardia-shared`           |
| `npm run build`        | Compila a `dist/`                               |
| `npm start`            | Arranca el build compilado                      |
| `npm run migrate`      | Aplica las migraciones pendientes               |
| `npm run migrate:down` | Revierte la última migración aplicada           |

## Migraciones

Archivos SQL planos en `migrations/`, con nombre `<versión>_<nombre>.up.sql` y su
`<versión>_<nombre>.down.sql` (versión numérica con ceros a la izquierda:
`0002_...`). El runner (`src/db/migrate.ts`) registra lo aplicado en la tabla
`schema_migrations` y corre cada migración en su propia transacción.

## API

Todas las rutas salvo `/health` exigen la cabecera **`x-api-key`** con el valor
de `INCIDENTS_API_KEY` (la misma clave que las rutas de incidentes). Sin
cabecera, vacía o con una clave que no coincide → **401**
`{"error":"No autorizado"}`, siempre igual. La clave se comprueba antes de leer
o validar el cuerpo: sin clave válida la respuesta es 401 aunque el cuerpo sea
inválido.

Un fallo de base de datos devuelve **500** `{"error":"Error interno del servidor"}`
(el detalle sólo va al log).

Los turnos (`Turno` de guardia-shared) tienen esta forma; las fechas son ISO 8601
en UTC:

```json
{ "id": "uuid v4", "persona": "ana", "desde": "2030-01-01T08:00:00.000Z", "hasta": "2030-01-01T16:00:00.000Z" }
```

### `POST /shifts`

Crea un turno. El cuerpo es JSON (`Content-Type: application/json`) con
**exactamente** estos tres campos; cualquier otro (incluido `id`, que genera la
API) es un error:

```json
{ "persona": "ana", "desde": "2030-01-01T08:00:00Z", "hasta": "2030-01-01T16:00:00Z" }
```

Se valida con el schema de Turno de guardia-shared (sin `id`): `persona` no
vacía, `desde`/`hasta` ISO 8601 UTC y `hasta` estrictamente posterior a `desde`.

**Solapamiento.** Los turnos son intervalos medio-abiertos `[desde, hasta)`. Un
turno nuevo no puede compartir ningún instante con otro turno de la **misma
persona**. Tocarse en el borde exacto **no** es solapar: con ana de 08:00 a 16:00,
ana de 16:00 a 22:00 se crea (201), pero ana de 07:00 a 08:00:01 no (409).
Personas distintas pueden coincidir libremente. `persona` se compara por
igualdad exacta del valor recibido (`"ana"`, `"Ana"` y `" ana"` son personas
distintas). La regla la garantiza la base (restricción de exclusión
`shifts_no_overlap_per_person`), también ante requests simultáneas.

| Respuesta | Cuándo | Cuerpo |
| --------- | ------ | ------ |
| **201** | Turno creado | El turno completo tal como quedó persistido |
| **400** | Cuerpo inválido según el schema | `{"error": "Cuerpo inválido", "detalles": [{"path": ["hasta"], "message": "..."}]}` (en campos extra, `path` es `[]` y `keys` los lista) |
| **400** | Cuerpo no JSON o JSON mal formado | `{"error": "..."}` |
| **401** | Falta la clave o es incorrecta | `{"error": "No autorizado"}` |
| **409** | Se solapa con otro turno de la misma persona; no se guarda nada | `{"error": "...", "conflicto": {id, persona, desde, hasta}}` con el turno existente |

### `GET /shifts/current`

Quién está de guardia ahora (reloj del servidor, UTC). Un turno está activo si
`desde ≤ ahora < hasta`: el que termina justo ahora ya no cuenta, el que empieza
justo ahora sí.

| Respuesta | Cuándo | Cuerpo |
| --------- | ------ | ------ |
| **200** | Hay al menos un turno activo | Lista de todos los turnos activos (varias personas a la vez aparecen todas), ordenada por `desde` ascendente y luego por `id` |
| **204** | Nadie de guardia | Sin cuerpo |
| **401** | Falta la clave o es incorrecta | `{"error": "No autorizado"}` |

## Tests

```sh
./scripts/dev-up.sh   # la base del compose tiene que estar arriba
npm test
```

Son tests de integración sin mocks: levantan la app en un puerto efímero, hacen
requests HTTP reales y usan una base **`guardia_test`** en el mismo Postgres del
compose (5433), que se crea y migra sola; los datos de desarrollo de la base
`guardia` no se tocan. `TEST_DATABASE_URL` permite apuntar a otra base. La clave
es `INCIDENTS_API_KEY` si está definida (entorno o `.env`), si no una aleatoria.
Con `TEST_LOGS=1` los logs de la app se vuelcan a stderr.
