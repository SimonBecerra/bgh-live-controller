// Builds app/index.html (the controller as the desktop app shows it) from src/obs-controller.html:
// prototype-only parts removed, fonts and icons bundled so it works without internet, and the real
// OBS connection added. Run with: npm run build:renderer
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripPrototype } from "./strip-prototype.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = p => join(root, "node_modules", p);
const out = join(root, "app");
const vendor = join(out, "vendor");
mkdirSync(vendor, { recursive: true });

// Bundled copies of what the prototype loads from the internet
cpSync(nm("lucide/dist/umd/lucide.min.js"), join(vendor, "lucide.min.js"));
cpSync(nm("obs-websocket-js/dist/obs-ws.global.js"), join(vendor, "obs-ws.global.js"));
cpSync(nm("@fontsource/inter"), join(vendor, "fonts", "inter"), { recursive: true, filter: p => !/\.(woff)$/.test(p) || p.endsWith(".woff2") });
cpSync(nm("@fontsource/spectral"), join(vendor, "fonts", "spectral"), { recursive: true, filter: p => !/\.(woff)$/.test(p) || p.endsWith(".woff2") });
cpSync(nm("@fontsource/yellowtail"), join(vendor, "fonts", "yellowtail"), { recursive: true, filter: p => !/\.(woff)$/.test(p) || p.endsWith(".woff2") });

const { html: stripped, elements, blocks } = stripPrototype(readFileSync(join(root, "src", "obs-controller.html"), "utf8"));
let html = stripped;
const swap = (from, to) => {
  if(!from.test(html)) throw new Error(`Build stopped: couldn't find ${from} in the controller page`);
  html = html.replace(from, to);
};
swap(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/, "");
swap(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2[^"]*">/,
  ["400", "500", "600", "700", "800"].map(w => `<link rel="stylesheet" href="vendor/fonts/inter/${w}.css">`).join("") +
  `<link rel="stylesheet" href="vendor/fonts/spectral/700.css"><link rel="stylesheet" href="vendor/fonts/yellowtail/400.css">`);
swap(/<script src="https:\/\/unpkg\.com\/lucide@[^"]*"><\/script>/,
  `<script src="vendor/lucide.min.js"></script><script src="vendor/obs-ws.global.js"></script><script src="obs-connection.js"></script>`);
// Only local files, plus the WebSocket to OBS
swap(/<head>/, `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:">`);
if(/https:\/\/(unpkg|fonts\.googleapis|cdn)/.test(html)) throw new Error("Build stopped: the page still loads something from the internet");

writeFileSync(join(out, "index.html"), html);
console.log(`app/index.html built: ${elements} prototype-only elements and ${blocks} code blocks removed, fonts and icons bundled.`);

// The phone remote's page, served to phones by phone.js
const { html: phone, elements: phEls, blocks: phBlocks } = stripPrototype(readFileSync(join(root, "src", "phone.html"), "utf8"));
if(/PROTO_CTL|data-pt=/.test(phone)) throw new Error("Build stopped: the phone page still has prototype-only code");
if(/https?:\/\/(?!www\.w3\.org)/.test(phone.replace(/<!--[\s\S]*?-->/g, ""))) throw new Error("Build stopped: the phone page loads something from the internet");
writeFileSync(join(out, "phone.html"), phone);
console.log(`app/phone.html built: ${phEls} prototype-only elements and ${phBlocks} code blocks removed.`);

// Simple mode: the second window on the touchscreen (simple.js)
const { html: simple, elements: smEls, blocks: smBlocks } = stripPrototype(readFileSync(join(root, "src", "simple.html"), "utf8"));
if(/PROTO_SM/.test(simple)) throw new Error("Build stopped: the Simple mode page still has prototype-only code");
if(/https?:\/\/(?!www\.w3\.org)/.test(simple.replace(/<!--[\s\S]*?-->/g, ""))) throw new Error("Build stopped: the Simple mode page loads something from the internet");
writeFileSync(join(out, "simple.html"), simple);
console.log(`app/simple.html built: ${smEls} prototype-only elements and ${smBlocks} code blocks removed.`);
