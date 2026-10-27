// BGH LIVE Controller: Simple mode, a second window for the touchscreen.
// With two screens, the full controller stays on the main monitor and this window fills the touchscreen.
// It has no connection to OBS of its own: the controller sends it what's happening (like the phone remote)
// and runs what it asks for, so the rules are the same everywhere.
"use strict";
const { BrowserWindow, screen } = require("electron");
const path = require("node:path");

function setup({ ipcMain, getWin, appDir }) {
  let sw = null, displayId = null, lastState = null, lastFrame = "";
  const pending = new Map();   // command id → {resolve, timer}
  let seq = 0;
  const toMain = (ch, data) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
  const toSimple = (ch, data) => { if (sw && !sw.isDestroyed()) sw.webContents.send(ch, data); };
  const status = () => toMain("simple-status", { open: !!sw, displayId });

  function fill(d) {
    if (!sw || sw.isDestroyed()) return;
    if (sw.isFullScreen()) sw.setFullScreen(false);
    sw.setBounds(d.bounds);
    sw.setFullScreen(true);
  }
  function open(id) {
    const d = screen.getAllDisplays().find(x => x.id === id);
    if (!d) return close();
    displayId = id;
    if (sw && !sw.isDestroyed()) { fill(d); status(); return; }
    sw = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false, backgroundColor: "#0c0f13", title: "BGH LIVE Simple mode",
      icon: path.join(appDir, "build", "icon.ico"),
      webPreferences: { preload: path.join(appDir, "preload-simple.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
    });
    sw.loadFile(path.join(appDir, "app", "simple.html"));
    sw.once("ready-to-show", () => { if (!sw) return; fill(d); sw.showInactive(); });
    sw.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    sw.webContents.on("will-navigate", e => e.preventDefault());
    sw.webContents.on("render-process-gone", () => { setTimeout(() => { if (sw && !sw.isDestroyed()) sw.reload(); }, 1000); });
    // Closed some other way (Alt+F4): the controller hears, so it doesn't think Simple mode is still there
    sw.on("closed", () => { sw = null; displayId = null; status(); });
    status();
  }
  function close() {
    displayId = null;
    if (sw && !sw.isDestroyed()) { const w = sw; sw = null; w.destroy(); }
    status();
  }
  // Its monitor was unplugged: close straight away, before Windows moves it onto the main monitor
  screen.on("display-removed", (e, d) => { if (sw && d.id === displayId) close(); });

  ipcMain.handle("simple-open", (e, id) => { open(Number(id)); return { open: !!sw, displayId }; });
  ipcMain.handle("simple-close", () => { close(); return { open: false }; });
  ipcMain.handle("simple-status", () => ({ open: !!sw, displayId }));
  ipcMain.handle("simple-focus", () => { if (sw && !sw.isDestroyed()) { sw.show(); sw.moveTop(); } return !!sw; });
  // From the controller
  ipcMain.on("simple-state", (e, s) => { lastState = s; toSimple("simple-state", s); });
  ipcMain.on("simple-level", (e, l) => toSimple("simple-level", Math.max(0, Math.min(100, Math.round(Number(l) || 0)))));
  ipcMain.on("simple-frame", (e, dataUrl) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/") || dataUrl.length > 1500000) return;
    lastFrame = dataUrl; toSimple("simple-frame", dataUrl);
  });
  // Studio Mode: the Preview picture
  ipcMain.on("simple-pframe", (e, dataUrl) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/") || dataUrl.length > 1500000) return;
    toSimple("simple-pframe", dataUrl);
  });
  ipcMain.on("simple-toast", (e, text) => toSimple("simple-toast", String(text || "").slice(0, 300)));
  ipcMain.on("simple-reply", (e, r) => {
    const p = r && pending.get(r.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(r.id);
    p.resolve({ ok: !!r.ok, data: r.data, error: r.error, code: r.code });
  });
  // From Simple mode
  ipcMain.handle("simple-hello", () => ({ state: lastState, frame: lastFrame }));
  ipcMain.handle("simple-cmd", (e, cmd, args) => {
    const w = getWin();
    if (!w || w.isDestroyed()) return { ok: false, error: "The controller isn't open." };
    const id = ++seq;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "The controller didn't answer. Try again." }); }, 15000);
      pending.set(id, { resolve, timer });
      toMain("simple-cmd", { id, cmd: String(cmd || ""), args: args && typeof args === "object" ? args : {} });
    });
  });

  return { close, isOpen: () => !!sw };
}

module.exports = { setup };
