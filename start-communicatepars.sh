#!/bin/bash

PROJECT_DIR="$HOME/Projeler/communicatepars"
SERVER_DIR="$PROJECT_DIR/server"
DESKTOP_DIR="$PROJECT_DIR/desktop"
LOG_DIR="$PROJECT_DIR/logs"

mkdir -p "$LOG_DIR"

# Backend zaten çalışmıyorsa başlat.
if ! curl -fsS "http://127.0.0.1:5050/" >/dev/null 2>&1; then
  cd "$SERVER_DIR" || exit 1

  nohup node index.js \
    > "$LOG_DIR/server.log" \
    2>&1 &

  SERVER_PID=$!
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
  zenity --error \
    --title="CommunicatePars" \
    --text="CommunicatePars sunucusu başlatılamadı. Ayrıntılar: $LOG_DIR/server.log"

  exit 1
fi

# Electron uygulamasını başlat.
cd "$DESKTOP_DIR" || exit 1
npm run desktop
