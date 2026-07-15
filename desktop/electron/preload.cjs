const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("communicatePars", {
  chooseFiles: (kind) => ipcRenderer.invoke("share:choose-files", kind),
  saveSharedFile: (file) => ipcRenderer.invoke("share:save-file", {
    id: file.id,
    name: file.name,
  }),
});