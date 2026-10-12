// BGH LIVE Controller: Bible text for the "Scripture & Hymns" source (Electron main process).
//
// The controller page works out the reference (book, chapters and verses) and asks here for the words:
//   KJV                      bundled with the app (public domain), works without internet
//   ESV                      Crossway's ESV API (api.esv.org), with the church's free API key
//   NKJV, NIV, CSB, NASB 1995  API.Bible (rest.api.bible), with the church's API key, where the publisher
//                            allows it on that key's plan
// Keys are kept encrypted by Windows (the same store as the OBS password) and never reach the page.
// Copyrighted text is only kept in memory while the app is open, never saved to disk.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TRANSLATIONS = [
  {abbr:"KJV", name:"King James Version", source:"local"},
  {abbr:"NKJV", name:"New King James Version", source:"apibible", match:b => /^nkjv$/i.test(b.abbreviation || b.abbreviationLocal) || /new king james/i.test(b.name)},
  {abbr:"ESV", name:"English Standard Version", source:"esv"},
  {abbr:"NIV", name:"New International Version", source:"apibible", match:b => /^niv(\d{4})?$/i.test(b.abbreviation || b.abbreviationLocal) || /new international version/i.test(b.name) && !/reader/i.test(b.name)},
  {abbr:"CSB", name:"Christian Standard Bible", source:"apibible", match:b => /^csb$/i.test(b.abbreviation || b.abbreviationLocal) || /^christian standard bible/i.test(b.name)},
  {abbr:"NASB 1995", name:"New American Standard Bible 1995", source:"apibible", match:b => /^nasb.?(19)?95$/i.test(b.abbreviation || b.abbreviationLocal) || /new american standard.*1995/i.test(b.name)}
];

module.exports = function createBible({dataDir, userData, getSecret, fetchImpl = globalThis.fetch}){
  let kjv = null;
  const cache = new Map();              // translation + passage → verses, while the app is open
  let apiBibles = null, apiBiblesAt = 0, apiBiblesKey = "";
  const sessionId = crypto.randomUUID();
  const fail = (code, message) => { const e = new Error(message); e.code = code; return e; };

  function deviceId(){
    // API.Bible's view counting asks for an id that stays the same on this computer
    const file = path.join(userData, "device-id.txt");
    try{ return fs.readFileSync(file, "utf8").trim(); }
    catch(e){ const id = crypto.randomUUID(); try{ fs.mkdirSync(userData, {recursive:true}); fs.writeFileSync(file, id); }catch(e2){} return id; }
  }
  function loadKjv(){
    if(!kjv) kjv = JSON.parse(fs.readFileSync(path.join(dataDir, "kjv.json"), "utf8"));
    return kjv;
  }
  async function get(url, headers){
    let r;
    try{ r = await fetchImpl(url, {headers, signal:AbortSignal.timeout(12000)}); }
    catch(e){ throw fail("OFFLINE", "Couldn't reach the internet to get this translation. KJV works without internet."); }
    if(r.status === 401 || r.status === 403) throw fail("BAD_KEY", "The API key wasn't accepted. Check it in Settings → On-screen text.");
    if(r.status === 429) throw fail("LIMIT", "Too many lookups in a short time. Wait a minute and try again.");
    if(!r.ok) throw fail("SERVICE", `The Bible service answered with an error (${r.status}). Try again, or use KJV.`);
    return r.json();
  }

  // "[16] For God so loved … [17] For God sent …" → [{c, v, text}]. Verse numbers that go down mean a new chapter.
  function splitNumbered(text, c){
    const out = [], parts = String(text).split(/\[(\d+)\]/);
    let prev = 0;
    for(let i = 1; i < parts.length; i += 2){
      const v = +parts[i];
      if(v <= prev) c++;
      prev = v;
      const t = parts[i + 1].replace(/\s+/g, " ").replace(/\s*\(ESV\)\s*$/, "").trim();
      if(t) out.push({c, v, text:t});
    }
    return out;
  }

  async function esv(book, s){
    const key = await getSecret("esvKey");
    if(!key) throw fail("NO_KEY", "The ESV needs a free API key from api.esv.org. Add it in Settings → On-screen text.");
    const q = `${book.name} ${s.c1}:${s.v1}-${s.c2}:${s.v2}`;
    const params = new URLSearchParams({q, "include-passage-references":"false", "include-verse-numbers":"true",
      "include-first-verse-numbers":"true", "include-footnotes":"false", "include-headings":"false",
      "include-short-copyright":"false", "include-copyright":"false", "include-selahs":"true",
      "indent-paragraphs":"0", "indent-poetry":"false", "indent-declares":"0", "indent-psalm-doxology":"0", "line-length":"0"});
    const d = await get(`https://api.esv.org/v3/passage/text/?${params}`, {Authorization:`Token ${key}`});
    return splitNumbered((d.passages || []).join(" "), s.c1);
  }

  async function apiBibleList(key){
    if(apiBibles && apiBiblesKey === key && Date.now() - apiBiblesAt < 30 * 60000) return apiBibles;
    const d = await get("https://rest.api.bible/v1/bibles?language=eng", {"api-key":key});
    apiBibles = d.data || []; apiBiblesAt = Date.now(); apiBiblesKey = key;
    return apiBibles;
  }
  function reportViews(tokens){
    // API.Bible's Fair Use Management System: report each passage shown (fums.api.bible/f3)
    const t = tokens.filter(Boolean);
    if(!t.length) return;
    const q = t.map(x => "t=" + encodeURIComponent(x)).join("&") + `&dId=${encodeURIComponent(deviceId())}&sId=${encodeURIComponent(sessionId)}`;
    fetchImpl(`https://fums.api.bible/f3?${q}`, {signal:AbortSignal.timeout(10000)}).catch(() => {});
  }
  async function apiBible(tr, book, s, tokens){
    const key = await getSecret("apiBibleKey");
    if(!key) throw fail("NO_KEY", `The ${tr.abbr} needs an API.Bible key. Add it in Settings → On-screen text.`);
    const bible = (await apiBibleList(key)).find(tr.match);
    if(!bible) throw fail("NOT_ON_PLAN", `The ${tr.abbr} isn't available with your API.Bible key. Add it to your plan at api.bible, or use another translation.`);
    const id = `${book.usfm}.${s.c1}.${s.v1}-${book.usfm}.${s.c2}.${s.v2}`;
    const params = new URLSearchParams({"content-type":"text", "include-notes":"false", "include-titles":"false",
      "include-chapter-numbers":"false", "include-verse-numbers":"true", "include-verse-spans":"false"});
    const d = await get(`https://rest.api.bible/v1/bibles/${encodeURIComponent(bible.id)}/passages/${encodeURIComponent(id)}?${params}`, {"api-key":key});
    if(d.meta && d.meta.fumsToken) tokens.push(d.meta.fumsToken);
    return splitNumbered(d.data && d.data.content || "", s.c1);
  }

  return {
    translations: () => TRANSLATIONS.map(({abbr, name, source}) => ({abbr, name, source})),

    // What can be used right now: [{abbr, name, ok, note}]
    async status(){
      const esvKey = await getSecret("esvKey"), abKey = await getSecret("apiBibleKey");
      let list = null, listErr = "";
      if(abKey){ try{ list = await apiBibleList(abKey); }catch(e){ listErr = e.message; } }
      return TRANSLATIONS.map(t => {
        if(t.source === "local") return {abbr:t.abbr, name:t.name, ok:true, note:"Built in, works without internet"};
        if(t.source === "esv") return {abbr:t.abbr, name:t.name, ok:!!esvKey, note:esvKey ? "From api.esv.org (needs internet)" : "Needs a free API key from api.esv.org"};
        if(!abKey) return {abbr:t.abbr, name:t.name, ok:false, note:"Needs an API.Bible key"};
        if(!list) return {abbr:t.abbr, name:t.name, ok:false, note:listErr};
        const b = list.find(t.match);
        return {abbr:t.abbr, name:t.name, ok:!!b, note:b ? `From API.Bible: ${b.name} (needs internet)` : "Not available with your API.Bible key"};
      });
    },

    // {translation, book:{i, name, usfm}, segments:[{c1,v1,c2,v2}]} → {ok, verses:[{c, v, text}]} or {ok:false, code, error}
    async lookup({translation, book, segments}){
      const tr = TRANSLATIONS.find(t => t.abbr === translation);
      if(!tr) return {ok:false, code:"UNKNOWN", error:`Unknown translation ${translation}.`};
      const ck = JSON.stringify([translation, book.usfm, segments]);
      if(cache.has(ck)) return {ok:true, verses:cache.get(ck)};
      try{
        const verses = [], tokens = [];
        for(const s of segments){
          if(tr.source === "local"){
            const text = loadKjv().text[book.i];
            for(let c = s.c1; c <= s.c2; c++){
              const ch = text[c - 1] || [];
              const from = c === s.c1 ? s.v1 : 1, to = c === s.c2 ? s.v2 : ch.length;
              for(let v = from; v <= to && v <= ch.length; v++) verses.push({c, v, text:ch[v - 1]});
            }
          }
          else if(tr.source === "esv") verses.push(...await esv(book, s));
          else verses.push(...await apiBible(tr, book, s, tokens));
        }
        if(!verses.length) return {ok:false, code:"EMPTY", error:`No text came back for that passage in the ${translation}.`};
        reportViews(tokens);
        if(cache.size > 300) cache.clear();
        cache.set(ck, verses);
        return {ok:true, verses};
      }catch(e){ return {ok:false, code:e.code || "ERROR", error:e.message}; }
    }
  };
};
module.exports.TRANSLATIONS = TRANSLATIONS;
