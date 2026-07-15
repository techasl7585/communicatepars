const express = require("express");
const cors = require("cors");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const { GlobalKeyboardListener } = require("node-global-key-listener");

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

const HIDCLIENT_PATH =
  "/home/aslpardus/Projeler/communicatepars/tools/hidclient/hidclient";
const X11_DISPLAY = process.env.DISPLAY || ":1";

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
let bluetoothAgentProcess = null;
let bluetoothPairingTimer = null;
let activeEventNumber = null;
let ctrlPressed = false;
const keyboard = new GlobalKeyboardListener();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  return res.json({
    app: "CommunicatePars Local Server",
    status: "running",
  });
});

app.get("/devices", (req, res) => {
  exec("adb devices", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "adb devices çalıştırılamadı",
        error: error.message,
        stderr,
      });
    }

    const devices = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("List of devices"))
      .map((line) => {
        const [id, status] = line.split(/\s+/);
        return { id, status };
      });

    return res.json({ success: true, devices });
  });
});

app.post("/mirror", (req, res) => {
  const child = exec("scrcpy -m1024", (error, stdout, stderr) => {
    if (error) console.error("scrcpy hatası:", error.message);
    if (stderr) console.error("scrcpy stderr:", stderr);
    if (stdout) console.log("scrcpy stdout:", stdout);
  });

  return res.json({
    success: true,
    message: "Telefon yansıtma başlatıldı",
    pid: child.pid,
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
    const child = spawn(uxplayPath, ["-n", "CommunicatePars", "-nh"], {
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
    // Yalnızca yeni cihaz eşleştirme görünürlüğünü kapatır.
    // hidclient ve mouse geri yükleme akışına dokunmaz.
    agent.stdin.write("discoverable off\n");
    agent.stdin.write("pairable off\n");
    agent.stdin.write("quit\n");
    agent.stdin.end();
  } catch (error) {
    console.error("Bluetooth eşleştirme modu kapatma hatası:", error.message);
    try { agent.kill("SIGTERM"); } catch (_) {}
  }
}







function disconnectBluetoothDevice(callback = () => {}) {
  exec(
    "bluetoothctl devices Connected",
    (error, stdout) => {
      if (error) {
        callback(error);
        return;
      }

      const devices = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (devices.length === 0) {
        callback(null, "Bağlı bluetooth cihazı yok");
        return;
      }

      let pending = devices.length;

      devices.forEach((line) => {
        const match = line.match(
          /Device\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i
        );

        if (!match) {
          pending--;

          if (pending === 0) {
            callback(null, "Bluetooth bağlantıları temizlendi");
          }

          return;
        }

        const mac = match[1];

        exec(`bluetoothctl disconnect ${mac}`, () => {
          console.log(`Bluetooth bağlantısı kesildi: ${mac}`);

          pending--;

          if (pending === 0) {
            callback(null, "Bluetooth bağlantıları temizlendi");
          }
        });
      });
    }
  );
}








app.post("/bluetooth/pairing/start", (req, res) => {
  if (bluetoothAgentProcess && bluetoothAgentProcess.exitCode === null) {
    return res.json({ success: true, active: true, message: "Yeni iOS eşleştirme modu zaten açık" });
  }
  exec("command -v bluetoothctl", (lookupError, stdout) => {
    if (lookupError || !stdout.trim()) {
      return res.status(503).json({ success: false, active: false, message: "bluetoothctl bulunamadı. Pardus'ta BlueZ paketini kur." });
    }
    const bluetoothctlPath = stdout.trim().split("\n")[0];
    const child = spawn(bluetoothctlPath, ["--agent", "NoInputNoOutput"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    bluetoothAgentProcess = child;
    let answered = false;
    let output = "";
    const fail = (message) => {
      if (bluetoothAgentProcess === child) bluetoothAgentProcess = null;
      if (!answered && !res.headersSent) {
        answered = true;
        return res.status(500).json({ success: false, active: false, message });
      }
    };
    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (text.trim()) console.log(`[bluetoothctl] ${text.trim()}`);
    });
    child.stderr.on("data", (data) => {
      const text = data.toString().trim();
      if (text) console.error(`[bluetoothctl hata] ${text}`);
    });
    child.once("error", (error) => fail(`Bluetooth eşleştirme modu açılamadı: ${error.message}`));
    child.once("close", (code) => {
      console.log(`Bluetooth eşleştirme agent kapandı. Kod: ${code}`);
      if (bluetoothAgentProcess === child) bluetoothAgentProcess = null;
    });
    child.once("spawn", () => {
      try {
        child.stdin.write("power on\n");
        child.stdin.write("agent NoInputNoOutput\n");
        child.stdin.write("default-agent\n");
        child.stdin.write("pairable on\n");
        child.stdin.write("discoverable-timeout 180\n");
        child.stdin.write("discoverable on\n");
      } catch (error) {
        fail(`Bluetooth komutları gönderilemedi: ${error.message}`);
        return;
      }
      setTimeout(() => {
        if (answered || res.headersSent) return;
        if (child.exitCode !== null) return fail("Bluetooth eşleştirme agent kapandı");
        answered = true;
        return res.json({
          success: true,
          active: true,
          message: "Yeni iOS eşleştirmesi açık. Bluetooth menüsünden CommunicatePars-Mouse cihazına bağlan.",
          output: output.trim(),
        });
      }, 900);
      bluetoothPairingTimer = setTimeout(stopBluetoothPairingMode, 180000);
      bluetoothPairingTimer.unref();
    });
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

app.get("/ipad/input/list", (req, res) => {
  const args = [
    "/usr/bin/env",
    `DISPLAY=${X11_DISPLAY}`,
    `XAUTHORITY=${X11_AUTHORITY}`,
    HIDCLIENT_PATH,
    "-l",
  ];

  const child = spawn("pkexec", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("error", (error) => {
    return res.status(500).json({
      success: false,
      message: "Input aygıtları listelenemedi",
      error: error.message,
    });
  });

  child.on("close", (code) => {
    if (res.headersSent) return;

    if (code !== 0) {
      return res.status(500).json({
        success: false,
        message: "Input aygıtları listelenemedi",
        error: `hidclient -l hata kodu: ${code}`,
        stderr,
      });
    }

    return res.json({ success: true, output: stdout });
  });
});

app.post("/ipad/control/start", (req, res) => {
  const eventNumber = String(req.body.eventNumber || "").trim();

  if (!/^[0-9]{1,2}$/.test(eventNumber)) {
    return res.status(400).json({
      success: false,
      active: false,
      message: "Geçerli bir event numarası gir",
    });
  }

  if (hidclientProcess && hidclientProcess.exitCode === null) {
    return res.json({
      success: true,
      active: true,
      message: "iPad kontrol sistemi zaten çalışıyor",
    });
  }

  activeEventNumber = eventNumber;

  hidclientProcess = spawn(
    "pkexec",
    [
      "/usr/bin/env",
      `DISPLAY=${X11_DISPLAY}`,
      `XAUTHORITY=${X11_AUTHORITY}`,
      HIDCLIENT_PATH,
      `-e${eventNumber}`,
      "-x",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  hidclientProcess.stdout.on("data", (data) => {
    const message = data.toString().trim();
    if (message) console.log(`[hidclient] ${message}`);
  });

  hidclientProcess.stderr.on("data", (data) => {
    const message = data.toString().trim();
    if (message) console.error(`[hidclient hata] ${message}`);
  });

  hidclientProcess.on("error", (error) => {
    console.error("hidclient başlatma hatası:", error.message);
    hidclientProcess = null;
    activeEventNumber = null;
  });

  hidclientProcess.on("close", (code) => {
    console.log(`hidclient kapandı. Kod: ${code}`);
    hidclientProcess = null;
  });

  return res.json({
    success: true,
    active: true,
    message:
      "Kontrol sistemi hazır. Şimdi iPad Bluetooth ayarlarından CommunicatePars-Mouse cihazına yeniden bağlan.",
  });
});

function stopHidclient() {
  exec("pkexec /usr/bin/pkill -9 -x hidclient");

  if (hidclientProcess) {
    try {
      hidclientProcess.kill("SIGKILL");
    } catch (_) {
      // Süreç zaten kapandıysa devam et.
    }
  }

  hidclientProcess = null;
}

function restoreMouse(eventNumber, callback) {
  if (!eventNumber) {
    callback(null, "Event numarası yok; yalnızca hidclient kapatıldı.");
    return;
  }

  const script = `
EVENT_PATH=$(readlink -f /sys/class/input/event${eventNumber}/device 2>/dev/null)
if [ -z "$EVENT_PATH" ]; then
  udevadm trigger --action=add --subsystem-match=input
  echo "Event yolu bulunamadı; udev tetiklendi."
  exit 0
fi

CURRENT="$EVENT_PATH"
USB_DEVICE=""

while [ "$CURRENT" != "/" ]; do
  if [ -f "$CURRENT/idVendor" ] && [ -f "$CURRENT/idProduct" ]; then
    USB_DEVICE=$(basename "$CURRENT")
    break
  fi
  CURRENT=$(dirname "$CURRENT")
done

if [ -n "$USB_DEVICE" ] && [ -e "/sys/bus/usb/drivers/usb/$USB_DEVICE" ]; then
  echo "$USB_DEVICE" > /sys/bus/usb/drivers/usb/unbind
  sleep 1
  echo "$USB_DEVICE" > /sys/bus/usb/drivers/usb/bind
  echo "USB mouse yeniden bağlandı: $USB_DEVICE"
else
  udevadm trigger --action=add --subsystem-match=input
  echo "USB aygıtı bulunamadı; udev tetiklendi."
fi
`;

  const child = spawn("pkexec", ["/bin/bash", "-c", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      callback(new Error(stderr || `Mouse geri yükleme hata kodu: ${code}`));
      return;
    }
    callback(null, stdout.trim() || "Mouse Pardus'a geri verildi.");
  });
}

function stopIpadControlFromShortcut() {
  console.log("CTRL + K ile iPad kontrolü kapatılıyor");

  const eventNumber = activeEventNumber;
  activeEventNumber = null;

  stopHidclient();

  restoreMouse(eventNumber, (error, output) => {
    if (error) {
      console.error("Mouse geri yükleme hatası:", error.message);
      return;
    }

    console.log(output);

    disconnectBluetoothDevice((disconnectError) => {
      if (disconnectError) {
        console.error(
          "Bluetooth bağlantısı kesilemedi:",
          disconnectError.message
        );
      } else {
        console.log("Bluetooth bağlantısı sonlandırıldı.");
      }
    });
  });
}

app.post("/ipad/control/stop", (req, res) => {
  console.log("STOP endpoint çağrıldı");

  const eventNumber = activeEventNumber;
  activeEventNumber = null;

  stopHidclient();

  restoreMouse(eventNumber, (error, output) => {
    if (error) {
      return res.status(500).json({
        success: false,
        active: false,
        message: "hidclient kapatıldı ancak mouse geri yüklenemedi",
        error: error.message,
      });
    }

    disconnectBluetoothDevice((disconnectError) => {
      if (disconnectError) {
        console.error(
          "Bluetooth bağlantısı kesilemedi:",
          disconnectError.message
        );
      }

      return res.json({
        success: true,
        active: false,
        message:
          (output || "Mouse Pardus'a geri verildi.") +
          " Bluetooth bağlantısı sonlandırıldı.",
      });
    });
  });
});

app.get("/ipad/control/status", (req, res) => {
  const active =
    hidclientProcess !== null && hidclientProcess.exitCode === null;
  return res.json({ success: true, active });
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
        if (code !== 0) return res.status(500).json({ success: false, active: false, message: stderr.trim() || "Pardus ağı açılamadı" });
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
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;max-width:850px;margin:auto;padding:24px;background:#0f172a;color:#e2e8f0}section{background:#1e293b;padding:22px;border-radius:18px;margin:16px 0}button,input{font:inherit;padding:12px;border-radius:10px;border:0}button{display:inline-block;background:#22d3ee;color:#082f49;font-weight:800;cursor:pointer;padding:12px;border-radius:10px}.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.file-picker-group{display:grid;gap:8px;width:100%;margin-bottom:14px}.file-picker-group label{color:#e2e8f0;font-weight:800}.file-picker-group input[type="file"]{display:block;width:100%;box-sizing:border-box;padding:12px;border:2px solid #22d3ee;border-radius:10px;background:#f8fafc;color:#0f172a;cursor:pointer}.file-picker-group input[type="file"]::file-selector-button{margin-right:12px;padding:10px 14px;border:0;border-radius:8px;background:#22d3ee;color:#082f49;font-weight:800;cursor:pointer}.file{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #334155}.filename{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;font-weight:700;overflow-wrap:anywhere;word-break:break-word}a{color:#67e8f9;font-weight:700}small{color:#94a3b8}@media(max-width:560px){body{padding:14px}.file{align-items:flex-start}.actions>*{width:100%;box-sizing:border-box;text-align:center}}
</style></head><body><h1>CommunicatePars Dosya Paylaşımı</h1><p>Pardus ile aynı ağa bağlı cihazlardan dosya gönderip indirebilirsin.</p>
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
<section><div class="actions" style="justify-content:space-between"><h2 style="margin:0">Paylaşılan dosyalar</h2><button id="refresh" type="button">Yenile</button></div><div id="list">Yükleniyor...</div></section>
<script>
const list=document.querySelector('#list'),msg=document.querySelector('#message');
const documents=document.querySelector('#documents'),photos=document.querySelector('#photos'),selection=document.querySelector('#selection'),uploadButton=document.querySelector('#uploadButton');
const size=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const selectedFiles=()=>[...documents.files,...photos.files];
function updateSelection(){const files=selectedFiles();selection.textContent=files.length?files.length+' dosya seçildi: '+files.map(f=>f.name).join(', '):'Henüz dosya seçilmedi.';uploadButton.disabled=!files.length}
async function refresh(){document.querySelector('#refresh').disabled=true;list.textContent='Yenileniyor...';try{const r=await fetch('/share/files',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.message||'Liste alınamadı');list.innerHTML=d.files.length?d.files.map(f=>'<div class="file"><span class="filename">'+escapeHtml(f.name)+'<br><small>'+size(f.size)+'</small></span><a href="'+f.downloadUrl+'">İndir</a></div>').join(''):'Henüz dosya yok.'}catch(e){list.textContent=e.message}finally{document.querySelector('#refresh').disabled=false}}
function escapeHtml(v){const e=document.createElement('div');e.textContent=v;return e.innerHTML}
documents.addEventListener('change',updateSelection);photos.addEventListener('change',updateSelection);document.querySelector('#refresh').addEventListener('click',refresh);
document.querySelector('#upload').addEventListener('submit',async e=>{e.preventDefault();const files=selectedFiles();if(!files.length)return;msg.textContent='Yükleniyor...';uploadButton.disabled=true;const body=new FormData();for(const f of files)body.append('files',f,f.name);try{const r=await fetch('/share/upload',{method:'POST',body});const d=await r.json();if(!r.ok)throw new Error(d.message||'Yükleme başarısız');msg.textContent=d.message||'Tamam';e.target.reset();updateSelection();await refresh()}catch(error){msg.textContent=error.message}finally{uploadButton.disabled=!selectedFiles().length}});refresh();
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

keyboard.addListener((event) => {
  if (event.name === "LEFT CTRL" && event.state === "DOWN") {
    ctrlPressed = true;
  }

  if (event.name === "LEFT CTRL" && event.state === "UP") {
    ctrlPressed = false;
  }

  if (ctrlPressed && event.name === "K" && event.state === "DOWN") {
    stopIpadControlFromShortcut();
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`CommunicatePars Local Server çalışıyor: http://${HOST}:${PORT}`);
  console.log(`Telefon için varsayılan hotspot adresi: http://10.42.0.1:${PORT}/share`);
  console.log(`Bağlantı testi: http://10.42.0.1:${PORT}/share/health`);
  console.log(`X11 ekranı: ${X11_DISPLAY}`);
  console.log(`X11 authority: ${X11_AUTHORITY}`);
  console.log("Acil kapatma kısayolu: Sol Ctrl + K");
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