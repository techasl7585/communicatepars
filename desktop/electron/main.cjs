const { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Wayland oturumlarında Electron genel kısayollarını masaüstü portalı
// üzerinden kaydedebilsin. Bu anahtar app hazır olmadan önce verilmelidir.
app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

const SHARE_DIR = process.env.COMMUNICATEPARS_SHARE_DIR ||
  path.join(os.homedir(), ".local", "share", "communicatepars", "uploads");

fs.mkdirSync(SHARE_DIR, { recursive: true });

function safeName(name) {
  return path.basename(String(name || "dosya"))
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .trim() || "dosya";
}

function storedName(originalName) {
  const clean = safeName(originalName);
  const extension = path.extname(clean);
  const stem = path.basename(clean, extension).slice(0, 120);
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${stem}${extension}`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    autoHideMenuBar: true,
    minWidth: 1100,
    minHeight: 700,
    title: "CommunicatePars",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // target="_blank" bağlantıları için ikinci, boş bir Electron penceresi
  // oluşturma. Web adreslerini sistemin varsayılan tarayıcısında aç.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Global kısayol portalı kullanılamıyorsa, CommunicatePars penceresi odaktayken
  // Ctrl+K yine de mouse geri alma isteğini çalıştırsın.
  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.control &&
      !input.alt &&
      !input.meta &&
      String(input.key || "").toLowerCase() === "k"
    ) {
      event.preventDefault();
      void stopIpadControlFromShortcut();
    }
  });

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://127.0.0.1:5173");
    //win.webContents.openDevTools();                                       //developer konsol açma
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

let shortcutStopInFlight = false;

async function stopIpadControlFromShortcut() {
  if (shortcutStopInFlight) return;
  shortcutStopInFlight = true;
  try {
    const response = await net.fetch("http://127.0.0.1:5050/ipad/control/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const message = await response.text();
    console.log(`[Ctrl+K] iPad kontrolü durdurma: ${response.status} ${message}`);
    if (!response.ok) {
      void dialog.showMessageBox({
        type: "error",
        title: "Mouse geri alınamadı",
        message: "Ctrl+K mouse'u geri alamadı",
        detail: message,
      });
    }
  } catch (error) {
    console.error(`[Ctrl+K] iPad kontrolü durdurulamadı: ${error.message}`);
    void dialog.showMessageBox({
      type: "error",
      title: "Mouse geri alınamadı",
      message: "CommunicatePars sunucusuna ulaşılamadı",
      detail: error.message,
    });
  } finally {
    shortcutStopInFlight = false;
  }
}

ipcMain.handle("share:choose-files", async (event, kind = "all") => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const filters = kind === "images"
    ? [{ name: "Görseller", extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"] }]
    : [{ name: "Tüm dosyalar", extensions: ["*"] }];

  const result = await dialog.showOpenDialog(parent, {
    title: kind === "images" ? "Paylaşılacak fotoğrafları seç" : "Paylaşılacak dosyaları seç",
    properties: ["openFile", "multiSelections"],
    filters,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: true, canceled: true, count: 0 };
  }

  const copied = [];
  for (const sourcePath of result.filePaths) {
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) continue;
    const destination = path.join(SHARE_DIR, storedName(path.basename(sourcePath)));
    fs.copyFileSync(sourcePath, destination);
    copied.push(path.basename(sourcePath));
  }

  return {
    success: true,
    canceled: false,
    count: copied.length,
    names: copied,
    message: `${copied.length} dosya paylaşıma eklendi`,
  };
});

ipcMain.handle("share:save-file", async (event, file) => {
  const id = path.basename(String(file?.id || ""));
  const shareRoot = path.resolve(SHARE_DIR);
  const sourcePath = path.resolve(shareRoot, id);

  if (!id || !sourcePath.startsWith(shareRoot + path.sep) || !fs.existsSync(sourcePath)) {
    return { success: false, message: "Kaynak dosya bulunamadı" };
  }

  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(parent, {
    title: "Dosyayı kaydet",
    defaultPath: path.join(app.getPath("downloads"), safeName(file?.name || id)),
  });

  if (result.canceled || !result.filePath) {
    return { success: true, canceled: true };
  }

  fs.copyFileSync(sourcePath, result.filePath);
  return { success: true, canceled: false, message: `Dosya kaydedildi: ${result.filePath}` };
});

app.whenReady().then(() => {
  const shortcutRegistered = globalShortcut.register("Control+K", () => {
    void stopIpadControlFromShortcut();
  });
  if (!shortcutRegistered) {
    console.warn("[uyarı] Sol Ctrl + K genel kısayolu kaydedilemedi.");
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
