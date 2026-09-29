# guardia-api
Guardia · banco de pruebas del ADE

API de Guardia: Fastify + TypeScript sobre Postgres.

## Requisitos

- Node.js ≥ 20.12
- Docker (con `docker compose`)

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
| `npm run typecheck`    | Chequeo de tipos sin emitir                     |
| `npm run build`        | Compila a `dist/`                               |
| `npm start`            | Arranca el build compilado                      |
| `npm run migrate`      | Aplica las migraciones pendientes               |
| `npm run migrate:down` | Revierte la última migración aplicada           |

## Migraciones

Archivos SQL planos en `migrations/`, con nombre `<versión>_<nombre>.up.sql` y su
`<versión>_<nombre>.down.sql` (versión numérica con ceros a la izquierda:
`0002_...`). El runner (`src/db/migrate.ts`) registra lo aplicado en la tabla
`schema_migrations` y corre cada migración en su propia transacción.
