#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[INFO]${NC} $*"
}

ok() {
  echo -e "${GREEN}[OK]${NC} $*"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $*"
}

err() {
  echo -e "${RED}[ERROR]${NC} $*"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

BACKEND_LOG="/tmp/alvyto-backend.log"
ROOM_AGENT_LOG="/tmp/alvyto-room-agent.log"
FRONTEND_LOG="/tmp/alvyto-frontend.log"

remove_pid() {
  local target="$1"
  local remaining=()
  local p
  for p in "${PIDS[@]:-}"; do
    if [[ "$p" != "$target" ]]; then
      remaining+=("$p")
    fi
  done
  PIDS=("${remaining[@]:-}")
}

cleanup() {
  warn "Shutting down services and cleaning up..."

  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  for port in 3000 8000 8080; do
    lsof -ti tcp:"$port" 2>/dev/null | xargs -I{} kill -9 {} 2>/dev/null || true
  done

  exit 0
}

trap cleanup EXIT INT TERM

wait_for_service() {
  local name="$1"
  local url="$2"
  local max_seconds="$3"
  local post_body="${4:-}"

  local elapsed=0
  local http_code="000"

  log "Waiting for ${name} at ${url} (timeout: ${max_seconds}s)"

  while [[ "$elapsed" -lt "$max_seconds" ]]; do
    if [[ -n "$post_body" ]]; then
      http_code="$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$post_body" "$url" || echo "000")"
    else
      http_code="$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")"
    fi

    if [[ "$http_code" != "000" ]]; then
      ok "${name} responded with HTTP ${http_code}"
      return 0
    fi

    echo -n "."
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo
  err "Timeout waiting for ${name} at ${url}"
  return 1
}

start_service() {
  local name="$1"
  local logfile="$2"
  local retries="$3"
  local url="$4"
  local wait_secs="$5"
  local post_body="$6"
  shift 6
  local cmd=("$@")

  local attempt
  for ((attempt = 1; attempt <= retries; attempt++)); do
    log "Starting ${name} (attempt ${attempt}/${retries})"

    : > "$logfile"
    "${cmd[@]}" >"$logfile" 2>&1 &
    local pid=$!
    PIDS+=("$pid")

    if wait_for_service "$name" "$url" "$wait_secs" "$post_body"; then
      ok "${name} started successfully (PID ${pid})"
      return 0
    fi

    warn "${name} failed to start on attempt ${attempt}. Stopping PID ${pid} and retrying..."
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    remove_pid "$pid"
    sleep 3
  done

  err "${name} failed after ${retries} attempts. Last 20 log lines from ${logfile}:"
  tail -n 20 "$logfile" || true
  return 1
}

log "Starting Alvyto EMR stack from ${SCRIPT_DIR}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  err "ffmpeg is required but not installed. Install with: brew install ffmpeg"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  err "node is required but not installed. Install with: brew install node"
  exit 1
fi

if ! command -v python3.11 >/dev/null 2>&1; then
  err "python3.11 is required but not installed. Install with: brew install python@3.11"
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  err "Ollama is required but not installed."
  err "Install with: curl -fsSL https://ollama.com/install.sh | sh"
  err "  or on macOS: brew install ollama"
  exit 1
fi

log "Ensuring Ollama is running..."
if ! ollama list >/dev/null 2>&1; then
  log "Starting Ollama server in background..."
  ollama serve >/tmp/alvyto-ollama.log 2>&1 &
  PIDS+=($!)
  sleep 3
fi

log "Pulling phi4-mini (skipped if already present)..."
ollama pull phi4-mini || true

log "Killing existing processes on ports 3000, 8000, 8080"
for port in 3000 8000 8080; do
  lsof -ti tcp:"$port" 2>/dev/null | xargs -I{} kill -9 {} 2>/dev/null || true
done

log "Clearing stale Next.js dev lock and build cache"
rm -f "${SCRIPT_DIR}/.next/dev/lock"
rm -rf "${SCRIPT_DIR}/.next/cache"

sleep 1

if [[ ! -d "${SCRIPT_DIR}/venv" ]]; then
  log "Creating Python virtual environment"
  python3.11 -m venv "${SCRIPT_DIR}/venv"
fi

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/venv/bin/activate"

log "Installing Backend Python dependencies"
pip install -q -r "${SCRIPT_DIR}/backend/requirements.txt"

if [[ ! -d "${SCRIPT_DIR}/room-agent/venv" ]]; then
  log "Creating Room Agent virtual environment"
  python3.11 -m venv "${SCRIPT_DIR}/room-agent/venv"
fi
log "Installing Room Agent Python dependencies"
"${SCRIPT_DIR}/room-agent/venv/bin/pip" install -q -r "${SCRIPT_DIR}/room-agent/requirements.txt"


log "Installing Node dependencies"
(
  cd "${SCRIPT_DIR}"
  npm install --silent >/dev/null 2>&1
)

if [[ ! -f "${SCRIPT_DIR}/.env.local" ]]; then
  touch "${SCRIPT_DIR}/.env.local"
fi

if ! grep -q '^NEXT_PUBLIC_API_URL=http://localhost:8080$' "${SCRIPT_DIR}/.env.local"; then
  log "Adding NEXT_PUBLIC_API_URL to .env.local"
  echo 'NEXT_PUBLIC_API_URL=http://localhost:8080' >> "${SCRIPT_DIR}/.env.local"
fi

if [[ ! -f "${SCRIPT_DIR}/emr.db" ]]; then
  log "emr.db not found. Seeding database..."
  (
    cd "${SCRIPT_DIR}"
    python3 -m backend.seed
    python3 -m backend.seed_visits
  )
fi

# Resolve backend Python venv — prefer backend/venv, fall back to root venv
if [[ -f "${SCRIPT_DIR}/backend/venv/bin/activate" ]]; then
  BACKEND_VENV="${SCRIPT_DIR}/backend/venv"
elif [[ -f "${SCRIPT_DIR}/venv/bin/activate" ]]; then
  BACKEND_VENV="${SCRIPT_DIR}/venv"
else
  err "No Python venv found for backend. Run: python3 -m venv backend/venv && source backend/venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi
log "Using backend venv: ${BACKEND_VENV}"

BACKEND_POST_BODY='{"email":"admin@clinic.com","password":"admin123"}'
if ! start_service \
  "Backend" \
  "$BACKEND_LOG" \
  3 \
  "http://localhost:8080/health" \
  30 \
  "" \
  bash -c "cd '$SCRIPT_DIR' && source '${BACKEND_VENV}/bin/activate' && python3 -m backend.server"
then
  err "Backend failed to start. Exiting."
  exit 1
fi

log "Starting Room Agent (WhisperX initialization may take 1-2 mins)..."
if ! start_service \
  "Room Agent" \
  "$ROOM_AGENT_LOG" \
  3 \
  "http://127.0.0.1:8000/health" \
  180 \
  "" \
  bash -c "cd '$SCRIPT_DIR/room-agent' && source '$SCRIPT_DIR/room-agent/venv/bin/activate' && uvicorn server:app --host 127.0.0.1 --port 8000"
then
  warn "Room Agent failed to start. Check $ROOM_AGENT_LOG. Continuing without Room Agent."
fi

if ! start_service \
  "Frontend" \
  "$FRONTEND_LOG" \
  3 \
  "http://localhost:3000" \
  90 \
  "" \
  bash -c "cd '$SCRIPT_DIR' && npm run dev"
then
  err "Frontend failed to start. Exiting."
  exit 1
fi

echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║                     Alvyto EMR Stack Ready                  ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║${NC} Frontend:    ${BLUE}http://localhost:3000${NC}                              ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC} Backend:     ${BLUE}http://localhost:8080${NC}                              ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC} Room Agent:  ${BLUE}http://127.0.0.1:8000${NC}                             ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC} Login:       ${YELLOW}admin@clinic.com / admin123${NC}                     ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC} Stop:        ${YELLOW}Press Ctrl+C to shut everything down${NC}              ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

log "Tailing service logs"
tail -f "$BACKEND_LOG" &
PIDS+=("$!")
tail -f "$ROOM_AGENT_LOG" &
PIDS+=("$!")
tail -f "$FRONTEND_LOG" &
PIDS+=("$!")

wait
