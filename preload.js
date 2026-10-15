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
  setStartTitle: data => ipcRenderer.invoke("start-title", data),
  saveFile: (name, text, kind) => ipcRenderer.invoke("save-file", name, text, kind),
  bible: {
    status: () => ipcRenderer.invoke("bible-status"),
    lookup: q => ipcRenderer.invoke("bible-lookup", q)
  },
  appCpu: () => ipcRenderer.invoke("app-cpu"),
  slides: {
    open: q => ipcRenderer.invoke("slides-open", q),
    step: d => ipcRenderer.invoke("slides-step", d),
    close: () => ipcRenderer.invoke("slides-close"),
    state: () => ipcRenderer.invoke("slides-state"),
    onState: fn => ipcRenderer.on("slides-state", (e, s) => fn(s))
  },
  phone: {
    info: () => ipcRenderer.invoke("phone-info"),
    enable: on => ipcRenderer.invoke("phone-enable", !!on),
    pairing: open => ipcRenderer.invoke("phone-pairing", !!open),
    remove: id => ipcRenderer.invoke("phone-remove", String(id)),
    watching: () => ipcRenderer.invoke("phone-watching"),
    state: s => ipcRenderer.send("phone-state", s),
    level: l => ipcRenderer.send("phone-level", l),
    frame: dataUrl => ipcRenderer.send("phone-frame", dataUrl),
    slide: dataUrl => ipcRenderer.send("phone-slide", dataUrl),
    reply: r => ipcRenderer.send("phone-reply", r),
    onCmd: fn => ipcRenderer.on("phone-cmd", (e, c) => fn(c)),
    onWatch: fn => ipcRenderer.on("phone-watch", (e, w) => fn(w)),
    onChanged: fn => ipcRenderer.on("phone-changed", () => fn()),
    onPaired: fn => ipcRenderer.on("phone-paired", (e, d) => fn(d))
  },
  youtube: {
    viewers: q => ipcRenderer.invoke("youtube-viewers", q),
    test: q => ipcRenderer.invoke("youtube-test", q)
  },
  hymns: {
    list: () => ipcRenderer.invoke("hymns-list"),
    save: book => ipcRenderer.invoke("hymns-save", book),
    remove: id => ipcRenderer.invoke("hymns-remove", id)
  },
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  isFullscreen: () => ipcRenderer.invoke("is-fullscreen"),
  onFullscreenChanged: fn => ipcRenderer.on("fullscreen-changed", (e, on) => fn(on)),
  setZoom: z => webFrame.setZoomFactor(Number(z) || 1),
  bringToFront: () => ipcRenderer.invoke("bring-to-front"),
  setOpenObs: on => ipcRenderer.invoke("set-open-obs", !!on),
  setCloseObs: on => ipcRenderer.invoke("set-close-obs", !!on),
  onClosing: fn => ipcRenderer.on("closing", () => fn()),
  closeAnswer: choice => ipcRenderer.invoke("close-answer", choice),
  getStartAtLogin: () => ipcRenderer.invoke("get-start-at-login"),
  setStartAtLogin: on => ipcRenderer.invoke("set-start-at-login", !!on),
  obsConnected: () => ipcRenderer.invoke("obs-connected"),
  onMessage: fn => ipcRenderer.on("app-message", (e, text) => fn(text)),
  plugin: {
    status: () => ipcRenderer.invoke("plugin-status"),
    install: () => ipcRenderer.invoke("plugin-install")
  },
  appUpdate: {
    status: () => ipcRenderer.invoke("app-update-status"),
    check: () => ipcRenderer.invoke("app-update-check"),
    install: () => ipcRenderer.invoke("app-update-install"),
    onChange: fn => ipcRenderer.on("app-update", (e, u) => fn(u))
  },
  quit: () => ipcRenderer.invoke("quit"),
  version: () => ipcRenderer.invoke("version"),
  openedByObs: () => ipcRenderer.invoke("opened-by-obs")
});
