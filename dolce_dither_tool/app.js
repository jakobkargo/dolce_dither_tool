/* dolce_dither_tool - page logic: settings, preview, dragging, download. */
(() => {
"use strict";

// ------------------------------------------------------------------ settings
const PRESETS = {
  "mono": ["#000000", "#ffffff"],
  "gray4": ["#000000", "#555555", "#aaaaaa", "#ffffff"],
  "rgb8": ["#000000", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ffffff"],
  "green4": ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  "neon": ["#000000", "#127a2a", "#39ff14", "#f4fff6"],
  "neon-gray": ["#000000", "#5a5a5a", "#39ff14", "#f4fff6"],
  "neon-light": ["#000000", "#8f8f8f", "#39ff14", "#cfcfcf", "#f4fff6"],
  "neon-cyan": ["#000000", "#127a2a", "#39ff14", "#5ff2ff", "#f4fff6"],
};
const DEFAULTS = {
  cx: 0.05, cy: 0.05, rx: 0.5, ry: 0.5, angle: -8, roughness: 0.2, jag: 0.04, seed: 8888,
  patches: 8, patchMin: 0.03, patchMax: 0.10, patchShape: "mix",
  fragments: 1, spread: 0.05, tiers: 3, grow: 2,
  void: 0.5, voidFade: 0.4, voidColor: "#000000",
  preset: "neon", palette: PRESETS.neon.slice(), mapping: "tone", photoCount: 8,
  method: "grain", clump: 1.0, scale: 2, contrast: 1.0, gamma: 1.25, serpentine: true,
  background: 0.2, blend: 0.12, bgScale: 1, bgPalette: "same",
  previewSize: 900,
};
// defaults of the Python script, used to keep the command line short
const PY_DEFAULTS = {
  cx: 0.7, cy: 0.55, rx: 0.26, ry: 0.38, angle: -8, roughness: 0.2, jag: 0.04, patches: 8,
  patchMin: 0.03, patchMax: 0.10, patchShape: "mix", fragments: 1, spread: 0.05, tiers: 3, grow: 2,
  void: 0, voidFade: 0.3, voidColor: "#000000", method: "floyd", clump: 0.7, scale: 2,
  contrast: 1.15, gamma: 1, background: 0, blend: 0.12, bgScale: 1,
};

const SECTIONS = [
  { id: "image", title: "Image", custom: "image" },
  { id: "region", title: "Region", text: "The main dithered area. Drag on the preview to move its centre.", rows: [
    ["range", "cx", "Centre, horizontal", -0.5, 1.5, 0.01],
    ["range", "cy", "Centre, vertical", -0.5, 1.5, 0.01],
    ["range", "rx", "Width", 0.02, 1.5, 0.01],
    ["range", "ry", "Height", 0.02, 1.5, 0.01],
    ["range", "angle", "Angle", -180, 180, 1],
    ["range", "roughness", "Lobes", 0, 0.6, 0.01],
    ["range", "jag", "Raggedness", 0, 0.15, 0.005],
    ["seed", "seed", "Seed"],
  ] },
  { id: "patches", title: "Patches", text: "Smaller dithered areas scattered around the rest of the picture.", rows: [
    ["range", "patches", "Count", 0, 40, 1],
    ["range", "patchMin", "Smallest", 0.005, 0.3, 0.005],
    ["range", "patchMax", "Largest", 0.005, 0.4, 0.005],
    ["select", "patchShape", "Shape", [["mix", "Blobs and blocks"], ["blob", "Blobs"], ["rect", "Blocks"]]],
  ] },
  { id: "edge", title: "Edge", text: "Loose bits of dither breaking off ahead of every edge.", rows: [
    ["range", "fragments", "Fragments", 0, 3, 0.05],
    ["range", "spread", "Reach", 0, 0.2, 0.005],
  ] },
  { id: "intensity", title: "Intensity", text: "Dots get bigger in steps toward the core of each area.", rows: [
    ["range", "tiers", "Steps", 1, 5, 1],
    ["range", "grow", "Growth per step", 1, 4, 1],
  ] },
  { id: "void", title: "Void", text: "The deepest part of the main region turns one colour, and the dots die off toward it.", rows: [
    ["range", "void", "Amount", 0, 1, 0.01],
    ["range", "voidFade", "Fade", 0, 1, 0.01],
    ["color", "voidColor", "Colour"],
  ] },
  { id: "palette", title: "Palette", custom: "palette" },
  { id: "dither", title: "Dither", rows: [
    ["select", "method", "Method", [["grain", "Grain"], ["floyd", "Floyd–Steinberg"], ["atkinson", "Atkinson"],
      ["jjn", "Jarvis–Judice–Ninke"], ["stucki", "Stucki"], ["sierra-lite", "Sierra Lite"], ["bayer", "Bayer (ordered)"]]],
    ["range", "clump", "Grain clumpiness", 0, 4, 0.05],
    ["range", "scale", "Dot size (px)", 1, 16, 1],
    ["range", "contrast", "Contrast", 0.5, 2.5, 0.01],
    ["range", "gamma", "Gamma", 0.4, 2.5, 0.01],
    ["check", "serpentine", "Serpentine scan"],
  ] },
  { id: "background", title: "Background", text: "A fine dither over the rest of the picture, strongest near the dithered areas.", rows: [
    ["range", "background", "Strength", 0, 1, 0.01],
    ["range", "blend", "Blend distance", 0, 0.5, 0.01],
    ["range", "bgScale", "Dot size (px)", 1, 8, 1],
    ["select", "bgPalette", "Colours", [["same", "Same as palette"], ["photo", "Photo colours"]]],
  ] },
  { id: "command", title: "Command line", custom: "command" },
];
const SECTION_KEYS = {
  image: ["previewSize"],
  palette: ["preset", "palette", "mapping", "photoCount"],
  command: [],
};
for (const s of SECTIONS) if (s.rows) SECTION_KEYS[s.id] = s.rows.map((r) => r[1]);

const STORE_KEY = "dolce_dither_tool.settings.v1";
let S = loadSettings();

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { saved = {}; }
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
  if (!Array.isArray(out.palette) || out.palette.length < 2) out.palette = DEFAULTS.palette.slice();
  return out;
}
function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }

// ------------------------------------------------------------------ dom helpers
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids) if (kid != null) e.append(kid);
  return e;
}
const decimals = (step) => (String(step).split(".")[1] || "").length;
const controls = {};   // key -> {set(value)}

function rangeRow(key, label, min, max, step) {
  const id = "c_" + key, d = decimals(step);
  const range = el("input", { type: "range", id, min, max, step, "aria-label": label });
  const num = el("input", { type: "number", min, max, step, "aria-label": label + " value" });
  const set = (v) => { range.value = v; num.value = Number(v).toFixed(d); };
  range.addEventListener("input", () => { S[key] = +range.value; num.value = (+range.value).toFixed(d); changed(key); });
  num.addEventListener("change", () => {
    let v = parseFloat(num.value); if (!isFinite(v)) v = S[key];
    S[key] = v; range.value = v; changed(key);
  });
  controls[key] = { set };
  set(S[key]);
  return el("tr", { "data-key": key }, el("th", {}, el("label", { for: id, text: label })), el("td", {}, el("div", { class: "ctl" }, range, num)));
}
function selectRow(key, label, options) {
  const id = "c_" + key, sel = el("select", { id });
  for (const [v, t] of options) sel.append(el("option", { value: v, text: t }));
  sel.addEventListener("change", () => { S[key] = sel.value; changed(key); });
  controls[key] = { set: (v) => { sel.value = v; } };
  controls[key].set(S[key]);
  return el("tr", { "data-key": key }, el("th", {}, el("label", { for: id, text: label })), el("td", {}, sel));
}
function colorRow(key, label) {
  const id = "c_" + key, inp = el("input", { type: "color", id }), code = el("span", { class: "chip" });
  const set = (v) => { inp.value = v; code.textContent = v; };
  inp.addEventListener("input", () => { S[key] = inp.value; code.textContent = inp.value; changed(key); });
  controls[key] = { set };
  set(S[key]);
  return el("tr", { "data-key": key }, el("th", {}, el("label", { for: id, text: label })), el("td", {}, el("div", { class: "ctl" }, inp, code)));
}
function checkRow(key, label) {
  const id = "c_" + key, inp = el("input", { type: "checkbox", id });
  inp.addEventListener("change", () => { S[key] = inp.checked; changed(key); });
  controls[key] = { set: (v) => { inp.checked = !!v; } };
  controls[key].set(S[key]);
  return el("tr", { "data-key": key }, el("th", {}, el("label", { for: id, text: label })), el("td", {}, inp));
}
function seedRow(key, label) {
  const id = "c_" + key, num = el("input", { type: "number", id, min: 0, max: 999999, step: 1 });
  num.addEventListener("change", () => { const v = parseInt(num.value, 10); S.seed = isFinite(v) ? v : S.seed; num.value = S.seed; changed("seed"); });
  const again = el("button", { class: "link", type: "button", text: "new shape", onclick: () => {
    S.seed = Math.floor(Math.random() * 100000); num.value = S.seed; changed("seed");
  } });
  controls[key] = { set: (v) => { num.value = v; } };
  controls[key].set(S[key]);
  return el("tr", { "data-key": key }, el("th", {}, el("label", { for: id, text: label })), el("td", {}, el("div", { class: "ctl" }, num, again)));
}

// ------------------------------------------------------------------ build sections
function buildSections() {
  const host = $("sections"), toc = $("tocList");
  SECTIONS.forEach((sec, i) => {
    toc.append(el("li", {}, el("a", { href: "#" + sec.id }, el("span", { class: "num", text: String(i + 1) }), sec.title)));
    const reset = el("span", { class: "edit" }, "[", el("button", { class: "link", type: "button", text: "reset", onclick: () => resetSection(sec.id) }), "]");
    const h = el("h2", { id: sec.id }, el("span", { text: sec.title }), sec.id === "command" ? null : reset);
    const block = el("section", { "aria-labelledby": sec.id }, h);
    if (sec.text) block.append(el("p", { text: sec.text }));
    if (sec.rows) {
      const tb = el("tbody");
      for (const r of sec.rows) {
        const [type, key, label, ...rest] = r;
        tb.append(type === "range" ? rangeRow(key, label, ...rest) : type === "select" ? selectRow(key, label, rest[0])
          : type === "color" ? colorRow(key, label) : type === "check" ? checkRow(key, label) : seedRow(key, label));
      }
      block.append(el("table", { class: "wikitable" }, tb));
    }
    if (sec.custom === "image") block.append(buildImageSection());
    if (sec.custom === "palette") block.append(...buildPaletteSection());
    if (sec.custom === "command") block.append(...buildCommandSection());
    host.append(block);
  });
}

function buildImageSection() {
  const tb = el("tbody");
  const pick = el("button", { class: "btn", type: "button", text: "Choose image…", onclick: () => $("fileInput").click() });
  tb.append(el("tr", {}, el("th", { text: "Image" }), el("td", {}, el("div", { class: "ctl" }, pick, el("span", { id: "fileName", class: "hint", text: "No image yet" })))));
  const maskPick = el("button", { class: "link", type: "button", text: "choose mask", onclick: () => $("maskInput").click() });
  const maskClear = el("button", { class: "link", type: "button", text: "remove", hidden: true, id: "maskClear", onclick: clearMask });
  tb.append(el("tr", {}, el("th", { text: "Mask (optional)" }), el("td", {},
    el("div", { class: "ctl" }, maskPick, el("span", { id: "maskName", class: "hint", text: "White areas replace the generated region." }), maskClear))));
  const sel = el("select", { id: "c_previewSize" });
  for (const [v, t] of [[600, "Small (600 px)"], [900, "Medium (900 px)"], [1400, "Large (1400 px)"], [0, "Full size (slow)"]])
    sel.append(el("option", { value: v, text: t }));
  sel.value = S.previewSize;
  sel.addEventListener("change", () => { S.previewSize = +sel.value; saveSettings(); preparePreview(); });
  controls.previewSize = { set: (v) => { sel.value = v; } };
  tb.append(el("tr", {}, el("th", {}, el("label", { for: "c_previewSize", text: "Preview size" })), el("td", {}, sel)));
  return el("table", { class: "wikitable" }, tb);
}

function buildPaletteSection() {
  const p = el("p", { text: "The colours used for the dither. By brightness puts the darkest colour in the shadows and the lightest in the highlights, so every colour shows up." });
  const tb = el("tbody");
  const preset = el("select", { id: "c_preset" });
  preset.append(el("option", { value: "custom", text: "Custom" }));
  for (const k of Object.keys(PRESETS)) preset.append(el("option", { value: k, text: k }));
  preset.addEventListener("change", () => {
    if (preset.value === "custom") return;
    S.preset = preset.value; S.palette = PRESETS[preset.value].slice();
    S.mapping = preset.value === "rgb8" ? "color" : "tone"; controls.mapping.set(S.mapping);
    renderSwatches(); changed("palette");
  });
  controls.preset = { set: (v) => { preset.value = v; } };
  tb.append(el("tr", {}, el("th", {}, el("label", { for: "c_preset", text: "Preset" })), el("td", {}, preset)));
  tb.append(el("tr", {}, el("th", { text: "Colours" }), el("td", {}, el("div", { class: "swatches", id: "swatches" }))));

  const count = el("input", { type: "number", id: "c_photoCount", min: 2, max: 32, step: 1 });
  count.value = S.photoCount;
  count.addEventListener("change", () => { S.photoCount = Math.max(2, Math.min(32, parseInt(count.value, 10) || 8)); count.value = S.photoCount; saveSettings(); });
  controls.photoCount = { set: (v) => { count.value = v; } };
  const extract = el("button", { class: "link", type: "button", text: "use these from the photo", onclick: () => {
    if (!state.preview) { setStatus("Choose an image first."); return; }
    S.palette = Engine.medianCut(state.preview.data, state.preview.width * state.preview.height, S.photoCount);
    S.preset = "custom"; S.mapping = "color"; controls.mapping.set("color");
    renderSwatches(); changed("palette");
  } });
  tb.append(el("tr", {}, el("th", {}, el("label", { for: "c_photoCount", text: "From photo" })),
    el("td", {}, el("div", { class: "ctl" }, count, el("span", { class: "hint", text: "colours" }), extract))));

  const map = el("select", { id: "c_mapping" });
  map.append(el("option", { value: "tone", text: "By brightness" }), el("option", { value: "color", text: "Nearest colour" }));
  map.addEventListener("change", () => { S.mapping = map.value; changed("mapping"); });
  controls.mapping = { set: (v) => { map.value = v; } };
  tb.append(el("tr", {}, el("th", {}, el("label", { for: "c_mapping", text: "Mapping" })), el("td", {}, map)));
  controls.preset.set(S.preset); controls.mapping.set(S.mapping);
  return [p, el("table", { class: "wikitable" }, tb)];
}

function renderSwatches() {
  const host = $("swatches");
  host.replaceChildren();
  S.palette.forEach((hex, i) => {
    const inp = el("input", { type: "color", value: hex, "aria-label": "Colour " + (i + 1) });
    const code = el("span", { text: hex });
    inp.addEventListener("input", () => { S.palette[i] = inp.value; code.textContent = inp.value; S.preset = "custom"; controls.preset.set("custom"); changed("palette"); });
    const rm = el("button", { class: "link", type: "button", "aria-label": "Remove colour " + (i + 1), text: "×",
      onclick: () => { if (S.palette.length <= 2) { setStatus("A palette needs at least two colours."); return; }
        S.palette.splice(i, 1); S.preset = "custom"; controls.preset.set("custom"); renderSwatches(); changed("palette"); } });
    host.append(el("span", { class: "chip" }, inp, code, rm));
  });
  host.append(el("button", { class: "link", type: "button", text: "add colour", onclick: () => {
    S.palette.push("#808080"); S.preset = "custom"; controls.preset.set("custom"); renderSwatches(); changed("palette");
  } }));
}

function buildCommandSection() {
  const p = el("p", { text: "The same settings for glitch_dither4.py. The script draws different shapes for the same seed. "
    + "Paste a command here, or edit this one and press Enter, to load its settings." });
  const box = el("textarea", { class: "cmd", id: "cmd", rows: 3, spellcheck: "false", autocomplete: "off", "aria-label": "Command line" });
  box.addEventListener("paste", (e) => {
    const text = e.clipboardData.getData("text");
    const whole = !box.value.trim() || (box.selectionStart === 0 && box.selectionEnd === box.value.length) || /\.py\b|^\s*python/i.test(text);
    if (whole) { e.preventDefault(); box.value = text; applyCommand(text); }
    else setTimeout(() => applyCommand(box.value), 0);
  });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); applyCommand(box.value); } });
  box.addEventListener("input", () => sizeCommandBox(box));
  const apply = el("button", { class: "link", type: "button", text: "apply", onclick: () => applyCommand(box.value) });
  const copy = el("button", { class: "link", type: "button", text: "copy", onclick: async () => {
    try { await navigator.clipboard.writeText(box.value); setStatus("Command copied."); }
    catch (e) { box.select(); setStatus("Command selected. Press Ctrl+C or ⌘C to copy."); }
  } });
  return [p, box, el("div", { class: "ctl" }, el("span", { class: "edit" }, "[", apply, "]"), el("span", { class: "edit" }, "[", copy, "]"))];
}
function sizeCommandBox(box) { box.style.height = "auto"; box.style.height = box.scrollHeight + 2 + "px"; }
function showCommand() { const box = $("cmd"); box.value = commandLine(); sizeCommandBox(box); }

function commandLine() {
  const f = (v) => +Number(v).toFixed(4);
  const parts = ["python glitch_dither4.py", quote(state.fileName || "input.jpg"), "output.png"];
  const add = (flag, ...vals) => parts.push(flag + (vals.length ? " " + vals.join(" ") : ""));
  if (state.maskName) add("--mask", quote(state.maskName));
  else {
    if (S.cx !== PY_DEFAULTS.cx || S.cy !== PY_DEFAULTS.cy) add("--center", f(S.cx), f(S.cy));
    if (S.rx !== PY_DEFAULTS.rx || S.ry !== PY_DEFAULTS.ry) add("--size", f(S.rx), f(S.ry));
    for (const [k, flag] of [["angle", "--angle"], ["roughness", "--roughness"], ["jag", "--jag"]]) if (S[k] !== PY_DEFAULTS[k]) add(flag, f(S[k]));
  }
  add("--seed", S.seed);
  if (state.maskName ? S.patches !== 0 : S.patches !== PY_DEFAULTS.patches) add("--patches", S.patches);
  if (S.patchMin !== PY_DEFAULTS.patchMin || S.patchMax !== PY_DEFAULTS.patchMax) add("--patch-size", f(S.patchMin), f(S.patchMax));
  if (S.patchShape !== "mix") add("--patch-shape", S.patchShape);
  for (const [k, flag] of [["fragments", "--fragments"], ["spread", "--spread"], ["tiers", "--tiers"], ["grow", "--grow"],
    ["void", "--void"], ["voidFade", "--void-fade"]]) if (S[k] !== PY_DEFAULTS[k]) add(flag, f(S[k]));
  if (S.voidColor !== "#000000") add("--void-color", quote(S.voidColor));
  if (S.method !== PY_DEFAULTS.method) add("--method", S.method);
  if (S.clump !== PY_DEFAULTS.clump) add("--clump", f(S.clump));
  add("--palette", quote(S.palette.join(",")));
  if (S.mapping === "color") add("--map", "color");
  for (const [k, flag] of [["scale", "--scale"], ["contrast", "--contrast"], ["gamma", "--gamma"], ["background", "--background"],
    ["blend", "--blend"], ["bgScale", "--bg-scale"]]) if (S[k] !== PY_DEFAULTS[k]) add(flag, f(S[k]));
  if (S.bgPalette === "photo") add("--bg-palette", "auto16");
  if (!S.serpentine) add("--no-serpentine");
  return parts.join(" ");
}
function quote(s) { return /^[\w.,#\/-]+$/.test(s) && !s.includes("#") ? s : '"' + String(s).replace(/"/g, '\\"') + '"'; }

// ------------------------------------------------------------------ reading a pasted command
const NUM_FLAGS = {
  "--center": ["cx", "cy"], "--size": ["rx", "ry"], "--angle": ["angle"], "--roughness": ["roughness"], "--jag": ["jag"],
  "--seed": ["seed"], "--patches": ["patches"], "--patch-size": ["patchMin", "patchMax"], "--fragments": ["fragments"],
  "--spread": ["spread"], "--tiers": ["tiers"], "--grow": ["grow"], "--void": ["void"], "--void-fade": ["voidFade"],
  "--clump": ["clump"], "--scale": ["scale"], "--contrast": ["contrast"], "--gamma": ["gamma"],
  "--background": ["background"], "--blend": ["blend"], "--bg-scale": ["bgScale"],
};
const INT_KEYS = new Set(["seed", "patches", "tiers", "grow", "scale", "bgScale"]);
const REGION_KEYS = ["cx", "cy", "rx", "ry", "angle", "roughness", "jag"];
const selectValues = (key) => SECTIONS.flatMap((s) => s.rows || []).find((r) => r[1] === key)[3].map((o) => o[0]);

function shellWords(s) {
  const words = []; let cur = "", inWord = false, q = "";
  s = s.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = ""; else cur += c; }
    else if (q === '"') { if (c === '"') q = ""; else if (c === "\\" && /["\\$`]/.test(s[i + 1] || "")) cur += s[++i]; else cur += c; }
    else if (/\s/.test(c)) { if (inWord) { words.push(cur); cur = ""; inWord = false; } continue; }
    else if (c === "'" || c === '"') q = c;
    else if (c === "\\" && i + 1 < s.length) cur += s[++i];
    else cur += c;
    inWord = true;
  }
  if (q) throw new Error("The command has a quote that isn't closed.");
  if (inWord) words.push(cur);
  return words;
}
function normHex(s) {
  s = String(s).trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, "$&$&");
  return /^[0-9a-f]{6}$/i.test(s) ? "#" + s.toLowerCase() : null;
}

// Flags left out of the command mean the script's defaults, the same rule commandLine() uses to shorten it.
function applyCommand(text) {
  let words;
  try { words = shellWords(text); } catch (e) { setStatus(e.message); return; }
  if (!words.some((w) => w.startsWith("--"))) { setStatus("No settings found in that command."); return; }
  const hasMask = words.some((w) => w === "--mask" || w.startsWith("--mask="));
  const next = JSON.parse(JSON.stringify(S));
  Object.assign(next, PY_DEFAULTS, { patchShape: "mix", mapping: "tone", bgPalette: "same", serpentine: true, voidColor: "#000000" });
  if (hasMask) { for (const k of REGION_KEYS) next[k] = S[k]; next.patches = 0; }
  const bad = [], unknown = [];

  for (let i = 0; i < words.length; i++) {
    let flag = words[i];
    if (!flag.startsWith("--")) continue;
    const vals = [], eq = flag.indexOf("=");
    if (eq > 0) { vals.push(flag.slice(eq + 1)); flag = flag.slice(0, eq); }
    const take = (n) => { while (vals.length < n && i + 1 < words.length && !words[i + 1].startsWith("--")) vals.push(words[++i]); return vals; };
    if (NUM_FLAGS[flag]) {
      const keys = NUM_FLAGS[flag]; take(keys.length);
      keys.forEach((k, j) => {
        const v = parseFloat(vals[j]);
        if (isFinite(v)) next[k] = INT_KEYS.has(k) ? Math.round(v) : v; else if (!bad.includes(flag)) bad.push(flag);
      });
    } else if (flag === "--patch-shape" || flag === "--method") {
      const key = flag === "--method" ? "method" : "patchShape", v = take(1)[0];
      if (selectValues(key).includes(v)) next[key] = v; else bad.push(flag);
    } else if (flag === "--void-color") {
      const v = normHex(take(1)[0] || "");
      if (v) next.voidColor = v; else bad.push(flag);
    } else if (flag === "--palette") {
      const v = take(1)[0] || "", cols = PRESETS[v] ? PRESETS[v].slice() : v.split(",").map(normHex);
      if (cols.length >= 2 && cols.every(Boolean)) next.palette = cols; else bad.push(flag);
    } else if (flag === "--map") {
      const v = take(1)[0];
      if (v === "color" || v === "tone") next.mapping = v; else bad.push(flag);
    } else if (flag === "--bg-palette") next.bgPalette = /^auto/.test(take(1)[0] || "") ? "photo" : "same";
    else if (flag === "--serpentine" || flag === "--no-serpentine") next.serpentine = flag === "--serpentine";
    else if (flag === "--mask") take(1);
    else unknown.push(flag);
  }

  const match = Object.keys(PRESETS).find((k) => PRESETS[k].join() === next.palette.join());
  next.preset = match || "custom";
  S = next;
  for (const k of Object.keys(controls)) controls[k].set(S[k]);
  renderSwatches();
  const notes = ["Settings loaded from the command."];
  if (hasMask && !state.maskImg) notes.push("It uses a mask: choose the mask image in the Image section.");
  if (!hasMask && state.maskImg) { clearMask(); notes.push("The mask was removed, since the command doesn't use one."); }
  if (bad.length) notes.push("Couldn't read the value of " + bad.join(", ") + ".");
  if (unknown.length) notes.push("Ignored " + unknown.join(", ") + ".");
  changed("all");
  placeMarker();
  setStatus(notes.join(" "));
}

function resetSection(id) {
  for (const k of SECTION_KEYS[id] || []) {
    S[k] = Array.isArray(DEFAULTS[k]) ? DEFAULTS[k].slice() : DEFAULTS[k];
    if (controls[k]) controls[k].set(S[k]);
  }
  if (id === "palette") renderSwatches();
  if (id === "image") { preparePreview(); saveSettings(); return; }
  changed(id);
}

// ------------------------------------------------------------------ state + rendering
const state = {
  full: null, preview: null, draft: null, fileName: "", maskImg: null, maskName: "",
  maskCache: {}, photoPalette: null, imageCounter: 0,
  renderPreview: Engine.createRenderer(), renderDraft: Engine.createRenderer(),
};
const view = $("view"), vctx = view.getContext("2d");

function setStatus(msg) { $("status").textContent = msg; }

function changed(key) {
  saveSettings();
  refreshDisabled();
  showCommand();
  if (key === "cx" || key === "cy") placeMarker();
  schedule();
}

function refreshDisabled() {
  const off = {
    serpentine: S.method === "grain" || S.method === "bayer",
    cx: !!state.maskImg, cy: !!state.maskImg, rx: !!state.maskImg, ry: !!state.maskImg,
    angle: !!state.maskImg, roughness: !!state.maskImg && S.patches === 0, jag: !!state.maskImg && S.patches === 0,
    patchMin: S.patches === 0, patchMax: S.patches === 0, patchShape: S.patches === 0,
    spread: S.fragments === 0, grow: S.tiers <= 1, voidFade: S.void === 0, voidColor: S.void === 0,
    blend: S.background === 0, bgScale: S.background === 0, bgPalette: S.background === 0,
  };
  document.querySelectorAll("tr[data-key]").forEach((tr) => tr.classList.toggle("off", !!off[tr.dataset.key]));
}

function paramsFor(img) {
  const k = img.width / state.full.width;
  return Object.assign({}, S, {
    scale: Math.max(1, Math.round(S.scale * k)),
    bgScale: Math.max(1, Math.round(S.bgScale * k)),
    patchMin: Math.min(S.patchMin, S.patchMax), patchMax: Math.max(S.patchMin, S.patchMax),
  });
}
function maskFor(img) {
  if (!state.maskImg) return null;
  const key = img.width + "x" + img.height;
  if (!state.maskCache[key]) {
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(state.maskImg, 0, 0, img.width, img.height);
    const d = x.getImageData(0, 0, img.width, img.height).data, m = new Uint8Array(img.width * img.height);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114 > 127 ? 1 : 0;
    state.maskCache[key] = m;
  }
  return state.maskCache[key];
}
function optsFor(img) {
  return {
    mask: maskFor(img), maskId: state.maskImg ? state.maskName + state.imageCounter : null,
    bgPalette: S.bgPalette === "photo" ? state.photoPalette : null,
  };
}

// draft renders while you drag or slide; the full preview follows when you pause
let pendingDraft = false, pendingFull = false, busy = false, idleTimer = 0;
function schedule() {
  if (!state.preview) return;
  if (state.draft) pendingDraft = true; else pendingFull = true;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { pendingFull = true; pump(); }, 280);
  pump();
}
function pump() {
  if (busy) return;
  busy = true;
  requestAnimationFrame(() => {
    try {
      if (pendingFull) { pendingFull = false; pendingDraft = false; draw(state.preview, state.renderPreview); }
      else if (pendingDraft) { pendingDraft = false; draw(state.draft, state.renderDraft); }
    } catch (e) { console.error(e); setStatus("Something went wrong while rendering: " + e.message); }
    busy = false;
    if (pendingFull || pendingDraft) pump();
  });
}
function draw(img, renderer) {
  const t0 = performance.now();
  const px = renderer(img, paramsFor(img), optsFor(img));
  const id = new ImageData(px, img.width, img.height);
  if (img === state.preview) vctx.putImageData(id, 0, 0);
  else {
    const c = draw.tmp || (draw.tmp = document.createElement("canvas"));
    c.width = img.width; c.height = img.height; c.getContext("2d").putImageData(id, 0, 0);
    vctx.imageSmoothingEnabled = false;
    vctx.drawImage(c, 0, 0, view.width, view.height);
  }
  if (img === state.preview) $("infoPreview").textContent = `${img.width} × ${img.height} px, ${Math.round(performance.now() - t0)} ms`;
}

function scaled(src, maxSide) {
  const W = src.width, H = src.height, k = maxSide > 0 ? Math.min(1, maxSide / Math.max(W, H)) : 1;
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, w, h);
  return { data: x.getImageData(0, 0, w, h).data, width: w, height: h, id: `${state.imageCounter}:${w}x${h}` };
}

function preparePreview() {
  if (!state.full) return;
  state.preview = scaled(state.fullCanvas, S.previewSize);
  const pc = state.preview.width * state.preview.height;
  state.draft = pc > 260000 ? scaled(state.fullCanvas, Math.round(Math.max(state.preview.width, state.preview.height) / 2)) : null;
  state.photoPalette = Engine.medianCut(state.preview.data, pc, 16).map(Engine.hexToRgb);
  view.width = state.preview.width; view.height = state.preview.height;
  updateCaption();
  pendingFull = true; pump();
}

function updateCaption() {
  if (!state.full) return;
  const reduced = S.previewSize && Math.max(state.full.width, state.full.height) > S.previewSize;
  $("caption").textContent = (state.maskImg ? "The mask sets the region." : "Drag on the picture to move the region.")
    + (reduced ? " The preview is reduced; the download is full size." : "");
}

function loadImage(file) {
  if (!file || !file.type.startsWith("image/")) { setStatus("That file isn't an image. Choose a JPG or PNG."); return; }
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext("2d").drawImage(im, 0, 0);
    URL.revokeObjectURL(url);
    state.imageCounter++; state.fullCanvas = c; state.full = { width: c.width, height: c.height };
    state.fileName = file.name; state.maskCache = {};
    $("fileName").textContent = file.name; $("infoFile").textContent = file.name;
    $("infoSize").textContent = `${c.width} × ${c.height} px`;
    $("empty").hidden = true; $("canvasWrap").hidden = false;
    $("download").disabled = !downloadsReady();
    setStatus("");
    showCommand();
    preparePreview(); placeMarker();
  };
  im.onerror = () => { URL.revokeObjectURL(url); setStatus("This image couldn't be read. Try a JPG or PNG."); };
  im.src = url;
}
function loadMask(file) {
  if (!file || !file.type.startsWith("image/")) { setStatus("The mask must be an image."); return; }
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    state.maskImg = im; state.maskName = file.name; state.maskCache = {};
    $("maskName").textContent = file.name; $("maskClear").hidden = false;
    placeMarker(); updateCaption(); changed("mask");
  };
  im.onerror = () => { URL.revokeObjectURL(url); setStatus("The mask couldn't be read."); };
  im.src = url;
}
function clearMask() {
  state.maskImg = null; state.maskName = ""; state.maskCache = {};
  $("maskName").textContent = "White areas replace the generated region."; $("maskClear").hidden = true;
  placeMarker(); updateCaption(); changed("mask");
}

// ------------------------------------------------------------------ dragging the region
function placeMarker() {
  const m = $("marker");
  m.hidden = !state.preview || !!state.maskImg;
  if (m.hidden) return;
  const r = view.getBoundingClientRect(), w = $("canvasWrap").getBoundingClientRect();
  m.style.left = (r.left - w.left + Math.max(0, Math.min(1, S.cx)) * r.width) + "px";
  m.style.top = (r.top - w.top + Math.max(0, Math.min(1, S.cy)) * r.height) + "px";
}
window.addEventListener("resize", placeMarker);
let dragging = false;
function dragTo(e) {
  const r = view.getBoundingClientRect();
  S.cx = +((e.clientX - r.left) / r.width).toFixed(3);
  S.cy = +((e.clientY - r.top) / r.height).toFixed(3);
  controls.cx.set(S.cx); controls.cy.set(S.cy);
  changed("cx");
}
view.addEventListener("pointerdown", (e) => {
  if (state.maskImg) return;
  dragging = true; view.setPointerCapture(e.pointerId); dragTo(e);
});
view.addEventListener("pointermove", (e) => { if (dragging) dragTo(e); });
const endDrag = () => { dragging = false; };
view.addEventListener("pointerup", endDrag);
view.addEventListener("pointercancel", endDrag);

// ------------------------------------------------------------------ download
let downloads = null, capabilityChecked = !window.claude;
function downloadsReady() { return !!downloads || (capabilityChecked && window.top === window) || !window.claude; }
if (window.claude && typeof window.claude.use === "function") {
  window.claude.use("downloads").then((d) => {
    downloads = d; capabilityChecked = true;
    if (!d && window.top !== window) { $("download").hidden = true; setStatus("Downloads aren't available in this view."); }
    else if (state.full) $("download").disabled = false;
  }).catch(() => { capabilityChecked = true; });
}
$("download").addEventListener("click", () => {
  if (!state.full) return;
  const btn = $("download");
  btn.disabled = true; setStatus("Rendering full size…");
  setTimeout(async () => {
    try {
      const t0 = performance.now();
      const img = { data: state.fullCanvas.getContext("2d").getImageData(0, 0, state.full.width, state.full.height).data,
                    width: state.full.width, height: state.full.height, id: "full:" + state.imageCounter };
      const px = Engine.createRenderer()(img, paramsFor(img), optsFor(img));
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      c.getContext("2d").putImageData(new ImageData(px, img.width, img.height), 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      const name = (state.fileName.replace(/\.[^.]+$/, "") || "image") + "_dolce.png";
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (downloads) {
        try { await downloads.save({ filename: name, data: blob }); setStatus(`Saved ${name} (${secs} s).`); }
        catch (err) {
          const code = err && err.code;
          setStatus(code === "declined" ? "Download cancelled." : code === "rate_limited" ? "A download is already waiting for confirmation."
            : "The download couldn't be saved here.");
        }
      } else {
        const a = el("a", { href: URL.createObjectURL(blob), download: name });
        document.body.append(a); a.click(); a.remove();
        setStatus(`Downloaded ${name} (${secs} s).`);
      }
    } catch (e) { console.error(e); setStatus("The full-size render failed: " + e.message); }
    btn.disabled = false;
  }, 30);
});

// ------------------------------------------------------------------ wiring
$("fileInput").addEventListener("change", (e) => { loadImage(e.target.files[0]); e.target.value = ""; });
$("maskInput").addEventListener("change", (e) => { loadMask(e.target.files[0]); e.target.value = ""; });
$("emptyPick").addEventListener("click", () => $("fileInput").click());
const stage = $("stage");
stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("drop"); });
stage.addEventListener("dragleave", () => stage.classList.remove("drop"));
stage.addEventListener("drop", (e) => { e.preventDefault(); stage.classList.remove("drop"); loadImage(e.dataTransfer.files[0]); });
$("tocToggle").addEventListener("click", () => {
  const t = $("toc"); t.classList.toggle("hidden");
  $("tocToggle").textContent = t.classList.contains("hidden") ? "[show]" : "[hide]";
});
$("resetAll").addEventListener("click", () => {
  S = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(controls)) controls[k].set(S[k]);
  renderSwatches(); changed("all"); preparePreview();
});

buildSections();
renderSwatches();
refreshDisabled();
showCommand();
})();
