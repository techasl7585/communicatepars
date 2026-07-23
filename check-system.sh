#!/usr/bin/env bash

set -u

# Pardus masaüstü terminalinde /usr/sbin kullanıcı PATH'inde olmayabilir.
# Kurulu iw/btmgmt gibi araçları yanlışlıkla eksik sayma.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALLED_DIR="$HOME/.local/opt/communicatepars"
[ ! -d "$INSTALLED_DIR" ] || INSTALLED_DIR="$(cd -- "$INSTALLED_DIR" && pwd -P)"

if [ "$PROJECT_DIR" != "$INSTALLED_DIR" ] &&
   [ -x "$INSTALLED_DIR/check-system.sh" ]; then
  exec "$INSTALLED_DIR/check-system.sh" "$@"
fi

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

if [ "$PROJECT_DIR" = "$INSTALLED_DIR" ]; then
  ok "Uygulama sabit kullanıcı dizinine kurulu"
else
  error "Uygulama sabit kullanıcı dizinine kurulmamış; ./install-pardus.sh çalıştırın"
fi

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_LAUNCHER="$HOME/.local/bin/communicatepars"
DESKTOP_ENTRY="$DATA_HOME/applications/communicatepars.desktop"
APP_ICON="$DATA_HOME/icons/hicolor/256x256/apps/communicatepars.png"

if [ -x "$APP_LAUNCHER" ]; then
  ok "CommunicatePars komut başlatıcısı hazır"
else
  error "CommunicatePars komut başlatıcısı eksik"
fi
if [ -f "$DESKTOP_ENTRY" ]; then
  ok "CommunicatePars uygulamalar menüsüne kayıtlı"
else
  error "CommunicatePars uygulama menüsü kaydı eksik"
fi
if [ -f "$APP_ICON" ]; then
  ok "CommunicatePars uygulama simgesi kurulu"
else
  error "CommunicatePars uygulama simgesi eksik"
fi

if [ "$(uname -m)" = "x86_64" ]; then
  ok "hidclient mimarisi uyumlu (x86_64)"
else
  error "Paketteki hidclient x86_64; bu bilgisayar $(uname -m)"
fi

for command_name in node npm curl pkexec bluetoothctl nmcli upower xinput \
  adb scrcpy uxplay flatpak gst-inspect-1.0 avahi-browse iw btmgmt; do
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
  if "$HIDCLIENT" --help 2>/dev/null | grep -Fq -- '--rotate-cw'; then
    ok "hidclient dikey iPhone eksen düzeltmesini destekliyor"
  else
    error "hidclient dikey iPhone desteği olmadan derlenmiş; ./install-pardus.sh çalıştırın"
  fi
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

  if systemctl is-active --quiet NetworkManager.service 2>/dev/null; then
    ok "NetworkManager servisi çalışıyor"
  else
    error "NetworkManager servisi çalışmıyor"
  fi

  if systemctl is-active --quiet avahi-daemon.service 2>/dev/null; then
    ok "Avahi mDNS servisi çalışıyor"
  else
    error "Avahi mDNS servisi çalışmıyor; iPad UxPlay'i bulamaz"
  fi
fi

if [ -e /dev/uinput ] && [ -w /dev/uinput ]; then
  ok "Weylus uinput aygıtı kullanılabilir"
else
  error "Weylus için /dev/uinput yazma izni yok; kurulumu tekrar çalıştırıp oturumu kapatıp açın"
fi

if grep -q '^uinput$' /etc/modules-load.d/communicatepars-uinput.conf 2>/dev/null; then
  ok "uinput yeniden başlatmada otomatik yüklenecek"
else
  error "uinput kalıcı yükleme ayarı eksik"
fi

UINPUT_GROUP="$(getent group uinput 2>/dev/null || true)"
UINPUT_MEMBERS="${UINPUT_GROUP##*:}"
case ",${UINPUT_MEMBERS}," in
  *,"$(id -un)",*) ok "Kullanıcı uinput grubunda" ;;
  *) error "$(id -un) kullanıcısı uinput grubunda değil" ;;
esac

if command -v weylus >/dev/null 2>&1; then
  ok "Weylus yerel paket olarak kurulu"
elif command -v flatpak >/dev/null 2>&1 &&
     flatpak info --user io.github.electronstudio.WeylusCommunityEdition >/dev/null 2>&1; then
  ok "Weylus Community Edition Flatpak kurulu"
else
  error "Weylus kurulu değil; ./install-pardus.sh çalıştırın"
fi

if command -v gst-inspect-1.0 >/dev/null 2>&1; then
  for gst_element in h264parse avdec_h264 avdec_aac autovideosink autoaudiosink; do
    if gst-inspect-1.0 "$gst_element" >/dev/null 2>&1; then
      ok "GStreamer öğesi hazır: $gst_element"
    else
      error "GStreamer öğesi eksik: $gst_element"
    fi
  done
fi

if command -v adb >/dev/null 2>&1 && adb version >/dev/null 2>&1; then
  ok "ADB çalışıyor"
fi

if dpkg-query -W -f='${Status}' android-sdk-platform-tools-common 2>/dev/null |
   grep -q 'install ok installed'; then
  ok "Android USB udev kuralları kurulu"
else
  error "Android USB udev kuralları eksik"
fi

if command -v scrcpy >/dev/null 2>&1; then
  SCRCPY_PATH="$(readlink -f "$(command -v scrcpy)" 2>/dev/null || command -v scrcpy)"
  SCRCPY_MISSING_LIBS="$(ldd "$SCRCPY_PATH" 2>/dev/null | awk '/not found/{print $1}' | paste -sd ', ' -)"
  if [ -n "$SCRCPY_MISSING_LIBS" ]; then
    error "scrcpy kitaplıkları eksik: $SCRCPY_MISSING_LIBS"
  elif scrcpy --version >/dev/null 2>&1; then
    ok "scrcpy çalışıyor"
  else
    error "scrcpy kurulu ancak çalıştırılamıyor"
  fi
fi

if command -v nmcli >/dev/null 2>&1; then
  if nmcli -t -f DEVICE,TYPE device status 2>/dev/null | grep -q ':wifi$'; then
    ok "Wi-Fi aygıtı algılandı"
  else
    warning "Wi-Fi aygıtı bulunamadı; Pardus Ağı özelliği bu bilgisayarda kullanılamaz"
  fi

  # Bazı sürücüler AP desteğini iw çıktısında bildirmediği hâlde NetworkManager
  # hotspot açabilir. Bu yüzden burada kurulum kesilmez; gerçek sonucu uygulama
  # içindeki Pardus Ağını Aç işlemi belirler.
  if command -v iw >/dev/null 2>&1 &&
     iw list 2>/dev/null | grep -Eq '^[[:space:]]+\* AP$'; then
    ok "Wi-Fi aygıtı erişim noktası (AP) modunu bildiriyor"
  else
    warning "Wi-Fi AP yeteneği iw ile doğrulanamadı; çalışan NetworkManager hotspot akışı korunuyor"
  fi
fi

if [ -n "${DISPLAY:-}" ]; then
  ok "Grafik ekranı: $DISPLAY"
else
  warning "DISPLAY tanımlı değil; betiği grafik masaüstünde normal kullanıcı olarak çalıştırın"
fi

printf '\nSonuç: %d hata, %d uyarı\n' "$ERRORS" "$WARNINGS"

if [ "$ERRORS" -gt 0 ]; then
  printf 'Düzeltmek için: %s/install-pardus.sh\n' "$PROJECT_DIR"
  exit 1
fi

printf 'Sistem hazır. Başlatmak için: %s/start-communicatepars.sh\n' "$PROJECT_DIR"
