const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://127.0.0.1:5173");
    //win.webContents.openDevTools();                                       //developer konsol açma
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});