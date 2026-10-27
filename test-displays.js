// Tests only (not packaged): pretend monitors, read from the JSON file named by BGH_TEST_DISPLAYS, so a test can
// plug a touchscreen in and out on a machine with one screen. Each entry: {id, label, bounds, touch, primary}.
"use strict";
const fs = require("node:fs");
module.exports = function fakeDisplays(screen, file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; } };
  const full = d => ({ id: d.id, label: d.label, bounds: d.bounds, workArea: d.bounds, size: { width: d.bounds.width, height: d.bounds.height },
    scaleFactor: 1, rotation: 0, touchSupport: d.touch ? "available" : "unavailable", primary: !!d.primary });
  let list = (read() || []).map(full);
  if (!list.length) return;
  screen.getAllDisplays = () => list;
  screen.getPrimaryDisplay = () => list.find(d => d.primary) || list[0];
  setInterval(() => {
    const next = read(); if (!next) return;
    const now = next.map(full), had = new Set(list.map(d => d.id)), has = new Set(now.map(d => d.id));
    const added = now.filter(d => !had.has(d.id)), removed = list.filter(d => !has.has(d.id));
    if (!added.length && !removed.length) return;
    list = now;
    removed.forEach(d => screen.emit("display-removed", {}, d));
    added.forEach(d => screen.emit("display-added", {}, d));
  }, 300);
};
