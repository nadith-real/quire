#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ ! -d backend/node_modules ]; then
  (cd backend && npm install)
fi
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

mkdir -p vault

# Start backend server in background
(cd backend && npm run dev) &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start frontend server (this will be the exposed port)
cd frontend && npm run dev
