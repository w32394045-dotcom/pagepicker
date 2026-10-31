# PagePicker — a single-file, offline print page-range builder

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![UI: 7 languages](https://img.shields.io/badge/UI-7%20languages-9cf)](index.html)
[![Single file, offline](https://img.shields.io/badge/single--file-offline-brightgreen.svg)](index.html)

**English** · [简体中文](README.zh-CN.md)

PagePicker turns "which pages do I actually want to print?" into a page range you can paste straight into the
print dialog — built for printers without a duplexer. Tell it the document's total page count, pick the pages on
the overview map (or type a range), and copy the result. One HTML file, no build step, no dependencies, no network
at runtime.

Source: [github.com/w32394045-dotcom/pagepicker](https://github.com/w32394045-dotcom/pagepicker)

## Try it

**Primary: https://pagepicker.xszx.cc.cd** — this is the one to bookmark.

| Entry | URL | When to use it |
| --- | --- | --- |
| **Primary** | **https://pagepicker.xszx.cc.cd** | Default (custom domain, Cloudflare Worker) |
| Mirror 1 | https://pagepicker.w32394045.workers.dev | Same Worker, native address — if DNS misbehaves |
| Mirror 2 | https://w32394045-dotcom.github.io/pagepicker/ | GitHub Pages — if Cloudflare is down entirely |

All three serve the same `index.html`, byte for byte. Settings and history live in your browser's `localStorage`,
so they do not follow you between entries — pick one and stick with it. Prefer to keep it offline? Download
`index.html` from the [repository](https://github.com/w32394045-dotcom/pagepicker) and double-click it.

## Features

**Page count and overview map**

- **Total pages** — enter the document's page count (1–2000), with stepper buttons and 50 / 100 / 200 shortcuts.
- **Overview map** — one or more rows of small squares, one per page: selected odd pages are blue, selected even
  pages amber, unselected pages pale grey. Hover a square to see its page number; click it to toggle that page.
- **Flagging gaps** — switch on *Flag pages that are not selected* to paint every unpicked page red, so a missing
  range in the middle of a long document is obvious at a glance.
- **Selection bar** — a live *X of N pages selected (P%)* progress bar, with **All**, **None**, **Invert**,
  **Odd only** and **Even only** shortcuts.

**Three ways to pick pages**

- **Range** — From / To number boxes with steppers, plus a dual-handle slider you can drag. Step through every
  page or every second page; apply the range with **Add**, **Replace** or **Remove**. The box below also takes
  direct input such as `1-5, 8, 10-13`, `odd`, `even` or `1-99/2` — see
  [Direct input syntax](#direct-input-syntax).
- **Odd / even** — Both sides, Odd only or Even only, with a separate from / to limit for the odd pages and for
  the even pages (each with its own switch, number boxes and mini slider). This is the manual-duplex workflow:
  print the odd sides first, flip the stack, then print the even sides. The direct input box takes
  `odd:1-99; even:2-100` as well.
- **Manual picking** — a numbered grid, one square per page. Click toggles a page, Shift-click fills the span from
  the last clicked page, and **All** / **None** / **Invert** work on the whole grid. There is no drag-select.

**Output**

- **Three tabs** — **All** (merged), **Odd** and **Even**, each showing a string ready for the print dialog's
  *Pages / Page range* field, for example `1-5,8,10,11-13`.
- **Copy buttons** — one per tab, using the Clipboard API with an automatic `execCommand` fallback; a toast
  confirms the copy.
- **Format options** — merge consecutive pages (on by default), pick a separator (`,` / `, ` / `、` / `/` / space /
  newline), reverse the order (for the back side of a manual duplex job), or split the output into lines of at
  most K pages, so you can feed paper a small batch at a time.
- **Live output** — the strings update as you pick, and the read-only boxes can be selected by hand.

**History and sharing**

- **History** — every copy adds a record with the time, page count and an output preview. Copy it again, restore
  that exact selection, delete one record or clear the list.
- **Kept across reloads** — the history and the current selection are stored in `localStorage`.
- **Share link** — one click copies a link that carries the page count and the selection in the URL hash; opening
  it restores the same state. Nothing is uploaded.

**Settings and interface**

- **Settings** — language (detected automatically, or 简体中文 / 繁體中文 / 日本語 / 한국어 / Deutsch / Français /
  English), show the footer credits and related projects (on by default), flag pages that are not selected, show
  the overview map at the top, clear saved data, restore defaults. Settings are saved in `localStorage`.
- **Fully local** — a single `index.html`; double-clicking the file (even from `file://`) works. No external
  fonts, scripts or CDN, and no requests of any kind.
- **White theme, responsive** — two columns on desktop (controls left, output right), a single column on narrow
  screens.
- **Keyboard-friendly** — visible Tab focus rings, `aria-label`s on the buttons, and Esc closes dialogs.

**Footer**

- **A quiet footer** — the line "Runs entirely on this device — nothing is sent anywhere.", a link to the source
  on GitHub and *Open source · MIT*. Below it, two cards for other tools from the same author:
  - **imgprint** — a multi-image print layout tool, single-file and offline:
    [repository](https://github.com/w32394045-dotcom/imgprint) · [live](https://imgprint.xszx.cc.cd/)
  - **md2pdf** — a single-file, offline Markdown → PDF typesetter:
    [repository](https://github.com/w32394045-dotcom/md2pdf) · [live](https://md2pdf.xszx.cc.cd/)
  - The whole footer can be switched off in Settings.

## Usage

1. Open `index.html` in a modern browser — double-click the file, or use one of the entries above.
2. Enter the document's total page count.
3. Pick the pages: overview map, manual grid, range controls, odd / even controls or direct input.
4. Choose the **All** tab (or **Odd** / **Even** if you are printing one side at a time) and click **Copy**.
5. In the browser's print dialog, paste the string into the **Pages / Page range** field — *页面范围* in Chinese.
   Print.

The **split into batches** format option is for printers that only take a small stack at a time: the output is
broken into lines of at most K pages, and you feed paper batch by batch.

### Manual duplex (a printer without a duplexer)

1. Set the page count, copy the **Odd** string and print it on the front side.
2. Flip the stack **following your printer's manual-duplex instructions** — which edge to flip on, and which end
   to feed, depends on the printer and on long-edge vs short-edge binding.
3. Copy the **Even** string and print the back side. If the backs come out in the wrong order or upside down, turn
   on **Reverse order** in the output options and copy again.
4. Test with two or three pages first; it is cheaper than reprinting the whole stack.

## Direct input syntax

Type these into the *Or type it* box instead of clicking:

| Input | Meaning |
| --- | --- |
| `1-5` | Pages 1 to 5 |
| `1-5, 8, 10-13` | Two ranges and the single page 8; commas separate the items |
| `odd` | Every odd page |
| `even` | Every even page |
| `1-99/2` | Every second page from 1 to 99 (step 2) |
| `odd:1-99; even:2-100` | Odd pages 1–99 and even pages 2–100 — the two sides for manual duplex |

Items can be separated by commas, spaces or `、`; `odd:` and `even:` can be combined, and a range can carry a `/`
step as in `1-99/2`.

## Privacy & offline

- **Nothing leaves the browser.** PagePicker makes no network requests, loads no external fonts, scripts or CDN
  files, and has no analytics or telemetry. It never opens your document either — it only knows the page numbers
  you give it.
- **One file.** `index.html` is self-contained: no build step, no dependencies, and it works from `file://`.
- **Where the data lives.** The current selection, settings and history are kept in this browser's `localStorage`;
  a share link keeps the state in the URL hash. Clear it from *Settings → Clear saved data*, or by clearing the
  site's data in your browser.
- **The three entries do not share storage.** They are separate origins, so pick one and stay with it.

## Related projects

- **[md2pdf](https://github.com/w32394045-dotcom/md2pdf)** — [md2pdf.xszx.cc.cd](https://md2pdf.xszx.cc.cd/) ·
  the single-file, offline Markdown → PDF typesetter from the same ecosystem: LaTeX maths, chemistry, inline SVG
  and print-ready page layout, output as vector text, with no fonts to install. When the thing to print is a
  document rather than a page range, start there.
- **[md2pdf-authoring](https://github.com/w32394045-dotcom/md2pdf-authoring)** — the companion AI skill for that
  typesetter. It teaches an agent to write Markdown whose maths, chemistry, figures and tables survive rendering
  and printing, and ships a `check_md.py` linter to run before delivery.
- **[md2pdf-ext-rules](https://github.com/w32394045-dotcom/md2pdf-ext-rules)** — the second companion AI skill,
  covering md2pdf's JSON extension system (`preProcess`, `customSyntax`, `cssInjection`, `uiInjection`), with a
  `check_ext.py` linter and sixteen counter-examples of extensions that fail loudly or quietly.
- **[imgprint](https://github.com/w32394045-dotcom/imgprint)** — [imgprint.xszx.cc.cd](https://imgprint.xszx.cc.cd/) ·
  the single-file image printer: several photos per sheet, paper size, margins and 1–4 images a page, with warnings
  for effective DPI and non-sRGB colour spaces. Fully offline.

## Licence

[MIT](LICENSE) © 2026 w32394045-dotcom

Use it, change it, redistribute it — keep the copyright notice. No warranty.
