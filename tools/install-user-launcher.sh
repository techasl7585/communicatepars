#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="${1:-}"
TARGET_HOME="${2:-}"

if [ -z "$PROJECT_DIR" ] || [ -z "$TARGET_HOME" ]; then
  printf 'Kullanım: %s PROJE_DIZINI KULLANICI_EV_DIZINI\n' "$0" >&2
  exit 2
fi

PROJECT_DIR="$(cd -- "$PROJECT_DIR" && pwd -P)"
TARGET_HOME="$(cd -- "$TARGET_HOME" && pwd -P)"

START_SCRIPT="$PROJECT_DIR/start-communicatepars.sh"
ICON_SOURCE="$PROJECT_DIR/desktop/src/assets/logo.png"
DATA_HOME="${XDG_DATA_HOME:-$TARGET_HOME/.local/share}"
BIN_DIR="$TARGET_HOME/.local/bin"
APPLICATIONS_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/256x256/apps"
LAUNCHER="$BIN_DIR/communicatepars"
DESKTOP_ENTRY="$APPLICATIONS_DIR/communicatepars.desktop"
ICON_TARGET="$ICON_DIR/communicatepars.png"

[ -x "$START_SCRIPT" ] || {
  printf 'Başlatma betiği bulunamadı veya çalıştırılabilir değil: %s\n' "$START_SCRIPT" >&2
  exit 3
}
[ -f "$ICON_SOURCE" ] || {
  printf 'Uygulama simgesi bulunamadı: %s\n' "$ICON_SOURCE" >&2
  exit 4
}

mkdir -p "$BIN_DIR" "$APPLICATIONS_DIR" "$ICON_DIR"

{
  printf '#!/usr/bin/env bash\n'
  printf 'exec %q "$@"\n' "$START_SCRIPT"
} > "$LAUNCHER"
chmod 0755 "$LAUNCHER"

install -m 0644 "$ICON_SOURCE" "$ICON_TARGET"

ESCAPED_LAUNCHER="${LAUNCHER//\\/\\\\}"
ESCAPED_LAUNCHER="${ESCAPED_LAUNCHER//\"/\\\"}"
cat > "$DESKTOP_ENTRY" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=CommunicatePars
Comment=Android, iOS ve Pardus cihaz bağlantı merkezi
Exec="$ESCAPED_LAUNCHER"
Icon=communicatepars
Terminal=false
Categories=Utility;Network;RemoteAccess;
StartupNotify=true
EOF
chmod 0644 "$DESKTOP_ENTRY"

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$DESKTOP_ENTRY"
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true
fi

DESKTOP_SHORTCUT=""
if [ "${COMMUNICATEPARS_CREATE_DESKTOP_SHORTCUT:-1}" != "0" ] &&
   command -v xdg-user-dir >/dev/null 2>&1; then
  if command -v xdg-user-dirs-update >/dev/null 2>&1; then
    HOME="$TARGET_HOME" xdg-user-dirs-update >/dev/null 2>&1 || true
  fi
  DESKTOP_DIR="$(HOME="$TARGET_HOME" xdg-user-dir DESKTOP 2>/dev/null || true)"
  if [ -n "$DESKTOP_DIR" ] && [ "$DESKTOP_DIR" != "$TARGET_HOME" ] &&
     [[ "$DESKTOP_DIR" == "$TARGET_HOME/"* ]]; then
    mkdir -p "$DESKTOP_DIR"
    DESKTOP_SHORTCUT="$DESKTOP_DIR/CommunicatePars.desktop"
    install -m 0755 "$DESKTOP_ENTRY" "$DESKTOP_SHORTCUT"
    if command -v gio >/dev/null 2>&1; then
      gio set "$DESKTOP_SHORTCUT" metadata::trusted true >/dev/null 2>&1 || true
    fi
  fi
fi

printf 'Uygulama menüsü: %s\n' "$DESKTOP_ENTRY"
printf 'Komut başlatıcısı: %s\n' "$LAUNCHER"
if [ -n "$DESKTOP_SHORTCUT" ]; then
  printf 'Masaüstü kısayolu: %s\n' "$DESKTOP_SHORTCUT"
else
  printf 'Masaüstü klasörü bulunamadı; uygulama menüsü kaydı hazır.\n'
fi
