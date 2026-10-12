// BGH LIVE Controller: the bridge between the controller page and the desktop app.
// The page sees only window.bgh and these functions; it has no other access to the computer.
"use strict";
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("bgh", {
  displays: () => ipcRenderer.invoke("displays"),
  onDisplaysChanged: fn => ipcRenderer.on("displays-changed", (e, d) => fn(d)),
  place: opts => ipcRenderer.invoke("place", opts),
  identify: () => ipcRenderer.invoke("identify"),
  touchSetup: () => ipcRenderer.invoke("touch-setup"),
  listFolder: folder => ipcRenderer.invoke("list-folder", folder),
  readCollection: name => ipcRenderer.invoke("read-collection", name),
  secret: {
    get: key => ipcRenderer.invoke("secret-get", key),
    set: (key, value) => ipcRenderer.invoke("secret-set", key, value)
  },
  keepAwake: on => ipcRenderer.invoke("keep-awake", !!on),
  setOpenWithObs: enabled => ipcRenderer.invoke("open-with-obs", !!enabled),
  saveFile: (name, text) => ipcRenderer.invoke("save-file", name, text),
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  isFullscreen: () => ipcRenderer.invoke("is-fullscreen"),
  onFullscreenChanged: fn => ipcRenderer.on("fullscreen-changed", (e, on) => fn(on)),
  setZoom: z => webFrame.setZoomFactor(Number(z) || 1),
  bringToFront: () => ipcRenderer.invoke("bring-to-front"),
  setOpenObs: on => ipcRenderer.invoke("set-open-obs", !!on),
  obsConnected: () => ipcRenderer.invoke("obs-connected"),
  onMessage: fn => ipcRenderer.on("app-message", (e, text) => fn(text)),
  quit: () => ipcRenderer.invoke("quit"),
  version: () => ipcRenderer.invoke("version"),
  openedByObs: () => ipcRenderer.invoke("opened-by-obs")
});
