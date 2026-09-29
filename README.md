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

## Tests de integración

```sh
./scripts/dev-up.sh          # la base del compose tiene que estar levantada y migrada
npm run test:integration
```

Levantan la app en un puerto efímero y hacen requests HTTP reales contra el
Postgres del compose (usa `DATABASE_URL` de `.env`, por defecto
`localhost:5433`); no hay mocks. **Vacían la tabla `incidents`** antes de cada
caso y al terminar, así que borran los incidentes de la base de desarrollo. Si
la base no está disponible fallan de entrada con
`La base del compose no está disponible en ...`.

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
