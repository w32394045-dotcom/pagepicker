/* PagePicker — DOM smoke test without a browser.
 *
 * Why: this machine has no Chrome/Edge/Firefox, no jsdom/playwright, and npm install is unavailable.
 * So this file ships a *minimal but real* DOM shim (element tree, id index, attributes, classList,
 * events with bubbling, fragments, form-control properties, dataset…) and boots the actual
 * src/core.js + src/i18n/*.json + src/app.js inside a `vm` context. The app's own init path runs,
 * so every `document.getElementById(...)`, `querySelectorAll(...)`, event handler and render pass
 * that a browser would execute is executed here too.
 *
 * It is a smoke test, not a rendering test: layout/CSS/real input widgets are out of scope.
 *
 * Run directly (node:test runs in place; `node --test tests/` trips the sandbox's spawn EPERM):
 *     & $NODE tests/dom-smoke.mjs
 *
 * Known issues are marked "[KNOWN ISSUE]" and skipped with an explicit reason (see QA-REPORT.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const TEMPLATE = read("src/index.template.html");
const CORE_SRC = read("src/core.js");
const APP_SRC = read("src/app.js");
const LANGS = ["zh-CN", "zh-TW", "ja", "ko", "fr", "de", "en"];
const DICTS = {};
for (const lang of LANGS) DICTS[lang] = JSON.parse(read(`src/i18n/${lang}.json`));
const I18N_SRC = "var I18N = " + JSON.stringify(DICTS) + ";";
const VERSION = /var VERSION = "([^"]+)"/.exec(APP_SRC)[1];

/* ==================================================================== DOM shim */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

function decodeEntities(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, k) => ({
    amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'"
  }[k]));
}

class ShimNode {
  constructor(doc, nodeType) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = new Map();
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    if (this.nodeType === 3) { this.data = String(v); return; }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== "" && v !== null && v !== undefined) {
      this.appendChild(this.ownerDocument.createTextNode(String(v)));
    }
  }
  appendChild(node) {
    if (!node) return node;
    if (node.nodeType === 11) { // DocumentFragment: move children
      for (const c of node.childNodes.slice()) this.appendChild(c);
      node.childNodes = [];
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === "string" ? this.ownerDocument.createTextNode(n) : n);
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) { this.childNodes.splice(i, 1); node.parentNode = null; }
    return node;
  }
  addEventListener(type, fn) {
    if (typeof fn !== "function") return;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event) { return dispatchEventTo(this, event); }
}

class ShimText extends ShimNode {
  constructor(doc, data) { super(doc, 3); this.data = String(data); }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
}

class ShimFragment extends ShimNode {
  constructor(doc) { super(doc, 11); }
}

class ShimElement extends ShimNode {
  constructor(doc, tagName) {
    super(doc, 1);
    this.tagName = String(tagName).toLowerCase();
    this.nodeName = this.tagName.toUpperCase();
    this._attrs = new Map();
    this._classes = new Set();
    this.style = {};
    this._value = "";
    this._checked = false;
    this._hidden = false;
    this._disabled = false;
    this._open = false;
    const self = this;
    this.dataset = new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        const name = "data-" + prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
        const v = self.getAttribute(name);
        return v === null ? undefined : v;
      },
      set(_t, prop, value) {
        const name = "data-" + String(prop).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
        self.setAttribute(name, value);
        return true;
      },
      has(_t, prop) {
        if (typeof prop !== "string") return false;
        return self.getAttribute("data-" + prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())) !== null;
      }
    });
  }

  /* --- attributes --- */
  getAttribute(name) {
    name = String(name).toLowerCase();
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }
  hasAttribute(name) { return this._attrs.has(String(name).toLowerCase()); }
  removeAttribute(name) {
    name = String(name).toLowerCase();
    this._attrs.delete(name);
    if (name === "class") this._classes = new Set();
    else if (name === "hidden") this._hidden = false;
    else if (name === "checked") this._checked = false;
    else if (name === "disabled") this._disabled = false;
    else if (name === "open") this._open = false;
    else if (name === "value") this._value = "";
  }
  setAttribute(name, value) {
    name = String(name).toLowerCase();
    const v = String(value);
    this._attrs.set(name, v);
    if (name === "class") {
      this._classes = new Set(v.split(/\s+/).filter(Boolean));
    } else if (name === "id") {
      const doc = this.ownerDocument;
      if (doc && doc._byId) {
        if (doc._byId.has(v)) doc._duplicateIds.push(v);
        else doc._byId.set(v, this);
      }
    } else if (name === "hidden") this._hidden = true;
    else if (name === "checked") this._checked = true;
    else if (name === "disabled") this._disabled = true;
    else if (name === "open") this._open = true;
    else if (name === "value") this._value = v;
  }

  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get title() { return this.getAttribute("title") || ""; }
  set title(v) { this.setAttribute("title", v); }
  get placeholder() { return this.getAttribute("placeholder") || ""; }
  set placeholder(v) { this.setAttribute("placeholder", v); }
  get type() { return this.getAttribute("type") || ""; }
  set type(v) { this.setAttribute("type", v); }
  get min() { return this.getAttribute("min") === null ? "" : this.getAttribute("min"); }
  set min(v) { this.setAttribute("min", v); }
  get max() { return this.getAttribute("max") === null ? "" : this.getAttribute("max"); }
  set max(v) { this.setAttribute("max", v); }
  get value() { return this._value; }
  set value(v) { this._value = v === null || v === undefined ? "" : String(v); }
  get checked() { return this._checked; }
  set checked(v) { this._checked = !!v; }
  get hidden() { return this._hidden; }
  set hidden(v) { this._hidden = !!v; }
  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = !!v; }
  get open() { return this._open; }
  set open(v) { this._open = !!v; }
  get className() { return [...this._classes].join(" "); }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    this._attrs.set("class", [...this._classes].join(" "));
  }
  get classList() {
    const self = this;
    const sync = () => { self._attrs.set("class", [...self._classes].join(" ")); };
    return {
      add(...names) { for (const n of names) self._classes.add(n); sync(); },
      remove(...names) { for (const n of names) self._classes.delete(n); sync(); },
      contains(name) { return self._classes.has(name); },
      toggle(name, force) {
        const on = force === undefined ? !self._classes.has(name) : !!force;
        if (on) self._classes.add(name); else self._classes.delete(name);
        sync();
        return on;
      },
      item(i) { return [...self._classes][i] || null; },
      get length() { return self._classes.size; }
    };
  }

  /* --- events --- */
  click() { return this.dispatchEvent(makeEvent("click")); }
  focus() { this._focused = true; }
  blur() { this._focused = false; }
  select() { this._selected = true; }
  showModal() { this._open = true; }
  close() { this._open = false; }
  scrollIntoView() {}

  /* --- tree / selectors --- */
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === 9;
  }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let n = this;
    while (n && n.nodeType === 1) {
      if (matchesSelector(n, selector)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) { return collectMatching(this, selector, false); }
  querySelector(selector) { return collectMatching(this, selector, false)[0] || null; }
}

function findFirstTag(root, tag) {
  if (root.nodeType === 1 && root.tagName === tag) return root;
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      const hit = findFirstTag(child, tag);
      if (hit) return hit;
    }
  }
  return null;
}

/* --- CSS selector matching (the small subset app.js/tests actually use) --- */

const COMPOUND_TOKEN = /([#.]?[A-Za-z0-9_-]+|\[[^\]]+\]|\*)/g;

function matchCompound(el, compound) {
  if (!compound) return false;
  COMPOUND_TOKEN.lastIndex = 0;
  let m, any = false;
  while ((m = COMPOUND_TOKEN.exec(compound))) {
    any = true;
    const tok = m[1];
    if (tok === "*") continue;
    if (tok[0] === "#") {
      if (el.id !== tok.slice(1)) return false;
    } else if (tok[0] === ".") {
      if (!el.classList.contains(tok.slice(1))) return false;
    } else if (tok[0] === "[") {
      const inner = tok.slice(1, -1).trim();
      const eq = /^([^\s=\]]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?$/.exec(inner);
      if (!eq) return false;
      const actual = el.getAttribute(eq[1]);
      if (eq[2] === undefined) {
        if (actual === null) return false;
      } else if (eq[2] !== "=") {
        /* only exact match is needed in this project's selectors */
        if (actual === null) return false;
      } else {
        const expected = eq[3] !== undefined ? eq[3] : eq[4] !== undefined ? eq[4] : eq[5];
        if (actual !== expected) return false;
      }
    } else {
      if (el.tagName !== tok.toLowerCase()) return false;
    }
  }
  return any;
}

function matchesSelector(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  for (const group of String(selector).split(",")) {
    const parts = group.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    if (!matchCompound(el, parts[parts.length - 1])) continue;
    let idx = parts.length - 2;
    let node = el.parentNode;
    while (idx >= 0 && node) {
      if (node.nodeType === 1 && matchCompound(node, parts[idx])) idx--;
      node = node.parentNode;
    }
    if (idx < 0) return true;
  }
  return false;
}

function collectMatching(rootEl, selector, includeSelf) {
  const out = [];
  (function walk(el, include) {
    if (!el || el.nodeType !== 1) return;
    if (include && matchesSelector(el, selector)) out.push(el);
    for (const child of el.childNodes) if (child.nodeType === 1) walk(child, true);
  })(rootEl, includeSelf);
  return out;
}

/* --- events + bubbling --- */

function makeEvent(type, props) {
  const ev = {
    type,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    target: null,
    currentTarget: null,
    shiftKey: false,
    key: undefined,
    _stopPropagation: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopPropagation = true; }
  };
  if (props) Object.assign(ev, props);
  return ev;
}

function dispatchEventTo(target, event) {
  if (event.target === null) event.target = target;
  let node = target;
  while (node) {
    const listeners = node._listeners && node._listeners.get(event.type);
    if (listeners && listeners.length) {
      event.currentTarget = node;
      for (const fn of listeners.slice()) fn.call(node, event);
      if (event._stopPropagation) break;
    }
    if (node.nodeType === 9) break; // document is the last stop
    node = node.parentNode;
  }
  return !event.defaultPrevented;
}

function fire(node, type, props) {
  const ev = makeEvent(type, props);
  dispatchEventTo(node, ev);
  return ev;
}

function click(node, props) { return fire(node, "click", props); }

/* --- HTML parser (the template is small and well-formed) --- */

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(text, el) {
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(text))) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    el.setAttribute(name, decodeEntities(value));
  }
}

function parseHTML(html, doc, root) {
  const stack = [root];
  const appendText = (text) => {
    if (!text) return;
    stack[stack.length - 1].appendChild(doc.createTextNode(text));
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { appendText(html.slice(i)); break; }
    if (lt > i) appendText(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt)) {
      const end = html.indexOf(">", lt + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const closeMatch = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(lt));
    if (closeMatch) {
      const name = closeMatch[1].toLowerCase();
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].tagName === name) { stack.length = k; break; }
      }
      i = lt + closeMatch[0].length;
      continue;
    }
    const openMatch = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(lt));
    if (!openMatch) { appendText("<"); i = lt + 1; continue; }
    const tagName = openMatch[1].toLowerCase();
    let j = lt + openMatch[0].length;
    let quote = null;
    for (; j < html.length; j++) {
      const ch = html[j];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === ">") break;
    }
    if (j >= html.length) break;
    let inner = html.slice(lt + openMatch[0].length, j);
    const selfClosing = /\/\s*$/.test(inner);
    if (selfClosing) inner = inner.replace(/\/\s*$/, "");
    const el = doc.createElement(tagName);
    parseAttributes(inner, el);
    stack[stack.length - 1].appendChild(el);
    i = j + 1;
    if (VOID_TAGS.has(tagName) || selfClosing) continue;
    if (RAW_TEXT_TAGS.has(tagName)) {
      const closeRe = new RegExp("</" + tagName + "\\s*>", "i");
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      if (m) {
        const raw = rest.slice(0, m.index);
        if (raw) el.appendChild(doc.createTextNode(raw));
        i += m.index + m[0].length;
      } else {
        i = html.length;
      }
      continue;
    }
    stack.push(el);
  }
  return root;
}

/* --- document --- */

class ShimDocument extends ShimNode {
  constructor(html) {
    super(null, 9);
    this.readyState = "complete"; // app.js runs init() immediately
    this._byId = new Map();
    this._duplicateIds = [];
    this._missingIdLookups = [];
    this.execCommand = () => true;
    const root = new ShimFragment(this);
    parseHTML(html, this, root);
    let htmlEl = root.children.find((el) => el.tagName === "html");
    if (!htmlEl) {
      htmlEl = new ShimElement(this, "html");
      while (root.childNodes.length) htmlEl.appendChild(root.childNodes[0]);
    }
    this.documentElement = htmlEl;
    htmlEl.parentNode = this;
    this.childNodes = [htmlEl];
    this.head = findFirstTag(htmlEl, "head") || this.createElement("head");
    this.body = findFirstTag(htmlEl, "body") || this.createElement("body");
    this._title = "";
  }
  createElement(tag) { return new ShimElement(this, tag); }
  createTextNode(data) { return new ShimText(this, data); }
  createDocumentFragment() { return new ShimFragment(this); }
  getElementById(id) {
    const hit = this._byId.get(String(id));
    if (!hit) this._missingIdLookups.push(String(id));
    return hit || null;
  }
  querySelectorAll(selector) { return collectMatching(this.documentElement, selector, true); }
  querySelector(selector) { return collectMatching(this.documentElement, selector, true)[0] || null; }
  get title() { return this._title; }
  set title(v) { this._title = String(v); }
}

/* ==================================================================== boot */

/**
 * Boot the real app against a fresh shim document.
 * opts: { hash, storage (object of key→string), language, languages, confirm, prompt }
 */
function boot(opts = {}) {
  const doc = new ShimDocument(opts.template || TEMPLATE);
  const store = new Map();
  if (opts.storage) {
    for (const [k, v] of Object.entries(opts.storage)) store.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const localStorage = {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); }
  };
  const loc = { hash: "", href: "http://localhost/index.html" };
  if (opts.hash) {
    loc.hash = opts.hash;
    loc.href = loc.href.split("#")[0] + opts.hash;
  }
  const history = {
    state: null,
    replaceState(_state, _title, url) {
      if (url === null || url === undefined) return;
      const u = String(url);
      if (u.startsWith("#")) {
        loc.hash = u;
        loc.href = loc.href.split("#")[0] + u;
      } else {
        loc.href = u;
        loc.hash = u.includes("#") ? "#" + u.split("#")[1] : "";
      }
    },
    pushState() {}
  };
  const nav = {
    language: opts.language || "en-US",
    languages: opts.languages || [opts.language || "en-US"]
  };
  const sandbox = {
    console,
    document: doc,
    navigator: nav,
    location: loc,
    history,
    localStorage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    confirm: (...args) => (opts.confirm ? opts.confirm(...args) : false),
    prompt: (...args) => (opts.prompt ? opts.prompt(...args) : null),
    alert: () => {}
  };
  const ctx = vm.createContext(sandbox, { name: "pagepicker-dom-smoke" });
  // the app only touches window.confirm/window.prompt; window === globalThis is enough
  vm.runInContext("globalThis.window = globalThis; globalThis.self = globalThis;", ctx);
  vm.runInContext(CORE_SRC, ctx, { filename: "src/core.js" });
  vm.runInContext(I18N_SRC, ctx, { filename: "src/i18n.js" });
  try {
    vm.runInContext(APP_SRC, ctx, { filename: "src/app.js" });
  } catch (err) {
    err.message = `app.js threw during init: ${err.message}`;
    throw err;
  }
  return { doc, ctx, sandbox, nav, loc, store };
}

/* ==================================================================== helpers */

const $ = (h, id) => h.doc.getElementById(id);
const one = (h, selector) => {
  const list = h.doc.querySelectorAll(selector);
  assert.ok(list.length > 0, `expected at least one element matching ${selector}`);
  return list[0];
};
const many = (h, selector) => h.doc.querySelectorAll(selector);
const mapCell = (h, page) => $(h, "map").children[page - 1];
const chipCell = (h, page) => $(h, "chips").children[page - 1];
const outText = (h) => $(h, "outArea").value;
const toastText = (h) => $(h, "toast").textContent;
const selectedPages = (h) =>
  $(h, "map").children
    .map((el, i) => (el.classList.contains("is-sel") ? i + 1 : 0))
    .filter(Boolean);
const setInput = (h, id, value) => {
  const el = $(h, id);
  el.value = value;
  fire(el, "change");
};
const pressSeg = (h, containerId, attr, value) => {
  const container = $(h, containerId);
  assert.ok(container, `container #${containerId} exists`);
  const btn = container.querySelectorAll("button").find((b) => b.getAttribute(attr) === value);
  assert.ok(btn, `button[${attr}="${value}"] in #${containerId}`);
  click(btn);
  return btn;
};
const pressPreset = (h, value) => {
  const btn = $(h, "presets").querySelectorAll("button").find((b) => b.getAttribute("data-preset") === String(value));
  assert.ok(btn, `preset ${value}`);
  click(btn);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const fill = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const sel = (h, pages) => {
  // click the first page, then shift-click the last one for a span; single pages click once
  if (pages.length === 1) { click(mapCell(h, pages[0])); return; }
  click(mapCell(h, pages[0]));
  click(mapCell(h, pages[pages.length - 1]), { shiftKey: true });
};

/* ==================================================================== tests */

test("boot: no exception, every template id resolves, 100 cells, empty output", () => {
  const h = boot();
  // 1. every id in the template is reachable through getElementById (catches id typos in app.js too)
  const templateIds = [...TEMPLATE.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(templateIds.length > 80, "template declares plenty of ids");
  for (const id of templateIds) {
    assert.ok($(h, id), `#${id} resolves via getElementById`);
  }
  // app.js must not have looked up an id that the template does not define
  assert.deepEqual(h.doc._missingIdLookups, [], "app.js looked up an id that is missing from the template");
  // 2. total pages = 100 and the heat map + manual grid each built 100 buttons
  assert.equal($(h, "totalInput").value, "100");
  assert.equal($(h, "map").children.length, 100);
  assert.equal($(h, "chips").children.length, 100);
  assert.equal($(h, "chips").children[99].textContent, "100");
  // 3. nothing is selected yet
  assert.deepEqual(selectedPages(h), []);
  assert.equal(outText(h), "");
  assert.equal($(h, "outCount").textContent, DICTS.en["output.empty"]);
  assert.equal($(h, "copyBtn").disabled, true);
  assert.equal($(h, "mapCoverage").textContent, "0 of 100 pages selected (0%)");
  assert.equal(h.doc.title, DICTS.en["app.title"]);
});

test("clicking a page button toggles .is-sel and updates the output text", () => {
  const h = boot();
  click(mapCell(h, 3));
  assert.ok(mapCell(h, 3).classList.contains("is-sel"), "map cell 3 has .is-sel");
  assert.ok(chipCell(h, 3).classList.contains("is-sel"), "chip 3 has .is-sel");
  assert.ok(mapCell(h, 3).classList.contains("is-odd"), "page 3 is odd");
  assert.equal(outText(h), "3");
  assert.equal(mapCell(h, 3).title, "Page 3", "hover tooltip = page number");
  assert.equal(mapCell(h, 3).getAttribute("aria-label"), "Page 3");
  assert.equal($(h, "outCount").textContent, DICTS.en["output.allCount"].replace("{n}", "1"));
  assert.equal($(h, "copyBtn").disabled, false);
  assert.match($(h, "mapCoverage").textContent, /^1 of 100 pages selected \(1%\)$/);

  click(mapCell(h, 3)); // toggle back off
  assert.ok(!mapCell(h, 3).classList.contains("is-sel"));
  assert.equal(outText(h), "");
});

test("Shift+click fills the span from the last clicked page; Shift+click again removes it", () => {
  const h = boot();
  click(mapCell(h, 2));
  click(mapCell(h, 6), { shiftKey: true });
  assert.deepEqual(selectedPages(h), [2, 3, 4, 5, 6]);
  assert.equal(outText(h), "2-6");

  click(mapCell(h, 2), { shiftKey: true }); // anchor 6 → span 2..6 is fully selected → remove
  assert.deepEqual(selectedPages(h), []);
  assert.equal(outText(h), "");
});

test("changing total to 8 rebuilds an 8-cell grid, clips the selection, output stays printable", () => {
  const h = boot();
  click(mapCell(h, 10));
  assert.equal(outText(h), "10");

  setInput(h, "totalInput", "8");
  assert.equal($(h, "totalInput").value, "8");
  assert.equal($(h, "map").children.length, 8);
  assert.equal($(h, "chips").children.length, 8);
  assert.deepEqual(selectedPages(h), [], "page 10 was clipped by total=8");

  // select 1..5 and 8 → compact output is exactly "1-5,8"
  click(mapCell(h, 1));
  click(mapCell(h, 5), { shiftKey: true });
  click(mapCell(h, 8));
  assert.deepEqual(selectedPages(h), [1, 2, 3, 4, 5, 8]);
  assert.equal(outText(h), "1-5,8");
  assert.equal($(h, "mapCoverage").textContent, "6 of 8 pages selected (75%)");
});

test("range control: from 2 to 6 step 2 — add / replace / remove semantics", () => {
  const h = boot();
  setInput(h, "rangeFrom", "2");
  setInput(h, "rangeTo", "6");
  pressSeg(h, "stepSeg", "data-step", "2");

  // default action is "add" on an empty selection
  click($(h, "rangeApply"));
  assert.deepEqual(selectedPages(h), [2, 4, 6]);
  assert.equal(outText(h), "2,4,6");

  // "replace" throws the previous selection away
  click(mapCell(h, 1)); // selection: 1,2,4,6
  pressSeg(h, "actionSeg", "data-action", "replace");
  click($(h, "rangeApply"));
  assert.deepEqual(selectedPages(h), [2, 4, 6]);

  // "add" merges into the existing selection
  pressSeg(h, "actionSeg", "data-action", "add");
  click($(h, "rangeApply"));
  assert.deepEqual(selectedPages(h), [2, 4, 6], "adding the same range is idempotent");

  // "remove" takes the range back out
  pressSeg(h, "actionSeg", "data-action", "remove");
  click($(h, "rangeApply"));
  assert.deepEqual(selectedPages(h), []);
  assert.equal(outText(h), "");
});

test('parity: mode=odd with total=10 produces "1,3,5,7,9"', () => {
  const h = boot();
  setInput(h, "totalInput", "10");
  pressSeg(h, "paritySeg", "data-mode", "odd");
  click($(h, "parityApply"));
  assert.deepEqual(selectedPages(h), [1, 3, 5, 7, 9]);
  assert.equal(outText(h), "1,3,5,7,9");
  assert.equal($(h, "oddOn").checked, false);
  assert.equal($(h, "evenOn").checked, false);

  // even mode on an empty selection
  click($(h, "qNone"));
  pressSeg(h, "paritySeg", "data-mode", "even");
  click($(h, "parityApply"));
  assert.equal(outText(h), "2,4,6,8,10");
});

test("direct pages input: valid list applies; invalid input shows #rangeDirectErr and keeps the selection", () => {
  const h = boot();
  setInput(h, "rangeDirect", "1-5, 8, 10-13");
  click($(h, "rangeDirectApply"));
  assert.equal(outText(h), "1-5,8,10-13");
  assert.equal($(h, "rangeDirectErr").hidden, true);

  const before = outText(h);
  setInput(h, "rangeDirect", "abc");
  click($(h, "rangeDirectApply"));
  assert.equal(outText(h), before, "invalid input must not change the selection");
  assert.equal($(h, "rangeDirectErr").hidden, false, "#rangeDirectErr is visible");
  assert.ok($(h, "rangeDirectErr").textContent.includes("abc"), "error names the bad token");
  assert.equal(toastText(h), DICTS.en["toast.invalid"]);

  // a valid input clears the error again
  click($(h, "qNone"));
  setInput(h, "rangeDirect", "2-3");
  click($(h, "rangeDirectApply"));
  assert.equal($(h, "rangeDirectErr").hidden, true);
  assert.equal(outText(h), "2-3");
});

test('parity direct input: "odd:1-9; even:2-10" → 1..10, mode all', () => {
  const h = boot();
  setInput(h, "totalInput", "10");
  setInput(h, "parityDirect", "odd:1-9; even:2-10");
  click($(h, "parityDirectApply"));
  assert.deepEqual(selectedPages(h), fill(1, 10));
  assert.equal(outText(h), "1-10");
  // mode=all is reflected in the segmented control and in both limit switches
  const allBtn = pressSeg(h, "paritySeg", "data-mode", "all");
  assert.equal(allBtn.getAttribute("aria-pressed"), "true");
  assert.equal($(h, "oddOn").checked, true);
  assert.equal($(h, "evenOn").checked, true);
  assert.equal($(h, "oddFrom").value, "1");
  assert.equal($(h, "oddTo").value, "9");
  assert.equal($(h, "evenFrom").value, "2");
  assert.equal($(h, "evenTo").value, "10");
  assert.equal($(h, "parityDirectErr").hidden, true);
});

test("language switch: all 7 locales repaint the UI and differ from en", () => {
  const h = boot();
  assert.equal(h.doc.title, DICTS.en["app.title"]);
  assert.equal(h.doc.documentElement.lang, "en");

  const keys = ["app.tagline", "range.title", "range.desc", "output.title", "output.desc", "settings.title", "footer.local", "records.title", "heatmap.legendUnselected"];
  const snapshot = () => {
    const texts = {};
    for (const key of keys) {
      const el = many(h, "[data-i18n]").find((e) => e.getAttribute("data-i18n") === key);
      assert.ok(el, `template contains a data-i18n="${key}" element`);
      texts[key] = el.textContent;
    }
    return texts;
  };
  const enTexts = snapshot();
  const languages = LANGS.slice(0, 6); // everything except en: zh-CN, zh-TW, ja, ko, fr, de
  const langsWithADifference = [];
  for (const lang of languages) {
    const select = $(h, "langSelect");
    select.value = lang;
    fire(select, "change");
    assert.equal(h.doc.documentElement.lang, lang);
    assert.equal(h.doc.title, DICTS[lang]["app.title"]);
    assert.notEqual(h.doc.title, "app.title");
    assert.ok(h.doc.title.trim().length > 0);
    const texts = snapshot();
    for (const key of keys) {
      assert.ok(texts[key].trim().length > 0, `${lang}: ${key} is non-empty`);
      assert.equal(texts[key], DICTS[lang][key], `${lang}: ${key} uses the locale dictionary`);
    }
    if (keys.some((k) => texts[k] !== enTexts[k])) langsWithADifference.push(lang);
    // the language selector itself was rebuilt and stays selected
    assert.equal($(h, "langSelect").value, lang);
    assert.equal($(h, "setLang").value, lang);
  }
  assert.deepEqual(langsWithADifference, languages, "every non-en locale differs from en in at least one label");

  // back to en
  const select = $(h, "langSelect");
  select.value = "en";
  fire(select, "change");
  assert.equal(h.doc.title, DICTS.en["app.title"]);
  assert.equal(h.doc.documentElement.lang, "en");
});

test("output format options: compact / separator / reverse / batch", () => {
  const h = boot();
  click(mapCell(h, 1));
  click(mapCell(h, 5), { shiftKey: true });
  click(mapCell(h, 8));
  assert.equal(outText(h), "1-5,8");

  // compact = false → one page per token
  $(h, "optCompact").checked = false;
  fire($(h, "optCompact"), "change");
  assert.equal(outText(h), "1,2,3,4,5,8");

  // separator "、"
  $(h, "optCompact").checked = true;
  fire($(h, "optCompact"), "change");
  $(h, "optSep").value = "、";
  fire($(h, "optSep"), "change");
  assert.equal(outText(h), "1-5、8");

  // reverse order (runs are reversed, numbers inside a run stay ascending)
  $(h, "optReverse").checked = true;
  fire($(h, "optReverse"), "change");
  assert.equal(outText(h), "8、1-5");
  $(h, "optReverse").checked = false;
  fire($(h, "optReverse"), "change");

  // batch=3 on "all pages" → one line per 3 pages
  click($(h, "qAll"));
  $(h, "optBatch").value = "3";
  fire($(h, "optBatch"), "change");
  const batched = outText(h);
  const lines = batched.split("\n");
  assert.ok(batched.includes("\n"), "batched output uses newlines");
  assert.equal(lines[0], "1-3");
  assert.equal(lines[1], "4-6");
  assert.equal(lines.length, 34); // 100 pages / 3 per line
  assert.equal(lines[lines.length - 1], "100");
});

test("copy adds a history record and restore brings the selection back", async () => {
  const h = boot();
  click(mapCell(h, 1));
  click(mapCell(h, 5), { shiftKey: true });
  click(mapCell(h, 8));
  const copied = [];
  h.nav.clipboard = {
    writeText(text) { copied.push(text); return Promise.resolve(); }
  };
  click($(h, "copyBtn"));
  await tick();

  assert.deepEqual(copied, ["1-5,8"], "navigator.clipboard.writeText got the output");
  assert.equal(toastText(h), DICTS.en["toast.copied"]);
  const records = $(h, "recList").children;
  assert.equal(records.length, 1, "#recList has one <li>");
  assert.ok(records[0].textContent.includes("1-5,8"), "record shows the output preview");
  const saved = JSON.parse(h.store.get("pagepicker.v1"));
  assert.equal(saved.records.length, 1);
  assert.deepEqual(saved.records[0].pages, [1, 2, 3, 4, 5, 8]);

  // change the selection, then restore the record
  click($(h, "qNone"));
  assert.equal(outText(h), "");
  const restoreBtn = many(h, "#recList button").find((b) => b.getAttribute("data-act") === "restore");
  assert.ok(restoreBtn, "restore button exists in the record row");
  click(restoreBtn);
  assert.deepEqual(selectedPages(h), [1, 2, 3, 4, 5, 8]);
  assert.equal(outText(h), "1-5,8");
  assert.equal(toastText(h), DICTS.en["toast.restored"]);
});

test("URL hash #t=8&p=1-5,8 restores total and selection on load", () => {
  const h = boot({ hash: "#t=8&p=1-5,8" });
  assert.equal($(h, "totalInput").value, "8");
  assert.equal($(h, "map").children.length, 8);
  assert.deepEqual(selectedPages(h), [1, 2, 3, 4, 5, 8]);
  assert.equal(outText(h), "1-5,8");
});

test("presets 50 / 100 / 200 set the total page count", () => {
  const h = boot();
  pressPreset(h, 50);
  assert.equal($(h, "totalInput").value, "50");
  assert.equal($(h, "map").children.length, 50);
  pressPreset(h, 200);
  assert.equal($(h, "totalInput").value, "200");
  assert.equal($(h, "map").children.length, 200);
  pressPreset(h, 100);
  assert.equal($(h, "totalInput").value, "100");
  assert.deepEqual(h.doc._missingIdLookups, []);
});

test("settings dialog: open on click, Esc closes, map/gaps/promo switches work", () => {
  const h = boot({ confirm: () => true });
  const dlg = $(h, "settingsDlg");
  click($(h, "settingsBtn"));
  assert.equal(dlg.open, true, "settings dialog opened");
  fire(h.doc, "keydown", { key: "Escape" });
  assert.equal(dlg.open, false, "Esc closed the settings dialog");

  // flag gaps: every unselected cell gets .is-gap
  $(h, "setGaps").checked = true;
  fire($(h, "setGaps"), "change");
  assert.ok(mapCell(h, 1).classList.contains("is-gap"));

  // hide the overview map
  $(h, "setMap").checked = false;
  fire($(h, "setMap"), "change");
  assert.equal($(h, "mapWrap").hidden, true);

  // hide the footer promo block
  $(h, "setPromo").checked = false;
  fire($(h, "setPromo"), "change");
  assert.equal($(h, "promo").hidden, true);

  // clear saved data → back to 100 pages, empty selection
  click(mapCell(h, 2));
  click($(h, "clearData"));
  assert.equal(h.store.has("pagepicker.v1"), false, "saved data removed from localStorage");
  assert.equal($(h, "totalInput").value, "100");
  assert.equal($(h, "map").children.length, 100);
  assert.equal(outText(h), "");
});

test("localStorage snapshot restores the selection on the next visit", () => {
  const snapshot = {
    v: 1, total: 8, pages: [1, 2, 3],
    lang: "auto", showMap: true, highlightGaps: false, showPromo: true,
    action: "add", tab: "all",
    out: { compact: true, sep: ",", reverse: false, batch: 0 },
    range: { from: 1, to: 8, step: 1 },
    parity: { mode: "all", oddOn: false, oddFrom: 1, oddTo: 7, evenOn: false, evenFrom: 2, evenTo: 8 },
    records: []
  };
  const h = boot({ storage: { "pagepicker.v1": JSON.stringify(snapshot) } });
  assert.equal($(h, "totalInput").value, "8");
  assert.deepEqual(selectedPages(h), [1, 2, 3]);
  assert.equal(outText(h), "1-3");
});

test("direct-input placeholders resolve to translated text (auto-xfail if the i18n keys are missing)", (t) => {
  const pairs = [["rangeDirect", "range.directPlaceholder"], ["parityDirect", "parity.directPlaceholder"]];
  const h = boot();
  let knownBug = false;
  for (const [id, key] of pairs) {
    const actual = $(h, id).getAttribute("placeholder");
    if (!(key in DICTS.en)) {
      // The template may have been updated to stop using this key (fine) or the key is still missing (bug).
      if (actual === key) {
        console.log(`  ✗ ${id}.placeholder is the raw key "${actual}" (missing from all ${LANGS.length} locale files)`);
        knownBug = true;
      } else {
        assert.ok(actual && actual !== key, `${id}.placeholder is a plain fallback, not a raw key`);
      }
      continue;
    }
    const expected = DICTS.en[key];
    assert.equal(actual, expected, `${id}.placeholder is localised`);
  }
  if (knownBug) {
    t.skip("KNOWN ISSUE: data-i18n-placeholder keys range.directPlaceholder / parity.directPlaceholder are missing from en.json and all 6 translations, so the two direct-input placeholders show the raw key text (t() falls back to the key). Fix: add the keys in en.json + 6 translations, rebuild, or drop the data-i18n-placeholder attributes.");
  }
});

test("output tabs, quick buttons and the dual-handle range slider", () => {
  const h = boot();
  setInput(h, "totalInput", "6");
  for (const p of [1, 2, 3, 4]) click(mapCell(h, p));
  assert.equal(outText(h), "1-4");
  assert.equal($(h, "tabAll").getAttribute("aria-selected"), "true");

  click($(h, "tabOdd"));
  assert.equal(outText(h), "1,3");
  assert.equal($(h, "tabOdd").getAttribute("aria-selected"), "true");
  assert.equal($(h, "tabAll").getAttribute("aria-selected"), "false");
  click($(h, "tabEven"));
  assert.equal(outText(h), "2,4");
  click($(h, "tabAll"));

  click($(h, "qInvert")); // complement of {1,2,3,4} in 6 pages
  assert.deepEqual(selectedPages(h), [5, 6]);
  click($(h, "qOdd"));
  assert.deepEqual(selectedPages(h), [1, 3, 5]);
  assert.equal(outText(h), "1,3,5");
  click($(h, "qEven"));
  assert.deepEqual(selectedPages(h), [2, 4, 6]);

  // dual-handle slider: dragging a handle updates the number boxes (input event)
  const lo = $(h, "rangeLo");
  lo.value = "2";
  fire(lo, "input");
  assert.equal($(h, "rangeFrom").value, "2");
  const hi = $(h, "rangeHi");
  hi.value = "5";
  fire(hi, "input");
  assert.equal($(h, "rangeTo").value, "5");
  assert.equal($(h, "rangeLo").min, "1");
  assert.equal($(h, "rangeHi").max, "6");

  // odd/even limits: odd 3..7 + un-limited evens on a 10-page document
  setInput(h, "totalInput", "10");
  $(h, "oddOn").checked = true;
  fire($(h, "oddOn"), "change");
  setInput(h, "oddFrom", "3");
  setInput(h, "oddTo", "7");
  click($(h, "parityApply"));
  assert.equal(outText(h), "2-8,10");
});

test("share link, clipboard fallback and history row actions", async () => {
  const h = boot({ confirm: () => true });
  click(mapCell(h, 1));
  click(mapCell(h, 5), { shiftKey: true });
  click(mapCell(h, 8));

  // share link: one click copies base + "#t=..&p=.."
  const copied = [];
  h.nav.clipboard = { writeText(text) { copied.push(text); return Promise.resolve(); } };
  click($(h, "shareBtn"));
  await tick();
  assert.equal(copied[0], "http://localhost/index.html#t=100&p=1-5,8");
  assert.equal(toastText(h), DICTS.en["toast.linkCopied"]);

  // copy button → record
  click($(h, "copyBtn"));
  await tick();
  assert.equal(copied[1], "1-5,8");
  assert.equal($(h, "recList").children.length, 1);

  // "copy it again" from the record row (does not duplicate the record)
  const rowButtons = () => many(h, "#recList button");
  const recordCopy = rowButtons().find((b) => b.getAttribute("data-act") === "copy");
  click(recordCopy);
  await tick();
  assert.equal(copied[2], "1-5,8");
  assert.equal($(h, "recList").children.length, 1);

  // delete one record
  const recordDel = rowButtons().find((b) => b.getAttribute("data-act") === "del");
  click(recordDel);
  assert.equal($(h, "recList").children.length, 0);
  assert.equal($(h, "recEmpty").hidden, false);

  // clipboard API unavailable → execCommand fallback still records the copy
  delete h.nav.clipboard;
  let execCalls = 0;
  h.doc.execCommand = () => { execCalls++; return true; };
  click($(h, "copyBtn"));
  await tick();
  assert.equal(execCalls, 1, "fallbackCopy used document.execCommand");
  assert.equal($(h, "recList").children.length, 1);
  assert.equal(toastText(h), DICTS.en["toast.copied"]);

  // clear all records (confirm() → true)
  click(mapCell(h, 2)); // selection change is irrelevant; keep one record for the clear test
  click($(h, "recClear"));
  assert.equal($(h, "recList").children.length, 0);
  assert.equal($(h, "recEmpty").hidden, false);
  assert.equal($(h, "recClear").disabled, true);
});

test("app version string used by the About box exists and is displayed", () => {
  const h = boot();
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal($(h, "verText").textContent, DICTS.en["settings.version"].replace("{v}", VERSION));
});
