# guardia-api
Guardia · banco de pruebas del ADE

API de Guardia: Fastify + TypeScript sobre Postgres.

## Requisitos

- Node.js ≥ 20.12
- Docker (con `docker compose`)
- [guardia-shared](https://github.com/constantinostrada/guardia-shared) clonado
  **junto a** este repo (`../guardia-shared`). Se consume como
  `file:../guardia-shared` y `npm install` lo compila ahí si falta su `dist/`
  (`scripts/build-shared.sh`). Es temporal: guardia-shared todavía no es
  instalable desde git (publica sólo `dist/`, que no versiona, y no tiene
  script `prepare`).

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

## Endpoints

### `POST /incidents`

Crea un incidente abierto.

- **Cabecera obligatoria:** `x-api-key: <INCIDENTS_API_KEY>`. Se comprueba antes
  que el cuerpo.
- **Cuerpo** (`Content-Type: application/json`), exactamente estos dos campos:

  ```json
  { "titulo": "Caída del servicio", "severidad": "alta" }
  ```

  `severidad` ∈ `baja` · `media` · `alta` · `crítica`; `titulo` no puede estar
  vacío. Las reglas vienen del schema `Incidente` de guardia-shared. **No se
  admiten campos extra**: enviar `id`, `creadoEn`, `estado`, `cerradoEn` o
  cualquier otro da 400. La API genera el id (UUID v4), `creadoEn` (ahora, ISO
  8601 UTC) y `estado: "abierto"`.

| Respuesta | Cuándo | Cuerpo |
| --------- | ------ | ------ |
| `201` | Creado | El incidente persistido: `{ id, titulo, severidad, estado: "abierto", creadoEn }` (sin `cerradoEn`) |
| `400` | El cuerpo no valida | `{ "error": "...", "issues": [{ "path": ["severidad"], "message": "...", "code": "..." }] }` (detalle de zod) |
| `400` | El cuerpo no es JSON o el content-type no es JSON | `{ "error": "..." }` |
| `401` | Sin `x-api-key`, vacía o incorrecta | `{ "error": "No autorizado" }` |
| `500` | Fallo interno (p. ej. la base no responde) | `{ "error": "Error interno del servidor" }`; el detalle queda sólo en el log |

```sh
curl -i http://127.0.0.1:3000/incidents \
  -H "x-api-key: $INCIDENTS_API_KEY" -H 'content-type: application/json' \
  -d '{"titulo":"Caída del servicio","severidad":"alta"}'
```

### `GET /incidents`

Lista incidentes, paginados por cursor.

- **Cabecera obligatoria:** `x-api-key: <INCIDENTS_API_KEY>`. Se comprueba antes
  que los parámetros: sin clave válida es 401 aunque la query sea inválida.
- **Parámetros de consulta** (todos opcionales; cualquier otro, o uno repetido, da 400):

  | Parámetro | Valores | Por defecto |
  | --------- | ------- | ----------- |
  | `severidad` | Una o varias de `baja` · `media` · `alta` · `crítica` separadas por coma (`severidad=alta,crítica`): incidentes de cualquiera de ellas. Exactas, en minúsculas y con tilde; un solo valor inválido en la lista da 400 | Todas |
  | `estado` | `abierto` o `cerrado` | Ambos |
  | `limite` | Tamaño de página, entero de 1 a **100** | **20** |
  | `cursor` | El `siguienteCursor` de la respuesta anterior | Primera página |

  Los valores válidos de severidad y estado vienen de guardia-shared. Los dos
  filtros se combinan (intersección).

- **Orden:** más recientes primero — `creadoEn` descendente y, a igual instante,
  `id` descendente. Es determinista: incidentes con el mismo `creadoEn` nunca se
  saltan ni se repiten entre páginas.
- **Respuesta 200:**

  ```json
  {
    "incidentes": [
      { "id": "…", "titulo": "Caída del servicio", "severidad": "alta", "estado": "cerrado",
        "creadoEn": "2026-03-01T10:00:00.123Z", "cerradoEn": "2026-03-01T11:00:00.123Z" }
    ],
    "siguienteCursor": "opaco…"
  }
  ```

  Cada incidente tiene la forma de `Incidente` de guardia-shared (`cerradoEn`
  sólo si está cerrado). Sin resultados es `200` con `"incidentes": []` y
  `"siguienteCursor": null`, nunca 404.

- **Seguir el cursor:** si `siguienteCursor` no es `null`, pedí la página
  siguiente con `cursor=<siguienteCursor>` y **los mismos `severidad` y
  `estado`** (el orden de la lista de severidades da igual; `limite` puede
  cambiar). Repetí hasta que `siguienteCursor` sea `null`. El cursor es opaco
  (cifrado y autenticado): no se puede leer ni editar; uno malformado o
  manipulado, o usado con otros filtros, da 400.

| Respuesta | Cuándo | Cuerpo |
| --------- | ------ | ------ |
| `200` | Siempre que la request sea válida | `{ incidentes, siguienteCursor }` |
| `400` | Parámetro inválido, desconocido o repetido | `{ "error": "...", "issues": [{ "path": ["severidad", 1], "message": "...", "code": "..." }] }` (detalle de zod; `path[0]` es el parámetro; en desconocidos `path` es `[]` y `keys` los lista) |
| `400` | Cursor malformado o manipulado | `{ "error": "El cursor no es válido", "issues": [{ "path": ["cursor"], ... }] }` |
| `400` | Cursor generado con otros filtros | `{ "error": "El cursor no corresponde a estos filtros: ...", "issues": [{ "path": ["cursor"], ... }] }` |
| `401` | Sin `x-api-key`, vacía o incorrecta | `{ "error": "No autorizado" }` |
| `500` | Fallo interno (p. ej. la base no responde) | `{ "error": "Error interno del servidor" }`; el detalle queda sólo en el log |

```sh
curl -s "http://127.0.0.1:3000/incidents?severidad=alta,cr%C3%ADtica&estado=abierto&limite=10" \
  -H "x-api-key: $INCIDENTS_API_KEY"
# página siguiente: mismos filtros + cursor
curl -s "http://127.0.0.1:3000/incidents?severidad=alta,cr%C3%ADtica&estado=abierto&limite=10&cursor=$CURSOR" \
  -H "x-api-key: $INCIDENTS_API_KEY"
```

Las rutas de turnos (`Turno` de guardia-shared) usan la misma cabecera y
devuelven turnos con esta forma, fechas ISO 8601 en UTC:

```json
{ "id": "uuid v4", "persona": "ana", "desde": "2030-01-01T08:00:00.000Z", "hasta": "2030-01-01T16:00:00.000Z" }
```

### `POST /shifts`

Crea un turno.

- **Cabecera obligatoria:** `x-api-key: <INCIDENTS_API_KEY>`. Se comprueba antes
  que el cuerpo.
- **Cuerpo** (`Content-Type: application/json`), exactamente estos tres campos:

  ```json
  { "persona": "ana", "desde": "2030-01-01T08:00:00Z", "hasta": "2030-01-01T16:00:00Z" }
  ```

  Reglas del schema `Turno` de guardia-shared: `persona` no vacía, `desde` y
  `hasta` ISO 8601 UTC, `hasta` estrictamente posterior a `desde`. **No se
  admiten campos extra** (tampoco `id`: lo genera la API, UUID v4).

**Solapamiento.** Los turnos son intervalos medio-abiertos `[desde, hasta)`. Un
turno nuevo no puede compartir ningún instante con otro turno de la **misma
persona**. Tocarse en el borde exacto **no** es solapar: con ana de 08:00 a
16:00, ana de 16:00 a 22:00 se crea (201), pero ana de 07:00 a 08:00:01 no
(409). Personas distintas pueden coincidir libremente. `persona` se compara por
igualdad exacta del valor recibido (`"ana"`, `"Ana"` y `" ana"` son personas
distintas). Lo garantiza la base (restricción de exclusión
`shifts_no_overlap_per_person`), también ante requests simultáneas.

| Respuesta | Cuándo | Cuerpo |
| --------- | ------ | ------ |
| `201` | Creado | El turno persistido: `{ id, persona, desde, hasta }` |
| `400` | El cuerpo no valida | `{ "error": "Cuerpo inválido", "detalles": [{ "path": ["hasta"], "message": "..." }] }` (detalle de zod; en campos extra `path` es `[]` y `keys` los lista) |
| `400` | El cuerpo no es JSON o el content-type no es JSON | `{ "error": "..." }` |
| `401` | Sin `x-api-key`, vacía o incorrecta | `{ "error": "No autorizado" }` |
| `409` | Se solapa con otro turno de la misma persona; no se guarda nada | `{ "error": "...", "conflicto": { id, persona, desde, hasta } }` con el turno existente |
| `500` | Fallo interno (p. ej. la base no responde) | `{ "error": "Error interno del servidor" }`; el detalle queda sólo en el log |

### `GET /shifts/current`

Quién está de guardia ahora (reloj del servidor, UTC). Un turno está activo si
`desde ≤ ahora < hasta`: el que termina justo ahora ya no cuenta, el que empieza
justo ahora sí.

- **Cabecera obligatoria:** `x-api-key: <INCIDENTS_API_KEY>`.

| Respuesta | Cuándo | Cuerpo |
| --------- | ------ | ------ |
| `200` | Hay al menos un turno activo | Lista de todos los turnos activos (varias personas a la vez aparecen todas), ordenada por `desde` ascendente y luego por `id` |
| `204` | Nadie de guardia | Sin cuerpo |
| `401` | Sin `x-api-key`, vacía o incorrecta | `{ "error": "No autorizado" }` |
| `500` | Fallo interno | `{ "error": "Error interno del servidor" }` |

## Tests de integración

```sh
./scripts/dev-up.sh          # la base del compose tiene que estar levantada y migrada
npm run test:integration
```

Levantan la app en un puerto efímero y hacen requests HTTP reales contra el
Postgres del compose (5433); no hay mocks. Los archivos corren en serie.

- **Alta de incidentes** (`tests/incidents.test.ts`) usan `DATABASE_URL` de `.env` (por
  defecto la base `guardia`) y **vacían la tabla `incidents`** antes de cada caso
  y al terminar, así que borran los incidentes de la base de desarrollo. Si la
  base no está disponible fallan de entrada con
  `La base del compose no está disponible en ...`.
- **Turnos y listado de incidentes** (`tests/shifts.*.test.ts`,
  `tests/incidents.list.test.ts`, `tests/auth.test.ts`, `tests/db-failure.test.ts`) usan una base aparte, **`guardia_test`**, en el
  mismo servidor, que se crea y migra sola; no tocan los datos de desarrollo.
  `TEST_DATABASE_URL` permite apuntar a otra base. Con `TEST_LOGS=1` los logs de
  la app se vuelcan a stderr.

## Scripts

| Comando                | Qué hace                                        |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Arranca la API con recarga (`tsx watch`)        |
| `npm run typecheck`    | Chequeo de tipos sin emitir (src + tests)       |
| `npm run test:integration` | Tests de integración contra la base del compose |
| `npm run build`        | Compila a `dist/`                               |
| `npm start`            | Arranca el build compilado                      |
| `npm run migrate`      | Aplica las migraciones pendientes               |
| `npm run migrate:down` | Revierte la última migración aplicada           |

## Migraciones

Archivos SQL planos en `migrations/`, con nombre `<versión>_<nombre>.up.sql` y su
`<versión>_<nombre>.down.sql` (versión numérica con ceros a la izquierda:
`0002_...`). El runner (`src/db/migrate.ts`) registra lo aplicado en la tabla
`schema_migrations` y corre cada migración en su propia transacción.
