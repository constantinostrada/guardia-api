#!/usr/bin/env bash
# Levanta la base de desarrollo, espera a que acepte conexiones y aplica
# las migraciones pendientes. Es idempotente: se puede correr las veces que sea.
set -euo pipefail

cd "$(dirname "$0")/.."

TIMEOUT="${DB_WAIT_TIMEOUT:-60}"

fail() {
  echo "dev-up: $*" >&2
  exit 1
}

# Corre "$@" cortándolo a los $1 segundos. Portable (macOS no trae `timeout`);
# necesario porque con el daemon de Docker colgado los comandos no vuelven nunca.
with_timeout() {
  local secs=$1 rc=0
  shift
  "$@" &
  local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" ) >/dev/null 2>&1 &
  local watchdog=$!
  disown "$watchdog" # sin avisos "Terminated" al cancelarlo
  wait "$pid" || rc=$?
  kill "$watchdog" >/dev/null 2>&1 || true
  return "$rc"
}

deadline=$((SECONDS + TIMEOUT))
remaining() { local r=$((deadline - SECONDS)); echo $(( r > 0 ? r : 1 )); }

echo "dev-up: levantando Postgres (docker compose up -d, timeout ${TIMEOUT}s)..."
with_timeout "$(remaining)" docker compose up -d \
  || fail "la base no respondió: 'docker compose up -d' falló o no terminó en ${TIMEOUT}s (¿Docker está corriendo?). No se corrieron migraciones."

echo "dev-up: esperando a que Postgres acepte conexiones..."
# -h 127.0.0.1 fuerza TCP: durante la inicialización del contenedor el servidor
# temporal sólo escucha por socket unix y luego se reinicia.
until with_timeout 5 docker compose exec -T db pg_isready -q -h 127.0.0.1 -U guardia -d guardia >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    fail "la base no respondió en ${TIMEOUT}s. No se corrieron migraciones. Revisá 'docker compose logs db'."
  fi
  sleep 1
done
echo "dev-up: Postgres listo en localhost:5433."

if [[ ! -f ../guardia-shared/package.json ]]; then
  fail "falta el checkout de guardia-shared junto a guardia-api (../guardia-shared)."
fi
if [[ ! -d node_modules ]]; then
  echo "dev-up: instalando dependencias (npm install)..."
  npm install
fi

# guardia-shared se consume como dependencia file:../guardia-shared (su dist/ no
# está versionado): hace falta el checkout hermano y compilarlo una vez.
if [[ ! -f node_modules/guardia-shared/dist/index.js ]]; then
  echo "dev-up: compilando guardia-shared (npm run shared:build)..."
  npm run --silent shared:build
fi

# Sin .env (clon recién hecho) usamos la misma URL que .env.example.
if [[ -z "${DATABASE_URL:-}" && ! -f .env ]]; then
  export DATABASE_URL="postgres://guardia:guardia@localhost:5433/guardia"
fi

echo "dev-up: aplicando migraciones..."
npm run --silent migrate
echo "dev-up: listo."
