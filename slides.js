/* BGH LIVE Controller: the slideshow played on this laptop (Settings → Slideshow, "Played on this laptop").
 *
 * The controller opens the Google Slides link in Chrome, in its own window with its own profile ("Slideshow
 * browser" in the controller's folder, so it never mixes with everyday browsing and needs no sign-in for a slideshow
 * shared as "Anyone with the link"). Chrome is started with its DevTools connection on 127.0.0.1 only; the controller
 * drives the slideshow through it: → / ← key presses go straight into the page (the touchscreen keeps focus), the
 * window's title is kept as "BGH Slideshow" so OBS's Window Capture always finds it, and the slide number is read
 * back when the page shows it.
 *   - Second monitor: full screen there.
 *   - One monitor ("behind"): full screen behind the controller, which comes back to the front. Chrome is told not to
 *     pause a covered window, so OBS keeps capturing it.
 * Closing: from the controller, or when the livestream ends. If the window is closed by hand, the controller hears.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const TITLE = "BGH Slideshow";
const wait = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  if (process.env.BGH_SLIDES_BROWSER) return { exe: process.env.BGH_SLIDES_BROWSER, name: "Chrome" };
  const pf = process.env.ProgramFiles || "C:\\Program Files", pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    local = process.env.LOCALAPPDATA || "";
  const list = process.platform === "win32" ? [
    [path.join(pf, "Google", "Chrome", "Application", "chrome.exe"), "Chrome"],
    [path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"), "Chrome"],
    [path.join(local, "Google", "Chrome", "Application", "chrome.exe"), "Chrome"],
    [path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), "Edge"],
    [path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"), "Edge"]
  ] : process.platform === "darwin" ? [
    ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "Chrome"]
  ] : [["/usr/bin/google-chrome", "Chrome"], ["/usr/bin/chromium", "Chrome"], ["/usr/bin/chromium-browser", "Chrome"]];
  const hit = list.find(([p]) => p && fs.existsSync(p));
  return hit ? { exe: hit[0], name: hit[1] } : null;
}
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.unref();
  s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
const getJson = (port, p) => new Promise((res, rej) => {
  const req = http.get({ host: "127.0.0.1", port, path: p, timeout: 1500 }, r => {
    let body = ""; r.on("data", c => body += c); r.on("end", () => { try { res(JSON.parse(body)); } catch (e) { rej(e); } });
  });
  req.on("error", rej); req.on("timeout", () => req.destroy(new Error("timeout")));
});

// Kept as the window's title so OBS's Window Capture finds it; runs on every page load
const KEEP_TITLE = `(() => { if (window.__bghTitle) return; window.__bghTitle = true;
  const T = ${JSON.stringify(TITLE)}; const fix = () => { if (document.title !== T) { window.__bghDeck = document.title; document.title = T; } };
  setInterval(fix, 500); document.addEventListener("DOMContentLoaded", fix); fix(); })()`;
// Where the slideshow is, when the page says so ("Slide 3 of 12", "3 / 12"); otherwise nothing
const READ_POS = `(() => {
  const deck = String(window.__bghDeck || "").replace(/\\s*[-–]\\s*Google Slides\\s*$/i, "").trim();
  const seen = [...document.querySelectorAll("[aria-label],[aria-valuetext],[role=option][aria-selected=true]")].slice(0, 400)
    .map(e => e.getAttribute("aria-valuetext") || e.getAttribute("aria-label") || e.textContent || "");
  for (const t of seen) { const m = String(t).match(/slide\\s+(\\d+)\\s+(?:of|\\/)\\s+(\\d+)/i); if (m) return { n: +m[1], total: +m[2], deck }; }
  return { deck };
})()`;

module.exports.setup = ({ ipcMain, getWin, userData, screen }) => {
  let child = null, ws = null, port = 0, msgId = 0, exeName = "chrome.exe";
  const pending = new Map();
  const state = { open: false, n: 0, total: 0, title: "" };
  const tell = () => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send("slides-state", { ...state }); };

  const send = (method, params = {}) => new Promise((res, rej) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return rej(new Error("The slideshow window isn't open."));
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("The slideshow didn't answer.")); } }, 4000);
  });
  const evaluate = async expr => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : undefined; };

  function gone() {
    if (!state.open && !child) return;
    Object.assign(state, { open: false, n: 0, total: 0 });
    try { if (ws) ws.close(); } catch (e) {}
    ws = null; child = null; tell();
  }

  async function connect() {
    // The slideshow page (not Chrome's own pages), once Chrome is up
    for (let i = 0; i < 60; i++) {
      try {
        const list = await getJson(port, "/json/list");
        const page = list.find(t => t.type === "page" && /^https?:/.test(t.url || "")) || list.find(t => t.type === "page");
        if (page && page.webSocketDebuggerUrl) {
          ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
          await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
          ws.on("message", m => { let d; try { d = JSON.parse(m); } catch (e) { return; } const p = d.id && pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } });
          ws.on("close", () => { if (ws) gone(); });
          return;
        }
      } catch (e) { /* not up yet */ }
      await wait(250);
    }
    throw new Error("Chrome didn't open the slideshow.");
  }

  async function readPos() {
    try {
      const p = await evaluate(READ_POS);
      if (p && p.deck) state.title = p.deck;
      if (p && p.n) { state.n = p.n; state.total = p.total || 0; }
    } catch (e) {}
  }

  async function open({ id, url, screen: where }) {
    const b = findBrowser();
    if (!b) throw new Error("Chrome isn't installed on this computer. Install Google Chrome, then try again.");
    await close();
    exeName = path.basename(b.exe);
    port = await freePort();
    const win = getWin();
    const disp = where && where !== "behind" ? screen.getAllDisplays().find(d => String(d.id) === String(where)) : null;
    const d = disp || (win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay());
    const target = url || `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/present?usp=sharing`;
    const profile = path.join(userData, "Slideshow browser");
    fs.mkdirSync(profile, { recursive: true });
    child = spawn(b.exe, [
      `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1",
      "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--hide-crash-restore-bubble",
      // Keep drawing while covered by the controller (one monitor), so OBS's capture doesn't freeze
      "--disable-features=CalculateNativeWinOcclusion,Translate", "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
      `--window-position=${d.bounds.x + 20},${d.bounds.y + 20}`, `--window-size=${d.bounds.width},${d.bounds.height}`,
      "--kiosk", `--app=${target}`
    ], { stdio: "ignore", detached: false });
    child.on("exit", () => gone());
    child.on("error", () => gone());
    await connect();
    await send("Page.enable").catch(() => {});
    await send("Page.addScriptToEvaluateOnNewDocument", { source: KEEP_TITLE }).catch(() => {});
    // The page acts as if it has focus, so it takes the key presses while the touchscreen keeps the real focus
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await evaluate(KEEP_TITLE).catch(() => {});
    Object.assign(state, { open: true, n: 1, total: 0, title: "" });
    // One monitor: the slideshow goes behind the controller
    if (!disp && win && !win.isDestroyed()) {
      for (const ms of [600, 1500, 3000]) setTimeout(() => {
        if (win.isDestroyed()) return;
        win.setAlwaysOnTop(true); win.show(); win.focus();
        setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); }, 400);
      }, ms);
    }
    for (let i = 0; i < 12 && !state.title; i++) { await wait(500); await readPos(); }
    tell();
    return { ...state, exe: exeName, windowTitle: TITLE };
  }

  async function step(dir) {
    if (!state.open) throw new Error("The slideshow isn't open.");
    const key = dir > 0 ? { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 } : { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key, nativeVirtualKeyCode: key.windowsVirtualKeyCode });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...key, nativeVirtualKeyCode: key.windowsVirtualKeyCode });
    const before = state.n;
    await wait(250);
    await readPos();
    // The page didn't say where it is: count here
    if (state.n === before) state.n = Math.max(1, state.n + (dir > 0 ? 1 : -1));
    if (state.total) state.n = Math.min(state.total, state.n);
    tell();
    return { ...state };
  }

  async function close() {
    const c = child;
    if (!c && !ws) return;
    try { await send("Browser.close"); } catch (e) {}
    await wait(300);
    try { if (c && c.exitCode === null) c.kill(); } catch (e) {}
    gone();
  }

  ipcMain.handle("slides-open", async (e, q) => { try { return { ok: true, ...(await open(q || {})) }; } catch (err) { await close().catch(() => {}); return { ok: false, error: err.message }; } });
  ipcMain.handle("slides-step", async (e, d) => { try { return { ok: true, ...(await step(Number(d) || 1)) }; } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle("slides-close", async () => { await close(); return { ok: true }; });
  ipcMain.handle("slides-state", () => ({ ...state }));
  return { close };
};
