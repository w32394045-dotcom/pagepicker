#!/usr/bin/env node
/* PagePicker — static consistency checks (independent of tools/check-i18n.mjs).
 *
 * Checks:
 *   1. ids: every id app.js looks up exists in src/index.template.html (and reverse: dead ids)
 *   2. i18n: every template data-i18n* key and app t("…") key exists in en.json; all 7 locales
 *      have identical key sets, non-empty values, identical {placeholder} sets
 *   3. build: root index.html is exactly build(template, src) and worker.js `const HTML` equals
 *      index.html byte for byte (worker.js serves the same bytes as GitHub Pages / the local file)
 *   4. offline: no @@ placeholders, no external <script src> / stylesheet / @import / @font-face /
 *      resource URLs; only user-clickable <a href> may point outside (SVG xmlns is allowed)
 *   5. html: tag pairing of index.html (JS fallback — the Python html.parser version is
 *      tests/html-check.py, which Node cannot spawn under this sandbox: spawn EPERM)
 *   6. UI facts used by QA-REPORT.md's README fact-check
 *
 * Run:  & $NODE tests/static-check.mjs        (exit 0 = PASS, 1 = FAIL)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const readBuf = (p) => readFileSync(join(ROOT, p));

let errors = 0;
let warnings = 0;
const ok = (msg) => console.log("  \u2713 " + msg);
const bad = (msg) => { errors++; console.log("  \u2717 " + msg); };
const warn = (msg) => { warnings++; console.log("  ! " + msg); };
const info = (msg) => console.log("  \u00b7 " + msg);
const section = (title) => console.log(`\n[${title}]`);

const TEMPLATE = read("src/index.template.html");
const APP = read("src/app.js");
const CORE = read("src/core.js");
const CSS = read("src/styles.css");
const HTML = read("index.html");
const WORKER = read("worker.js");
const BUILD = existsSync(join(ROOT, "tools/build.mjs")) ? read("tools/build.mjs") : "";
const require = createRequire(import.meta.url);
const PP = require(join(ROOT, "src/core.js"));

/* ================================================================ 1. ids */

section("1. DOM ids: app.js \u2194 index.template.html");

const templateIds = [...TEMPLATE.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const templateIdSet = new Set(templateIds);
const dupIds = templateIds.filter((id, i) => templateIds.indexOf(id) !== i);
if (dupIds.length) bad(`duplicate id= in template: ${[...new Set(dupIds)].join(", ")}`);
else ok(`template declares ${templateIds.length} unique ids`);

const cacheMatch = /function cacheEls\(\)\s*\{[\s\S]*?\[([\s\S]*?)\]\.forEach/.exec(APP);
if (!cacheMatch) bad("could not find the cacheEls() id list in src/app.js");
const cacheIds = cacheMatch ? [...cacheMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
const literalIds = [
  ...APP.matchAll(/\$\("([^"]+)"\)/g),
  ...APP.matchAll(/getElementById\("([^"]+)"\)/g)
].map((m) => m[1]);
const referencedIds = [...new Set([...cacheIds, ...literalIds])];
let missingIds = 0;
for (const id of referencedIds) {
  if (!templateIdSet.has(id)) { bad(`src/app.js references #${id} — no such id in src/index.template.html`); missingIds++; }
}
if (!missingIds) ok(`all ${referencedIds.length} ids looked up by app.js exist in the template (cacheEls ${cacheIds.length} + literal ${new Set(literalIds).size})`);

/* dynamic getElementById, e.g. getElementById("tab" + capitalized(tab)) */
const dynamicPrefixes = [...APP.matchAll(/getElementById\("([^"]*)"\s*\+/g)].map((m) => m[1]);
if (dynamicPrefixes.length) {
  info(`dynamic getElementById prefixes: ${dynamicPrefixes.map((p) => `"${p}" +`).join(", ")}`);
  for (const prefix of dynamicPrefixes) {
    const candidates = templateIds.filter((id) => id.startsWith(prefix));
    if (!candidates.length) bad(`dynamic id prefix "${prefix}" matches no id in the template`);
    else info(`  "${prefix}" + … \u2192 ${candidates.join(", ")}`);
  }
}
/* the only dynamic lookup builds "tab" + All|Odd|Even from data-tab */
const tabValues = [...TEMPLATE.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
const dynamicTabIds = tabValues.map((v) => "tab" + v[0].toUpperCase() + v.slice(1));
for (const id of dynamicTabIds) {
  if (!templateIdSet.has(id)) bad(`setTab() builds #${id} from data-tab but the template has no such id`);
}
if (dynamicTabIds.length && dynamicTabIds.every((id) => templateIdSet.has(id))) {
  ok(`dynamic tab ids exist: ${dynamicTabIds.join(", ")}`);
}

/* reverse direction: template ids that app.js never mentions (informational only).
   NB: use a string-literal regex that also matches empty strings (""), otherwise a new Set of
   all double-quoted substrings slips out of alignment at `setAttribute("readonly", "")`. */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;
const appQuoted = new Set([...APP.matchAll(STRING_LITERAL)].map((m) => m[0].slice(1, -1)));
const unusedTemplateIds = templateIds.filter((id) => !appQuoted.has(id) && !dynamicTabIds.includes(id));
if (unusedTemplateIds.length) {
  info(`template ids not referenced anywhere in app.js (dead ids, harmless): ${unusedTemplateIds.join(", ")}`);
} else {
  ok("every template id is referenced by app.js");
}

/* ================================================================ 2. i18n */

section("2. i18n: template/app keys \u2194 locale files");

const localeFiles = readdirSync(join(ROOT, "src/i18n")).filter((f) => f.endsWith(".json")).sort();
const localeLangs = localeFiles.map((f) => f.replace(/\.json$/, ""));
const LOCALES = {};
for (const lang of localeLangs) LOCALES[lang] = JSON.parse(read(`src/i18n/${lang}.json`));
const en = LOCALES.en;
if (!en) { bad("src/i18n/en.json is missing or invalid"); }

const buildLangsMatch = /const LANGS = \[([^\]]*)\]/.exec(BUILD);
const buildLangs = buildLangsMatch ? [...buildLangsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
if (!buildLangs.length) warn("could not read LANGS from tools/build.mjs");
else {
  const want = JSON.stringify(buildLangs);
  if (JSON.stringify(PP.LANGS) !== want) bad(`PP.LANGS ${JSON.stringify(PP.LANGS)} != build.mjs LANGS ${want}`);
  else ok(`PP.LANGS == build.mjs LANGS (${buildLangs.length}: ${buildLangs.join(", ")})`);
  const missingLocale = buildLangs.filter((l) => !localeLangs.includes(l));
  const extraLocale = localeLangs.filter((l) => !buildLangs.includes(l));
  if (missingLocale.length) bad(`locale files missing for: ${missingLocale.join(", ")}`);
  if (extraLocale.length) bad(`locale files not listed in build.mjs: ${extraLocale.join(", ")}`);
  if (!missingLocale.length && !extraLocale.length) ok(`locale files match build LANGS (${localeLangs.join(", ")})`);
}

/* app's display names for the languages */
const langNamesMatch = /var LANG_NAMES = \{([\s\S]*?)\};/.exec(APP);
if (langNamesMatch) {
  const nameKeys = [...langNamesMatch[1].matchAll(/(?:"([^"]+)"|([A-Za-z][\w-]*))\s*:/g)].map((m) => m[1] || m[2]);
  const missing = PP.LANGS.filter((l) => !nameKeys.includes(l));
  if (missing.length) bad(`LANG_NAMES is missing display names for: ${missing.join(", ")}`);
  else ok(`LANG_NAMES covers all ${PP.LANGS.length} languages`);
}

/* template keys (data-i18n, data-i18n-placeholder, -title, -aria, …) */
const templateKeys = [...new Set([...TEMPLATE.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]))];
let missingTemplateKeys = 0;
for (const key of templateKeys) {
  if (!(key in en)) { bad(`template uses data-i18n key "${key}" which is missing from src/i18n/en.json`); missingTemplateKeys++; }
}
if (!missingTemplateKeys) ok(`all ${templateKeys.length} template i18n keys exist in en.json`);

/* app t("key") calls (static keys only, plus dynamic "prefix" + …) */
const appKeys = [...new Set([...APP.matchAll(/\bt\("([^"]+)"(?!\s*\+)/g)].map((m) => m[1]))];
let missingAppKeys = 0;
for (const key of appKeys) {
  if (!(key in en)) { bad(`app.js calls t("${key}") but en.json has no such key`); missingAppKeys++; }
}
const dynamicKeyPrefixes = [...new Set([...APP.matchAll(/\bt\("([^"]*)"\s*\+/g)].map((m) => m[1]))];
const dynamicResolvedKeys = new Set();
for (const prefix of dynamicKeyPrefixes) {
  const candidates = Object.keys(en).filter((k) => k.startsWith(prefix));
  if (!candidates.length) bad(`dynamic i18n prefix "${prefix}" matches no en.json key`);
  else { candidates.forEach((k) => dynamicResolvedKeys.add(k)); info(`dynamic t("${prefix}" + …) \u2192 ${candidates.join(", ")}`); }
}
if (!missingAppKeys) ok(`all ${appKeys.length} static t() keys exist in en.json`);

/* SEP_KEYS: output separator \u2192 i18n key map */
const sepKeysMatch = /var SEP_KEYS = \{([\s\S]*?)\};/.exec(APP);
const sepI18nKeys = sepKeysMatch ? [...sepKeysMatch[1].matchAll(/"([^"]*)"\s*:\s*"([^"]+)"/g)].map((m) => m[2]) : [];
for (const key of sepI18nKeys) if (!(key in en)) bad(`SEP_KEYS points at missing i18n key "${key}"`);
if (sepI18nKeys.length && sepI18nKeys.every((k) => k in en)) ok(`SEP_KEYS: ${sepI18nKeys.length} separator labels all exist`);

/* all locale files: same key set, non-empty strings, same {placeholders} */
const placeholders = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(",");
const enKeys = Object.keys(en);
let localeBad = 0;
for (const lang of localeLangs) {
  if (lang === "en") continue;
  const dict = LOCALES[lang];
  const missing = enKeys.filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !(k in en));
  const empty = Object.keys(dict).filter((k) => typeof dict[k] !== "string" || !dict[k].trim());
  const mismatch = enKeys.filter((k) => k in dict && typeof dict[k] === "string" && placeholders(en[k]) !== placeholders(dict[k]));
  if (missing.length) { bad(`[${lang}] missing ${missing.length} keys: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`); localeBad++; }
  if (extra.length) { bad(`[${lang}] extra ${extra.length} keys: ${extra.slice(0, 8).join(", ")}`); localeBad++; }
  if (empty.length) { bad(`[${lang}] empty/non-string values: ${empty.slice(0, 8).join(", ")}`); localeBad++; }
  if (mismatch.length) { bad(`[${lang}] placeholder mismatch: ${mismatch.slice(0, 8).join(", ")}`); localeBad++; }
  if (!missing.length && !extra.length && !empty.length && !mismatch.length) {
    ok(`[${lang}] ${Object.keys(dict).length} keys, same key set, non-empty, placeholders OK`);
  }
  const allowIdentical = new Set(["app.name", "output.sepComma", "output.sepSlash", "output.sepIdeographic"]);
  const identical = enKeys.filter((k) => k in dict && dict[k] === en[k] && !allowIdentical.has(k));
  if (identical.length) info(`[${lang}] ${identical.length} value(s) identical to en (may be valid, e.g. "Page {n}"): ${identical.slice(0, 6).join(", ")}${identical.length > 6 ? " …" : ""}`);
}
if (!localeBad) ok(`all ${localeLangs.length} locale files are consistent with en.json (${enKeys.length} keys each)`);
if (localeLangs.length !== 7) bad(`expected 7 locale files, found ${localeLangs.length}`);

/* keys that are defined but never used (informational).
   NB: some keys are used through variables, e.g. t(key) where key = "output.oddCount";
   so also count any en key that appears as a string literal anywhere in app.js. */
const appStringKeys = enKeys.filter((k) => appQuoted.has(k));
const usedKeys = new Set([...templateKeys, ...appKeys, ...sepI18nKeys, ...dynamicResolvedKeys, ...appStringKeys]);
const unusedKeys = enKeys.filter((k) => !usedKeys.has(k));
if (unusedKeys.length) info(`en.json keys not used by the template or app.js (dead strings): ${unusedKeys.length} — ${unusedKeys.join(", ")}`);

/* ================================================================ 3. build */

section("3. build: index.html / worker.js vs src");

const leftover = HTML.match(/@@[A-Z]+@@/g) || [];
if (leftover.length) bad(`index.html still contains build placeholders: ${leftover.join(", ")}`);
else ok("index.html has no @@PLACEHOLDER@@ leftovers");

const i18nObj = {};
for (const lang of buildLangs.length ? buildLangs : PP.LANGS) i18nObj[lang] = LOCALES[lang];
const i18nExpected = "var I18N = " + JSON.stringify(i18nObj) + ";";

if (/(@@[A-Z]+@@)/.test(TEMPLATE)) {
  const expectedHtml = TEMPLATE
    .replace("@@STYLES@@", () => CSS)
    .replace("@@CORE@@", () => CORE)
    .replace("@@I18N@@", () => i18nExpected)
    .replace("@@APP@@", () => APP);
  if (expectedHtml === HTML) {
    ok(`index.html is exactly build(src) — ${(HTML.length / 1024).toFixed(1)} KB, ${PP.LANGS.length} locales inlined, 0 external assets`);
  } else {
    let at = 0;
    while (at < expectedHtml.length && at < HTML.length && expectedHtml[at] === HTML[at]) at++;
    bad(`index.html is STALE vs src (first difference at char ${at}) — run: node tools/build.mjs`);
    info(`  expected ${expectedHtml.length} chars, index.html has ${HTML.length} chars`);
  }
} else {
  bad("src/index.template.html has no @@PLACEHOLDER@@ tokens — cannot verify how index.html was built");
}

/* worker.js must inline exactly the same bytes */
const marker = 'const HTML = "';
const markerAt = WORKER.indexOf(marker);
let workerHtml = null;
if (markerAt < 0) {
  bad("worker.js has no `const HTML = \"…\"` line");
} else {
  const quoteAt = markerAt + marker.length - 1;
  let i = quoteAt + 1;
  let escaped = false;
  let end = -1;
  for (; i < WORKER.length; i++) {
    const ch = WORKER[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { end = i; break; }
  }
  try {
    workerHtml = JSON.parse(WORKER.slice(quoteAt, end + 1));
  } catch (err) {
    bad(`worker.js const HTML is not a parseable JSON string: ${err.message}`);
  }
}
if (workerHtml !== null) {
  const same = readBuf("index.html").equals(Buffer.from(workerHtml, "utf8"));
  if (same) ok("worker.js `const HTML` parses to exactly the bytes of index.html");
  else {
    bad("worker.js inlines different HTML than index.html (stale worker build) — run: node tools/build.mjs");
    info(`  worker HTML ${workerHtml.length} chars vs index.html ${HTML.length} chars`);
  }
  if (/@@[A-Z]+@@/.test(workerHtml)) bad("worker.js HTML still contains build placeholders");
  if (!/export default \{/.test(WORKER)) warn("worker.js has no `export default {` handler");
  for (const hdr of ['"x-content-type-options": "nosniff"', '"content-type": "text/html; charset=utf-8"']) {
    if (!WORKER.includes(hdr)) warn(`worker.js is missing expected header ${hdr}`);
  }
}
const workerSize = (readBuf("worker.js").length / 1024).toFixed(1);
info(`sizes: index.html ${(readBuf("index.html").length / 1024).toFixed(1)} KB · worker.js ${workerSize} KB`);

/* ================================================================ 4. offline */

section("4. offline / external-asset checks (index.html)");

/* 4a. script tags must be inline */
const scriptTags = [...HTML.matchAll(/<script\b([^>]*)>/gi)];
let externalScript = 0;
for (const m of scriptTags) {
  if (/\bsrc\s*=/i.test(m[1])) { bad(`<script> with src= found: <script${m[1].trim()}>`); externalScript++; }
  if (/\btype\s*=\s*["']module["']/i.test(m[1])) warn(`<script type="module"> found — needs http(s) on file://`);
}
if (!externalScript) ok(`${scriptTags.length} inline <script> tags, none with src=`);

/* 4b. link tags: only data: favicon is allowed */
const linkTags = [...HTML.matchAll(/<link\b([^>]*)>/gi)];
let externalLink = 0;
for (const m of linkTags) {
  const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
  const url = href ? (href[2] ?? href[3] ?? href[4] ?? "") : "";
  if (/^https?:|^\/\//i.test(url)) { bad(`external <link> found: ${url}`); externalLink++; }
  else if (url && !/^data:/i.test(url) && !/^\.?\//.test(url)) warn(`unrecognised <link href>: ${url}`);
}
if (!externalLink) ok(`${linkTags.length} <link> tag(s), all local or data: URI (SVG favicon)`);

/* 4c. CSS must not import or load anything */
const atImport = (HTML.match(/@import/gi) || []).length;
if (atImport) bad(`CSS @import found (${atImport})`);
else ok("no CSS @import");
const externalCssUrl = [...HTML.matchAll(/url\(\s*['"]?(https?:|\/\/)/gi)];
if (externalCssUrl.length) bad(`${externalCssUrl.length} external url(...) reference(s) in CSS`);
else ok("no external url(...) in CSS");
const fontFace = (HTML.match(/@font-face/gi) || []).length;
if (fontFace) warn(`${fontFace} @font-face block(s) — verify the src is not an external URL`);
else ok("no @font-face / external fonts");

/* 4d. resource elements with http(s) src */
const resourceSrc = [...HTML.matchAll(/<(img|iframe|object|embed|video|audio|source|track|input)\b[^>]*\bsrc\s*=\s*["'](https?:|\/\/)/gi)];
if (resourceSrc.length) bad(`${resourceSrc.length} resource element(s) load an external URL`);
else ok("no external image/iframe/media/script resource URLs");

/* 4e. only user-clickable <a href> may leave the page */
const anchors = [...HTML.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
  attrs: m[1],
  text: m[2].replace(/<[^>]+>/g, "").trim()
}));
const anchorHrefs = anchors
  .map((a) => (/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(a.attrs) || [])[2] || "")
  .filter(Boolean);
const externalAnchors = anchorHrefs.filter((h) => /^https?:|^\/\//i.test(h));
const badAnchor = anchorHrefs.filter((h) => /^javascript:/i.test(h));
if (badAnchor.length) bad(`javascript: anchors found: ${badAnchor.join(", ")}`);
ok(`${anchorHrefs.length} <a href> total, ${externalAnchors.length} external (allowed: user-clicked links)`);
for (const href of [...new Set(externalAnchors)]) info(`  \u2192 ${href}`);
for (const a of anchors) {
  if (/target\s*=\s*["']_blank["']/i.test(a.attrs) && !/rel\s*=\s*["'][^"']*noopener/i.test(a.attrs)) {
    warn(`target=_blank without rel=noopener: "${a.text}"`);
  }
}

/* 4f. no network APIs in the inlined JS (privacy claim) */
const networkApis = [
  ["fetch(", /\bfetch\s*\(/g],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/g],
  ["navigator.sendBeacon", /sendBeacon\s*\(/g],
  ["new WebSocket", /new\s+WebSocket\b/g],
  ["new EventSource", /new\s+EventSource\b/g],
  ["importScripts", /importScripts\s*\(/g]
];
let apiHits = 0;
for (const [name, re] of networkApis) {
  const hits = (HTML.match(re) || []).length;
  if (hits) { bad(`network API in index.html: ${name} \u00d7${hits}`); apiHits++; }
}
if (!apiHits) ok("no fetch/XHR/sendBeacon/WebSocket/EventSource/importScripts in the shipped HTML");
const httpLiteral = (HTML.match(/https?:\/\//g) || []).length;
info(`bare http(s):// occurrences in index.html: ${httpLiteral} (SVG xmlns, external <a href>, meta are fine)`);

/* 4g. document metadata */
if (/^<!doctype html>/i.test(HTML.trimStart())) ok("index.html starts with <!doctype html>");
else bad("index.html does not start with <!doctype html>");
if (/<meta\s+charset="utf-8"/i.test(HTML)) ok("meta charset=utf-8 present");
else bad("meta charset is missing");
if (/<meta\s+name="viewport"/i.test(HTML)) ok("viewport meta present");
else warn("no viewport meta");
if (/<title>[^<]+<\/title>/i.test(HTML)) ok("non-empty <title>");
else bad("<title> is missing or empty");
if (/<html\b[^>]*\blang="[a-zA-Z-]+"/.test(HTML)) ok("<html lang> present");
else warn("<html lang> missing");

/* ================================================================ 5. html pairing */

section("5. HTML tag pairing (JS fallback; Python html.parser version: tests/html-check.py)");

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function checkTagPairing(source, name) {
  /* hide raw-text element contents so JS/CSS text cannot be mistaken for tags */
  const stripped = source.replace(/<(script|style|textarea)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, (m, tag) => `<${tag}${m.slice(tag.length + 1, m.indexOf(">") + 1)}></${tag}>`);
  const tagRe = /<!--[\s\S]*?-->|<!doctype[^>]*>|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/gi;
  const stack = [];
  const problems = [];
  let m;
  while ((m = tagRe.exec(stripped))) {
    if (m[1]) {
      const tag = m[1].toLowerCase();
      if (VOID.has(tag)) continue;
      if (!stack.length) { problems.push(`line ${lineOf(stripped, m.index)}: unexpected </${tag}>`); continue; }
      const top = stack.pop();
      if (top.tag !== tag) problems.push(`line ${lineOf(stripped, m.index)}: </${tag}> closes <${top.tag}> opened at line ${top.line}`);
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = m[3] || "";
      const selfClosing = /\/\s*$/.test(attrs);
      if (VOID.has(tag) || selfClosing) continue;
      stack.push({ tag, line: lineOf(stripped, m.index) });
    }
  }
  for (const open of stack) problems.push(`opened <${open.tag}> at line ${open.line} is never closed`);
  if (problems.length) { bad(`${name}: ${problems.length} tag pairing problem(s)`); problems.slice(0, 10).forEach((p) => info("  " + p)); }
  else ok(`${name}: all tags paired (ignoring void elements)`);
  return problems.length;
}
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}
checkTagPairing(HTML, "index.html");
checkTagPairing(TEMPLATE, "src/index.template.html");
info("Python html.parser check: run `python tests/html-check.py` separately (Node spawn is EPERM in this sandbox)");

/* ================================================================ 6. UI facts */

section("6. UI facts (for README fact-check; informational)");

const facts = {
  copyButtons: (TEMPLATE.match(/\bid="copyBtn"/g) || []).length,
  tabs: tabValues.length,
  presets: (TEMPLATE.match(/\bdata-preset="/g) || []).length,
  settingsRows: (TEMPLATE.match(/\bid="set(Lang|Map|Gaps|Promo)"/g) || []).length,
  sepOptions: (() => {
    const m = /var SEP_OPTIONS = \[([^\]]*)\]/.exec(APP);
    return m ? [...m[1].matchAll(STRING_LITERAL)].length : "?";
  })(),
  locales: localeLangs.length,
  externalAnchors: externalAnchors.length,
  recordActions: ["copy", "restore", "del"].filter((a) => new RegExp(`data-act", "${a}"`).test(APP)).length,
  maxRecords: /var MAX_RECORDS = (\d+)/.exec(APP) ? /var MAX_RECORDS = (\d+)/.exec(APP)[1] : "?",
  version: /var VERSION = "([^"]+)"/.exec(APP) ? /var VERSION = "([^"]+)"/.exec(APP)[1] : "?",
  totalMin: PP.MIN_PAGES, totalMax: PP.MAX_PAGES, totalDefault: PP.DEFAULT_TOTAL
};
info(`copy buttons in template: ${facts.copyButtons} (id="copyBtn") — README says one per tab`);
info(`output tabs: ${facts.tabs}; total-page presets: ${facts.presets} (50/100/200)`);
info(`settings toggle rows: ${facts.settingsRows}; separator options: ${facts.sepOptions}`);
info(`locales: ${facts.locales}; external <a> links: ${facts.externalAnchors}`);
info(`record actions wired: ${facts.recordActions} (copy/restore/del); history cap MAX_RECORDS=${facts.maxRecords}`);
info(`page-count limits: ${facts.totalMin}..${facts.totalMax} (default ${facts.totalDefault}); app VERSION=${facts.version}`);
info(`package.json "test" script: ${(() => { try { return JSON.parse(read("package.json")).scripts.test; } catch { return "?"; } })()} — fails under this sandbox (spawn EPERM); use tests/*.mjs directly`);

/* ================================================================ summary */

console.log(`\nRESULT: ${errors ? "FAIL" : "PASS"} (${errors} error(s), ${warnings} warning(s))`);
process.exitCode = errors ? 1 : 0;
