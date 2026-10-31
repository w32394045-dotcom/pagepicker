#!/usr/bin/env node
/* Publish the working tree to GitHub as one commit, then make sure GitHub Pages is on.
   Works for the first push and for later updates. Shell network is blocked in this
   environment, hence plain fetch() instead of git.

   Usage: node tools/github-publish.mjs ["commit message"] [--dry-run]
   The token is read from %USERPROFILE%\.dsh\github.json and never printed. */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "w32394045-dotcom";
const REPO = "pagepicker";
const BRANCH = "main";
const API = "https://api.github.com";

const credPath = join(process.env.USERPROFILE || process.env.HOME || "", ".dsh", "github.json");
const token = JSON.parse(readFileSync(credPath, "utf8")).token;
if (!token) throw new Error("no token in " + credPath);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const message = args.filter((a) => !a.startsWith("--")).join(" ") || "PagePicker 1.0.0 — single-file print page-range builder";

const FILES = [
  "index.html", "worker.js", "package.json", "README.md", "README.zh-CN.md", "LICENSE",
  "robots.txt", ".nojekyll", ".gitignore",
  "src/core.js", "src/app.js", "src/styles.css", "src/index.template.html",
  "src/i18n/en.json", "src/i18n/zh-CN.json", "src/i18n/zh-TW.json", "src/i18n/ja.json",
  "src/i18n/ko.json", "src/i18n/fr.json", "src/i18n/de.json",
  "tools/build.mjs", "tools/check-i18n.mjs", "tools/github-publish.mjs",
  "tests/core.test.mjs"
];

const req = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "pagepicker-publish",
      "x-github-api-version": "2022-11-28"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
};

const api = async (method, path, body) => {
  const r = await req(method, path, body);
  if (!r.ok) {
    const msg = r.json && (r.json.message || r.json.raw) ? (r.json.message || r.json.raw) : "";
    throw new Error(`${method} ${path} -> ${r.status} ${msg}`);
  }
  return r.json;
};

async function ensureRepo() {
  const r = await req("GET", `/repos/${OWNER}/${REPO}`);
  if (r.ok) {
    console.log(`repo exists: ${r.json.full_name}`);
    return r.json;
  }
  if (r.status !== 404) throw new Error("GET repo -> " + r.status);
  if (dryRun) { console.log("[dry-run] would create repo"); return null; }
  const created = await api("POST", "/user/repos", {
    name: REPO,
    description: "Print-dialog page-range builder for printers without a duplexer — odd/even sides, ranges, heat-map overview, copy button. One offline HTML file, 7 languages.",
    homepage: "https://pagepicker.xszx.cc.cd",
    private: false,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: false
  });
  console.log("repo created: " + created.full_name);
  return created;
}

async function publish() {
  const files = FILES.filter((f) => existsSync(join(root, f)));
  if (files.length !== FILES.length) {
    console.warn("not found:", FILES.filter((f) => !existsSync(join(root, f))).join(", "));
  }
  console.log(`files: ${files.length}`);

  /* GitHub refuses blob creation on a repository with no commits ("Git Repository is empty"),
     so the first file goes in through the contents API. */
  let ref = await req("GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  if (!ref.ok && (ref.status === 404 || ref.status === 409)) {
    if (dryRun) { console.log("[dry-run] would bootstrap the empty repository"); return; }
    await api("PUT", `/repos/${OWNER}/${REPO}/contents/.gitignore`, {
      message: "chore: initialize repository",
      content: Buffer.from("node_modules/\n*.log\n.DS_Store\n").toString("base64"),
      branch: BRANCH
    });
    ref = await req("GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    if (!ref.ok) throw new Error("bootstrap failed -> " + ref.status);
    console.log("bootstrapped empty repository");
  }
  if (!ref.ok && ref.status !== 409) throw new Error("GET ref -> " + ref.status);

  const parentSha = ref.ok ? ref.json.object.sha : null;
  let baseTree = null;
  if (parentSha) {
    const commit = await api("GET", `/repos/${OWNER}/${REPO}/git/commits/${parentSha}`);
    baseTree = commit.tree.sha;
  }

  if (dryRun) {
    console.log(`[dry-run] ${parentSha ? "update" : "initial"} commit with ${files.length} files`);
    return;
  }

  const blobs = [];
  for (let i = 0; i < files.length; i += 4) {
    const slice = files.slice(i, i + 4);
    const made = await Promise.all(slice.map(async (file) => {
      const content = readFileSync(join(root, file)).toString("base64");
      const b = await api("POST", `/repos/${OWNER}/${REPO}/git/blobs`, { content, encoding: "base64" });
      return { path: file, mode: "100644", type: "blob", sha: b.sha };
    }));
    blobs.push(...made);
  }

  const treeBody = { tree: blobs };
  if (baseTree) treeBody.base_tree = baseTree;
  const tree = await api("POST", `/repos/${OWNER}/${REPO}/git/trees`, treeBody);

  const commit = await api("POST", `/repos/${OWNER}/${REPO}/git/commits`, {
    message,
    tree: tree.sha,
    parents: parentSha ? [parentSha] : []
  });

  if (parentSha) {
    await api("PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  } else {
    await api("POST", `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  }
  console.log("commit " + commit.sha.slice(0, 7) + " -> " + BRANCH);

  await api("PATCH", `/repos/${OWNER}/${REPO}`, {
    description: "Print-dialog page-range builder for printers without a duplexer — odd/even sides, ranges, heat-map overview, copy button. One offline HTML file, 7 languages.",
    homepage: "https://pagepicker.xszx.cc.cd"
  });
  try {
    await api("PUT", `/repos/${OWNER}/${REPO}/topics`, {
      names: ["print", "page-range", "duplex", "offline", "single-file", "i18n", "vanilla-js", "tool"]
    });
  } catch (e) { console.warn("topics:", e.message); }
}

async function ensurePages() {
  const r = await req("GET", `/repos/${OWNER}/${REPO}/pages`);
  if (r.ok) {
    console.log("pages already on: " + r.json.html_url);
    return r.json.html_url;
  }
  if (r.status !== 404) throw new Error("GET pages -> " + r.status);
  const created = await api("POST", `/repos/${OWNER}/${REPO}/pages`, {
    source: { branch: BRANCH, path: "/" },
    build_type: "legacy"
  });
  console.log("pages enabled: " + created.html_url);
  return created.html_url;
}

const repo = await ensureRepo();
await publish();
const pagesUrl = await ensurePages();

console.log("\nRepo      ", `https://github.com/${OWNER}/${REPO}`);
console.log("Pages     ", pagesUrl || `https://${OWNER}.github.io/${REPO}/`);
console.log("Pages API ", `https://api.github.com/repos/${OWNER}/${REPO}/pages`);
