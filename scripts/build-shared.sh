#!/usr/bin/env bash
# postinstall: guardia-shared se consume como file:../guardia-shared y no versiona
# dist/, así que lo compilamos en el checkout hermano si todavía no está compilado.
# Temporal: guardia-shared no es instalable desde git (files: ["dist"] y sin
# script prepare); cuando lo tenga, pasar a una dependencia git y borrar esto.
set -euo pipefail

cd "$(dirname "$0")/.."
SHARED="../guardia-shared"

if [[ ! -f "$SHARED/package.json" ]]; then
  echo "build-shared: no encuentro $SHARED (clonalo junto a guardia-api: git clone https://github.com/constantinostrada/guardia-shared ../guardia-shared)." >&2
  exit 1
fi

if [[ -f "$SHARED/dist/index.js" && -f "$SHARED/dist/index.d.ts" ]]; then
  exit 0
fi

echo "build-shared: compilando guardia-shared en $SHARED..."
npm --prefix "$SHARED" install --no-audit --no-fund
npm --prefix "$SHARED" run build
