// BGH LIVE Controller: desktop app (Electron main process).
// The controller itself is app/index.html; this file gives it a window and the few things a web page can't do:
// choosing a monitor, reading the Schedule folder and OBS's saved scene collections, keeping the password
// encrypted, keeping the screen awake, saving files, and the "open with OBS" setting for the plug-in.
"use strict";
const { app, BrowserWindow, ipcMain, screen, safeStorage, powerSaveBlocker, dialog, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { spawn } = require("node:child_process");

app.setName("BGH LIVE Controller");
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null;
let awakeId = null;
const userData = () => app.getPath("userData");   // %APPDATA%\BGH LIVE Controller

/* ---------------------------------------------------------------- monitors */
function describeDisplays() {
  const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
  return all.map((d, i) => {
    const w = Math.round(d.size.width * d.scaleFactor), h = Math.round(d.size.height * d.scaleFactor);
    let pos = "main";
    if (d.id !== primary.id) {
      const dx = (d.bounds.x + d.bounds.width / 2) - (primary.bounds.x + primary.bounds.width / 2);
      const dy = (d.bounds.y + d.bounds.height / 2) - (primary.bounds.y + primary.bounds.height / 2);
      pos = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right of main" : "left of main") : (dy > 0 ? "below main" : "above main");
    }
    return { id: d.id, label: d.label || `Display ${i + 1}`, size: `${w}×${h}`, primary: d.id === primary.id, pos, touch: d.touchSupport === "available" };
  });
}
let lastDisplays = [];
function displaysChanged(kind, display) {
  const list = describeDisplays();
  const desc = list.find(x => x.id === display.id) || lastDisplays.find(x => x.id === display.id) || { id: display.id, label: display.label || "Display", size: "", pos: "" };
  lastDisplays = list;
  if (win && !win.isDestroyed()) win.webContents.send("displays-changed", { list, added: kind === "added" ? desc : null, removed: kind === "removed" ? desc : null });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
let windowedBounds = null;
async function place({ displayId, full, corner }) {
  if (!win) return;
  const d = screen.getAllDisplays().find(x => x.id === displayId) || screen.getPrimaryDisplay();
  const wa = d.workArea;
  if (win.isFullScreen()) { win.setFullScreen(false); await wait(350); }
  win.setAlwaysOnTop(false);
  if (corner) {
    // While live and the touchscreen is gone: a small window in a corner of the main monitor, above OBS
    const w = Math.min(620, wa.width), h = Math.min(480, wa.height);
    win.setBounds({ x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h });
    win.setAlwaysOnTop(true, "floating");
    return;
  }
  if (full) {
    win.setBounds({ x: wa.x + 40, y: wa.y + 40, width: Math.min(1280, wa.width - 80), height: Math.min(800, wa.height - 80) });
    await wait(50);
    win.setFullScreen(true);
    return;
  }
  const w = Math.min(windowedBounds?.width || 1280, wa.width), h = Math.min(windowedBounds?.height || 800, wa.height);
  win.setBounds({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h });
}

// "Identify monitors": each monitor shows its number and name for 4 seconds
function identify() {
  describeDisplays().forEach((desc, i) => {
    const d = screen.getAllDisplays().find(x => x.id === desc.id);
    const w = 520, h = 260;
    const tag = new BrowserWindow({
      x: d.bounds.x + Math.round((d.bounds.width - w) / 2), y: d.bounds.y + Math.round((d.bounds.height - h) / 2),
      width: w, height: h, frame: false, transparent: true, alwaysOnTop: true, focusable: false, skipTaskbar: true,
      resizable: false, webPreferences: { sandbox: true }
    });
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const html = `<body style="margin:0;font-family:Segoe UI,sans-serif;background:rgba(10,15,20,.92);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;border-radius:20px;border:4px solid #F5B700;box-sizing:border-box">
      <div style="font-size:120px;font-weight:800;line-height:1">${i + 1}</div><div style="font-size:24px;margin-top:8px">${esc(desc.label)}</div>
      <div style="font-size:16px;opacity:.7;margin-top:4px">${esc(desc.size)} · ${esc(desc.primary ? "main" : desc.pos)}</div></body>`;
    tag.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    setTimeout(() => { if (!tag.isDestroyed()) tag.close(); }, 4000);
  });
}

/* ---------------------------------------------------------------- files */
const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tga|tiff?)$/i;
async function listFolder(folder) {
  try {
    const entries = await fsp.readdir(folder, { withFileTypes: true });
    // OBS saves image paths with forward slashes (C:/Users/...); answer in the same style as the folder
    // asked for, so the controller can match the image OBS shows against the folder's files
    const sep = folder.includes("/") && !folder.includes("\\") ? "/" : path.sep;
    const dir = folder.replace(/[\\/]+$/, "");
    return entries.filter(e => e.isFile() && IMAGE_EXT.test(e.name))
      .map(e => dir + sep + e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch (e) { return null; }
}

// OBS saves each scene collection as a JSON file in %APPDATA%\obs-studio\basic\scenes
async function readCollection(name) {
  const dir = path.join(app.getPath("appData"), "obs-studio", "basic", "scenes");
  let files = [];
  try { files = (await fsp.readdir(dir)).filter(f => f.toLowerCase().endsWith(".json")); } catch (e) { return null; }
  for (const f of files) {
    try {
      const json = JSON.parse(await fsp.readFile(path.join(dir, f), "utf8"));
      if (json.name !== name) continue;
      const sources = Array.isArray(json.sources) ? json.sources : [];
      const scenes = Array.isArray(json.scene_order) && json.scene_order.length
        ? json.scene_order.map(s => s.name)
        : sources.filter(s => s.id === "scene").map(s => s.name);
      const inputs = {};
      sources.filter(s => s.id !== "scene" && s.id !== "group").forEach(s => { inputs[s.name] = { kind: s.versioned_id || s.id }; });
      return { scenes, inputs };
    } catch (e) { /* a damaged or half-written file: skip it */ }
  }
  return null;
}

/* ---------------------------------------------------------------- secrets (the OBS password) */
const secretsFile = () => path.join(userData(), "secrets.json");
function readSecrets() { try { return JSON.parse(fs.readFileSync(secretsFile(), "utf8")); } catch (e) { return {}; } }
function getSecret(key) {
  const s = readSecrets()[key];
  if (!s || !safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(Buffer.from(s, "base64")); } catch (e) { return null; }
}
function setSecret(key, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Encryption isn't available");
  const all = readSecrets();
  all[key] = safeStorage.encryptString(String(value)).toString("base64");
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(secretsFile(), JSON.stringify(all));
  return true;
}

/* ---------------------------------------------------------------- IPC */
ipcMain.handle("displays", () => (lastDisplays = describeDisplays()));
ipcMain.handle("place", (e, opts) => place(opts || {}));
ipcMain.handle("identify", () => identify());
ipcMain.handle("touch-setup", () => {
  // Windows' own "Tablet PC Settings → Setup → Touch input": asks you to tap the touchscreen once
  const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "MultiDigiMon.exe");
  try { spawn(exe, ["-touch"], { detached: true, stdio: "ignore" }).unref(); return true; } catch (e) { return false; }
});
ipcMain.handle("list-folder", (e, folder) => listFolder(String(folder || "")));
ipcMain.handle("read-collection", (e, name) => readCollection(String(name || "")));
ipcMain.handle("secret-get", (e, key) => getSecret(String(key)));
ipcMain.handle("secret-set", (e, key, value) => setSecret(String(key), value));
ipcMain.handle("keep-awake", (e, on) => {
  if (on && awakeId === null) awakeId = powerSaveBlocker.start("prevent-display-sleep");
  if (!on && awakeId !== null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
  return awakeId !== null;
});
// The plug-in reads this when OBS starts (see the plug-in's openControllerIfWanted)
ipcMain.handle("open-with-obs", (e, enabled) => {
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(path.join(userData(), "open-with-obs.json"), JSON.stringify({ enabled: !!enabled, exePath: process.execPath }));
  return true;
});
ipcMain.handle("save-file", async (e, name, text) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), String(name)), filters: [{ name: "Settings backup", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, String(text), "utf8");
  return r.filePath;
});
ipcMain.handle("toggle-fullscreen", () => { if (win) win.setFullScreen(!win.isFullScreen()); return win ? win.isFullScreen() : false; });
ipcMain.handle("is-fullscreen", () => (win ? win.isFullScreen() : false));
ipcMain.handle("quit", () => app.quit());
// After going live on a one-monitor setup: bring the controller back in front of OBS.
// Windows doesn't let a background app simply take focus, so it's briefly made "always on top".
ipcMain.handle("bring-to-front", () => {
  if (!win || win.isDestroyed()) return false;
  const wasOnTop = win.isAlwaysOnTop();
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true, "screen-saver");
  win.show(); win.moveTop(); win.focus();
  setTimeout(() => { if (win && !win.isDestroyed() && !wasOnTop) win.setAlwaysOnTop(false); }, 400);
  return true;
});
ipcMain.handle("version", () => app.getVersion());
ipcMain.handle("opened-by-obs", () => process.argv.includes("--opened-by-obs"));

/* ---------------------------------------------------------------- window */
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 480, show: false,
    title: "BGH LIVE Controller", backgroundColor: "#0B1418",
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.once("ready-to-show", () => win.show());
  // Remember the window's size for windowed mode
  win.on("resized", () => { if (!win.isFullScreen() && !win.isAlwaysOnTop()) windowedBounds = win.getBounds(); });
  win.on("enter-full-screen", () => win.webContents.send("fullscreen-changed", true));
  win.on("leave-full-screen", () => win.webContents.send("fullscreen-changed", false));
  // Nothing opens inside the controller: links go to the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) e.preventDefault(); });
  // If the page ever crashes, load it again instead of leaving a blank screen
  win.webContents.on("render-process-gone", () => { setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 1000); });
  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => {
  // Opened again (for example by OBS starting): bring the existing controller forward
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});

app.whenReady().then(() => {
  lastDisplays = describeDisplays();
  screen.on("display-added", (e, d) => displaysChanged("added", d));
  screen.on("display-removed", (e, d) => displaysChanged("removed", d));
  createWindow();
});
app.on("window-all-closed", () => app.quit());
