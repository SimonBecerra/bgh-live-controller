// BGH LIVE Controller: the bridge for the Simple mode window. It can only hear what the controller sends
// and ask the controller to do things; it has no other access to the computer.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bghSimple", {
  hello: () => ipcRenderer.invoke("simple-hello"),
  cmd: (cmd, args) => ipcRenderer.invoke("simple-cmd", String(cmd), args || {}),
  onState: fn => ipcRenderer.on("simple-state", (e, s) => fn(s)),
  onLevel: fn => ipcRenderer.on("simple-level", (e, l) => fn(l)),
  onFrame: fn => ipcRenderer.on("simple-frame", (e, f) => fn(f)),
  onToast: fn => ipcRenderer.on("simple-toast", (e, t) => fn(t))
});
