const express = require("express");
const cors = require("cors");
const { exec, execFile, spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = Number(process.env.PORT || 5050);
const HOST = process.env.HOST || "0.0.0.0";
const SHARE_DIR = process.env.COMMUNICATEPARS_SHARE_DIR ||
  path.join(os.homedir(), ".local", "share", "communicatepars", "uploads");
const HOTSPOT_CONNECTION = process.env.COMMUNICATEPARS_HOTSPOT_CONNECTION || "CommunicatePars-Hotspot";
const HOTSPOT_SSID = process.env.COMMUNICATEPARS_HOTSPOT_SSID || "CommunicatePars";
const HOTSPOT_PASSWORD = process.env.COMMUNICATEPARS_HOTSPOT_PASSWORD || "CommunicatePars123";
const MAX_FILE_SIZE = Number(process.env.COMMUNICATEPARS_MAX_FILE_SIZE || 2 * 1024 * 1024 * 1024);
fs.mkdirSync(SHARE_DIR, { recursive: true });

function repairFilenameEncoding(name) {
  const value = String(name || "dosya");
  // Multer/Busboy bazı tarayıcılardan gelen UTF-8 dosya adını Latin-1 gibi okuyabilir.
  // Yalnızca tipik bozuk karakterler görülürse dönüştürerek normal adları koruruz.
  if (!/[ÃÄÅÆ]/.test(value)) return value;
  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    return repaired.includes("�") ? value : repaired;
  } catch (_) {
    return value;
  }
}

function safeOriginalName(name) {
  const normalized = path.basename(repairFilenameEncoding(name))
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .trim();
  return normalized || "dosya";
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SHARE_DIR),
    filename: (_req, file, cb) => {
      const original = safeOriginalName(file.originalname);
      const extension = path.extname(original);
      const stem = path.basename(original, extension).slice(0, 120);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${stem}${extension}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 20 },
});

const PROJECT_DIR = path.resolve(__dirname, "..");
const HIDCLIENT_PATH = process.env.COMMUNICATEPARS_HIDCLIENT ||
  path.join(PROJECT_DIR, "tools", "hidclient", "hidclient");
const SYSTEMCTL_PATH = process.env.COMMUNICATEPARS_SYSTEMCTL || "/usr/bin/systemctl";
const BLUETOOTHCTL_PATH = process.env.COMMUNICATEPARS_BLUETOOTHCTL || "/usr/bin/bluetoothctl";
const XINPUT_PATH = process.env.COMMUNICATEPARS_XINPUT || "/usr/bin/xinput";
const INPUT_SYSFS_ROOT = process.env.COMMUNICATEPARS_INPUT_SYSFS_ROOT || "/sys";
const X11_DISPLAY = process.env.DISPLAY || ":0";

function resolveX11Authority() {
  if (process.env.XAUTHORITY && fs.existsSync(process.env.XAUTHORITY)) {
    return process.env.XAUTHORITY;
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const runtimeDir = `/run/user/${uid}`;
  const candidates = [path.join(runtimeDir, "gdm", "Xauthority")];

  try {
    for (const file of fs.readdirSync(runtimeDir)) {
      if (file.startsWith(".mutter-Xwaylandauth.")) {
        candidates.push(path.join(runtimeDir, file));
      }
    }
  } catch (_) {
    // Diğer adaylarla devam et.
  }

  candidates.push(path.join(os.homedir(), ".Xauthority"));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  console.warn("[uyarı] Xauthority bulunamadı; -x özelliği çalışmayabilir.");
  return path.join(os.homedir(), ".Xauthority");
}

const X11_AUTHORITY = resolveX11Authority();

let hidclientProcess = null;
let airplayProcess = null;
let weylusProcess = null;
let bluetoothAgentProcess = null;
let bluetoothPairingTimer = null;
let activeEventNumber = null;
let lastInputEventNumber = "8";
let hidclientReady = false;
let hidclientConnected = false;
let hidclientPeerAddress = "";
let hidclientLastError = "";
let weylusReady = false;
let weylusLastError = "";

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  return res.json({
    app: "CommunicatePars Local Server",
    status: "running",
  });
});

function readAndroidDevices(callback) {
  exec("adb devices -l", (error, stdout, stderr) => {
    if (error) return callback(new Error(stderr.trim() || error.message));
    const devices = stdout.split("\n").slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
      const columns = line.split(/\s+/);
      const id = columns[0];
      const status = columns[1] || "unknown";
      return {
        id,
        status,
        connection: id.includes(":") ? "Kablosuz" : "USB",
      };
    });
    callback(null, devices);
  });
}
function startScrcpyForSerial(serial, callback) {
  exec("command -v scrcpy", (lookupError, stdout) => {
    if (lookupError || !stdout.trim()) return callback(new Error("scrcpy bulunamadı"));
    const scrcpyPath = stdout.trim().split("\n")[0];
    const args = ["--serial", serial, "--max-size=1024", "--window-title=CommunicatePars Android Kontrol"];
    const child = spawn(scrcpyPath, args, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    let answered = false;
    child.once("spawn", () => {
      answered = true;
      child.unref();
      callback(null, child.pid);
    });
    child.stderr.on("data", (data) => console.error(`[scrcpy] ${data.toString().trim()}`));
    child.once("error", (error) => {
      if (!answered) callback(error);
    });
  });
}
app.get("/devices", (_req, res) => {
  readAndroidDevices((error, devices) => {
    if (error) return res.status(500).json({ success: false, message: "Android cihazları taranamadı", error: error.message });
    return res.json({ success: true, devices });
  });
});
app.get("/android/devices", (_req, res) => {
  readAndroidDevices((error, devices) => {
    if (error) return res.status(500).json({ success: false, message: "Android cihazları taranamadı", error: error.message });
    return res.json({ success: true, devices });
  });
});
app.post("/android/mirror/start", (req, res) => {
  const mode = req.body?.mode;
  if (![/^usb$/, /^wireless$/].some((pattern) => pattern.test(String(mode)))) {
    return res.status(400).json({ success: false, message: "USB veya kablosuz bağlantı türünü seç." });
  }

  readAndroidDevices((scanError, devices) => {
    if (scanError) return res.status(500).json({ success: false, message: scanError.message });
    const ready = devices.filter((device) => device.status === "device");
    const wireless = ready.find((device) => device.connection === "Kablosuz");
    const usb = ready.find((device) => device.connection === "USB");

    if (mode === "usb") {
      if (!usb) {
        return res.status(404).json({
          success: false,
          message: "USB cihazı bulunamadı. USB kablosunu bağla, USB hata ayıklamayı aç ve telefondaki bilgisayar iznini onayla.",
        });
      }
      return startScrcpyForSerial(usb.id, (error, pid) => {
        if (error) return res.status(500).json({ success: false, message: `USB kontrolü başlatılamadı: ${error.message}` });
        return res.status(202).json({ success: true, message: "USB Android kontrolü başlatıldı.", connection: "USB", pid });
      });
    }

    if (wireless) {
      return startScrcpyForSerial(wireless.id, (error, pid) => {
        if (error) return res.status(500).json({ success: false, message: `Kablosuz kontrol başlatılamadı: ${error.message}` });
        return res.status(202).json({ success: true, message: "Kablosuz Android kontrolü başlatıldı.", connection: "Kablosuz", pid });
      });
    }

    if (!usb) {
      return res.status(400).json({
        success: false,
        message: "Kablosuz bağlantı hazır değil. Telefon ve Pardus aynı Wi-Fi ağında olmalı. İlk kurulum için USB kablosunu bağla, USB hata ayıklamayı aç ve bilgisayar iznini onayla. Android 11 ve üzerindeyse Kablosuz hata ayıklamayı da aç.",
      });
    }

    exec("command -v scrcpy", (lookupError, stdout) => {
      if (lookupError || !stdout.trim()) {
        return res.status(503).json({ success: false, message: "scrcpy bulunamadı" });
      }
      const scrcpyPath = stdout.trim().split("\n")[0];
      const child = spawn(scrcpyPath, [
        "--serial", usb.id,
        "--tcpip",
        "--max-size=1024",
        "--window-title=CommunicatePars Android Kablosuz Kontrol",
      ], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
      let answered = false;
      child.once("spawn", () => {
        answered = true;
        child.unref();
        return res.status(202).json({
          success: true,
          message: "Kablosuz Android kontrolü hazırlanıyor. Telefon ve Pardus aynı Wi-Fi ağında kalmalı. Pencere açıldıktan sonra USB kablosunu çıkarabilirsin.",
          connection: "Kablosuz hazırlık",
          pid: child.pid,
        });
      });
      child.stderr.on("data", (data) => console.error(`[scrcpy tcpip] ${data.toString().trim()}`));
      child.once("error", (error) => {
        if (!answered && !res.headersSent) {
          return res.status(500).json({ success: false, message: `Kablosuz bağlantı başlatılamadı: ${error.message}` });
        }
      });
    });
  });
});
app.post("/mirror", (req, res) => {
  req.body = { ...(req.body || {}), mode: "auto" };
  readAndroidDevices((scanError, devices) => {
    if (scanError) return res.status(500).json({ success: false, message: scanError.message });
    const selected = devices.find((device) => device.status === "device" && device.connection === "Kablosuz") || devices.find((device) => device.status === "device");
    if (!selected) return res.status(404).json({ success: false, message: "Hazır Android cihazı bulunamadı" });
    startScrcpyForSerial(selected.id, (error, pid) => {
      if (error) return res.status(500).json({ success: false, message: error.message });
      return res.status(202).json({ success: true, message: "Android kontrolü başlatıldı", pid });
    });
  });
});
app.post("/airplay/start", (req, res) => {
  if (airplayProcess && airplayProcess.exitCode === null) {
    return res.json({
      success: true,
      active: true,
      message: "AirPlay alıcısı zaten çalışıyor",
    });
  }

  exec("command -v uxplay", (lookupError, stdout) => {
    if (lookupError || !stdout.trim()) {
      return res.status(503).json({
        success: false,
        active: false,
        message: "UxPlay bulunamadı. Önce Pardus'a uxplay paketini kur.",
      });
    }

    const uxplayPath = stdout.trim().split("\n")[0];
    const child = spawn(uxplayPath, ["-n", "CommunicatePars | Mouse Pc Geri Al: Sol Ctrl + K", "-nh"], {
      env: {
        ...process.env,
        DISPLAY: X11_DISPLAY,
        XAUTHORITY: X11_AUTHORITY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    airplayProcess = child;
    let answered = false;

    const failStart = (message) => {
      if (airplayProcess === child) airplayProcess = null;
      if (!answered && !res.headersSent) {
        answered = true;
        return res.status(500).json({
          success: false,
          active: false,
          message,
        });
      }
    };

    child.once("spawn", () => {
      if (answered || res.headersSent) return;
      answered = true;
      return res.status(202).json({
        success: true,
        active: true,
        message:
          "AirPlay hazır. iPad Denetim Merkezi > Ekran Yansıtma > CommunicatePars yolunu kullan.",
      });
    });
    child.stdout.on("data", (data) => {
      const message = data.toString().trim();
      if (message) console.log(`[uxplay] ${message}`);
    });
    child.stderr.on("data", (data) => {
      const message = data.toString().trim();
      if (message) console.error(`[uxplay hata] ${message}`);
    });
    child.once("error", (error) => {
      console.error("UxPlay başlatma hatası:", error.message);
      failStart(`AirPlay başlatılamadı: ${error.message}`);
    });
    child.once("close", (code) => {
      console.log(`UxPlay kapandı. Kod: ${code}`);
      if (airplayProcess === child) airplayProcess = null;
    });
  });
});

app.post("/airplay/stop", (req, res) => {
  const child = airplayProcess;
  airplayProcess = null;
  if (!child || child.exitCode !== null) {
    return res.json({
      success: true,
      active: false,
      message: "AirPlay zaten kapalı",
    });
  }

  // Yalnızca bu sunucunun başlattığı UxPlay sürecini kapatır.
  // hidclient, activeEventNumber ve mouse geri yükleme akışına dokunmaz.
  child.kill("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 3000);
  forceTimer.unref();

  return res.json({
    success: true,
    active: false,
    message: "AirPlay kapatıldı. iPad mouse kontrolü değiştirilmedi.",
  });
});

app.get("/airplay/status", (req, res) => {
  const active = airplayProcess !== null && airplayProcess.exitCode === null;
  return res.json({ success: true, active });
});

function stopBluetoothPairingMode() {
  if (bluetoothPairingTimer) {
    clearTimeout(bluetoothPairingTimer);
    bluetoothPairingTimer = null;
  }
  const agent = bluetoothAgentProcess;
  bluetoothAgentProcess = null;
  if (!agent || agent.exitCode !== null) return;
  try {
    // HID çalışırken bilgisayar çevre birimi olarak bağlanabilir kalmalıdır.
    // Yalnızca HID kapalıysa görünürlük/eşleştirme de kapatılır.
    if (!hidclientReady) {
      agent.stdin.write("discoverable off\n");
      agent.stdin.write("pairable off\n");
    }
    agent.stdin.write("quit\n");
    agent.stdin.end();
  } catch (error) {
    console.error("Bluetooth eşleştirme modu kapatma hatası:", error.message);
    try { agent.kill("SIGTERM"); } catch (_) {}
  }
}







function disconnectBluetoothDevice(address, callback = () => {}) {
  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i.test(address || "")) {
    callback(null, "Etkin iPad Bluetooth adresi yok");
    return;
  }

  execFile(BLUETOOTHCTL_PATH, ["disconnect", address], (error, stdout, stderr) => {
    if (error) {
      callback(new Error(stderr.trim() || error.message));
      return;
    }
    console.log(`iPad Bluetooth bağlantısı kesildi: ${address}`);
    callback(null, stdout.trim() || "iPad Bluetooth bağlantısı sonlandırıldı");
  });
}








app.post("/bluetooth/pairing/start", (req, res) => {
  if (bluetoothAgentProcess && bluetoothAgentProcess.exitCode === null) {
    return res.json({ success: true, active: true, message: "Yeni iOS eşleştirme modu zaten açık" });
  }
  // --agent ile agent kaydını bluetoothctl başlatırken yap. Eski akışta
  // "agent" ve "default-agent" komutları peş peşe gönderiliyor, agent kaydı
  // henüz tamamlanmadığı için "No agent is registered" oluşuyordu. Sonuçta
  // masaüstünün DisplayYesNo agent'ı kullanılıyor ve iOS onayı yanıtsız kalıyordu.
  const child = spawn(BLUETOOTHCTL_PATH, ["--agent", "NoInputNoOutput"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  bluetoothAgentProcess = child;

  let answered = false;
  let output = "";
  let defaultAgentRequested = false;
  let discoverabilityRequested = false;
  let promptBuffer = "";
  let readinessTimer = null;

  const send = (command) => {
    if (child.exitCode !== null || child.stdin.destroyed) return false;
    child.stdin.write(`${command}\n`);
    return true;
  };

  const closeChild = () => {
    try {
      send("quit");
      child.stdin.end();
    } catch (_) {
      try { child.kill("SIGTERM"); } catch (_) {}
    }
  };

  const fail = (message) => {
    if (readinessTimer) clearTimeout(readinessTimer);
    if (bluetoothAgentProcess === child) bluetoothAgentProcess = null;
    closeChild();
    if (!answered && !res.headersSent) {
      answered = true;
      return res.status(500).json({ success: false, active: false, message });
    }
  };

  const finishReady = () => {
    if (answered || res.headersSent || child.exitCode !== null) return;
    if (readinessTimer) clearTimeout(readinessTimer);
    answered = true;
    bluetoothPairingTimer = setTimeout(stopBluetoothPairingMode, 180000);
    bluetoothPairingTimer.unref();
    return res.json({
      success: true,
      active: true,
      message: "Yeni iOS eşleştirmesi açık. iPad Bluetooth menüsünden CommunicatePars cihazına bağlan.",
      output: output.trim(),
    });
  };

  child.stdout.on("data", (data) => {
    const text = data.toString();
    output += text;
    promptBuffer = `${promptBuffer}${text}`.slice(-512);
    if (text.trim()) console.log(`[bluetoothctl] ${text.trim()}`);

    if (/Failed to register agent object|No agent is registered/i.test(output)) {
      fail("Bluetooth eşleştirme agent'ı varsayılan olarak kaydedilemedi");
      return;
    }

    // Agent kaydı tamamlandıktan sonra varsayılan yap; bu sıra IO yeteneğinin
    // gerçekten NoInputNoOutput olarak BlueZ'e iletilmesini sağlar.
    if (!defaultAgentRequested && /Agent registered/i.test(output)) {
      defaultAgentRequested = true;
      send("default-agent");
    }

    if (!discoverabilityRequested && /Default agent request successful/i.test(output)) {
      discoverabilityRequested = true;
      send("pairable on");
      send("discoverable-timeout 0");
      send("discoverable on");
    }

    // Bazı BlueZ sürümleri NoInputNoOutput seçimine rağmen metin tabanlı onay
    // sorabiliyor. Yalnızca kullanıcının açtığı üç dakikalık eşleştirme
    // penceresinde bu iOS eşleştirme/servis onayını otomatik kabul et.
    const promptMatch = promptBuffer.match(/(?:Confirm passkey|Authorize service|Request authorization)[\s\S]{0,160}\(yes\/no\):/i);
    if (promptMatch) {
      promptBuffer = "";
      console.log("[bluetoothctl] iOS eşleştirme onayı otomatik kabul edildi");
      send("yes");
    }

    if (discoverabilityRequested && /Changing discoverable on succeeded/i.test(output)) {
      finishReady();
    }
  });

  child.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.error(`[bluetoothctl hata] ${text}`);
  });

  child.once("error", (error) => {
    const missing = error.code === "ENOENT"
      ? "bluetoothctl bulunamadı. Pardus'ta BlueZ paketini kur."
      : `Bluetooth eşleştirme modu açılamadı: ${error.message}`;
    fail(missing);
  });

  child.once("close", (code) => {
    console.log(`Bluetooth eşleştirme agent kapandı. Kod: ${code}`);
    if (bluetoothAgentProcess === child) bluetoothAgentProcess = null;
    if (!answered) fail("Bluetooth eşleştirme agent'ı hazır olmadan kapandı");
  });

  child.once("spawn", () => {
    send("power on");
    send("system-alias CommunicatePars");
    readinessTimer = setTimeout(() => {
      if (answered || res.headersSent) return;
      console.error(`[bluetoothctl] Agent hazırlama zaman aşımı. Çıktı: ${output.trim()}`);
      fail("Bluetooth NoInputNoOutput agent'ı hazırlanamadı; server.log dosyasını kontrol edin");
    }, 8000);
    readinessTimer.unref();
  });
});

app.post("/bluetooth/pairing/stop", (req, res) => {
  stopBluetoothPairingMode();
  return res.json({ success: true, active: false, message: "Yeni iOS eşleştirme modu kapatıldı" });
});

app.get("/bluetooth/pairing/status", (req, res) => {
  const active = bluetoothAgentProcess !== null && bluetoothAgentProcess.exitCode === null;
  return res.json({ success: true, active });
});

function readInputDevices() {
  const inputRoot = path.join(INPUT_SYSFS_ROOT, "class", "input");
  const devices = fs.readdirSync(inputRoot)
    .filter((entry) => /^event\d+$/.test(entry))
    .map((entry) => {
      const deviceRoot = path.join(inputRoot, entry, "device");
      const readValue = (relativePath) => {
        try {
          return fs.readFileSync(path.join(deviceRoot, relativePath), "utf8").trim();
        } catch (_) {
          return "";
        }
      };
      const name = readValue("name") || "Adsız input aygıtı";
      const relativeBits = readValue("capabilities/rel");
      const hasRelativeAxes = relativeBits
        .split(/\s+/)
        .some((word) => word && !/^0+$/.test(word));
      const touchpad = /touch[ -]?pad|track[ -]?pad|clickpad/i.test(name);
      const selectable = hasRelativeAxes && !touchpad;
      const reason = touchpad
        ? "Touchpad desteklenmiyor"
        : selectable
          ? "Seçilebilir mouse/işaretçi"
          : "Relative mouse aygıtı değil";
      return {
        eventNumber: entry.slice("event".length),
        name,
        relative: hasRelativeAxes,
        touchpad,
        selectable,
        reason,
      };
    })
    .sort((a, b) => Number(a.eventNumber) - Number(b.eventNumber));

  const lines = ["İşaret  event  Aygıt (+ seçilebilir / - seçilemez)"];
  for (const device of devices) {
    lines.push(
      `${device.selectable ? "+" : "-"}       ${device.eventNumber.padStart(2, " ")}  '${device.name}' — ${device.reason}`
    );
  }
  return { devices, output: lines.join("\n") };
}

app.get("/ipad/input/list", (req, res) => {
  try {
    const { devices, output } = readInputDevices();
    return res.json({ success: true, output, devices });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Input aygıtları listelenemedi",
      error: error.message,
    });
  }
});

app.post("/ipad/control/start", (req, res) => {
  const eventNumber = String(req.body.eventNumber ?? "").trim();

  if (!/^[0-9]{1,4}$/.test(eventNumber)) {
    return res.status(400).json({
      success: false,
      active: false,
      message: "Menüden kullanmak istediğiniz mouse event aygıtını seçin",
    });
  }

  let selectedDevice;
  try {
    selectedDevice = readInputDevices().devices.find(
      (device) => device.eventNumber === eventNumber
    );
  } catch (error) {
    return res.status(500).json({
      success: false,
      active: false,
      message: "Input aygıtları doğrulanamadı",
      error: error.message,
    });
  }

  if (!selectedDevice) {
    return res.status(400).json({
      success: false,
      active: false,
      message: `event${eventNumber} bu bilgisayarda bulunamadı; Aygıtları Göster ile yeniden seçin.`,
    });
  }

  if (!selectedDevice.selectable) {
    return res.status(400).json({
      success: false,
      active: false,
      message: selectedDevice.touchpad
        ? `event${eventNumber} bir touchpad; touchpad desteklenmiyor. Harici mouse seçin.`
        : `event${eventNumber} seçilebilir bir mouse aygıtı değil. '+' işaretli bir aygıt seçin.`,
    });
  }

  if (hidclientProcess && hidclientProcess.exitCode === null) {
    return res.status(hidclientReady ? 200 : 409).json({
      success: hidclientReady,
      active: hidclientReady,
      ready: hidclientReady,
      connected: hidclientConnected,
      message: hidclientReady
        ? "iPad kontrol sistemi zaten çalışıyor"
        : "iPad kontrol sistemi başlatılıyor; parola penceresini tamamlayın.",
    });
  }

  if (!fs.existsSync(HIDCLIENT_PATH)) {
    return res.status(503).json({
      success: false,
      active: false,
      message: "hidclient bulunamadı",
      error: `Beklenen dosya: ${HIDCLIENT_PATH}`,
    });
  }

  activeEventNumber = eventNumber;
  lastInputEventNumber = eventNumber;
  hidclientReady = false;
  hidclientConnected = false;
  hidclientPeerAddress = "";
  hidclientLastError = "";

  // Kurulum bluetoothd'yi --compat ve gerekli eklenti ayarlarıyla önceden
  // hazırlar. hidclient SDP kaydını çalışan bluetoothd'ye ekler. Bu kayıttan
  // sonra bluetoothd yeniden başlatılırsa HID kaydı silineceği için burada
  // servis kesinlikle yeniden başlatılmaz.
  const startScript = `
set -u
HIDCLIENT="$1"
EVENT_NUMBER="$2"
DISPLAY_VALUE="$3"
XAUTHORITY_VALUE="$4"
SYSTEMCTL="$5"
BLUETOOTHCTL="$6"

if ! "$SYSTEMCTL" is-active --quiet bluetooth.service; then
  "$SYSTEMCTL" start bluetooth.service || {
    printf 'Bluetooth servisi başlatılamadı. Önce ./install-pardus.sh çalıştırın.\n' >&2
    exit 20
  }
fi

"$BLUETOOTHCTL" power on >/dev/null || {
  printf 'Bluetooth adaptörü açılamadı.\n' >&2
  exit 21
}
"$BLUETOOTHCTL" system-alias CommunicatePars >/dev/null 2>&1 || true

# BlueZ adaptörü açarken sınıf bilgisini kısa bir gecikmeyle yayınlayabilir.
BLUETOOTH_CLASS=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  BLUETOOTH_CLASS=$("$BLUETOOTHCTL" show 2>/dev/null | /usr/bin/awk '/Class:/ {print $2; exit}')
  if [[ "$BLUETOOTH_CLASS" =~ ^0x[0-9A-Fa-f]+$ ]] &&
     (( (BLUETOOTH_CLASS & 0x1FFC) == 0x05C0 )); then
    break
  fi
  /usr/bin/sleep 0.2
done

if ! [[ "$BLUETOOTH_CLASS" =~ ^0x[0-9A-Fa-f]+$ ]] ||
   (( (BLUETOOTH_CLASS & 0x1FFC) != 0x05C0 )); then
  [ -n "$BLUETOOTH_CLASS" ] || BLUETOOTH_CLASS="okunamadı"
  printf 'Bluetooth sınıfı çevre birimi değil (mevcut: %s). ./install-pardus.sh komutunu yeniden çalıştırın.\n' "$BLUETOOTH_CLASS" >&2
  exit 24
fi

/usr/bin/stdbuf -oL -eL /usr/bin/env \
  DISPLAY="$DISPLAY_VALUE" \
  XAUTHORITY="$XAUTHORITY_VALUE" \
  "$HIDCLIENT" "-e$EVENT_NUMBER" -x </dev/null &
HID_PID=$!

/usr/bin/sleep 2
if ! /bin/kill -0 "$HID_PID" 2>/dev/null; then
  wait "$HID_PID"
  exit $?
fi

# SDP kaydı yapıldıktan sonra iPad'in aramasını aç. Agent hemen ardından
# /bluetooth/pairing/start endpoint'i tarafından başlatılır.
"$BLUETOOTHCTL" pairable on >/dev/null || {
  printf 'Bluetooth eşleştirme modu açılamadı.\n' >&2
  /bin/kill -INT "$HID_PID" 2>/dev/null || true
  wait "$HID_PID" 2>/dev/null || true
  exit 22
}
"$BLUETOOTHCTL" discoverable-timeout 0 >/dev/null 2>&1 || true
"$BLUETOOTHCTL" discoverable on >/dev/null || {
  printf 'Bluetooth çevre birimi görünür yapılamadı.\n' >&2
  /bin/kill -INT "$HID_PID" 2>/dev/null || true
  wait "$HID_PID" 2>/dev/null || true
  exit 23
}

if ! /bin/kill -0 "$HID_PID" 2>/dev/null; then
  wait "$HID_PID"
  exit $?
fi

printf 'COMMUNICATEPARS_HID_READY\\n'

while /bin/kill -0 "$HID_PID" 2>/dev/null; do
  if IFS= read -r -t 1 CONTROL_COMMAND; then
    if [ "$CONTROL_COMMAND" = "STOP" ]; then
      /bin/kill -INT "$HID_PID" 2>/dev/null || true
      for _ in 1 2 3 4 5 6; do
        /bin/kill -0 "$HID_PID" 2>/dev/null || break
        /usr/bin/sleep 0.5
      done
      /bin/kill -KILL "$HID_PID" 2>/dev/null || true
      break
    fi
  else
    /usr/bin/sleep 0.1
  fi
done

wait "$HID_PID" 2>/dev/null
HID_STATUS=$?
exit "$HID_STATUS"
`;

  const child = spawn(
    "pkexec",
    [
      "/bin/bash",
      "-c",
      startScript,
      "communicatepars-hid",
      HIDCLIENT_PATH,
      eventNumber,
      X11_DISPLAY,
      X11_AUTHORITY,
      SYSTEMCTL_PATH,
      BLUETOOTHCTL_PATH,
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  hidclientProcess = child;

  let startupOutput = "";
  let startupError = "";
  let answered = false;

  const answerFailure = (message, status = 500) => {
    if (answered || res.headersSent) return;
    answered = true;
    clearTimeout(startupTimer);
    return res.status(status).json({
      success: false,
      active: false,
      ready: false,
      connected: false,
      message,
      error: hidclientLastError || startupError.trim() || startupOutput.trim(),
    });
  };

  const startupTimer = setTimeout(() => {
    hidclientLastError = "HID başlatma zaman aşımına uğradı. Parola penceresini ve Bluetooth servisini kontrol edin.";
    try { child.kill("SIGTERM"); } catch (_) {}
    answerFailure(hidclientLastError, 504);
  }, 60000);
  startupTimer.unref();

  child.stdout.on("data", (data) => {
    const text = data.toString();
    startupOutput = (startupOutput + text).slice(-12000);
    const message = text.trim();
    if (message) console.log(`[hidclient] ${message}`);

    const peerMatch = startupOutput.match(
      /Incoming connection from node \[([0-9A-F]{2}(?::[0-9A-F]{2}){5})\] accepted and established/i
    );
    if (peerMatch) {
      hidclientConnected = true;
      hidclientPeerAddress = peerMatch[1];
    }

    if (text.includes("COMMUNICATEPARS_HID_READY") && !answered) {
      answered = true;
      clearTimeout(startupTimer);
      hidclientReady = true;
      hidclientLastError = "";
      return res.json({
        success: true,
        active: true,
        ready: true,
        connected: hidclientConnected,
        message: "Bluetooth HID hazır. iPad Bluetooth ayarlarından CommunicatePars cihazına bağlanın.",
      });
    }
  });

  child.stderr.on("data", (data) => {
    const text = data.toString();
    startupError = (startupError + text).slice(-12000);
    hidclientLastError = text.trim() || hidclientLastError;
    if (text.trim()) console.error(`[hidclient hata] ${text.trim()}`);
  });

  child.on("error", (error) => {
    hidclientLastError = error.message;
    if (hidclientProcess === child) hidclientProcess = null;
    hidclientReady = false;
    hidclientConnected = false;
    hidclientPeerAddress = "";
    activeEventNumber = null;
    answerFailure(`hidclient başlatılamadı: ${error.message}`);
  });

  child.on("close", (code) => {
    console.log(`hidclient kapandı. Kod: ${code}`);
    clearTimeout(startupTimer);
    if (hidclientProcess === child) hidclientProcess = null;
    const wasReady = hidclientReady;
    hidclientReady = false;
    hidclientConnected = false;
    activeEventNumber = null;
    if (!wasReady) {
      answerFailure(
        code === 126
          ? "Yetkilendirme iptal edildi; iPad kontrolü başlatılmadı."
          : `iPad kontrolü başlatılamadı (hidclient kodu: ${code}).`
      );
    }
  });
});

function forceStopHidclient(callback) {
  const stopScript = `
set -u
HIDCLIENT=$(/usr/bin/readlink -f "$1")
PIDS=()

for PROC_DIR in /proc/[0-9]*; do
  PROC_EXE=$(/usr/bin/readlink -f "$PROC_DIR/exe" 2>/dev/null || true)
  if [ "$PROC_EXE" = "$HIDCLIENT" ]; then
    PIDS+=("\${PROC_DIR##*/}")
  fi
done

# Kullanıcı iOS kapatmayı seçtiğinde yumuşak sinyal bekleme: bu paketteki
# hidclient süreçlerini pkill -9 eşdeğeri SIGKILL ile doğrudan kes.
if [ "\${#PIDS[@]}" -gt 0 ]; then
  /bin/kill -KILL "\${PIDS[@]}" 2>/dev/null || true
  /usr/bin/sleep 0.1
fi
exit 0
`;

  const cleanup = spawn(
    "pkexec",
    ["/bin/bash", "-c", stopScript, "communicatepars-hid-stop", HIDCLIENT_PATH],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  let finished = false;
  const finish = (error = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(authTimer);
    callback(error);
  };
  const authTimer = setTimeout(() => {
    try { cleanup.kill("SIGTERM"); } catch (_) {}
    finish(new Error("Yetkili HID kapatma işlemi zaman aşımına uğradı"));
  }, 60000);
  authTimer.unref();
  cleanup.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-4000); });
  cleanup.once("error", (error) => finish(error));
  cleanup.once("close", (code) => {
    if (code === 0) return finish();
    finish(new Error(stderr.trim() || `Yetkili HID kapatma kodu: ${code}`));
  });
}

function restoreXInputEvent(eventNumber, callback) {
  if (!/^\d{1,4}$/.test(String(eventNumber || ""))) return callback();

  const restoreScript = `
set -u
XINPUT="$1"
EVENT_NUMBER="$2"
[ -x "$XINPUT" ] || exit 0

MASTER_ID=$("$XINPUT" list --id-only "Virtual core pointer" 2>/dev/null | /usr/bin/head -n 1)
[ -n "$MASTER_ID" ] || exit 0

while IFS= read -r DEVICE_ID; do
  [[ "$DEVICE_ID" =~ ^[0-9]+$ ]] || continue
  if "$XINPUT" list-props "$DEVICE_ID" 2>/dev/null | /bin/grep -Fq "/dev/input/event$EVENT_NUMBER"; then
    "$XINPUT" enable "$DEVICE_ID" >/dev/null 2>&1 || true
    "$XINPUT" reattach "$DEVICE_ID" "$MASTER_ID" >/dev/null 2>&1 || true
  fi
done < <("$XINPUT" list --id-only 2>/dev/null)
exit 0
`;

  execFile(
    "/bin/bash",
    ["-c", restoreScript, "communicatepars-xinput-restore", XINPUT_PATH, String(eventNumber)],
    { env: { ...process.env, DISPLAY: X11_DISPLAY, XAUTHORITY: X11_AUTHORITY } },
    (error) => callback(error || null)
  );
}

function restoreMouseHardware(eventNumber, callback) {
  if (!/^\d{1,4}$/.test(String(eventNumber || ""))) {
    return callback(new Error("Mouse geri yükleme için seçili event numarası geçersiz"));
  }

  // Eski çalışan sürümdeki ikinci yetkili işlem: seçilen event aygıtının
  // gerçek USB üst aygıtını bul, sürücüden ayır ve yeniden bağla. USB olmayan
  // aygıtlarda udev + XInput geri yükleme yolu kullanılır.
  const restoreScript = `
set -u
EVENT_NUMBER="$1"
SYS_ROOT="$2"
EVENT_LINK="$SYS_ROOT/class/input/event$EVENT_NUMBER/device"
EVENT_PATH=$(/usr/bin/readlink -f "$EVENT_LINK" 2>/dev/null || true)

udev_fallback() {
  /usr/bin/udevadm trigger --action=add --subsystem-match=input 2>/dev/null || true
  /usr/bin/udevadm settle 2>/dev/null || true
  printf 'event%s için udev geri yükleme tetiklendi\n' "$EVENT_NUMBER"
}

if [ -z "$EVENT_PATH" ]; then
  udev_fallback
  exit 0
fi

CURRENT="$EVENT_PATH"
USB_DEVICE=""
while [ "$CURRENT" != "/" ]; do
  if [ -f "$CURRENT/idVendor" ] && [ -f "$CURRENT/idProduct" ]; then
    USB_DEVICE=$(/usr/bin/basename "$CURRENT")
    break
  fi
  CURRENT=$(/usr/bin/dirname "$CURRENT")
done

DRIVER_ROOT="$SYS_ROOT/bus/usb/drivers/usb"
if [ -z "$USB_DEVICE" ] || [ ! -e "$DRIVER_ROOT/$USB_DEVICE" ]; then
  udev_fallback
  exit 0
fi

UNBOUND=0
rebind_on_exit() {
  if [ "$UNBOUND" -eq 1 ]; then
    printf '%s' "$USB_DEVICE" > "$DRIVER_ROOT/bind" 2>/dev/null || true
  fi
}
trap rebind_on_exit EXIT

printf '%s' "$USB_DEVICE" > "$DRIVER_ROOT/unbind" || {
  printf 'USB mouse sürücüden ayrılamadı: %s\n' "$USB_DEVICE" >&2
  exit 31
}
UNBOUND=1
/usr/bin/sleep 1
printf '%s' "$USB_DEVICE" > "$DRIVER_ROOT/bind" || {
  printf 'USB mouse sürücüye yeniden bağlanamadı: %s\n' "$USB_DEVICE" >&2
  exit 32
}
UNBOUND=0
trap - EXIT
/usr/bin/udevadm settle 2>/dev/null || true
printf 'event%s USB aygıtı yeniden bağlandı: %s\n' "$EVENT_NUMBER" "$USB_DEVICE"
exit 0
`;

  const restore = spawn(
    "pkexec",
    [
      "/bin/bash",
      "-c",
      restoreScript,
      "communicatepars-mouse-restore",
      String(eventNumber),
      INPUT_SYSFS_ROOT,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  let finished = false;
  const finish = (error = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(authTimer);
    callback(error, stdout.trim());
  };
  const authTimer = setTimeout(() => {
    try { restore.kill("SIGTERM"); } catch (_) {}
    finish(new Error("Yetkili USB mouse geri bağlama işlemi zaman aşımına uğradı"));
  }, 60000);
  authTimer.unref();
  restore.stdout.on("data", (data) => { stdout = (stdout + data.toString()).slice(-4000); });
  restore.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-4000); });
  restore.once("error", (error) => finish(error));
  restore.once("close", (code) => {
    if (code === 0) return finish();
    finish(new Error(stderr.trim() || `Yetkili USB mouse geri bağlama kodu: ${code}`));
  });
}

function stopHidclient(eventNumber, callback = () => {}) {
  const child = hidclientProcess;
  hidclientProcess = null;
  hidclientReady = false;
  hidclientConnected = false;

  let finished = false;
  const finish = (error = null) => {
    if (finished) return;
    finished = true;
    restoreXInputEvent(eventNumber, (restoreError) => callback(error || restoreError || null));
  };

  console.warn("[Ctrl+K] Yetkili doğrudan HID kapatma (SIGKILL) başlatılıyor.");
  forceStopHidclient((error) => {
    // SIGKILL sonrasında yetkili sarmalayıcıyı da kapat. Ardından eski çalışan
    // sürümdeki ikinci pkexec ile seçilen event'in USB aygıtını unbind/bind yap.
    if (child && child.exitCode === null) {
      try { child.stdin.end(); } catch (_) {}
      try { child.kill("SIGTERM"); } catch (_) {}
    }
    if (error) return finish(error);
    console.warn(`[Ctrl+K] event${eventNumber} için yetkili USB geri bağlama başlatılıyor.`);
    restoreMouseHardware(eventNumber, (restoreError, output) => {
      if (output) console.log(`[mouse geri yükleme] ${output}`);
      finish(restoreError);
    });
  });
}

app.post("/ipad/control/stop", (req, res) => {
  console.log("STOP endpoint çağrıldı");

  const eventNumber = activeEventNumber || lastInputEventNumber;
  activeEventNumber = null;
  const peerAddress = hidclientPeerAddress;
  hidclientPeerAddress = "";

  stopHidclient(eventNumber, (error) => {
    if (error) {
      return res.status(500).json({
        success: false,
        active: false,
        message: "iPad kontrolü kapatılırken mouse geri yüklenemedi",
        error: error.message,
      });
    }

    stopBluetoothPairingMode();

    disconnectBluetoothDevice(peerAddress, (disconnectError) => {
      if (disconnectError) {
        console.error(
          "iPad Bluetooth bağlantısı kesilemedi:",
          disconnectError.message
        );
      }

      return res.json({
        success: true,
        active: false,
        eventNumber,
        message: `iPad kontrolü kapatıldı; event${eventNumber} mouse Pardus'a geri verildi.`,
      });
    });
  });
});

app.get("/ipad/control/status", (req, res) => {
  const active =
    hidclientReady && hidclientProcess !== null && hidclientProcess.exitCode === null;
  return res.json({
    success: true,
    active,
    ready: active,
    connected: active && hidclientConnected,
    eventNumber: activeEventNumber || lastInputEventNumber,
    error: active ? "" : hidclientLastError,
  });
});


function listSharedFiles() {
  return fs.readdirSync(SHARE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(SHARE_DIR, entry.name);
      const stat = fs.statSync(fullPath);
      const parts = entry.name.split("-");
      const displayName = repairFilenameEncoding(parts.length >= 3 ? parts.slice(2).join("-") : entry.name);
      return {
        id: entry.name,
        name: displayName,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        downloadUrl: `/share/files/${encodeURIComponent(entry.name)}`,
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function getWifiDevice(callback) {
  const child = spawn("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "device"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data.toString(); });
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  child.once("error", callback);
  child.once("close", (code) => {
    if (code !== 0) return callback(new Error(stderr.trim() || "Wi-Fi aygıtı bulunamadı"));
    const rows = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    const wifi = rows.map((line) => line.split(":"))
      .find((columns) => columns[1] === "wifi");
    if (!wifi || !wifi[0]) return callback(new Error("Pardus üzerinde Wi-Fi adaptörü bulunamadı"));
    callback(null, wifi[0]);
  });
}

function getHotspotInfo(callback) {
  const child = spawn("nmcli", ["-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (data) => { stdout += data.toString(); });
  child.once("error", callback);
  child.once("close", (code) => {
    if (code !== 0) return callback(null, { active: false });
    const line = stdout.split("\n").find((row) => row.startsWith(`${HOTSPOT_CONNECTION}:`));
    if (!line) return callback(null, { active: false });
    const columns = line.split(":");
    const device = columns[columns.length - 1];
    const ipChild = spawn("nmcli", ["-g", "IP4.ADDRESS", "device", "show", device], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let ipOutput = "";
    ipChild.stdout.on("data", (data) => { ipOutput += data.toString(); });
    ipChild.once("close", () => {
      const address = ipOutput.trim().split("\n")[0].split("/")[0] || "10.42.0.1";
      callback(null, {
        active: true,
        device,
        ssid: HOTSPOT_SSID,
        address,
        shareUrl: `http://${address}:${PORT}/share`,
      });
    });
  });
}

app.get("/network/hotspot/status", (_req, res) => {
  getHotspotInfo((error, info) => {
    if (error) return res.status(500).json({ success: false, active: false, message: error.message });
    return res.json({
      success: true,
      ...info,
      ...(info.active ? { password: HOTSPOT_PASSWORD } : {}),
    });
  });
});

app.post("/network/hotspot/start", (_req, res) => {
  if (HOTSPOT_PASSWORD.length < 8) {
    return res.status(500).json({ success: false, active: false, message: "Hotspot parolası en az 8 karakter olmalıdır" });
  }
  getHotspotInfo((statusError, current) => {
    if (!statusError && current.active) {
      return res.json({ success: true, ...current, password: HOTSPOT_PASSWORD, message: "Pardus ağı zaten açık" });
    }
    getWifiDevice((deviceError, device) => {
      if (deviceError) return res.status(503).json({ success: false, active: false, message: deviceError.message });
      const args = [
        "device", "wifi", "hotspot", "ifname", device,
        "con-name", HOTSPOT_CONNECTION, "ssid", HOTSPOT_SSID,
        "password", HOTSPOT_PASSWORD,
      ];
      const child = spawn("nmcli", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (data) => { stderr += data.toString(); });
      child.once("error", (error) => res.status(500).json({ success: false, active: false, message: error.message }));
      child.once("close", (code) => {
        if (res.headersSent) return;
        if (code !== 0) {
          console.error("Pardus ağı başlatma hatası:", stderr.trim());
          return res.status(500).json({
            success: false,
            active: false,
            message:
              "Pardus ağının açılabilmesi için kablosuz özelliğinin açık konumda olması gerekir.",
          });
        }
        getHotspotInfo((_infoError, info) => res.json({
          success: true,
          ...info,
          active: true,
          ssid: HOTSPOT_SSID,
          password: HOTSPOT_PASSWORD,
          message: "Pardus ağı açıldı. Telefonda bu ağa bağlanıp dosya paylaşım adresini aç.",
        }));
      });
    });
  });
});

app.post("/network/hotspot/stop", (_req, res) => {
  const child = spawn("nmcli", ["connection", "down", HOTSPOT_CONNECTION], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  child.once("error", (error) => res.status(500).json({ success: false, active: false, message: error.message }));
  child.once("close", (code) => {
    if (res.headersSent) return;
    if (code !== 0 && !/not active|unknown connection/i.test(stderr)) {
      return res.status(500).json({ success: false, active: false, message: stderr.trim() || "Pardus ağı kapatılamadı" });
    }
    return res.json({ success: true, active: false, message: "Pardus ağı kapatıldı" });
  });
});

app.get("/share/files", (_req, res) => {
  try {
    return res.json({ success: true, files: listSharedFiles() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/share/upload", upload.array("files", 20), (req, res) => {
  const files = (req.files || []).map((file) => ({
    id: file.filename,
    name: safeOriginalName(file.originalname),
    size: file.size,
  }));
  return res.status(201).json({ success: true, files, message: `${files.length} dosya alındı` });
});

app.get("/share/files/:id", (req, res) => {
  const id = path.basename(String(req.params.id || ""));
  const shareRoot = path.resolve(SHARE_DIR);
  const fullPath = path.resolve(shareRoot, id);

  if (!id || !fullPath.startsWith(shareRoot + path.sep)) {
    return res.status(400).json({ success: false, message: "Geçersiz dosya adresi" });
  }

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch (error) {
    console.error("Dosya bulunamadı:", { id, fullPath, error: error.message });
    return res.status(404).json({ success: false, message: "Dosya bulunamadı" });
  }

  if (!stat.isFile()) {
    return res.status(404).json({ success: false, message: "Dosya bulunamadı" });
  }

  const parts = id.split("-");
  const originalName = parts.length >= 3 ? parts.slice(2).join("-") : id;
  const downloadName = safeOriginalName(repairFilenameEncoding(originalName));

  res.status(200);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  res.setHeader("Cache-Control", "no-store");

  const stream = fs.createReadStream(fullPath);
  stream.once("error", (error) => {
    console.error("Dosya okuma hatası:", { id, fullPath, error: error.message });
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: `Dosya okunamadı: ${error.message}` });
    } else {
      res.destroy(error);
    }
  });
  stream.pipe(res);
});

app.delete("/share/files/:id", (req, res) => {
  const id = path.basename(String(req.params.id || ""));
  const fullPath = path.join(SHARE_DIR, id);
  if (!id || !fs.existsSync(fullPath)) return res.status(404).json({ success: false, message: "Dosya bulunamadı" });
  fs.unlinkSync(fullPath);
  return res.json({ success: true, message: "Dosya silindi" });
});

function readPowerDevices(callback) {
  const child = spawn("upower", ["-d"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data.toString(); });
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  child.once("error", callback);
  child.once("close", (code) => {
    if (code !== 0) {
      return callback(new Error(stderr.trim() || "Pil bilgileri alınamadı. UPower kurulu olmayabilir."));
    }
    const sections = stdout.split(/\n(?=Device:)/).map((section) => section.trim()).filter(Boolean);
    const devices = [];
    for (const section of sections) {
      const getValue = (key) => {
        const match = section.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "im"));
        return match ? match[1].trim() : "";
      };
      const devicePath = getValue("Device");
      const nativePath = getValue("native-path");
      const vendor = getValue("vendor");
      const model = getValue("model");
      const percentage = Number.parseInt(getValue("percentage").replace("%", ""), 10);
      const state = getValue("state").toLowerCase();
      const powerSupply = getValue("power supply").toLowerCase() === "yes";
      const rechargeable = getValue("rechargeable").toLowerCase() === "yes";
      if (!Number.isFinite(percentage)) continue;
      const searchableText = [devicePath, nativePath, vendor, model].join(" ").toLowerCase();
      let type = "other";
      if (powerSupply || /bat[0-9]|battery_bat|displaydevice/.test(searchableText)) type = "pc";
      else if (/mouse|pointer|logitech|razer/.test(searchableText)) type = "mouse";
      else if (/keyboard|kbd/.test(searchableText)) type = "keyboard";
      else if (/headset|headphone|audio/.test(searchableText)) type = "headset";
      else if (/bluetooth|bluez|hid/.test(searchableText)) type = "bluetooth";
      devices.push({
        id: devicePath || nativePath || `${type}-${devices.length}`,
        type,
        name: [vendor, model].filter(Boolean).join(" ") ||
          (type === "pc" ? "Bilgisayar Pili" :
            type === "mouse" ? "Bluetooth Mouse" :
              type === "keyboard" ? "Bluetooth Klavye" :
                type === "headset" ? "Bluetooth Kulaklık" :
                  type === "bluetooth" ? "Bluetooth Cihazı" : "Pil"),
        percentage,
        state,
        charging: ["charging", "fully-charged", "pending-charge"].includes(state),
        rechargeable,
        nativePath,
      });
    }
    const uniqueDevices = [];
    for (const device of devices) {
      const duplicate = uniqueDevices.some((saved) =>
        saved.id === device.id ||
        (device.type === "pc" && saved.type === "pc" && saved.percentage === device.percentage)
      );
      if (!duplicate) uniqueDevices.push(device);
    }
    callback(null, uniqueDevices);
  });
}
app.get("/system/batteries", (_req, res) => {
  readPowerDevices((error, devices) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Pil bilgileri alınamadı",
        error: error.message,
        devices: [],
      });
    }
    return res.json({ success: true, devices });
  });
});

function getTabletUrls(port = 1701) {
  const urls = [];
  const ignoredInterface = /^(lo|docker|br-|veth|virbr|tun|tap|tailscale)/i;
  let interfaces;
  try {
    interfaces = os.networkInterfaces();
  } catch (error) {
    console.error(`Yerel ağ adresleri okunamadı: ${error.message}`);
    return urls;
  }
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    if (ignoredInterface.test(interfaceName)) continue;
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) urls.push(`http://${address.address}:${port}`);
    }
  }
  return [...new Set(urls)];
}

function waitForTcpPort(port, timeoutMs, callback) {
  const startedAt = Date.now();
  const tryConnect = () => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let finished = false;
    const finishAttempt = (ready) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (ready) return callback(null);
      if (Date.now() - startedAt >= timeoutMs) {
        return callback(new Error(`${port} numaralı port zamanında açılmadı`));
      }
      setTimeout(tryConnect, 300);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finishAttempt(true));
    socket.once("error", () => finishAttempt(false));
    socket.once("timeout", () => finishAttempt(false));
  };
  tryConnect();
}

function resolveWeylusCommand(callback) {
  exec("command -v weylus", (nativeError, nativeStdout) => {
    if (!nativeError && nativeStdout.trim()) {
      return callback(null, {
        command: nativeStdout.trim().split("\n")[0],
        args: ["--no-gui"],
        source: "native",
      });
    }
    exec("command -v flatpak", (flatpakError, flatpakStdout) => {
      if (flatpakError || !flatpakStdout.trim()) return callback(new Error("Weylus bulunamadı. Weylus veya Flatpak sürümünü kur."));
      exec("flatpak info io.github.electronstudio.WeylusCommunityEdition", (infoError) => {
        if (infoError) return callback(new Error("Weylus bulunamadı. Weylus Community Edition Flatpak paketini kur."));
        callback(null, {
          command: flatpakStdout.trim().split("\n")[0],
          args: ["run", "io.github.electronstudio.WeylusCommunityEdition", "--no-gui"],
          source: "flatpak",
        });
      });
    });
  });
}
app.post("/tablet/start", (_req, res) => {
  if (weylusProcess && weylusProcess.exitCode === null) {
    return res.status(weylusReady ? 200 : 409).json({
      success: weylusReady,
      active: weylusReady,
      urls: getTabletUrls(),
      message: weylusReady
        ? "İkinci Ekran servisi zaten çalışıyor."
        : "Weylus başlatılıyor; lütfen bekleyin.",
    });
  }
  resolveWeylusCommand((lookupError, launcher) => {
    if (lookupError) return res.status(503).json({ success: false, active: false, message: lookupError.message });
    weylusReady = false;
    weylusLastError = "";
    const child = spawn(launcher.command, launcher.args, {
      env: {
        ...process.env,
        DISPLAY: X11_DISPLAY,
        XAUTHORITY: X11_AUTHORITY,
        WEYLUS_LOG_LEVEL: "INFO",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    weylusProcess = child;
    let answered = false;
    let output = "";
    let stderr = "";
    child.stdout.on("data", data => {
      const message = data.toString();
      output = (output + message).slice(-12000);
      if (message.trim()) console.log(`[weylus] ${message.trim()}`);
    });
    child.stderr.on("data", data => {
      const message = data.toString();
      stderr = (stderr + message).slice(-12000);
      weylusLastError = message.trim() || weylusLastError;
      if (message.trim()) console.error(`[weylus hata] ${message.trim()}`);
    });
    child.once("spawn", () => {
      waitForTcpPort(1701, 25000, (readyError) => {
        if (answered || res.headersSent) return;
        if (readyError) {
          answered = true;
          weylusLastError = stderr.trim() || output.trim() || readyError.message;
          try { child.kill("SIGTERM"); } catch (_) {}
          return res.status(504).json({
            success: false,
            active: false,
            message: "Weylus web sunucusu başlatılamadı.",
            error: weylusLastError,
          });
        }
        answered = true;
        weylusReady = true;
        const urls = getTabletUrls();
        return res.status(202).json({
          success: true,
          active: true,
          urls,
          source: launcher.source,
          message: urls.length
            ? `Hazır. iPad Safari'de şu adresi açın: ${urls[0]}`
            : "Hazır; ancak yerel ağ adresi bulunamadı.",
        });
      });
    });
    child.once("error", error => {
      if (weylusProcess === child) weylusProcess = null;
      weylusReady = false;
      weylusLastError = error.message;
      if (!answered && !res.headersSent) { answered=true; res.status(500).json({ success:false, active:false, message:`İkinci Ekran servisi başlatılamadı: ${error.message}` }); }
    });
    child.once("close", code => {
      console.log(`Weylus kapandı. Kod: ${code}`);
      if (weylusProcess === child) weylusProcess = null;
      weylusReady = false;
      if (!answered && !res.headersSent) {
        answered = true;
        weylusLastError = stderr.trim() || output.trim() || `Weylus kodu: ${code}`;
        res.status(500).json({
          success: false,
          active: false,
          message: "Weylus başlatılamadan kapandı.",
          error: weylusLastError,
        });
      }
    });
  });
});
app.post("/tablet/stop", (_req, res) => {
  const child=weylusProcess; weylusProcess=null; weylusReady=false;
  if (!child || child.exitCode !== null) return res.json({ success:true, active:false, message:"İkinci Ekran servisi zaten kapalı." });
  try {
    child.kill("SIGTERM");
    const forceTimer=setTimeout(() => { if(child.exitCode===null) child.kill("SIGKILL"); },3000); forceTimer.unref();
  } catch(error) { return res.status(500).json({ success:false, active:false, message:`İkinci Ekran servisi kapatılamadı: ${error.message}` }); }
  res.json({ success:true, active:false, message:"İkinci Ekran servisi kapatıldı." });
});
app.get("/tablet/status", (_req, res) => {
  const active=weylusReady && weylusProcess!==null && weylusProcess.exitCode===null;
  res.json({ success:true, active, urls:getTabletUrls(), error:active ? "" : weylusLastError });
});

app.get("/share/health", (req, res) => {
  return res.json({
    success: true,
    message: "Telefon bağlantısı çalışıyor",
    server: "CommunicatePars",
    port: PORT,
    clientIp: req.ip,
  });
});

app.get("/share", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CommunicatePars Dosya Paylaşımı</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;max-width:850px;margin:auto;padding:24px;background:#0f172a;color:#e2e8f0}section{background:#1e293b;padding:22px;border-radius:18px;margin:16px 0}button,input{font:inherit;padding:12px;border-radius:10px;border:0}button{display:inline-block;background:#22d3ee;color:#082f49;font-weight:800;cursor:pointer;padding:12px;border-radius:10px}.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.file-picker-group{display:grid;gap:8px;width:100%;margin-bottom:14px}.file-picker-group label{display:flex;align-items:center;justify-content:center;width:100%;box-sizing:border-box;padding:13px 16px;border:2px solid #22d3ee;border-radius:10px;background:#22d3ee;color:#082f49;font-weight:800;cursor:pointer}.file-picker-group label:hover{background:#67e8f9}.file-picker-group input[type="file"]{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)}.file{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #334155}.filename{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;font-weight:700;overflow-wrap:anywhere;word-break:break-word}a{color:#67e8f9;font-weight:700}small{color:#94a3b8}@media(max-width:560px){body{padding:14px}.file{align-items:flex-start}.actions>*{width:100%;box-sizing:border-box;text-align:center}}
</style></head><body><h1>CommunicatePars Dosya Paylaşımı</h1>
<section><h2>Dosya gönder</h2><p>Belge, PDF, ZIP ve diğer dosyalar için “Dosya seç”; kamera veya galeri için “Fotoğraf seç” kullan.</p>
<form id="upload">
<div class="file-picker-group">
<label for="documents">Dosya seç</label>
<input id="documents" name="documents" type="file" multiple>
</div>
<div class="file-picker-group">
<label for="photos">Fotoğraf seç</label>
<input id="photos" name="photos" type="file" multiple accept="image/*">
</div>
<button id="uploadButton" type="submit" disabled>Seçilenleri gönder</button>
<p id="selection">Henüz dosya seçilmedi.</p></form><p id="message"></p></section>
<section><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">Paylaşılan dosyalar</h2><p style="margin:8px 0 0;color:#cbd5e1;font-size:14px">Dosya görünmüyorsa Yenile düğmesine basın.</p></div><button id="refresh" type="button">Yenile</button></div><div id="list" style="margin-top:20px">Yükleniyor...</div></section>
<script>
const list=document.querySelector('#list'),msg=document.querySelector('#message');
const documents=document.querySelector('#documents'),photos=document.querySelector('#photos'),selection=document.querySelector('#selection'),uploadButton=document.querySelector('#uploadButton');
const size=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const selectedFiles=()=>[...documents.files,...photos.files];
function updateSelection(){const files=selectedFiles();selection.textContent=files.length?files.length+' dosya seçildi: '+files.map(f=>f.name).join(', '):'Henüz dosya seçilmedi.';uploadButton.disabled=!files.length}
async function refresh(){document.querySelector('#refresh').disabled=true;list.textContent='Yenileniyor...';try{const r=await fetch('/share/files',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();list.innerHTML=d.files.length?d.files.map(f=>'<div class="file"><span class="filename">'+escapeHtml(f.name)+'<br><small>'+size(f.size)+'</small></span><a href="'+f.downloadUrl+'">İndir</a></div>').join(''):'Henüz dosya yok. Dosya gönderildiyse Yenile düğmesine basın.'}catch(e){console.error('Dosya listesi yüklenemedi:',e);list.textContent='Yüklenemedi. Bağlantıyı kontrol edip Yenile düğmesine basın.'}finally{document.querySelector('#refresh').disabled=false}}
function escapeHtml(v){const e=document.createElement('div');e.textContent=v;return e.innerHTML}
documents.addEventListener('change',updateSelection);photos.addEventListener('change',updateSelection);document.querySelector('#refresh').addEventListener('click',refresh);
document.querySelector('#upload').addEventListener('submit',async e=>{e.preventDefault();const files=selectedFiles();if(!files.length)return;msg.textContent='Yükleniyor...';uploadButton.disabled=true;const body=new FormData();for(const f of files)body.append('files',f,f.name);try{const r=await fetch('/share/upload',{method:'POST',body});const d=await r.json();if(!r.ok)throw new Error(d.message||'Yükleme başarısız');msg.textContent=d.message||'Tamam';e.target.reset();updateSelection();await refresh()}catch(error){console.error('Dosya yüklenemedi:',error);msg.textContent='Yüklenemedi. Bağlantıyı kontrol edip tekrar deneyin.'}finally{uploadButton.disabled=!selectedFiles().length}});refresh();
</script></body></html>`);
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: error.code === "LIMIT_FILE_SIZE" ? "Dosya boyutu sınırı aşıldı" : error.message });
  }
  return next(error);
});

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "API adresi bulunamadı",
  });
});

app.use((error, req, res, next) => {
  console.error("Server hatası:", error);
  return res.status(500).json({
    success: false,
    message: "Beklenmeyen server hatası",
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`CommunicatePars Local Server çalışıyor: http://${HOST}:${PORT}`);
  console.log(`Telefon için varsayılan hotspot adresi: http://10.42.0.1:${PORT}/share`);
  console.log(`Bağlantı testi: http://10.42.0.1:${PORT}/share/health`);
  console.log(`X11 ekranı: ${X11_DISPLAY}`);
  console.log(`X11 authority: ${X11_AUTHORITY}`);
  console.log("Acil kapatma kısayolu: Sol Ctrl + K (masaüstü uygulaması)");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} kullanımda. Eski server sürecini kapatıp yeniden başlat.`);
  } else if (error.code === "EACCES") {
    console.error(`Port ${PORT} için erişim izni reddedildi.`);
  } else {
    console.error("HTTP server başlatılamadı:", error);
  }
});
