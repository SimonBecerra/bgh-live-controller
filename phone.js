// BGH LIVE Controller: the phone remote (Electron main process).
// A small web server on the church network. A phone opens http://<this computer>:8642, pairs once with the
// 3-digit code shown in Settings → Phone remote, and from then on sees what the controller sees and sends taps.
// The controller page stays in charge: phones only ask it to do things (scene, mute, hymn, verse, lower third),
// and it answers with the same rules as its own buttons. Nothing here talks to OBS directly.
//
//   GET  /                 the phone page (app/phone.html)
//   POST /api/pair         {code, name} → {token}     only while Settings → Phone remote is open on the controller
//   GET  /api/events?t=…   Server-Sent Events: state (when it changes), lvl (mic level), frame (Program picture)
//   POST /api/cmd          {cmd, args, sid} with "Authorization: Bearer <token>" → the controller's answer
//
// Safety: only addresses on the local network are answered; tokens are stored hashed; 5 wrong codes lock
// pairing for 5 minutes; the code changes after every phone that pairs; a phone removed in Settings is cut off.
"use strict";
const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = 8642;
const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;
const hash = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const newCode = () => String(crypto.randomInt(0, 1000)).padStart(3, "0");

// Private, link-local and loopback addresses only (IPv4, IPv6 and IPv4-mapped IPv6)
function isLocal(addr) {
  let a = String(addr || "").toLowerCase();
  if (a.startsWith("::ffff:")) a = a.slice(7);
  if (a === "::1" || a.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(a)) return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [x, y] = [+m[1], +m[2]];
  return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
}
// Addresses a phone can use to reach this computer (Wi-Fi / Ethernet, IPv4)
function addresses() {
  if (process.env.BGH_PHONE_ADDRESS) return [process.env.BGH_PHONE_ADDRESS];   // for testing on machines without a private address
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== "IPv4" || i.internal || !isLocal(i.address) || i.address.startsWith("169.254.")) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vbox|utun|tailscale|zerotier/i.test(name)) continue;
      out.push(i.address);
    }
  }
  return out;
}
// "iPhone", "Android phone", "iPad"…, from the browser's description of itself
function deviceName(ua, given) {
  const g = String(given || "").trim().slice(0, 40);
  if (g) return g;
  ua = String(ua || "");
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  return "Phone";
}

function setup({ ipcMain, getWin, userData, appDir }) {
  const cfgFile = () => path.join(userData(), "phone-remote.json");
  let cfg = { enabled: false, devices: [] };   // devices: [{id, hash, name, pairedAt, lastSeen}]
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile(), "utf8")) }; } catch (e) {}
  const save = () => fsp.writeFile(cfgFile(), JSON.stringify(cfg, null, 2)).catch(() => {});

  let server = null, serverErr = "";
  let code = newCode(), pairingOpen = false, fails = 0, lockUntil = 0;
  const clients = new Map();   // sid → {res, device, view}
  let lastState = null, lastStateJson = "", lastFrame = "", lastLvl = -1;
  const pending = new Map();   // command id → {resolve, timer}
  let seq = 0;

  const send = (ch, data) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
  // The controller only does phone work (state, level, pictures) while a phone is connected
  function watch() {
    const view = [...clients.values()].some(c => c.view);
    send("phone-watch", { clients: clients.size, view });
  }
  const changed = () => send("phone-changed");
  const sse = (res, event, data) => { try { res.write(`event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`); } catch (e) {} };
  const broadcast = (event, data, only) => { for (const c of clients.values()) if (!only || only(c)) sse(c.res, event, data); };

  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0, buf = "";
      req.on("data", d => { size += d.length; if (size > 8192) { reject(new Error("too big")); req.destroy(); } else buf += d; });
      req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
      req.on("error", reject);
    });
  }
  function deviceFor(req, url) {
    const auth = String(req.headers.authorization || "");
    const tok = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("t");
    if (!tok) return null;
    const h = hash(tok);
    return cfg.devices.find(d => d.hash === h) || null;
  }
  function seen(d) {
    const now = Date.now();
    if (now - (d.lastSeen || 0) > 60000) { d.lastSeen = now; save(); }
  }

  async function handle(req, res) {
    if (!isLocal(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url, "http://phone");
    const p = url.pathname;
    try {
      if (req.method === "GET" && (p === "/" || p === "/index.html")) {
        const html = await fsp.readFile(path.join(appDir, "app", "phone.html"));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache",
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"
        });
        res.end(html);
        return;
      }
      if (req.method === "POST" && p === "/api/pair") {
        const b = await readBody(req);
        if (Date.now() < lockUntil) return json(res, 429, { code: "LOCKED", wait: Math.ceil((lockUntil - Date.now()) / 1000) });
        if (!pairingOpen) return json(res, 403, { code: "CLOSED" });
        if (String(b.code || "") !== code) {
          if (++fails >= MAX_FAILS) { fails = 0; lockUntil = Date.now() + LOCK_MS; code = newCode(); changed(); return json(res, 429, { code: "LOCKED", wait: LOCK_MS / 1000 }); }
          return json(res, 403, { code: "WRONG", left: MAX_FAILS - fails });
        }
        const token = crypto.randomBytes(24).toString("base64url");
        const d = { id: crypto.randomBytes(6).toString("hex"), hash: hash(token), name: deviceName(req.headers["user-agent"], b.name), pairedAt: Date.now(), lastSeen: Date.now() };
        cfg.devices.push(d); await save();
        fails = 0; code = newCode();   // the next phone needs the new code
        changed();
        send("phone-paired", { name: d.name });
        return json(res, 200, { token, name: d.name });
      }
      if (req.method === "GET" && p === "/api/events") {
        const d = deviceFor(req, url);
        if (!d) return json(res, 401, { code: "UNPAIRED" });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
        req.socket.setKeepAlive(true); req.socket.setNoDelay(true);
        const sid = crypto.randomBytes(8).toString("hex");
        const c = { res, device: d.id, view: url.searchParams.get("view") === "1" };
        clients.set(sid, c);
        res.write("retry: 2000\n\n");
        sse(res, "hello", { sid, name: d.name, now: Date.now() });
        if (lastStateJson) sse(res, "state", lastStateJson);
        if (c.view && lastFrame) sse(res, "frame", lastFrame);
        seen(d); watch(); changed();
        const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 15000);
        req.on("close", () => { clearInterval(ping); clients.delete(sid); watch(); changed(); });
        return;
      }
      if (req.method === "POST" && p === "/api/cmd") {
        const d = deviceFor(req, url);
        if (!d) return json(res, 401, { code: "UNPAIRED" });
        const b = await readBody(req);
        const cmd = String(b.cmd || ""), args = b.args && typeof b.args === "object" ? b.args : {};
        seen(d);
        if (cmd === "ping") return json(res, 200, { ok: true });
        if (cmd === "view") {   // this phone's "View program" switch (and whether its screen is on)
          const c = clients.get(String(b.sid || ""));
          if (c && c.device === d.id) { c.view = !!args.on; watch(); if (c.view && lastFrame) sse(c.res, "frame", lastFrame); }
          return json(res, 200, { ok: true });
        }
        const w = getWin();
        if (!w || w.isDestroyed()) return json(res, 503, { ok: false, error: "The controller isn't open." });
        const id = ++seq;
        const answer = await new Promise(resolve => {
          const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "The controller didn't answer. Try again." }); }, 15000);
          pending.set(id, { resolve, timer });
          send("phone-cmd", { id, cmd, args, device: d.name });
        });
        return json(res, 200, answer);
      }
      res.writeHead(404); res.end();
    } catch (e) {
      if (!res.headersSent) json(res, 400, { ok: false, error: "Bad request" });
    }
  }

  function start() {
    if (server) return Promise.resolve();
    return new Promise(resolve => {
      const s = http.createServer((req, res) => { handle(req, res); });
      s.keepAliveTimeout = 65000;
      s.on("error", e => {
        serverErr = e.code === "EADDRINUSE" ? `Port ${PORT} is in use by another program on this computer.` : (e.message || String(e));
        server = null; changed(); resolve();
      });
      s.listen(PORT, "0.0.0.0", () => { server = s; serverErr = ""; changed(); resolve(); });
    });
  }
  function stop() {
    for (const c of clients.values()) { try { c.res.end(); } catch (e) {} }
    clients.clear(); watch();
    if (server) { server.close(); server = null; }
    changed();
  }
  if (cfg.enabled) start();

  async function info() {
    const ips = addresses();
    const urls = ips.map(ip => `http://${ip}:${PORT}`);
    let qr = "";
    if (server && urls[0] && pairingOpen && Date.now() >= lockUntil) {
      try { qr = await require("qrcode").toString(`${urls[0]}/#pair=${code}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }); } catch (e) {}
    }
    const online = new Set([...clients.values()].map(c => c.device));
    return {
      enabled: !!cfg.enabled, running: !!server, error: serverErr, port: PORT, urls, qr,
      code: pairingOpen && Date.now() >= lockUntil ? code : "",
      lockedFor: Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000)),
      devices: cfg.devices.map(d => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen, online: online.has(d.id) }))
    };
  }

  ipcMain.handle("phone-info", () => info());
  ipcMain.handle("phone-enable", async (e, on) => {
    cfg.enabled = !!on; await save();
    if (cfg.enabled) await start(); else stop();
    return info();
  });
  // Settings → Phone remote open on the controller: only then does a code work
  ipcMain.handle("phone-pairing", (e, open) => { open = !!open; if (open && !pairingOpen) code = newCode(); pairingOpen = open; return info(); });
  ipcMain.handle("phone-remove", async (e, id) => {
    const d = cfg.devices.find(x => x.id === id);
    cfg.devices = cfg.devices.filter(x => x.id !== id); await save();
    for (const [sid, c] of clients) if (c.device === id) { sse(c.res, "unpaired", {}); try { c.res.end(); } catch (er) {} clients.delete(sid); }
    watch();
    return { removed: d ? d.name : "", ...(await info()) };
  });
  ipcMain.on("phone-state", (e, s) => {
    const j = JSON.stringify(s);
    if (j === lastStateJson) return;
    lastState = s; lastStateJson = j;
    broadcast("state", j);
  });
  ipcMain.on("phone-level", (e, l) => {
    const v = Math.max(0, Math.min(100, Math.round(Number(l) || 0)));
    if (v === lastLvl) return;
    lastLvl = v;
    broadcast("lvl", String(v));
  });
  ipcMain.on("phone-frame", (e, dataUrl) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/") || dataUrl.length > 400000) return;
    lastFrame = JSON.stringify({ img: dataUrl, at: Date.now() });
    broadcast("frame", lastFrame, c => c.view);
  });
  ipcMain.on("phone-reply", (e, r) => {
    const p = r && pending.get(r.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(r.id);
    p.resolve({ ok: !!r.ok, data: r.data, error: r.error, code: r.code });
  });
  // A page reload (or a new window) starts without knowing about connected phones
  ipcMain.handle("phone-watching", () => { const view = [...clients.values()].some(c => c.view); return { clients: clients.size, view }; });

  return { stop };
}

module.exports = { setup, isLocal, PORT };
