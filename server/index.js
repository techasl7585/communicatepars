const express = require("express");
const cors = require("cors");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { GlobalKeyboardListener } = require("node-global-key-listener");

const app = express();
const PORT = 5050;

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

app.listen(PORT, () => {
  console.log(`CommunicatePars Local Server çalışıyor: http://localhost:${PORT}`);
  console.log(`X11 ekranı: ${X11_DISPLAY}`);
  console.log(`X11 authority: ${X11_AUTHORITY}`);
  console.log("Acil kapatma kısayolu: Sol Ctrl + K");
});