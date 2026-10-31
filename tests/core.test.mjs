import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PP = require("../src/core.js");

const eq = (a, b, msg) => assert.deepEqual(a, b, msg);

test("parsePages: comma list with runs", () => {
  eq(PP.parsePages("1-5, 8, 10-13", 100).pages, [1, 2, 3, 4, 5, 8, 10, 11, 12, 13]);
});

test("parsePages: Chinese separators and spaces", () => {
  eq(PP.parsePages("1-3、7，9 11", 100).pages, [1, 2, 3, 7, 9, 11]);
});

test("parsePages: keywords", () => {
  eq(PP.parsePages("odd", 6).pages, [1, 3, 5]);
  eq(PP.parsePages("even", 6).pages, [2, 4, 6]);
  eq(PP.parsePages("all", 3).pages, [1, 2, 3]);
});

test("parsePages: step syntax", () => {
  eq(PP.parsePages("1-9/2", 100).pages, [1, 3, 5, 7, 9]);
  eq(PP.parsePages("1-10/3", 100).pages, [1, 4, 7, 10]);
});

test("parsePages: open-ended runs", () => {
  eq(PP.parsePages("-3", 100).pages, [1, 2, 3]);
  eq(PP.parsePages("98-", 100).pages, [98, 99, 100]);
});

test("parsePages: errors", () => {
  eq(PP.parsePages("", 100).errors[0].code, "empty");
  eq(PP.parsePages("abc", 100).errors[0].code, "invalid");
  eq(PP.parsePages("0", 100).errors[0].code, "outOfRange");
  eq(PP.parsePages("101", 100).errors[0].code, "outOfRange");
  eq(PP.parsePages("5-3", 100).errors[0].code, "invalid");
  eq(PP.parsePages("1-3, xyz, 9", 100).errors.length, 1);
  eq(PP.parsePages("1-5", 100).errors.length, 0);
});

test("parsePages: odd:1-9 inside the generic box", () => {
  eq(PP.parsePages("odd:1-9", 100).pages, [1, 3, 5, 7, 9]);
});

test("parseParity: both sides", () => {
  const r = PP.parseParity("odd:1-99; even:2-100", 100);
  eq(r.errors.length, 0);
  eq(r.mode, "all");
  eq(r.odd, { a: 1, b: 99 });
  eq(r.even, { a: 2, b: 100 });
});

test("parseParity: one side", () => {
  eq(PP.parseParity("odd 1-99", 100).mode, "odd");
  eq(PP.parseParity("even:2-80", 100).mode, "even");
  eq(PP.parseParity("odd", 100).mode, "odd");
});

test("parseParity: errors", () => {
  eq(PP.parseParity("", 100).errors[0].code, "empty");
  eq(PP.parseParity("nonsense", 100).errors[0].code, "invalid");
});

test("buildParity", () => {
  eq(PP.buildParity(6, "all", null, null), [1, 2, 3, 4, 5, 6]);
  eq(PP.buildParity(6, "odd", null, null), [1, 3, 5]);
  eq(PP.buildParity(6, "even", null, null), [2, 4, 6]);
  eq(PP.buildParity(10, "all", { a: 1, b: 5 }, null), [1, 2, 3, 4, 5, 6, 8, 10]);
  eq(PP.buildParity(10, "odd", { a: 1, b: 5 }, null), [1, 3, 5]);
  eq(PP.buildParity(10, "all", { a: 4, b: 8 }, { a: 2, b: 6 }), [2, 4, 5, 6, 7, 8].filter((n) => n % 2 === 0 ? n >= 2 && n <= 6 : n >= 4 && n <= 8));
});

test("formatList: merge runs", () => {
  const pages = [1, 2, 3, 4, 5, 8, 10, 11, 12, 13];
  eq(PP.formatList(pages), "1-5,8,10-13");
  eq(PP.formatList(pages, { sep: "、" }), "1-5、8、10-13");
  eq(PP.formatList(pages, { sep: ", " }), "1-5, 8, 10-13");
  eq(PP.formatList(pages, { compact: false }), "1,2,3,4,5,8,10,11,12,13");
});

test("formatList: reverse reverses runs, not numbers inside a run", () => {
  eq(PP.formatList([1, 2, 3, 10, 11], { reverse: true }), "10-11,1-3");
});

test("formatList: batches split on page counts", () => {
  eq(PP.formatList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { batch: 3 }), "1-3\n4-6\n7-9\n10");
  eq(PP.formatList(PP.range(1, 25), { batch: 10 }), "1-10\n11-20\n21-25");
});

test("formatList: empty", () => {
  eq(PP.formatList([]), "");
  eq(PP.formatList(null), "");
});

test("set operations", () => {
  eq(PP.applyOp([1, 2], [2, 3], "add"), [1, 2, 3]);
  eq(PP.applyOp([1, 2], [2, 3], "replace"), [2, 3]);
  eq(PP.applyOp([1, 2, 3], [2], "remove"), [1, 3]);
  eq(PP.toggle([1, 2], 2), [1]);
  eq(PP.toggle([1, 2], 3), [1, 2, 3]);
  eq(PP.invert([2, 4], 5), [1, 3, 5]);
  eq(PP.allPages(3), [1, 2, 3]);
  eq(PP.span(5, 2), [2, 3, 4, 5]);
});

test("sanitize drops out-of-range and duplicates", () => {
  eq(PP.sanitize([0, 1, 1, 2, 99, 500], 10), [1, 2, 99, 500].filter((n) => n <= 10));
});

test("normalizeTotal clamps", () => {
  eq(PP.normalizeTotal(0), 1);
  eq(PP.normalizeTotal(1e9), 2000);
  eq(PP.normalizeTotal("abc"), 100);
  eq(PP.normalizeTotal("37"), 37);
});

test("coverage", () => {
  eq(PP.coverage([1, 2, 3], 10), { count: 3, total: 10, pct: 30 });
  eq(PP.coverage([], 10), { count: 0, total: 10, pct: 0 });
});

test("detectLang", () => {
  eq(PP.detectLang(["zh-TW", "en-US"]), "zh-TW");
  eq(PP.detectLang(["zh-Hant-HK"]), "zh-TW");
  eq(PP.detectLang(["zh-Hans-CN"]), "zh-CN");
  eq(PP.detectLang(["zh"]), "zh-CN");
  eq(PP.detectLang(["ja-JP"]), "ja");
  eq(PP.detectLang(["ko-KR"]), "ko");
  eq(PP.detectLang(["fr-CA"]), "fr");
  eq(PP.detectLang(["de-DE"]), "de");
  eq(PP.detectLang(["en-GB"]), "en");
  eq(PP.detectLang(["es-ES"]), "en");
  eq(PP.detectLang([]), "en");
  eq(PP.detectLang("ja"), "ja");
});

test("encodeState / decodeState round trip", () => {
  const hash = "#" + PP.encodeState(100, [1, 2, 3, 8, 10, 11]);
  const back = PP.decodeState(hash, 100);
  eq(back.total, 100);
  eq(back.pages, [1, 2, 3, 8, 10, 11]);
  eq(PP.decodeState("#", 100), null);
  eq(PP.decodeState("", 100), null);
  eq(PP.decodeState("#t=50", 100), { total: 50, pages: [] });
  eq(PP.decodeState("#p=bad%20token&t=10", 100), null);
  eq(PP.decodeState("#t=100&p=1-5&ref=abc", 100).pages, [1, 2, 3, 4, 5]);
});

test("parsePages clamps to a changed total", () => {
  eq(PP.parsePages("1-10", 5).errors.length, 1);
});

test("stats", () => {
  eq(PP.stats([1, 2, 3, 4]), { count: 4, odd: 2, even: 2, min: 1, max: 4 });
  eq(PP.stats([]), { count: 0, odd: 0, even: 0, min: 0, max: 0 });
});

test("mergeRanges", () => {
  eq(PP.mergeRanges([1, 2, 3, 5, 7, 8]), [{ a: 1, b: 3 }, { a: 5, b: 5 }, { a: 7, b: 8 }]);
});
