#!/usr/bin/env node
// Compares every src/i18n/*.json against src/i18n/en.json:
//   - identical key sets (missing / extra)
//   - non-empty string values
//   - identical {placeholder} sets per key
// Exits 1 when anything is wrong. Usage: node tools/check-i18n.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src", "i18n");
const base = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
const langs = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json").sort();

const placeholders = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(",");

let failed = false;
const report = (msg) => { failed = true; console.log("  ✗ " + msg); };

for (const lang of langs) {
  const code = basename(lang, ".json");
  let dict;
  try {
    dict = JSON.parse(readFileSync(join(dir, lang), "utf8"));
  } catch (e) {
    console.log(`\n[${code}] INVALID JSON: ${e.message}`);
    failed = true;
    continue;
  }
  console.log(`\n[${code}] ${Object.keys(dict).length} keys`);
  const missing = Object.keys(base).filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !(k in base));
  if (missing.length) report(`missing ${missing.length}: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " …" : ""}`);
  if (extra.length) report(`extra ${extra.length}: ${extra.slice(0, 12).join(", ")}${extra.length > 12 ? " …" : ""}`);
  for (const k of Object.keys(base)) {
    const v = dict[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || !v.trim()) { report(`empty or non-string value: ${k}`); continue; }
    if (placeholders(base[k]) !== placeholders(v)) report(`placeholder mismatch: ${k} (en: ${placeholders(base[k])} | ${code}: ${placeholders(v)})`);
    if (v === base[k] && k !== "app.name") console.log(`  · untranslated (value identical to en): ${k}`);
  }
  if (!missing.length && !extra.length) {
    let bad = 0;
    for (const k of Object.keys(base)) {
      const v = dict[k];
      if (typeof v !== "string" || !v.trim()) bad++;
      else if (placeholders(base[k]) !== placeholders(v)) bad++;
    }
    console.log(bad ? `  ${bad} value issue(s)` : `  ✓ ${code}: key set + placeholders OK`);
  }
}
console.log(failed ? "\nRESULT: FAIL" : `\nRESULT: PASS (${langs.length} locales + en)`);
process.exit(failed ? 1 : 0);
