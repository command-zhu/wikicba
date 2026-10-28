const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  call: (method, data) => ipcRenderer.invoke("api", method, data),
  filePath: (file) => webUtils.getPathForFile(file),
});
