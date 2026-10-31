/* PagePicker — UI. Expects `PP` (core), `I18N` (locale dictionaries) and the DOM from index.template.html. */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var STORE_KEY = "pagepicker.v1";
  var LANGS = PP.LANGS.slice();
  var LANG_NAMES = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    ja: "日本語",
    ko: "한국어",
    fr: "Français",
    de: "Deutsch",
    en: "English"
  };
  var SEP_OPTIONS = [",", ", ", "、", "/", " ", "\n"];
  var SEP_KEYS = {
    ",": "output.sepComma",
    ", ": "output.sepCommaSpace",
    "、": "output.sepIdeographic",
    "/": "output.sepSlash",
    " ": "output.sepSpace",
    "\n": "output.sepNewline"
  };
  var MAX_RECORDS = 50;
  var DICT = typeof I18N !== "undefined" && I18N ? I18N : {};

  var state;
  var resolvedLang = "en";
  var els = {};
  var cells = [];
  var chips = [];
  var duals = {};
  var lastAnchor = null;
  var toastTimer = null;

  /* ------------------------------------------------------------ helpers */

  function $(id) { return document.getElementById(id); }

  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  function each(sel, fn) {
    var list = document.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  function t(key, vars) {
    var dict = DICT[resolvedLang] || DICT.en || {};
    var s = dict[key];
    if (s == null) s = (DICT.en && DICT.en[key] != null) ? DICT.en[key] : key;
    if (vars) {
      s = String(s).replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] != null ? String(vars[k]) : m;
      });
    }
    return s;
  }

  function defaults() {
    return {
      total: 100,
      pages: [],
      lang: "auto",
      showMap: true,
      highlightGaps: false,
      showPromo: true,
      action: "add",
      tab: "all",
      out: { compact: true, sep: ",", reverse: false, batch: 0 },
      range: { from: 1, to: 100, step: 1 },
      parity: { mode: "all", oddOn: false, oddFrom: 1, oddTo: 99, evenOn: false, evenFrom: 2, evenTo: 100 },
      records: []
    };
  }

  function resolveLang() {
    if (state.lang && state.lang !== "auto" && LANGS.indexOf(state.lang) >= 0) return state.lang;
    var nav = (typeof navigator !== "undefined" && (navigator.languages || navigator.language)) || ["en"];
    return PP.detectLang(nav);
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 1900);
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(fallbackCopy(text)); }
        );
      } else {
        resolve(fallbackCopy(text));
      }
    });
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------ storage */

  function snapshot() {
    return {
      v: 1,
      total: state.total,
      pages: state.pages,
      lang: state.lang,
      showMap: state.showMap,
      highlightGaps: state.highlightGaps,
      showPromo: state.showPromo,
      action: state.action,
      tab: state.tab,
      out: state.out,
      range: state.range,
      parity: state.parity,
      records: state.records.slice(0, MAX_RECORDS)
    };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); } catch (e) { /* private mode */ }
  }

  function mutate() {
    save();
    syncHash();
  }

  function syncHash() {
    try {
      var h = "#" + PP.encodeState(state.total, state.pages);
      if (location.hash !== h) history.replaceState(null, "", h);
    } catch (e) { /* file:// or sandboxed frame */ }
  }

  function load() {
    var d = defaults();
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { }
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (s && typeof s === "object") {
          d.total = PP.normalizeTotal(s.total);
          d.pages = PP.sanitize(Array.isArray(s.pages) ? s.pages : [], d.total);
          if (typeof s.lang === "string" && (s.lang === "auto" || LANGS.indexOf(s.lang) >= 0)) d.lang = s.lang;
          if (typeof s.showMap === "boolean") d.showMap = s.showMap;
          if (typeof s.highlightGaps === "boolean") d.highlightGaps = s.highlightGaps;
          if (typeof s.showPromo === "boolean") d.showPromo = s.showPromo;
          if (["add", "replace", "remove"].indexOf(s.action) >= 0) d.action = s.action;
          if (["all", "odd", "even"].indexOf(s.tab) >= 0) d.tab = s.tab;
          if (s.out && typeof s.out === "object") {
            if (typeof s.out.compact === "boolean") d.out.compact = s.out.compact;
            if (SEP_OPTIONS.indexOf(s.out.sep) >= 0) d.out.sep = s.out.sep;
            if (typeof s.out.reverse === "boolean") d.out.reverse = s.out.reverse;
            d.out.batch = PP.clampInt(s.out.batch || 0, 0, PP.MAX_PAGES);
          }
          if (s.range && typeof s.range === "object") {
            d.range.from = PP.clampInt(s.range.from || 1, 1, d.total);
            d.range.to = PP.clampInt(s.range.to || d.total, 1, d.total);
            d.range.step = Number(s.range.step) === 2 ? 2 : 1;
          } else {
            d.range.to = d.total;
          }
          if (s.parity && typeof s.parity === "object") {
            var pm = s.parity;
            if (["all", "odd", "even"].indexOf(pm.mode) >= 0) d.parity.mode = pm.mode;
            d.parity.oddOn = !!pm.oddOn;
            d.parity.evenOn = !!pm.evenOn;
            d.parity.oddFrom = PP.clampInt(pm.oddFrom || 1, 1, d.total);
            d.parity.oddTo = PP.clampInt(pm.oddTo || d.total, 1, d.total);
            d.parity.evenFrom = PP.clampInt(pm.evenFrom || 1, 1, d.total);
            d.parity.evenTo = PP.clampInt(pm.evenTo || d.total, 1, d.total);
            if (d.parity.oddFrom > d.parity.oddTo) { var o = d.parity.oddFrom; d.parity.oddFrom = d.parity.oddTo; d.parity.oddTo = o; }
            if (d.parity.evenFrom > d.parity.evenTo) { var e = d.parity.evenFrom; d.parity.evenFrom = d.parity.evenTo; d.parity.evenTo = e; }
          }
          if (Array.isArray(s.records)) {
            d.records = s.records.filter(function (r) {
              return r && Array.isArray(r.pages) && typeof r.text === "string" && typeof r.ts === "number";
            }).slice(0, MAX_RECORDS).map(function (r) {
              return { ts: r.ts, total: PP.normalizeTotal(r.total), pages: PP.sanitize(r.pages, PP.normalizeTotal(r.total)), tab: ["all", "odd", "even"].indexOf(r.tab) >= 0 ? r.tab : "all", text: r.text };
            });
          }
        }
      } catch (e) { /* corrupt store: start fresh */ }
    }

    /* the hash wins: it is the shareable state */
    var hs = PP.decodeState(location.hash, d.total);
    if (hs) {
      d.total = hs.total;
      d.pages = hs.pages;
    }
    d.range.to = Math.min(d.range.to, d.total);
    if (d.range.from > d.range.to) d.range.from = Math.min(1, d.total);
    return d;
  }

  /* ------------------------------------------------------------ i18n paint */

  function buildLangSelects() {
    [els.langSelect, els.setLang].forEach(function (sel) {
      if (!sel) return;
      sel.textContent = "";
      var auto = document.createElement("option");
      auto.value = "auto";
      auto.textContent = t("settings.languageAuto");
      sel.appendChild(auto);
      for (var i = 0; i < LANGS.length; i++) {
        var o = document.createElement("option");
        o.value = LANGS[i];
        o.textContent = LANG_NAMES[LANGS[i]] || LANGS[i];
        sel.appendChild(o);
      }
      sel.value = state.lang;
      sel.title = state.lang === "auto"
        ? t("settings.languageAutoDetected", { lang: LANG_NAMES[resolvedLang] || resolvedLang })
        : (LANG_NAMES[state.lang] || "");
    });
  }

  function buildSepOptions() {
    if (!els.optSep) return;
    els.optSep.textContent = "";
    for (var i = 0; i < SEP_OPTIONS.length; i++) {
      var sep = SEP_OPTIONS[i];
      var o = document.createElement("option");
      o.value = sep;
      o.textContent = t(SEP_KEYS[sep]);
      els.optSep.appendChild(o);
    }
    els.optSep.value = state.out.sep;
  }

  function applyI18n() {
    resolvedLang = resolveLang();
    document.documentElement.lang = resolvedLang;
    document.title = t("app.title");

    each("[data-i18n]", function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    each("[data-i18n-placeholder]", function (el) { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder"))); });
    each("[data-i18n-title]", function (el) { el.setAttribute("title", t(el.getAttribute("data-i18n-title"))); });
    each("[data-i18n-aria]", function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });

    buildLangSelects();
    buildSepOptions();
    els.verText.textContent = t("settings.version", { v: VERSION });
    refreshPageLabels();
    syncSettingsUI();
    renderRecords();
    setTab(state.tab, true);
    paint();
  }

  function refreshPageLabels() {
    for (var i = 0; i < cells.length; i++) {
      var label = t("heatmap.pageTitle", { n: i + 1 });
      cells[i].title = label;
      cells[i].setAttribute("aria-label", label);
    }
  }

  /* ------------------------------------------------------------ page grid */

  function buildGrid() {
    els.map.textContent = "";
    els.chips.textContent = "";
    cells = [];
    chips = [];
    var mapFrag = document.createDocumentFragment();
    var chipFrag = document.createDocumentFragment();
    for (var p = 1; p <= state.total; p++) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.setAttribute("data-page", String(p));
      mapFrag.appendChild(cell);
      cells.push(cell);

      var chip = document.createElement("button");
      chip.type = "button";
      chip.setAttribute("data-page", String(p));
      chip.textContent = String(p);
      chipFrag.appendChild(chip);
      chips.push(chip);
    }
    els.map.appendChild(mapFrag);
    els.chips.appendChild(chipFrag);
    refreshPageLabels();
    syncBounds();
    paint();
  }

  function paint() {
    var sel = Object.create(null);
    var pages = state.pages;
    for (var i = 0; i < pages.length; i++) sel[pages[i]] = 1;

    var oddCount = 0, evenCount = 0;
    for (var idx = 0; idx < cells.length; idx++) {
      var page = idx + 1;
      var isOn = !!sel[page];
      var isOdd = page % 2 === 1;
      var cell = cells[idx];
      cell.classList.toggle("is-sel", isOn);
      cell.classList.toggle("is-odd", isOn && isOdd);
      cell.classList.toggle("is-even", isOn && !isOdd);
      cell.classList.toggle("is-gap", state.highlightGaps && !isOn);

      var chip = chips[idx];
      if (chip) {
        chip.classList.toggle("is-sel", isOn);
        chip.classList.toggle("is-odd", isOn && isOdd);
        chip.classList.toggle("is-even", isOn && !isOdd);
        chip.classList.toggle("is-gap", state.highlightGaps && !isOn);
      }
      if (isOn) { if (isOdd) oddCount++; else evenCount++; }
    }

    var cov = PP.coverage(pages, state.total);
    els.mapCoverage.textContent = t("heatmap.coverage", { sel: cov.count, total: cov.total, pct: cov.pct });
    els.mapBar.style.width = cov.pct + "%";
    els.manualSelected.textContent = t("manual.selected", { n: cov.count });
    renderOutputs(oddCount, evenCount);
  }

  function renderOutputs(oddCount, evenCount) {
    if (oddCount == null) {
      oddCount = 0; evenCount = 0;
      for (var i = 0; i < state.pages.length; i++) { if (state.pages[i] % 2) oddCount++; else evenCount++; }
    }
    var lists = { all: state.pages, odd: [], even: [] };
    for (var j = 0; j < state.pages.length; j++) {
      if (state.pages[j] % 2) lists.odd.push(state.pages[j]);
      else lists.even.push(state.pages[j]);
    }
    var text = PP.formatList(lists[state.tab], state.out);
    if (els.outArea.value !== text) els.outArea.value = text;
    var n = state.tab === "odd" ? oddCount : state.tab === "even" ? evenCount : state.pages.length;
    var key = state.tab === "odd" ? "output.oddCount" : state.tab === "even" ? "output.evenCount" : "output.allCount";
    els.outCount.textContent = text ? t(key, { n: n }) : t("output.empty");
    els.copyBtn.disabled = !text;
  }

  function setTab(tab, silent) {
    state.tab = tab;
    ["all", "odd", "even"].forEach(function (key) {
      var btn = document.getElementById("tab" + key.charAt(0).toUpperCase() + key.slice(1));
      if (btn) btn.setAttribute("aria-selected", String(key === tab));
    });
    renderOutputs();
    if (!silent) mutate();
  }

  /* ------------------------------------------------------------ selection ops */

  function applyPages(pages) {
    state.pages = PP.applyOp(state.pages, PP.sanitize(pages, state.total), state.action);
    paint();
    mutate();
    showToast(t("toast.applied"));
  }

  function parityPagesFromState() {
    var p = state.parity;
    return PP.buildParity(
      state.total,
      p.mode,
      p.oddOn ? { a: p.oddFrom, b: p.oddTo } : null,
      p.evenOn ? { a: p.evenFrom, b: p.evenTo } : null
    );
  }

  function togglePage(page, shiftKey) {
    if (shiftKey && lastAnchor != null) {
      var span = PP.span(lastAnchor, page);
      var allOn = true;
      for (var i = 0; i < span.length; i++) {
        if (state.pages.indexOf(span[i]) < 0) { allOn = false; break; }
      }
      state.pages = PP.applyOp(state.pages, span, allOn ? "remove" : "add");
    } else {
      state.pages = PP.toggle(state.pages, page);
    }
    lastAnchor = page;
    paint();
    mutate();
  }

  /* ------------------------------------------------------------ controls */

  function makeStepper(o) {
    var input = $(o.input), minus = $(o.minus), plus = $(o.plus);
    function commit(v) {
      var n = PP.clampInt(v, o.min(), o.max());
      input.value = n;
      o.set(n);
    }
    on(minus, "click", function () { commit(Number(input.value) - 1); });
    on(plus, "click", function () { commit(Number(input.value) + 1); });
    on(input, "change", function () { commit(input.value); });
    on(input, "keydown", function (e) {
      if (e.key === "Enter") { commit(input.value); input.blur(); }
    });
    return {
      refresh: function () { input.value = o.get(); }
    };
  }

  function makeDual(ids, onChange) {
    var lo = $(ids.lo), hi = $(ids.hi), fill = $(ids.fill);
    function paintFill() {
      var min = Number(lo.min), max = Number(lo.max);
      var span = Math.max(1, max - min);
      var a = Number(lo.value), b = Number(hi.value);
      fill.style.left = ((a - min) / span) * 100 + "%";
      fill.style.right = (100 - ((b - min) / span) * 100) + "%";
    }
    function handle(which) {
      var a = Number(lo.value), b = Number(hi.value);
      if (a > b) {
        if (which === "lo") hi.value = a;
        else lo.value = b;
      }
      paintFill();
      onChange(Number(lo.value), Number(hi.value));
    }
    on(lo, "input", function () { handle("lo"); });
    on(hi, "input", function () { handle("hi"); });
    return {
      bounds: function (min, max) { lo.min = hi.min = min; lo.max = hi.max = max; },
      write: function (a, b) { lo.value = a; hi.value = b; paintFill(); },
      paint: paintFill
    };
  }

  function setBoxEnabled(box, enabled) {
    if (box) box.classList.toggle("is-off", !enabled);
  }

  function syncBounds() {
    var total = state.total;
    state.range.from = PP.clampInt(state.range.from, 1, total);
    state.range.to = PP.clampInt(state.range.to, state.range.from, total);
    var p = state.parity;
    p.oddFrom = PP.clampInt(p.oddFrom, 1, total);
    p.oddTo = PP.clampInt(p.oddTo, p.oddFrom, total);
    p.evenFrom = PP.clampInt(p.evenFrom, 1, total);
    p.evenTo = PP.clampInt(p.evenTo, p.evenFrom, total);

    duals.range.bounds(1, total);
    duals.range.write(state.range.from, state.range.to);
    duals.odd.bounds(1, total);
    duals.odd.write(p.oddFrom, p.oddTo);
    duals.even.bounds(1, total);
    duals.even.write(p.evenFrom, p.evenTo);

    els.totalInput.value = total;
    els.rangeFrom.value = state.range.from;
    els.rangeTo.value = state.range.to;
    els.oddFrom.value = p.oddFrom;
    els.oddTo.value = p.oddTo;
    els.evenFrom.value = p.evenFrom;
    els.evenTo.value = p.evenTo;
  }

  function syncSettingsUI() {
    if (els.langSelect) els.langSelect.value = state.lang;
    if (els.setLang) els.setLang.value = state.lang;
    els.setMap.checked = state.showMap;
    els.setGaps.checked = state.highlightGaps;
    els.setPromo.checked = state.showPromo;
    els.mapWrap.hidden = !state.showMap;
    els.promo.hidden = !state.showPromo;
    if (els.optCompact) els.optCompact.checked = state.out.compact;
    if (els.optReverse) els.optReverse.checked = state.out.reverse;
    if (els.optBatch) els.optBatch.value = state.out.batch || 0;
    if (els.optSep) els.optSep.value = state.out.sep;
    setPressed(els.actionSeg, "action", state.action);
    setPressed(els.stepSeg, "step", String(state.range.step));
    setPressed(els.paritySeg, "mode", state.parity.mode);
    els.oddOn.checked = state.parity.oddOn;
    els.evenOn.checked = state.parity.evenOn;
    setBoxEnabled(els.oddBox, state.parity.oddOn);
    setBoxEnabled(els.evenBox, state.parity.evenOn);
  }

  function setPressed(container, attr, value) {
    if (!container) return;
    var buttons = container.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-" + attr) === value));
    }
  }

  function syncAll() {
    els.totalInput.value = state.total;
    els.rangeFrom.value = state.range.from;
    els.rangeTo.value = state.range.to;
    syncSettingsUI();
    syncBounds();
    setTab(state.tab, true);
  }

  /* ------------------------------------------------------------ total pages */

  function setTotal(n) {
    n = PP.normalizeTotal(n);
    els.totalInput.value = n;
    if (n === state.total) return;
    state.total = n;
    state.pages = PP.sanitize(state.pages, n);
    buildGrid();
    mutate();
  }

  /* ------------------------------------------------------------ records */

  function formatDate(ts) {
    try {
      return new Intl.DateTimeFormat(resolvedLang, {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
      }).format(new Date(ts));
    } catch (e) {
      return new Date(ts).toLocaleString();
    }
  }

  function addRecord(text) {
    var rec = { ts: Date.now(), total: state.total, pages: state.pages.slice(), tab: state.tab, text: text };
    var list = state.records;
    if (list.length && list[0].text === text && list[0].total === state.total) {
      list[0].ts = rec.ts;
    } else {
      list.unshift(rec);
      if (list.length > MAX_RECORDS) list.length = MAX_RECORDS;
    }
    save();
    renderRecords();
  }

  function renderRecords() {
    if (!els.recList) return;
    els.recList.textContent = "";
    var list = state.records;
    els.recEmpty.hidden = list.length > 0;
    els.recClear.disabled = !list.length;

    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      var li = document.createElement("li");

      var top = document.createElement("div");
      top.className = "rec-top";

      var time = document.createElement("span");
      time.className = "rec-time";
      time.textContent = formatDate(rec.ts);
      top.appendChild(time);

      var count = document.createElement("span");
      count.className = "rec-count";
      count.textContent = t("records.pages", { n: rec.pages.length });
      top.appendChild(count);

      var tabLabel = document.createElement("span");
      tabLabel.textContent = t("output.tab" + rec.tab.charAt(0).toUpperCase() + rec.tab.slice(1));
      top.appendChild(tabLabel);

      var actions = document.createElement("div");
      actions.className = "rec-actions";

      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-sm";
      copyBtn.setAttribute("data-act", "copy");
      copyBtn.setAttribute("data-i", String(i));
      copyBtn.textContent = t("output.copy");
      actions.appendChild(copyBtn);

      var restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn btn-sm";
      restoreBtn.setAttribute("data-act", "restore");
      restoreBtn.setAttribute("data-i", String(i));
      restoreBtn.textContent = t("records.restore");
      actions.appendChild(restoreBtn);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-sm btn-quiet btn-danger";
      delBtn.setAttribute("data-act", "del");
      delBtn.setAttribute("data-i", String(i));
      delBtn.textContent = t("records.delete");
      actions.appendChild(delBtn);

      top.appendChild(actions);
      li.appendChild(top);

      var textEl = document.createElement("div");
      textEl.className = "rec-text";
      var preview = String(rec.text).replace(/\n/g, " ⏎ ");
      textEl.textContent = preview.length > 120 ? preview.slice(0, 120) + "…" : preview;
      if (!rec.text) textEl.classList.add("clip");
      li.appendChild(textEl);

      els.recList.appendChild(li);
    }
  }

  function restoreRecord(i) {
    var rec = state.records[i];
    if (!rec) return;
    state.total = PP.normalizeTotal(rec.total);
    state.pages = PP.sanitize(rec.pages, state.total);
    els.totalInput.value = state.total;
    buildGrid();
    mutate();
    showToast(t("toast.restored"));
  }

  /* ------------------------------------------------------------ direct input */

  function directErrorText(errors) {
    var e = errors[0];
    if (!e) return t("toast.invalid");
    if (e.code === PP.ERR.EMPTY) return t("range.empty");
    if (e.code === PP.ERR.OUT_OF_RANGE) return t("range.outOfRange", { total: state.total });
    return t("range.invalid", { token: e.token || "?" });
  }

  function setErr(el, msg) {
    el.textContent = msg;
    el.hidden = false;
  }

  function clearErr(el) {
    el.hidden = true;
    el.textContent = "";
  }

  /* ------------------------------------------------------------ init */

  function cacheEls() {
    [
      "langSelect", "settingsBtn", "settingsDlg", "settingsClose", "settingsDone",
      "mapCard", "mapWrap", "map", "mapBar", "mapCoverage",
      "totalMinus", "totalInput", "totalPlus", "presets",
      "qAll", "qNone", "qInvert", "qOdd", "qEven",
      "actionSeg", "stepSeg", "rangeFrom", "fromMinus", "fromPlus", "rangeTo", "toMinus", "toPlus",
      "rangeDual", "rangeFill", "rangeLo", "rangeHi", "rangeApply",
      "rangeDirect", "rangeDirectApply", "rangeDirectErr",
      "paritySeg", "oddBox", "evenBox", "oddOn", "evenOn",
      "oddFromMinus", "oddFrom", "oddFromPlus", "oddToMinus", "oddTo", "oddToPlus",
      "evenFromMinus", "evenFrom", "evenFromPlus", "evenToMinus", "evenTo", "evenToPlus",
      "oddDual", "oddFill", "oddLo", "oddHi", "evenDual", "evenFill", "evenLo", "evenHi",
      "parityApply", "parityDirect", "parityDirectApply", "parityDirectErr",
      "chips", "manualSelected",
      "outTabs", "outArea", "outCount", "copyBtn", "shareBtn",
      "optCompact", "optReverse", "optSep", "optBatch",
      "recList", "recEmpty", "recClear", "promo",
      "setLang", "setMap", "setGaps", "setPromo", "clearData", "resetData", "verText", "toast"
    ].forEach(function (id) { els[id] = $(id); });
  }

  function bindTotal() {
    makeStepper({
      input: "totalInput", minus: "totalMinus", plus: "totalPlus",
      min: function () { return 1; },
      max: function () { return PP.MAX_PAGES; },
      get: function () { return state.total; },
      set: function (n) { setTotal(n); }
    });
    on(els.presets, "click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-preset]") : null;
      if (!btn) return;
      setTotal(Number(btn.getAttribute("data-preset")));
    });
  }

  function bindRange() {
    makeStepper({
      input: "rangeFrom", minus: "fromMinus", plus: "fromPlus",
      min: function () { return 1; },
      max: function () { return state.range.to; },
      get: function () { return state.range.from; },
      set: function (n) {
        state.range.from = n;
        duals.range.write(n, state.range.to);
        mutate();
      }
    });
    makeStepper({
      input: "rangeTo", minus: "toMinus", plus: "toPlus",
      min: function () { return state.range.from; },
      max: function () { return state.total; },
      get: function () { return state.range.to; },
      set: function (n) {
        state.range.to = n;
        duals.range.write(state.range.from, n);
        mutate();
      }
    });

    on(els.rangeApply, "click", function () {
      applyPages(PP.range(state.range.from, state.range.to, state.range.step));
    });

    on(els.actionSeg, "click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      state.action = btn.getAttribute("data-action");
      setPressed(els.actionSeg, "action", state.action);
      mutate();
    });

    on(els.stepSeg, "click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-step]") : null;
      if (!btn) return;
      state.range.step = Number(btn.getAttribute("data-step")) === 2 ? 2 : 1;
      setPressed(els.stepSeg, "step", String(state.range.step));
      mutate();
    });

    on(els.rangeDirectApply, "click", function () {
      var parsed = PP.parsePages(els.rangeDirect.value, state.total);
      if (parsed.errors.length) {
        setErr(els.rangeDirectErr, directErrorText(parsed.errors));
        showToast(t("toast.invalid"));
        return;
      }
      clearErr(els.rangeDirectErr);
      applyPages(parsed.pages);
    });

    on(els.rangeDirect, "keydown", function (e) {
      if (e.key === "Enter") els.rangeDirectApply.click();
    });
  }

  function bindParity() {
    on(els.paritySeg, "click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-mode]") : null;
      if (!btn) return;
      state.parity.mode = btn.getAttribute("data-mode");
      setPressed(els.paritySeg, "mode", state.parity.mode);
      mutate();
    });

    on(els.oddOn, "change", function () {
      state.parity.oddOn = els.oddOn.checked;
      setBoxEnabled(els.oddBox, state.parity.oddOn);
      mutate();
    });
    on(els.evenOn, "change", function () {
      state.parity.evenOn = els.evenOn.checked;
      setBoxEnabled(els.evenBox, state.parity.evenOn);
      mutate();
    });

    makeStepper({
      input: "oddFrom", minus: "oddFromMinus", plus: "oddFromPlus",
      min: function () { return 1; }, max: function () { return state.parity.oddTo; },
      get: function () { return state.parity.oddFrom; },
      set: function (n) { state.parity.oddFrom = n; duals.odd.write(n, state.parity.oddTo); mutate(); }
    });
    makeStepper({
      input: "oddTo", minus: "oddToMinus", plus: "oddToPlus",
      min: function () { return state.parity.oddFrom; }, max: function () { return state.total; },
      get: function () { return state.parity.oddTo; },
      set: function (n) { state.parity.oddTo = n; duals.odd.write(state.parity.oddFrom, n); mutate(); }
    });
    makeStepper({
      input: "evenFrom", minus: "evenFromMinus", plus: "evenFromPlus",
      min: function () { return 1; }, max: function () { return state.parity.evenTo; },
      get: function () { return state.parity.evenFrom; },
      set: function (n) { state.parity.evenFrom = n; duals.even.write(n, state.parity.evenTo); mutate(); }
    });
    makeStepper({
      input: "evenTo", minus: "evenToMinus", plus: "evenToPlus",
      min: function () { return state.parity.evenFrom; }, max: function () { return state.total; },
      get: function () { return state.parity.evenTo; },
      set: function (n) { state.parity.evenTo = n; duals.even.write(state.parity.evenFrom, n); mutate(); }
    });

    on(els.parityApply, "click", function () {
      applyPages(parityPagesFromState());
    });

    on(els.parityDirectApply, "click", function () {
      var parsed = PP.parseParity(els.parityDirect.value, state.total);
      if (parsed.errors.length) {
        setErr(els.parityDirectErr, directErrorText(parsed.errors));
        showToast(t("toast.invalid"));
        return;
      }
      clearErr(els.parityDirectErr);
      state.parity.mode = parsed.mode;
      if (parsed.odd) {
        state.parity.oddOn = true;
        state.parity.oddFrom = parsed.odd.a;
        state.parity.oddTo = parsed.odd.b;
      }
      if (parsed.even) {
        state.parity.evenOn = true;
        state.parity.evenFrom = parsed.even.a;
        state.parity.evenTo = parsed.even.b;
      }
      syncSettingsUI();
      syncBounds();
      setBoxEnabled(els.oddBox, state.parity.oddOn);
      setBoxEnabled(els.evenBox, state.parity.evenOn);
      applyPages(parityPagesFromState());
    });

    on(els.parityDirect, "keydown", function (e) {
      if (e.key === "Enter") els.parityDirectApply.click();
    });
  }

  function bindDuals() {
    duals.range = makeDual({ lo: "rangeLo", hi: "rangeHi", fill: "rangeFill" }, function (a, b) {
      state.range.from = a;
      state.range.to = b;
      els.rangeFrom.value = a;
      els.rangeTo.value = b;
      mutate();
    });
    duals.odd = makeDual({ lo: "oddLo", hi: "oddHi", fill: "oddFill" }, function (a, b) {
      state.parity.oddFrom = a;
      state.parity.oddTo = b;
      els.oddFrom.value = a;
      els.oddTo.value = b;
      mutate();
    });
    duals.even = makeDual({ lo: "evenLo", hi: "evenHi", fill: "evenFill" }, function (a, b) {
      state.parity.evenFrom = a;
      state.parity.evenTo = b;
      els.evenFrom.value = a;
      els.evenTo.value = b;
      mutate();
    });
  }

  function bindQuick() {
    function run(fn) { state.pages = fn(); paint(); mutate(); }
    on(els.qAll, "click", function () { run(function () { return PP.allPages(state.total); }); });
    on(els.qNone, "click", function () { run(function () { return []; }); showToast(t("toast.cleared")); });
    on(els.qInvert, "click", function () { run(function () { return PP.invert(state.pages, state.total); }); });
    on(els.qOdd, "click", function () { run(function () { return PP.parityRange(1, state.total, "odd"); }); });
    on(els.qEven, "click", function () { run(function () { return PP.parityRange(1, state.total, "even"); }); });
  }

  function bindGridClicks() {
    function handler(e) {
      var btn = e.target.closest ? e.target.closest("button[data-page]") : null;
      if (!btn) return;
      togglePage(Number(btn.getAttribute("data-page")), e.shiftKey);
    }
    on(els.map, "click", handler);
    on(els.chips, "click", handler);
  }

  function bindOutput() {
    on(els.outTabs, "click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-tab]") : null;
      if (!btn) return;
      setTab(btn.getAttribute("data-tab"));
    });

    on(els.copyBtn, "click", function () {
      var text = els.outArea.value;
      if (!text) { showToast(t("toast.nothing")); return; }
      copyText(text).then(function (ok) {
        if (ok) {
          addRecord(text);
          showToast(t("toast.copied"));
        } else {
          els.outArea.focus();
          els.outArea.select();
          addRecord(text);
          showToast(t("toast.copyManual"));
        }
      });
    });

    on(els.shareBtn, "click", function () {
      var base = location.href.split("#")[0];
      var link = base + "#" + PP.encodeState(state.total, state.pages);
      copyText(link).then(function (ok) {
        if (ok) showToast(t("toast.linkCopied"));
        else window.prompt(t("toast.linkCopied"), link);
      });
    });

    on(els.optCompact, "change", function () {
      state.out.compact = els.optCompact.checked;
      renderOutputs();
      mutate();
    });
    on(els.optReverse, "change", function () {
      state.out.reverse = els.optReverse.checked;
      renderOutputs();
      mutate();
    });
    on(els.optSep, "change", function () {
      state.out.sep = els.optSep.value;
      renderOutputs();
      mutate();
    });
    on(els.optBatch, "change", function () {
      state.out.batch = PP.clampInt(els.optBatch.value, 0, PP.MAX_PAGES);
      els.optBatch.value = state.out.batch;
      renderOutputs();
      mutate();
    });
    on(els.optBatch, "keydown", function (e) {
      if (e.key === "Enter") els.optBatch.blur();
    });
  }

  function bindRecords() {
    on(els.recList, "click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!btn) return;
      var i = Number(btn.getAttribute("data-i"));
      var rec = state.records[i];
      if (!rec) return;
      var act = btn.getAttribute("data-act");
      if (act === "copy") {
        copyText(rec.text).then(function (ok) {
          showToast(ok ? t("toast.copied") : t("toast.invalid"));
        });
      } else if (act === "restore") {
        restoreRecord(i);
      } else if (act === "del") {
        state.records.splice(i, 1);
        save();
        renderRecords();
        showToast(t("toast.deleted"));
      }
    });

    on(els.recClear, "click", function () {
      if (!state.records.length) return;
      if (!window.confirm(t("records.clearConfirm"))) return;
      state.records = [];
      save();
      renderRecords();
    });
  }

  function bindSettings() {
    function openDialog() {
      syncSettingsUI();
      if (typeof els.settingsDlg.showModal === "function") els.settingsDlg.showModal();
      else els.settingsDlg.setAttribute("open", "");
    }
    function closeDialog() {
      if (typeof els.settingsDlg.close === "function") els.settingsDlg.close();
      else els.settingsDlg.removeAttribute("open");
    }

    on(els.settingsBtn, "click", openDialog);
    on(els.settingsClose, "click", closeDialog);
    on(els.settingsDone, "click", closeDialog);
    on(els.settingsDlg, "click", function (e) {
      if (e.target === els.settingsDlg) closeDialog();
    });

    function setLang(value) {
      state.lang = value;
      resolvedLang = resolveLang();
      save();
      applyI18n();
    }
    on(els.langSelect, "change", function () { setLang(els.langSelect.value); });
    on(els.setLang, "change", function () { setLang(els.setLang.value); });

    on(els.setMap, "change", function () {
      state.showMap = els.setMap.checked;
      els.mapWrap.hidden = !state.showMap;
      save();
    });
    on(els.setGaps, "change", function () {
      state.highlightGaps = els.setGaps.checked;
      paint();
      save();
    });
    on(els.setPromo, "change", function () {
      state.showPromo = els.setPromo.checked;
      els.promo.hidden = !state.showPromo;
      save();
    });

    on(els.clearData, "click", function () {
      if (!window.confirm(t("settings.clearDataConfirm"))) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { }
      state = defaults();
      resolvedLang = resolveLang();
      els.totalInput.value = state.total;
      buildGrid();
      applyI18n();
      syncAll();
      showToast(t("settings.dataCleared"));
    });

    on(els.resetData, "click", function () {
      if (!window.confirm(t("settings.resetConfirm"))) return;
      state = defaults();
      resolvedLang = resolveLang();
      els.totalInput.value = state.total;
      buildGrid();
      applyI18n();
      syncAll();
      mutate();
      showToast(t("toast.reset"));
    });
  }

  function bindKeys() {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !els.settingsDlg || !els.settingsDlg.open) return;
      if (typeof els.settingsDlg.close === "function") els.settingsDlg.close();
    });
  }

  function init() {
    cacheEls();
    state = load();
    resolvedLang = resolveLang();
    bindDuals();
    bindTotal();
    bindRange();
    bindParity();
    bindQuick();
    bindGridClicks();
    bindOutput();
    bindRecords();
    bindSettings();
    bindKeys();
    buildGrid();
    applyI18n();
    syncAll();
    paint();
    save();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
