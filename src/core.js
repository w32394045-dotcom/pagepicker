/* PagePicker — pure page-range logic.
   No DOM, no network. Usable from the browser (global `PP`) and from Node (module.exports). */
var PP = (function () {
  "use strict";

  var MIN_PAGES = 1;
  var MAX_PAGES = 2000;
  var DEFAULT_TOTAL = 100;

  /* ---------- small helpers ---------- */

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  function clampInt(v, min, max) {
    v = Math.round(Number(v));
    if (!isFinite(v)) return min;
    return v < min ? min : v > max ? max : v;
  }

  function normalizeTotal(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return DEFAULT_TOTAL;
    if (n < MIN_PAGES) n = MIN_PAGES;
    if (n > MAX_PAGES) n = MAX_PAGES;
    return n;
  }

  function uniqSorted(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      if (!isInt(n) || seen[n]) continue;
      seen[n] = 1;
      out.push(n);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function sanitize(pages, total) {
    total = normalizeTotal(total);
    var out = [];
    for (var i = 0; i < pages.length; i++) {
      var n = Math.round(Number(pages[i]));
      if (isFinite(n) && n >= 1 && n <= total) out.push(n);
    }
    return uniqSorted(out);
  }

  function range(start, end, step) {
    step = Math.max(1, Math.round(Number(step) || 1));
    var a = Number(start), b = Number(end);
    if (a > b) { var t = a; a = b; b = t; }
    var out = [];
    for (var n = a; n <= b; n += step) out.push(n);
    return out;
  }

  /* Pages in [from..to] whose parity matches. parity: "all" | "odd" | "even". */
  function parityRange(from, to, parity) {
    var a = Math.round(Number(from)), b = Math.round(Number(to));
    if (a > b) { var t = a; a = b; b = t; }
    var out = [];
    for (var n = a; n <= b; n++) {
      if (parity === "odd" && n % 2 === 0) continue;
      if (parity === "even" && n % 2 !== 0) continue;
      out.push(n);
    }
    return out;
  }

  function splitParity(pages) {
    var odd = [], even = [];
    for (var i = 0; i < pages.length; i++) (pages[i] % 2 ? odd : even).push(pages[i]);
    return { odd: odd, even: even };
  }

  function stats(pages) {
    var odd = 0;
    for (var i = 0; i < pages.length; i++) if (pages[i] % 2) odd++;
    return { count: pages.length, odd: odd, even: pages.length - odd, min: pages.length ? pages[0] : 0, max: pages.length ? pages[pages.length - 1] : 0 };
  }

  function coverage(selected, total) {
    total = normalizeTotal(total);
    var pct = total ? Math.round((selected.length / total) * 100) : 0;
    return { count: selected.length, total: total, pct: pct };
  }

  /* ---------- direct-input parsing ---------- */

  var SEPARATORS = /[\s,，;；、]+/;
  var ERR = {
    INVALID: "invalid",
    EMPTY: "empty",
    OUT_OF_RANGE: "outOfRange",
    RANGE_ORDER: "rangeOrder"
  };

  function parsePageToken(token, total, out, errors) {
    var t = String(token).trim();
    if (!t) return;
    var m;

    /* keywords */
    if (/^(all|全部|所有)$/i.test(t)) { pushAll(parityRange(1, total, "all"), out); return; }
    if (/^(odd|奇数|奇數)$/i.test(t)) { pushAll(parityRange(1, total, "odd"), out); return; }
    if (/^(even|偶数|偶數)$/i.test(t)) { pushAll(parityRange(1, total, "even"), out); return; }

    /* a-b/step  (1-99/2) */
    m = /^(\d*)\s*[-–—~]\s*(\d*)\s*(?:\/\s*(\d+))?$/.exec(t);
    if (m) {
      var from = m[1] === "" ? 1 : parseInt(m[1], 10);
      var to = m[2] === "" ? total : parseInt(m[2], 10);
      var step = m[3] ? parseInt(m[3], 10) : 1;
      if (!step || step < 1) { errors.push({ token: token, code: ERR.INVALID }); return; }
      if (from < 1 || to > total) { errors.push({ token: token, code: ERR.OUT_OF_RANGE }); return; }
      if (from > to) { errors.push({ token: token, code: ERR.INVALID }); return; }
      pushAll(range(from, to, step), out);
      return;
    }

    /* page/step  (10/2) — a lone page with a step is meaningless, reject */
    /* single number */
    m = /^(\d+)$/.exec(t);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n < 1 || n > total) { errors.push({ token: token, code: ERR.OUT_OF_RANGE }); return; }
      out.push(n);
      return;
    }

    /* "odd:1-99" style inside the generic box */
    m = /^(odd|even|奇数|偶数|奇數|偶數)\s*[:：]\s*(.+)$/i.exec(t);
    if (m) {
      var side = /^even|^偶/i.test(m[1]) ? "even" : "odd";
      var sub = parseSingleSpan(m[2], total, errors, token);
      if (sub) pushAll(parityRange(sub.a, sub.b, side), out);
      return;
    }

    errors.push({ token: token, code: ERR.INVALID });
  }

  function pushAll(list, out) {
    for (var i = 0; i < list.length; i++) out.push(list[i]);
  }

  /* a span like "1-99", "12", "1-99/2" -> {a,b,step}. null on error. */
  function parseSingleSpan(text, total, errors, wholeToken) {
    var t = String(text).trim();
    var m = /^(\d*)\s*[-–—~]\s*(\d*)\s*(?:\/\s*(\d+))?$/.exec(t);
    if (m) {
      var a = m[1] === "" ? 1 : parseInt(m[1], 10);
      var b = m[2] === "" ? total : parseInt(m[2], 10);
      var step = m[3] ? parseInt(m[3], 10) : 1;
      if (a < 1 || b > total || a > b || step < 1) {
        errors.push({ token: wholeToken || text, code: ERR.OUT_OF_RANGE });
        return null;
      }
      return { a: a, b: b, step: step };
    }
    m = /^(\d+)$/.exec(t);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n < 1 || n > total) { errors.push({ token: wholeToken || text, code: ERR.OUT_OF_RANGE }); return null; }
      return { a: n, b: n, step: 1 };
    }
    errors.push({ token: wholeToken || text, code: ERR.INVALID });
    return null;
  }

  /* Generic box: "1-5, 8, 10-13", "odd", "1-99/2" */
  function parsePages(text, total) {
    total = normalizeTotal(total);
    var errors = [];
    var pages = [];
    var src = String(text == null ? "" : text).trim();
    if (!src) return { pages: [], errors: [{ token: "", code: ERR.EMPTY }] };
    var tokens = src.split(SEPARATORS);
    for (var i = 0; i < tokens.length; i++) parsePageToken(tokens[i], total, pages, errors);
    return { pages: uniqSorted(pages), errors: errors };
  }

  /* Odd/even box: "odd:1-99; even:2-100"  or  "odd 1-99, even 2-100" */
  function parseParity(text, total) {
    total = normalizeTotal(total);
    var src = String(text == null ? "" : text).trim();
    var errors = [], odd = null, even = null;
    if (!src) return { mode: "all", odd: null, even: null, errors: [{ token: "", code: ERR.EMPTY }] };
    var tokens = src.split(SEPARATORS);
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i].trim();
      if (!tok) continue;
      var m = /^(odd|even|奇数|偶数|奇數|偶數)\s*[:：]?\s*(.*)$/i.exec(tok);
      if (!m) {
        /* allow a bare "odd" / "even" meaning the whole side */
        if (/^(odd|奇数|奇數)$/i.test(tok)) { odd = { a: 1, b: total }; continue; }
        if (/^(even|偶数|偶數)$/i.test(tok)) { even = { a: 1, b: total }; continue; }
        errors.push({ token: tok, code: ERR.INVALID });
        continue;
      }
      var isEven = /^even|^偶/i.test(m[1]);
      var rest = m[2].trim();
      if (!rest) {
        var whole = { a: 1, b: total };
        if (isEven) even = whole; else odd = whole;
        continue;
      }
      var span = parseSingleSpan(rest, total, errors, tok);
      if (!span) continue;
      if (isEven) even = { a: span.a, b: span.b };
      else odd = { a: span.a, b: span.b };
    }
    var mode = odd && even ? "all" : even ? "even" : odd ? "odd" : "all";
    return { mode: mode, odd: odd, even: even, errors: errors };
  }

  /* ---------- building the selection from the parity controls ---------- */

  function buildParity(total, mode, oddLimit, evenLimit) {
    total = normalizeTotal(total);
    var odd = oddLimit ? parityRange(oddLimit.a, oddLimit.b, "odd") : parityRange(1, total, "odd");
    var even = evenLimit ? parityRange(evenLimit.a, evenLimit.b, "even") : parityRange(1, total, "even");
    if (mode === "odd") return uniqSorted(odd);
    if (mode === "even") return uniqSorted(even);
    return uniqSorted(odd.concat(even));
  }

  /* ---------- formatting for the print dialog ---------- */

  function mergeRanges(pages) {
    var out = [];
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      var last = out[out.length - 1];
      if (last && p === last.b + 1) last.b = p;
      else out.push({ a: p, b: p });
    }
    return out;
  }

  function tokenText(tok) {
    return tok.a === tok.b ? String(tok.a) : tok.a + "-" + tok.b;
  }

  /**
   * opts: { compact = true, sep = ",", reverse = false, batch = 0 }
   * - compact merges runs into a-b; otherwise every page is listed on its own
   * - reverse reverses the order of the listed runs/pages (not the numbers inside a run)
   * - batch > 0 splits the list into lines of at most `batch` pages each
   */
  function formatList(pages, opts) {
    opts = opts || {};
    var compact = opts.compact !== false;
    var sep = opts.sep == null ? "," : opts.sep;
    var reverse = !!opts.reverse;
    var batch = Math.round(Number(opts.batch) || 0);
    if (batch < 0) batch = 0;

    if (!pages || !pages.length) return "";
    var sorted = uniqSorted(pages);
    var tokens = compact ? mergeRanges(sorted) : sorted.map(function (p) { return { a: p, b: p }; });
    if (reverse) tokens.reverse();
    if (!batch || batch <= 1) {
      return tokens.map(tokenText).join(sep);
    }

    /* batch: split on page counts, splitting runs that straddle a boundary */
    var groups = [], cur = [], used = 0;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i], a = tok.a, b = tok.b;
      while (a <= b) {
        var room = batch - used;
        var take = Math.min(room, b - a + 1);
        var end = a + take - 1;
        cur.push({ a: a, b: end });
        used += take;
        a = end + 1;
        if (used >= batch) { groups.push(cur); cur = []; used = 0; }
      }
    }
    if (cur.length) groups.push(cur);
    return groups
      .map(function (g) { return g.map(function (t) { return tokenText(t); }).join(sep); })
      .join("\n");
  }

  /* ---------- selection set operations ---------- */

  function applyOp(current, incoming, op) {
    var map = Object.create(null);
    for (var i = 0; i < current.length; i++) map[current[i]] = 1;
    if (op === "replace") {
      map = Object.create(null);
      for (var j = 0; j < incoming.length; j++) map[incoming[j]] = 1;
    } else if (op === "remove") {
      for (var k = 0; k < incoming.length; k++) delete map[incoming[k]];
    } else {
      for (var l = 0; l < incoming.length; l++) map[incoming[l]] = 1;
    }
    var out = [];
    for (var key in map) if (map[key]) out.push(parseInt(key, 10));
    return uniqSorted(out);
  }

  function toggle(pages, page) {
    var out = pages.slice();
    var idx = out.indexOf(page);
    if (idx >= 0) out.splice(idx, 1);
    else out.push(page);
    return uniqSorted(out);
  }

  function invert(pages, total) {
    total = normalizeTotal(total);
    var map = Object.create(null);
    for (var i = 0; i < pages.length; i++) map[pages[i]] = 1;
    var out = [];
    for (var n = 1; n <= total; n++) if (!map[n]) out.push(n);
    return out;
  }

  function allPages(total) {
    total = normalizeTotal(total);
    var out = [];
    for (var n = 1; n <= total; n++) out.push(n);
    return out;
  }

  /* Shift-click span filling: extend from `anchor` to `page`, inclusive. */
  function span(anchor, page) {
    return range(Math.min(anchor, page), Math.max(anchor, page), 1);
  }

  /* ---------- language detection ---------- */

  var LANGS = ["zh-CN", "zh-TW", "ja", "ko", "fr", "de", "en"];

  function detectLang(tags) {
    if (typeof tags === "string") tags = [tags];
    if (!tags || !tags.length) return "en";
    for (var i = 0; i < tags.length; i++) {
      var tag = String(tags[i] || "").toLowerCase().replace("_", "-");
      if (!tag) continue;
      if (tag.indexOf("zh") === 0) {
        if (/hant|tw|hk|mo/.test(tag)) return "zh-TW";
        return "zh-CN";
      }
      if (tag.indexOf("ja") === 0) return "ja";
      if (tag.indexOf("ko") === 0) return "ko";
      if (tag.indexOf("fr") === 0) return "fr";
      if (tag.indexOf("de") === 0) return "de";
      if (tag.indexOf("en") === 0) return "en";
    }
    return "en";
  }

  /* ---------- share links ---------- */

  function encodeState(total, pages) {
    var q = "t=" + normalizeTotal(total);
    var list = formatList(pages, { compact: true, sep: "," });
    if (list) q += "&p=" + list;
    return q;
  }

  function decodeState(hash, fallbackTotal) {
    var src = String(hash || "");
    if (src.charAt(0) === "#") src = src.slice(1);
    if (!src) return null;
    var parts = src.split("&");
    var total = null, pagesText = null;
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv.length < 2) continue;
      var key = decodeURIComponent(kv[0]);
      var val = decodeURIComponent(kv.slice(1).join("="));
      if (key === "t") total = val;
      else if (key === "p") pagesText = val;
    }
    if (!pagesText && !total) return null;
    var t = normalizeTotal(total == null ? fallbackTotal : total);
    var pages = [];
    if (pagesText) {
      var parsed = parsePages(pagesText, t);
      if (parsed.errors.length) return null;
      pages = parsed.pages;
    }
    return { total: t, pages: pages };
  }

  return {
    MIN_PAGES: MIN_PAGES,
    MAX_PAGES: MAX_PAGES,
    DEFAULT_TOTAL: DEFAULT_TOTAL,
    LANGS: LANGS,
    ERR: ERR,
    clampInt: clampInt,
    normalizeTotal: normalizeTotal,
    uniqSorted: uniqSorted,
    sanitize: sanitize,
    range: range,
    parityRange: parityRange,
    splitParity: splitParity,
    stats: stats,
    coverage: coverage,
    parsePages: parsePages,
    parseParity: parseParity,
    buildParity: buildParity,
    mergeRanges: mergeRanges,
    formatList: formatList,
    applyOp: applyOp,
    toggle: toggle,
    invert: invert,
    allPages: allPages,
    span: span,
    detectLang: detectLang,
    encodeState: encodeState,
    decodeState: decodeState
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PP;
