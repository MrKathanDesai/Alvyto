#!/bin/bash
# start.sh — Start Alvyto: backend (8080) + room-agent (8000) + frontend (3000)

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

trap 'echo ""; echo "Shutting down..."; kill $(jobs -p) 2>/dev/null; exit 0' INT TERM

# ── Persistent JWT secret ─────────────────────────────────────────────────────
# Generate once and store in backend/.env so tokens survive restarts.
BACKEND_ENV="$ROOT/backend/.env"
if [ -f "$BACKEND_ENV" ]; then
  set -a; source "$BACKEND_ENV"; set +a
fi
if [ -z "$JWT_SECRET_KEY" ]; then
  JWT_SECRET_KEY=$(/opt/homebrew/Cellar/python@3.11/3.11.14_1/Frameworks/Python.framework/Versions/3.11/Resources/Python.app/Contents/MacOS/Python -c "import secrets; print(secrets.token_hex(32))")
  echo "JWT_SECRET_KEY=$JWT_SECRET_KEY" >> "$BACKEND_ENV"
  echo "[backend]  Generated new JWT_SECRET_KEY → backend/.env"
fi
export JWT_SECRET_KEY

# ── Backend ───────────────────────────────────────────────────────────────────
echo "[backend]  starting on http://localhost:8080"
(
  cd "$ROOT"
  export JWT_SECRET_KEY
  [ -f .env ] && export $(grep -v '^#' .env | xargs)
  backend/venv/bin/uvicorn backend.server:app --host 127.0.0.1 --port 8080
) >"$LOGS/backend.log" 2>&1 &
BACKEND_PID=$!

# ── Room-agent (AI pipeline) ──────────────────────────────────────────────────
echo "[room-agent] starting on http://localhost:8000"
(
  cd "$ROOT/room-agent"
  [ -f .env ] && export $(grep -v '^#' .env | xargs)
  source venv/bin/activate
  uvicorn server:app --host 127.0.0.1 --port 8000
) >"$LOGS/room-agent.log" 2>&1 &
AGENT_PID=$!

# ── Frontend ──────────────────────────────────────────────────────────────────
echo "[frontend] starting on http://localhost:3000"
(
  cd "$ROOT"
  [ -f .env.local ] && export $(grep -v '^#' .env.local | xargs)
  npm run dev
) >"$LOGS/frontend.log" 2>&1 &
FRONTEND_PID=$!

echo ""
echo "All services started. Logs in .logs/"
echo "  backend   → .logs/backend.log"
echo "  room-agent → .logs/room-agent.log"
echo "  frontend  → .logs/frontend.log"
echo ""
echo "Press Ctrl+C to stop everything."
echo ""

# Wait and surface any immediate crash
sleep 4
for name in "backend:$BACKEND_PID" "room-agent:$AGENT_PID" "frontend:$FRONTEND_PID"; do
  svc="${name%%:*}"
  pid="${name##*:}"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "WARNING: $svc crashed on startup — check .logs/$svc.log"
  fi
done

wait
