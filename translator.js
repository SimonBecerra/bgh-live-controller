// BGH LIVE Controller: live translation with Hope Translator (Electron main process).
// The controller keeps the Hope Translator broadcast page open in a hidden window of its own, signed in once and
// remembered (its own saved session, apart from Chrome's). Start presses the page's Play button for you; Stop presses
// it again. The page takes its sound from the microphone chosen on it (for the church: "Microphone (MIXER-AUDIO)"),
// so the translation hears the mixer even though nobody is looking at the window.
//
//   translator-status        → state now (opens the page in the background the first time)
//   translator-start {url}   → presses Play when signed in and not already translating
//   translator-stop          → presses it again
//   translator-show          → shows the window (to sign in, or check the microphone); closing it only hides it
//   "translator-state" event → {state, since, mic, error}, whenever it changes
//
// state: "off" (not opened yet) · "loading" · "signin" (signed out) · "ready" · "starting" · "running" · "stopping" · "error"
"use strict";
const { BrowserWindow, session, shell } = require("electron");

const PARTITION = "persist:hope-translator";
const HOST = /(^|\.)hopetranslator\.com$/i;
const POLL_MS = 1000;

// Runs inside the Hope Translator page. Finds the player bar by its timer (00:00) and the round Play button before it.
// Hope Translator doesn't label its buttons, so this reads the page the way a person does: the timer, then the button.
const PAGE = `(() => {
  const vis = el => { if(!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const txt = document.body ? document.body.innerText || "" : "";
  const signedOut = /\\/auth\\b|\\/login|\\/signin/i.test(location.pathname) || (!/Log out/i.test(txt) && /Sign in|Log in/i.test(txt));
  const timer = [...document.querySelectorAll("body *")].find(el => el.children.length === 0 && /^\\d{1,2}:\\d{2}(:\\d{2})?$/.test((el.textContent || "").trim()) && vis(el));
  let play = null;
  if(timer){
    // The nearest box around the timer that also holds a button: the player bar
    for(let box = timer.parentElement; box && box !== document.body && !play; box = box.parentElement){
      const before = [...box.querySelectorAll("button,[role=button]")].filter(b => vis(b) && (b.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING));
      if(before.length) play = before[before.length - 1];
    }
  }
  // The microphone chosen on the page (shown beside "Microphone")
  let mic = "";
  const lab = [...document.querySelectorAll("body *")].find(el => el.children.length === 0 && /^Microphone$/i.test((el.textContent || "").trim()));
  if(lab){ for(let box = lab.parentElement; box && box !== document.body; box = box.parentElement){ const m = (box.innerText || "").replace(/\\*/g, "").replace(/^\\s*Microphone\\s*/i, "").trim().split("\\n")[0]; if(m && box.innerText.length < 200){ mic = m; break; } } }
  window.__bghPlay = play;
  return {path:location.pathname, signedOut, timer:timer ? timer.textContent.trim() : "", hasPlay:!!play, mic};
})()`;
const CLICK = `(() => { const b = window.__bghPlay; if(!b) return false; b.click(); return true; })()`;

function setup({ ipcMain, getWin }) {
  let tw = null, quitting = false, pollT = null;
  let url = "";
  let st = { state: "off", since: 0, mic: "", error: "" };
  let lastTimer = "", movedAt = 0, stillFor = 0;

  const send = () => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send("translator-state", st); };
  const set = patch => {
    const next = { ...st, ...patch };
    if (JSON.stringify(next) === JSON.stringify(st)) return;
    st = next; send();
  };

  function permissions() {
    const ses = session.fromPartition(PARTITION);
    const ok = origin => { try { return HOST.test(new URL(origin).hostname); } catch (e) { return false; } };
    // The page may use the microphone (and play its own voice) without asking; nothing else
    ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ok(details.requestingUrl || wc.getURL()) && ["media", "audioCapture", "speaker-selection", "clipboard-sanitized-write"].includes(perm)));
    ses.setPermissionCheckHandler((wc, perm, origin) => ok(origin) && ["media", "audioCapture", "speaker-selection"].includes(perm));
    return ses;
  }

  function open(target) {
    if (tw && !tw.isDestroyed()) {
      if (target && tw.webContents.getURL() !== target) tw.loadURL(target);
      return tw;
    }
    tw = new BrowserWindow({
      width: 1200, height: 860, show: false, title: "Hope Translator · BGH LIVE Controller",
      autoHideMenuBar: true,
      // backgroundThrottling off: hidden, it must still hear the mixer and keep its connection up
      webPreferences: { session: permissions(), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    tw.setMenuBarVisibility(false);
    tw.webContents.setAudioMuted(true);   // its own spoken translation must never come out of the church speakers
    tw.loadURL(target || "https://www.hopetranslator.com/en");
    // Closing it hides it: the broadcast keeps going
    tw.on("close", e => { if (!quitting) { e.preventDefault(); tw.hide(); } });
    tw.on("closed", () => { tw = null; clearInterval(pollT); pollT = null; set({ state: "off", since: 0 }); });
    tw.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: "deny" }; });
    tw.webContents.on("did-start-loading", () => { if (!["running", "starting"].includes(st.state)) set({ state: "loading", error: "" }); });
    tw.webContents.on("render-process-gone", () => set({ state: "error", since: 0, error: "The Hope Translator page stopped. Press Start to open it again." }));
    tw.webContents.on("did-fail-load", (e, code, desc, u, main) => { if (main && code !== -3) set({ state: "error", since: 0, error: "Couldn't reach Hope Translator. Check the internet connection." }); });
    if (!pollT) pollT = setInterval(poll, POLL_MS);
    set({ state: "loading", error: "" });
    return tw;
  }

  async function read() {
    if (!tw || tw.isDestroyed() || tw.webContents.isLoading()) return null;
    try { return await tw.webContents.executeJavaScript(PAGE); } catch (e) { return null; }
  }

  // Running = the page's timer keeps moving. Stopped = it hasn't moved for 3 s.
  async function poll() {
    const p = await read();
    if (!p) return;
    if (p.timer !== lastTimer) { if (lastTimer) movedAt = Date.now(); lastTimer = p.timer; stillFor = 0; } else stillFor++;
    const moving = !!movedAt && Date.now() - movedAt < 3000;
    if (p.signedOut) return set({ state: "signin", since: 0, mic: "" });
    if (moving) return set({ state: st.state === "stopping" ? "stopping" : "running", since: st.since || Date.now() - secs(p.timer) * 1000, mic: p.mic, error: "" });
    if (st.state === "starting") return;   // start() decides
    if (!p.hasPlay) return set({ state: "loading", since: 0, mic: p.mic });
    set({ state: "ready", since: 0, mic: p.mic, error: st.state === "error" ? st.error : "" });
  }
  const secs = t => String(t || "").split(":").reduce((a, n) => a * 60 + (+n || 0), 0);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function waitFor(test, ms) {
    for (const end = Date.now() + ms; Date.now() < end;) { const v = await test(); if (v) return v; await wait(400); }
    return null;
  }

  async function start(target) {
    if (target) url = target;
    if (!url) return { ok: false, code: "NO_LINK", error: "Add the Hope Translator broadcast link in Settings → Translation first." };
    if (st.state === "running") return { ok: true, already: true };
    const w = open(url);
    if (!w.webContents.getURL().startsWith(url)) w.loadURL(url);
    set({ state: "starting", error: "" });
    // The page loaded and showing its player (or the sign-in page)
    const p = await waitFor(async () => { const r = await read(); return r && (r.signedOut || r.hasPlay) ? r : null; }, 25000);
    if (!p) return fail("TIMEOUT", "Hope Translator didn't finish loading. Open its window to see why.");
    if (p.signedOut) { set({ state: "signin" }); return { ok: false, code: "SIGNIN", error: "Hope Translator is signed out. Open its window and sign in once." }; }
    // Pressed with a "user gesture", so the page may start its microphone and sound
    lastTimer = p.timer; movedAt = 0;
    try { await w.webContents.executeJavaScript(CLICK, true); } catch (e) { return fail("CLICK", "Couldn't press Play on the Hope Translator page."); }
    const ok = await waitFor(async () => { await poll(); return movedAt ? true : null; }, 8000);
    if (!ok) return fail("NOT_STARTED", "Pressed Play, but Hope Translator's timer didn't start. Open its window and check it.");
    set({ state: "running", since: Date.now() - secs(lastTimer) * 1000, error: "" });
    return { ok: true };
  }

  async function stop() {
    if (st.state !== "running") return { ok: true, already: true };
    const p = await read();
    if (!p || !p.hasPlay) return fail("CLICK", "Couldn't find the Stop button on the Hope Translator page. Open its window and stop it there.");
    set({ state: "stopping" });
    try { await tw.webContents.executeJavaScript(CLICK, true); } catch (e) {}
    const stopped = await waitFor(async () => { await poll(); return movedAt && Date.now() - movedAt > 2500 ? true : null; }, 8000);
    if (!stopped) return fail("NOT_STOPPED", "Hope Translator is still running. Open its window and stop it there.", true);
    movedAt = 0;
    set({ state: "ready", since: 0, error: "" });
    return { ok: true };
  }

  function fail(code, error, keepRunning) {
    set({ state: keepRunning ? "running" : "error", error, ...(keepRunning ? {} : { since: 0 }) });
    return { ok: false, code, error };
  }

  function show(target) {
    if (target) url = target;
    const w = open(url || undefined);
    w.show(); w.focus();
    return true;
  }

  ipcMain.handle("translator-status", (e, q) => { if (q && q.url) { url = q.url; if (q.open) open(url); } return st; });
  ipcMain.handle("translator-start", (e, q) => start(q && q.url));
  ipcMain.handle("translator-stop", () => stop());
  ipcMain.handle("translator-show", (e, q) => show(q && q.url));

  return { close() { quitting = true; if (tw && !tw.isDestroyed()) tw.destroy(); } };
}

module.exports = { setup };
