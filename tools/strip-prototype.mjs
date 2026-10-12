// Removes everything prototype-only from the controller page.
//   As a build step:  node tools/strip-prototype.mjs src/obs-controller.html app/index.html
//   From code:        import { stripPrototype } from "./strip-prototype.mjs"
// 1. Removes every element marked data-proto (with its contents).
// 2. Removes code between "// #proto-start" and "// #proto-end".
// 3. Turns "// #real <code>" lines into real code.
// 4. Fails if any prototype-only name is still there.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

export function stripPrototype(html){
  const scripts = [];
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, m => `<!--SCRIPT${scripts.push(m) - 1}-->`);
  const dom = new JSDOM(html);
  const marked = dom.window.document.querySelectorAll("[data-proto]");
  marked.forEach(el => el.remove());
  html = dom.serialize();
  let blocks = 0;
  const strip = code => code
    .replace(/^[ \t]*\/\/ #proto-start[\s\S]*?^[ \t]*\/\/ #proto-end[^\n]*\n?/gm, () => { blocks++; return ""; })
    .replace(/^([ \t]*)\/\/ #real (.*)$/gm, "$1$2");
  html = html.replace(/<!--SCRIPT(\d+)-->/g, (_, i) => strip(scripts[+i]));
  const leftovers = ["#proto-start", "#proto-end", "data-sim", "MockOBS", "protoFail", "setFail", "protoBar", "_ProtoStreamDialog"]
    .filter(name => html.includes(name));
  if(leftovers.length) throw new Error(`Prototype-only code is still in the app: ${leftovers.join(", ")}`);
  return { html, elements: marked.length, blocks };
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const [src, out] = process.argv.slice(2);
  if(!src || !out){ console.error("Usage: node tools/strip-prototype.mjs <in.html> <out.html>"); process.exit(2); }
  try{
    const r = stripPrototype(readFileSync(src, "utf8"));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, r.html);
    console.log(`Removed ${r.elements} prototype-only elements and ${r.blocks} prototype-only code blocks → ${out}`);
  }catch(e){ console.error(`Build stopped: ${e.message}`); process.exit(1); }
}
