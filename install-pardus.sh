#!/usr/bin/env bash

set -Eeuo pipefail

# Pardus grafik oturumlarında /usr/sbin her zaman kullanıcı PATH'ine ekli
# olmayabilir. iw gibi kurulu sistem araçlarının yanlışlıkla "bulunamadı"
# sayılmaması için standart sistem yollarını baştan ekle.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

info() {
  printf '\n[CommunicatePars] %s\n' "$1"
}

warning() {
  printf '[UYARI] %s\n' "$1" >&2
}

fail() {
  printf '[HATA] %s\n' "$1" >&2
  exit 1
}

if [ ! -f /etc/debian_version ]; then
  fail "Bu kurulum betiği Pardus/Debian tabanlı sistemler içindir."
fi

if [ "$(uname -m)" != "x86_64" ]; then
  fail "Paketteki hidclient yalnızca x86_64 için derlenmiş. Algılanan mimari: $(uname -m)"
fi

if ! command -v sudo >/dev/null 2>&1; then
  fail "sudo bulunamadı."
fi

if [ "$(id -u)" -eq 0 ]; then
  fail "Kurulum betiğini sudo ile başlatmayın. Normal kullanıcı olarak ./install-pardus.sh çalıştırın; gerektiğinde parola kendiliğinden sorulur."
fi

info "Pardus/Debian sistem paketleri kontrol ediliyor"
sudo apt-get update

required_packages=(
  acl
  adb
  android-sdk-platform-tools-common
  avahi-daemon
  avahi-utils
  ca-certificates
  curl
  ffmpeg
  flatpak
  gstreamer1.0-libav
  gstreamer1.0-plugins-bad
  gstreamer1.0-plugins-base
  gstreamer1.0-plugins-good
  gstreamer1.0-tools
  iw
  zenity
  bluez
  libbluetooth3
  libusb-1.0-0
  network-manager
  pipewire
  rfkill
  upower
  uxplay
  wireplumber
  xinput
  x11-xserver-utils
  xdg-desktop-portal
  xdg-desktop-portal-gtk
)

sudo apt-get install -y "${required_packages[@]}"

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl enable --now NetworkManager.service ||
    fail "NetworkManager servisi başlatılamadı."
  sudo systemctl enable --now avahi-daemon.service ||
    fail "Avahi mDNS servisi başlatılamadı."
fi

package_has_candidate() {
  LC_ALL=C apt-cache policy "$1" 2>/dev/null | awk '
    $1 == "Candidate:" { seen = 1; if ($2 != "(none)") found = 1 }
    END { exit !(seen && found) }
  '
}

install_first_available() {
  local package
  for package in "$@"; do
    if package_has_candidate "$package"; then
      sudo apt-get install -y "$package"
      return 0
    fi
  done
  warning "Depoda uygun paket bulunamadı: $*"
  return 0
}

install_required_first_available() {
  local package
  for package in "$@"; do
    if package_has_candidate "$package"; then
      sudo apt-get install -y "$package"
      return 0
    fi
  done
  fail "Gerekli paketlerden hiçbiri depoda bulunamadı: $*"
}

# Pardus 25/Debian 13'te eski policykit-1 paketi polkitd ve pkexec olarak ayrıldı.
if ! command -v pkexec >/dev/null 2>&1; then
  install_required_first_available pkexec policykit-1
fi

# Weylus ekran yakalama desteği (X11 ve Wayland/XWayland).
install_first_available pipewire
install_first_available xdg-desktop-portal
case "${XDG_CURRENT_DESKTOP:-}" in
  *GNOME*) install_first_available xdg-desktop-portal-gnome xdg-desktop-portal-gtk ;;
  *KDE*|*Plasma*) install_first_available xdg-desktop-portal-kde xdg-desktop-portal-gtk ;;
  *) install_first_available xdg-desktop-portal-gtk xdg-desktop-portal-gnome ;;
esac

# Electron'un farklı Pardus/Debian sürümlerinde değişebilen çalışma kitaplıkları.
install_first_available libgtk-3-0t64 libgtk-3-0
install_first_available libasound2t64 libasound2
install_first_available libatk-bridge2.0-0t64 libatk-bridge2.0-0
install_first_available libatk1.0-0t64 libatk1.0-0
install_first_available libcups2t64 libcups2
install_first_available libatspi2.0-0t64 libatspi2.0-0
install_first_available libcairo2
install_first_available libdbus-1-3
install_first_available libdrm2
install_first_available libexpat1
install_first_available libnss3
install_first_available libpango-1.0-0
install_first_available libxcomposite1
install_first_available libxdamage1
install_first_available libxfixes3
install_first_available libxrandr2
install_first_available libxss1
install_first_available libgbm1

# Android araçlarının paket adı Pardus sürümüne göre değişebilir.
install_first_available adb android-tools-adb

if ! command -v scrcpy >/dev/null 2>&1; then
  info "Resmî scrcpy 4.1 x86_64 paketi kuruluyor"
  SCRCPY_VERSION="4.1"
  SCRCPY_SHA256="ad56ae8bfeedf41e824945c11dbf55fcb092b3e615b9b486f48a50e30d389635"
  SCRCPY_ARCHIVE="scrcpy-linux-x86_64-v${SCRCPY_VERSION}.tar.gz"
  SCRCPY_URL="https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/${SCRCPY_ARCHIVE}"
  SCRCPY_TMP="$(mktemp -d)"

  if curl -fL --retry 3 --retry-all-errors -o "$SCRCPY_TMP/$SCRCPY_ARCHIVE" "$SCRCPY_URL" &&
     printf '%s  %s\n' "$SCRCPY_SHA256" "$SCRCPY_TMP/$SCRCPY_ARCHIVE" | sha256sum --check --status; then
    tar -xzf "$SCRCPY_TMP/$SCRCPY_ARCHIVE" -C "$SCRCPY_TMP"
    SCRCPY_SOURCE="$SCRCPY_TMP/scrcpy-linux-x86_64-v${SCRCPY_VERSION}"
    SCRCPY_DEST="/opt/communicatepars/scrcpy-${SCRCPY_VERSION}"
    sudo install -d "$SCRCPY_DEST"
    sudo cp -a "$SCRCPY_SOURCE/." "$SCRCPY_DEST/"
    sudo ln -sfn "$SCRCPY_DEST/scrcpy" /usr/local/bin/scrcpy
  else
    fail "scrcpy indirilemedi veya SHA-256 doğrulaması başarısız. İnterneti kontrol edip kurulumu yeniden çalıştırın."
  fi

  rm -r -- "$SCRCPY_TMP"
fi

if package_has_candidate uxplay; then
  sudo apt-get install -y uxplay
  install_first_available gstreamer1.0-plugins-base
  install_first_available gstreamer1.0-plugins-good
  install_first_available gstreamer1.0-plugins-bad
  install_first_available gstreamer1.0-libav
else
  warning "UxPlay Pardus deposunda yok; iPad ekran yansıtma özelliği UxPlay kurulana kadar kullanılamaz."
fi

WEYLUS_APP_ID="io.github.electronstudio.WeylusCommunityEdition"
if ! command -v weylus >/dev/null 2>&1; then
  info "Weylus Community Edition kuruluyor"
  install_required_first_available flatpak
  flatpak remote-add --user --if-not-exists flathub \
    https://flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y flathub "$WEYLUS_APP_ID"
  flatpak info --user "$WEYLUS_APP_ID" >/dev/null 2>&1 ||
    fail "Weylus Flatpak kurulamadı."

  # Flatpak içinden X11/Wayland ekranına, ağa ve uinput aygıtına erişim.
  flatpak override --user \
    --share=network \
    --socket=x11 \
    --socket=wayland \
    --device=all \
    "$WEYLUS_APP_ID"
fi

info "Weylus uinput izinleri hazırlanıyor"
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
sudo groupadd --system --force uinput
sudo usermod -aG uinput "$TARGET_USER"
printf '%s\n' 'KERNEL=="uinput", MODE="0660", GROUP="uinput", OPTIONS+="static_node=uinput", TAG+="uaccess"' |
  sudo tee /etc/udev/rules.d/60-communicatepars-weylus.rules >/dev/null
printf '%s\n' uinput | sudo tee /etc/modules-load.d/communicatepars-uinput.conf >/dev/null
sudo modprobe uinput
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=misc --action=add || sudo udevadm trigger
if [ -e /dev/uinput ]; then
  sudo setfacl -m "u:${TARGET_USER}:rw" /dev/uinput
else
  warning "/dev/uinput oluşturulamadı; yeniden başlatma gerekebilir."
fi

# Etkin güvenlik duvarlarında Weylus web ve websocket portlarını aç.
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q '^Status: active'; then
  sudo ufw allow 1701/tcp
  sudo ufw allow 9001/tcp
fi
if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port=1701/tcp
  sudo firewall-cmd --permanent --add-port=9001/tcp
  sudo firewall-cmd --reload
fi

node_is_supported() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
    process.exit(ok ? 0 : 1);
  '
}

if ! node_is_supported || ! command -v npm >/dev/null 2>&1; then
  info "Node.js ve npm kuruluyor"
  sudo apt-get install -y nodejs
  if ! command -v npm >/dev/null 2>&1; then
    sudo apt-get install -y npm
  fi
fi

if ! node_is_supported; then
  fail "Node.js 20.19+, 22.12+ veya daha yeni sürüm gerekli. Mevcut: $(node --version 2>/dev/null || echo yok)"
fi

command -v npm >/dev/null 2>&1 || fail "npm kurulamadı."

info "Sunucu paketleri kuruluyor"
(cd "$PROJECT_DIR/server" && npm ci)

info "Masaüstü paketleri kuruluyor"
(cd "$PROJECT_DIR/desktop" && npm ci)

info "Masaüstü uygulaması derleniyor"
(cd "$PROJECT_DIR/desktop" && npm run build)

chmod +x \
  "$PROJECT_DIR/start-communicatepars.sh" \
  "$PROJECT_DIR/check-system.sh" \
  "$PROJECT_DIR/tools/hidclient/hidclient"

if command -v systemctl >/dev/null 2>&1; then
  info "Bluetooth HID uyumluluk modu hazırlanıyor"
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
  [ -n "$BLUETOOTHD_PATH" ] || fail "bluetoothd çalıştırma dosyası bulunamadı."

  # Bilgisayar iPad'e bir PC olarak değil, klasik Bluetooth HID çevre birimi
  # (birleşik klavye + işaretçi) olarak ilan edilir. 0x0005C0, Bluetooth
  # Assigned Numbers içindeki Peripheral/Combo Keyboard+Pointing sınıfıdır.
  BLUEZ_MAIN_CONF="/etc/bluetooth/main.conf"
  sudo install -d /etc/bluetooth
  if [ ! -f "$BLUEZ_MAIN_CONF" ]; then
    printf '[General]\n' | sudo tee "$BLUEZ_MAIN_CONF" >/dev/null
  elif [ ! -f "${BLUEZ_MAIN_CONF}.communicatepars-backup" ]; then
    sudo cp -a "$BLUEZ_MAIN_CONF" "${BLUEZ_MAIN_CONF}.communicatepars-backup"
  fi

  set_bluez_general_value() {
    local key="$1"
    local value="$2"
    if sudo grep -Eq "^[#[:space:]]*${key}[[:space:]]*=" "$BLUEZ_MAIN_CONF"; then
      sudo sed -i -E "s|^[#[:space:]]*${key}[[:space:]]*=.*$|${key} = ${value}|g" "$BLUEZ_MAIN_CONF"
    else
      sudo sed -i "/^\[General\][[:space:]]*$/a ${key} = ${value}" "$BLUEZ_MAIN_CONF"
    fi
  }

  set_bluez_general_value Name CommunicatePars
  set_bluez_general_value Class 0x0005C0
  set_bluez_general_value DiscoverableTimeout 0
  set_bluez_general_value PairableTimeout 0

  sudo install -d /etc/systemd/system/bluetooth.service.d
  # "input" eklentisi HID PSM'lerini tutmasın. "hostname" eklentisi ise
  # main.conf içindeki 0x0005C0 sınıfını açılışta tekrar laptop/PC sınıfıyla
  # ezdiği için kapatılır; ad ve sınıfı CommunicatePars yönetir.
  printf '[Service]\nExecStart=\nExecStart=%s --compat --noplugin=input,hostname\n' "$BLUETOOTHD_PATH" |
    sudo tee /etc/systemd/system/bluetooth.service.d/communicatepars-hid.conf >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now bluetooth.service || fail "Bluetooth servisi başlatılamadı."
  sudo systemctl restart bluetooth.service || fail "Bluetooth HID ayarı etkinleştirilemedi."

  # bluetoothd yeniden başladığında görünürlük ve connectable durumu kapanabilir.
  # Bazı adaptörler servis yeniden başladıktan birkaç saniye sonra hazır olur.
  bluetoothctl_retry() {
    local last_output=""
    for _ in {1..40}; do
      if last_output=$(sudo bluetoothctl "$@" 2>&1); then
        return 0
      fi
      sleep 0.25
    done
    [ -z "$last_output" ] || printf '%s\n' "$last_output" >&2
    return 1
  }

  # HID bağlantısından önce çevre birimi modunu açık bırak.
  bluetoothctl_retry power on || fail "Bluetooth adaptörü açılamadı."
  bluetoothctl_retry system-alias CommunicatePars || true
  bluetoothctl_retry pairable on || fail "Bluetooth eşleştirme modu açılamadı."
  bluetoothctl_retry discoverable-timeout 0 || true
  bluetoothctl_retry discoverable on || fail "Bluetooth görünür yapılamadı."
fi

info "Kurulum sonucu kontrol ediliyor"
if ! "$PROJECT_DIR/check-system.sh"; then
  fail "Kurulum kontrolünde hata bulundu. Yukarıdaki HATA satırlarını inceleyin."
fi

info "Kurulum tamamlandı"
printf 'Uygulamayı aç: %s/start-communicatepars.sh\n' "$PROJECT_DIR"

if ! command -v uxplay >/dev/null 2>&1; then
  warning "UxPlay kurulu değil; iPad ekran yansıtma özelliği kullanılamaz."
fi

if ! command -v weylus >/dev/null 2>&1 &&
   ! flatpak info --user "$WEYLUS_APP_ID" >/dev/null 2>&1; then
  warning "Weylus kurulu değil; İkinci Ekran özelliği kullanılamaz."
fi
