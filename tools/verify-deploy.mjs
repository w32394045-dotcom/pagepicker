#!/usr/bin/env node
/* Verify that every entry point serves exactly the local index.html.
   Usage: node tools/verify-deploy.mjs [--retry N]
   Network note: the Windows shell has no outbound TLS here, but Node's fetch does. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const local = readFileSync(join(root, "index.html"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const LOCAL = sha(local);

const URLS = [
  ["primary", "https://pagerange.xszx.cc.cd/"],
  ["mirror1", "https://pagepicker.w32394045.workers.dev/"],
  ["mirror2", "https://w32394045-dotcom.github.io/pagepicker/"]
];

const retryIdx = process.argv.indexOf("--retry");
const retries = retryIdx >= 0 ? Number(process.argv[retryIdx + 1]) || 1 : 1;
const delay = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once() {
  const rows = [];
  let allOk = true;
  for (const [name, url] of URLS) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      const buf = Buffer.from(await res.arrayBuffer());
      const same = sha(buf) === LOCAL;
      if (!same || res.status !== 200) allOk = false;
      rows.push({ name, url, status: res.status, bytes: buf.length, match: same });
      if (!same) {
        writeFileSync(join(root, "tests", `_remote-${name}.html`), buf);
        if (res.status === 200) {
          const remote = buf.toString("utf8");
          let i = 0;
          while (i < Math.min(local.length, remote.length) && local[i] === remote[i]) i++;
          console.log(`  first difference for ${name} at byte ${i}`);
          console.log("  local :", JSON.stringify(local.slice(Math.max(0, i - 60), i + 120)));
          console.log("  remote:", JSON.stringify(remote.slice(Math.max(0, i - 60), i + 120)));
        }
      }
    } catch (e) {
      allOk = false;
      rows.push({ name, url, status: "ERR", bytes: 0, match: false, error: e.message + (e.cause ? " / " + e.cause.message : "") });
    }
  }
  return { rows, allOk };
}

let result;
for (let attempt = 1; attempt <= retries; attempt++) {
  console.log(`\nattempt ${attempt}/${retries} (local index.html ${local.length} bytes, sha256 ${LOCAL.slice(0, 16)})`);
  result = await once();
  for (const r of result.rows) {
    console.log(`${String(r.status).padEnd(4)} ${r.match ? "MATCH   " : "MISMATCH"} ${String(r.bytes).padStart(7)} B  ${r.name.padEnd(8)} ${r.url}${r.error ? "  (" + r.error + ")" : ""}`);
  }
  if (result.allOk) break;
  if (attempt < retries) await sleep(delay);
}

if (!result.allOk) {
  console.log("\nRESULT: NOT ALL ENTRIES ARE LIVE/IDENTICAL");
  process.exit(1);
}
console.log("\nRESULT: PASS — all entries serve the same bytes");
