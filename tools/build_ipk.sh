#!/bin/sh
# Builds the app and packages it as an .ipk in build/ (or $LUMEN_BUILD_DIR). Run from anywhere: npm run build:ipk
# App id, title and whether app/private/ is included come from .env (see .env.example); the default is the dev build.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/tools/env.sh"
cd "$ROOT/app"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build
LUMEN_BUILD_DIR=${LUMEN_BUILD_DIR:-$ROOT/build} sh scripts/package.sh
