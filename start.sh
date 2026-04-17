#!/bin/bash
# start.sh — Alvyto: backend (8080) · room-agent (8000) · frontend (3000)
# Run from anywhere: ./start.sh or cd alvyto && ./start.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

# ── Colours ───────────────────────────────────────────────────────────────────
RESET="\033[0m"
BOLD="\033[1m"
DIM="\033[2m"
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
CYAN="\033[36m"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

resolve_python() {
  local candidate
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command_exists "$candidate"; then
      local major
      local minor
      major="$($candidate -c 'import sys; print(sys.version_info[0])' 2>/dev/null || echo 0)"
      minor="$($candidate -c 'import sys; print(sys.version_info[1])' 2>/dev/null || echo 0)"
      if [[ "$major" -eq 3 && "$minor" -ge 10 ]]; then
        echo "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

load_env_file() {
  local file_path="$1"
  if [[ -f "$file_path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file_path"
    set +a
  fi
}

PYTHON_BIN="$(resolve_python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  echo -e "${RED}Python 3.10+ is required but not installed.${RESET}"
  exit 1
fi

if ! command_exists npm; then
  echo -e "${RED}npm is required but not installed.${RESET}"
  exit 1
fi

if ! command_exists lsof; then
  echo -e "${RED}lsof is required but not installed.${RESET}"
  exit 1
fi

if ! command_exists curl; then
  echo -e "${RED}curl is required but not installed.${RESET}"
  exit 1
fi

if [[ -x "$ROOT/backend/venv/bin/uvicorn" ]]; then
  BACKEND_VENV="$ROOT/backend/venv"
elif [[ -x "$ROOT/venv/bin/uvicorn" ]]; then
  BACKEND_VENV="$ROOT/venv"
else
  BACKEND_VENV=""
fi

if [[ -x "$ROOT/room-agent/venv/bin/uvicorn" ]]; then
  ROOM_AGENT_VENV="$ROOT/room-agent/venv"
else
  ROOM_AGENT_VENV=""
fi

_prefix() { local label="$1" color="$2"; sed "s/^/${color}[${label}]${RESET} /"; }

# ── Clean shutdown ─────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo -e "${DIM}Shutting down…${RESET}"
  # Kill the tail process group so the log tails die too
  kill -- -$$ 2>/dev/null || true
  # Kill tracked PIDs
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo -e "${DIM}All services stopped.${RESET}"
}
trap cleanup INT TERM

PIDS=()

# ── Port conflict check ───────────────────────────────────────────────────────
for port in 8080 8000 3000; do
  if lsof -ti ":$port" &>/dev/null; then
    echo -e "${YELLOW}Warning: port $port already in use — killing existing process${RESET}"
    lsof -ti ":$port" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
done

# ── Persistent JWT secret ─────────────────────────────────────────────────────
BACKEND_ENV="$ROOT/backend/.env"
load_env_file "$BACKEND_ENV"
if [ -z "${JWT_SECRET_KEY:-}" ]; then
  JWT_SECRET_KEY=$($PYTHON_BIN -c "import secrets; print(secrets.token_hex(32))")
  echo "JWT_SECRET_KEY=$JWT_SECRET_KEY" >> "$BACKEND_ENV"
  echo -e "${DIM}[backend]  Generated new JWT_SECRET_KEY → backend/.env${RESET}"
fi
export JWT_SECRET_KEY

# ── Auto-seed database if empty ───────────────────────────────────────────────
if [[ -f "$ROOT/emr.db" && ! -f "$ROOT/backend/emr.db" ]]; then
  echo -e "${YELLOW}Found legacy DB at repo root. Moving to backend/emr.db${RESET}"
  mv "$ROOT/emr.db" "$ROOT/backend/emr.db"
fi

DB="$ROOT/backend/emr.db"
ADMIN_COUNT=$($PYTHON_BIN -c "
import sqlite3, sys
try:
  c = sqlite3.connect('$DB').cursor()
  c.execute('SELECT COUNT(*) FROM admin_users')
  print(c.fetchone()[0])
except: print(0)
" 2>/dev/null)
if [ "${ADMIN_COUNT:-0}" -eq 0 ]; then
  echo -e "${DIM}[backend]  Database is empty — seeding demo data…${RESET}"
  if [[ -z "$BACKEND_VENV" || ! -x "$BACKEND_VENV/bin/python" ]]; then
    echo -e "${YELLOW}Warning: backend virtual env missing; skipping auto-seed.${RESET}"
  else
    (cd "$ROOT" && "$BACKEND_VENV/bin/python" -m backend.seed >> "$LOGS/backend.log" 2>&1) || \
    echo -e "${YELLOW}Warning: seed failed — check .logs/backend.log${RESET}"
  fi
fi

if [[ -z "$BACKEND_VENV" ]]; then
  echo -e "${RED}Missing backend venv. Expected backend/venv or venv with uvicorn installed.${RESET}"
  echo -e "${YELLOW}Run ./setup_and_run.sh once to bootstrap this machine.${RESET}"
  exit 1
fi

if [[ -z "$ROOM_AGENT_VENV" ]]; then
  echo -e "${RED}Missing room-agent venv at room-agent/venv.${RESET}"
  echo -e "${YELLOW}Run ./setup_and_run.sh once to bootstrap this machine.${RESET}"
  exit 1
fi

# ── Backend ───────────────────────────────────────────────────────────────────
echo -e "${BLUE}${BOLD}[backend]${RESET}    starting on http://localhost:8080"
(
  cd "$ROOT"
  export JWT_SECRET_KEY
  load_env_file "$ROOT/.env"
  exec "$BACKEND_VENV/bin/uvicorn" backend.server:app --host 127.0.0.1 --port 8080
) >"$LOGS/backend.log" 2>&1 &
PIDS+=($!)

# ── Room-agent ────────────────────────────────────────────────────────────────
echo -e "${CYAN}${BOLD}[room-agent]${RESET} starting on http://localhost:8000"
(
  cd "$ROOT/room-agent"
  load_env_file "$ROOT/room-agent/.env"
  source "$ROOM_AGENT_VENV/bin/activate"
  # Suppress harmless deprecation warnings from pyannote/torchaudio/torchcodec
  export PYTHONWARNINGS="ignore"
  exec "$ROOM_AGENT_VENV/bin/uvicorn" server:app --host 127.0.0.1 --port 8000
) >"$LOGS/room-agent.log" 2>&1 &
PIDS+=($!)

# ── Frontend ──────────────────────────────────────────────────────────────────
echo -e "${GREEN}${BOLD}[frontend]${RESET}   starting on http://localhost:3000"
(
  cd "$ROOT"
  load_env_file "$ROOT/.env.local"
  exec npm run dev
) >"$LOGS/frontend.log" 2>&1 &
PIDS+=($!)

# ── Wait for readiness ────────────────────────────────────────────────────────
echo ""
echo -e "${DIM}Waiting for services to come up…${RESET}"

_wait_http() {
  local name="$1" url="$2" max="${3:-30}"
  local i=0
  while true; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    # Accept any HTTP response (even 401/403) — means the server is up
    if [[ "$code" =~ ^[1-9][0-9][0-9]$ ]]; then
      break
    fi
    sleep 1
    i=$((i+1))
    [ "$i" -ge "$max" ] && echo -e "${RED}[${name}] did not respond after ${max}s — check .logs/${name}.log${RESET}" && return 1
  done
  echo -e "${GREEN}[${name}]${RESET} ready ✓"
}

_wait_http "backend"    "http://127.0.0.1:8080/health"  30 &
READINESS_PID_1=$!
_wait_http "room-agent" "http://127.0.0.1:8000/health"  60 &
READINESS_PID_2=$!
# Next.js takes longer; wait for the Next.js dev server to print its ready line
(
  tail -f "$LOGS/frontend.log" 2>/dev/null | while IFS= read -r line; do
    if echo "$line" | grep -q "Ready\|started server\|Local.*3000"; then
      echo -e "${GREEN}[frontend]${RESET} ready ✓"
      break
    fi
  done
) &
READINESS_PID_3=$!

wait "$READINESS_PID_1" "$READINESS_PID_2" "$READINESS_PID_3"

echo ""
echo -e "${BOLD}All services up.${RESET}"
echo -e "  ${BLUE}Backend${RESET}    → http://localhost:8080"
echo -e "  ${CYAN}Room-agent${RESET} → http://localhost:8000"
echo -e "  ${GREEN}Frontend${RESET}   → http://localhost:3000"
echo ""
echo -e "${DIM}Logs: .logs/backend.log · .logs/room-agent.log · .logs/frontend.log${RESET}"
echo -e "${DIM}Press Ctrl+C to stop everything.${RESET}"
echo ""

# ── Tail logs to terminal with colour-coded prefixes ─────────────────────────
tail -f "$LOGS/backend.log"    2>/dev/null | _prefix "backend"    "$BLUE"   &
tail -f "$LOGS/room-agent.log" 2>/dev/null | _prefix "room-agent" "$CYAN"   &
tail -f "$LOGS/frontend.log"   2>/dev/null | _prefix "frontend"   "$GREEN"  &

# ── Crash monitor: surface early exits ───────────────────────────────────────
(
  sleep 10
  names=("backend" "room-agent" "frontend")
  for i in 0 1 2; do
    pid="${PIDS[$i]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      echo -e "${RED}WARNING: ${names[$i]} exited unexpectedly — check .logs/${names[$i]}.log${RESET}"
    fi
  done
) &

wait "${PIDS[@]}"
