#!/usr/bin/env bash

set -u

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$PROJECT_DIR/server"
DESKTOP_DIR="$PROJECT_DIR/desktop"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/communicatepars"

show_error() {
  local message="$1"
  if command -v zenity >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    zenity --error --title="CommunicatePars" --text="$message"
  else
    echo "HATA: $message" >&2
  fi
}

for command_name in node npm curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    show_error "$command_name bulunamadı. Önce şu komutu çalıştırın: ./install-pardus.sh"
    exit 1
  fi
done

if [ ! -d "$SERVER_DIR/node_modules/express" ] || [ ! -x "$DESKTOP_DIR/node_modules/.bin/electron" ]; then
  show_error "Uygulama paketleri kurulu değil. Önce şu komutu çalıştırın: ./install-pardus.sh"
  exit 1
fi

if [ ! -f "$DESKTOP_DIR/dist/index.html" ]; then
  show_error "Masaüstü uygulaması derlenmemiş. Önce şu komutu çalıştırın: ./install-pardus.sh"
  exit 1
fi

mkdir -p "$LOG_DIR"

STARTED_SERVER=0
SERVER_PID=""

cleanup() {
  if [ "$STARTED_SERVER" -eq 1 ] && [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

# Backend zaten çalışmıyorsa başlat.
if ! curl -fsS "http://127.0.0.1:5050/" >/dev/null 2>&1; then
  cd "$SERVER_DIR" || exit 1

  nohup node index.js \
    > "$LOG_DIR/server.log" \
    2>&1 &

  SERVER_PID=$!
  STARTED_SERVER=1
  echo "$SERVER_PID" > "$LOG_DIR/server.pid"

  # Sunucunun açılmasını en fazla 10 saniye bekle.
  for i in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:5050/" >/dev/null 2>&1; then
      break
    fi

    sleep 0.5
  done
fi

# Backend başlatılamadıysa kullanıcıya hata göster.
if ! curl -fsS "http://127.0.0.1:5050/" >/dev/null 2>&1; then
  show_error "CommunicatePars sunucusu başlatılamadı. Ayrıntılar: $LOG_DIR/server.log"
  exit 1
fi

# Electron uygulamasını başlat.
cd "$DESKTOP_DIR" || exit 1
npm start
