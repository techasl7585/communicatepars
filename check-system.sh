#!/usr/bin/env bash

set -u

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ERRORS=0
WARNINGS=0

ok() {
  printf '[TAMAM] %s\n' "$1"
}

error() {
  printf '[HATA] %s\n' "$1" >&2
  ERRORS=$((ERRORS + 1))
}

warning() {
  printf '[UYARI] %s\n' "$1" >&2
  WARNINGS=$((WARNINGS + 1))
}

check_command() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    ok "$command_name: $(command -v "$command_name")"
  else
    error "$command_name bulunamadı"
  fi
}

printf '[CommunicatePars] Sistem kontrolü\n'
printf 'Proje: %s\n' "$PROJECT_DIR"
printf 'Mimari: %s\n' "$(uname -m)"

if [ "$(uname -m)" = "x86_64" ]; then
  ok "hidclient mimarisi uyumlu (x86_64)"
else
  error "Paketteki hidclient x86_64; bu bilgisayar $(uname -m)"
fi

for command_name in node npm curl pkexec bluetoothctl nmcli upower xinput; do
  check_command "$command_name"
done


BLUETOOTHD_PATH="$(command -v bluetoothd 2>/dev/null || true)"
if [ -z "$BLUETOOTHD_PATH" ]; then
  for candidate in \
    /usr/libexec/bluetooth/bluetoothd \
    /usr/lib/bluetooth/bluetoothd \
    /usr/sbin/bluetoothd; do
    if [ -x "$candidate" ]; then
      BLUETOOTHD_PATH="$candidate"
      break
    fi
  done
fi
if [ -n "$BLUETOOTHD_PATH" ]; then
  ok "bluetoothd: $BLUETOOTHD_PATH"
else
  error "bluetoothd bulunamadı"
fi

if command -v bluetoothctl >/dev/null 2>&1; then
  if bluetoothctl list 2>/dev/null | grep -q '^Controller '; then
    ok "Bluetooth adaptörü algılandı"
  else
    error "Bluetooth adaptörü algılanmadı veya devre dışı"
  fi

  BLUETOOTH_SHOW="$(bluetoothctl show 2>/dev/null || true)"
  BLUETOOTH_CLASS="$(printf '%s\n' "$BLUETOOTH_SHOW" | awk '/Class:/ {print $2; exit}')"
  if [[ "$BLUETOOTH_CLASS" =~ ^0x[0-9A-Fa-f]+$ ]] &&
     [ $((BLUETOOTH_CLASS & 0x1FFC)) -eq $((0x05C0)) ]; then
    ok "Bluetooth sınıfı çevre birimi: klavye + işaretçi ($BLUETOOTH_CLASS)"
  else
    error "Bluetooth çalışma sınıfı 0x0005C0 değil (mevcut: ${BLUETOOTH_CLASS:-okunamadı}); ./install-pardus.sh çalıştırın"
  fi
fi

if grep -Eq '^[[:space:]]*Class[[:space:]]*=[[:space:]]*0x0005[Cc]0' /etc/bluetooth/main.conf 2>/dev/null; then
  ok "BlueZ kalıcı çevre birimi sınıfı ayarlı"
else
  error "BlueZ çevre birimi sınıfı eksik; ./install-pardus.sh çalıştırın"
fi

if command -v node >/dev/null 2>&1; then
  if node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
    process.exit(ok ? 0 : 1);
  '; then
    ok "Node.js sürümü: $(node --version)"
  else
    error "Node.js sürümü desteklenmiyor: $(node --version). En az 20.19 veya 22.12 gerekli."
  fi
fi

HIDCLIENT="$PROJECT_DIR/tools/hidclient/hidclient"
if [ -x "$HIDCLIENT" ]; then
  ok "hidclient bulundu ve çalıştırılabilir"
  if command -v ldd >/dev/null 2>&1; then
    MISSING_LIBS="$(ldd "$HIDCLIENT" 2>/dev/null | awk '/not found/{print $1}' | paste -sd ', ' -)"
    if [ -n "$MISSING_LIBS" ]; then
      error "hidclient kitaplıkları eksik: $MISSING_LIBS"
    else
      ok "hidclient sistem kitaplıkları hazır"
    fi
  fi
else
  error "hidclient yok veya çalıştırma izni bulunmuyor: $HIDCLIENT"
fi

if [ -d "$PROJECT_DIR/server/node_modules/express" ] &&
   [ -d "$PROJECT_DIR/server/node_modules/multer" ]; then
  ok "Sunucu npm paketleri kurulu"
else
  error "Sunucu npm paketleri eksik; ./install-pardus.sh çalıştırın"
fi

if [ -x "$PROJECT_DIR/desktop/node_modules/.bin/electron" ]; then
  ok "Masaüstü npm paketleri kurulu"
else
  error "Masaüstü npm paketleri eksik; ./install-pardus.sh çalıştırın"
fi

ELECTRON_BINARY="$PROJECT_DIR/desktop/node_modules/electron/dist/electron"
if [ -x "$ELECTRON_BINARY" ]; then
  if command -v ldd >/dev/null 2>&1; then
    ELECTRON_MISSING_LIBS="$(ldd "$ELECTRON_BINARY" 2>/dev/null | awk '/not found/{print $1}' | paste -sd ', ' -)"
    if [ -n "$ELECTRON_MISSING_LIBS" ]; then
      error "Electron kitaplıkları eksik: $ELECTRON_MISSING_LIBS"
    else
      ok "Electron sistem kitaplıkları hazır"
    fi
  fi
else
  error "Electron çalıştırma dosyası eksik; ./install-pardus.sh komutunu yeniden çalıştırın"
fi

if [ -f "$PROJECT_DIR/desktop/dist/index.html" ]; then
  ok "Masaüstü uygulaması derlenmiş"
else
  error "desktop/dist eksik; ./install-pardus.sh çalıştırın"
fi

if node --check "$PROJECT_DIR/server/index.js" >/dev/null 2>&1; then
  ok "Sunucu JavaScript sözdizimi geçerli"
else
  error "server/index.js sözdizimi hatalı"
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet bluetooth.service 2>/dev/null; then
    ok "Bluetooth servisi çalışıyor"
  else
    error "Bluetooth servisi çalışmıyor"
  fi

  BLUETOOTH_EXEC_START="$(systemctl show bluetooth.service -p ExecStart --value 2>/dev/null || true)"
  if [[ "$BLUETOOTH_EXEC_START" == *"--compat"* ]] &&
     { [[ "$BLUETOOTH_EXEC_START" == *"--noplugin=input,hostname"* ]] ||
       [[ "$BLUETOOTH_EXEC_START" == *"-P input,hostname"* ]]; }; then
    ok "Bluetooth HID uyumluluk modu etkin; PC sınıfını ezen hostname eklentisi kapalı"
  else
    error "Bluetooth HID uyumluluk modu eksik (input,hostname kapalı olmalı); ./install-pardus.sh çalıştırın"
  fi
fi

if [ -e /dev/uinput ] && [ -w /dev/uinput ]; then
  ok "Weylus uinput aygıtı kullanılabilir"
else
  error "Weylus için /dev/uinput yazma izni yok; kurulumu tekrar çalıştırıp oturumu kapatıp açın"
fi

if command -v weylus >/dev/null 2>&1; then
  ok "Weylus yerel paket olarak kurulu"
elif command -v flatpak >/dev/null 2>&1 &&
     flatpak info io.github.electronstudio.WeylusCommunityEdition >/dev/null 2>&1; then
  ok "Weylus Community Edition Flatpak kurulu"
else
  error "Weylus kurulu değil; ./install-pardus.sh çalıştırın"
fi

if [ -n "${DISPLAY:-}" ]; then
  ok "Grafik ekranı: $DISPLAY"
else
  warning "DISPLAY tanımlı değil; betiği grafik masaüstünde normal kullanıcı olarak çalıştırın"
fi

for optional_command in adb scrcpy uxplay; do
  if command -v "$optional_command" >/dev/null 2>&1; then
    ok "İsteğe bağlı $optional_command kurulu"
  else
    warning "İsteğe bağlı $optional_command kurulu değil; ilgili özellik kullanılamaz"
  fi
done

printf '\nSonuç: %d hata, %d uyarı\n' "$ERRORS" "$WARNINGS"

if [ "$ERRORS" -gt 0 ]; then
  printf 'Düzeltmek için: %s/install-pardus.sh\n' "$PROJECT_DIR"
  exit 1
fi

printf 'Sistem hazır. Başlatmak için: %s/start-communicatepars.sh\n' "$PROJECT_DIR"
