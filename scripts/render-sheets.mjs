// Renders every A4 word sheet combination to one file so the printed result
// can be checked by eye, without needing an account or a running server.
// Run: node --experimental-strip-types scripts/render-sheets.mjs [outfile]
import { writeFileSync } from "node:fs";
import { words } from "./load-word-bank.mjs";
import {
  A4,
  CONTENT_LABELS,
  CONTENT_MODES,
  DENSITIES,
  bodyFontPt,
} from "../lib/challenge/print-layout.ts";

const out = process.argv[2] || "/tmp/minewords-sheets.html";
const escape = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
const clamp = (value, max) =>
  value.length > max ? value.slice(0, max - 1).trimEnd() + "…" : value;

// The worst realistic case: the longest definitions and examples in the bank.
const hardest = [...words]
  .sort(
    (a, b) =>
      b.definition.length + (b.example || "").length -
      (a.definition.length + (a.example || "").length),
  )
  .slice(0, 60);
const average = words.slice(400, 460);

const sheet = (source, density, content) => {
  const perPage = density.columns * density.rows;
  const body = bodyFontPt(density, content);
  const cell = (word) => {
    const parts = [`<b>${escape(word.word)}</b>`];
    if (content !== "word")
      parts.push(
        `<span class="m">${escape(
          clamp(word.definition, content === "example" ? 90 : 60),
        )}</span>`,
      );
    if (content === "example" && word.example)
      parts.push(`<span class="e">${escape(clamp(word.example, 110))}</span>`);
    return `<li>${parts.join("")}</li>`;
  };
  const pages = [];
  for (let i = 0; i < source.length; i += perPage)
    pages.push(
      `<section class="page"><ol class="grid" style="--cols:${density.columns};--rows:${density.rows}">${source
        .slice(i, i + perPage)
        .map(cell)
        .join("")}</ol></section>`,
    );
  return `<div class="band"><h2>${density.id} · ${CONTENT_LABELS[content]} · ${body}pt · ${
    source === hardest ? "longest entries" : "typical entries"
  }</h2>${pages.join("")}</div>`;
};

const blocks = [];
for (const density of DENSITIES)
  for (const content of CONTENT_MODES)
    for (const source of content === "word" ? [average] : [hardest, average])
      blocks.push(sheet(source, density, content));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MineWords sheet check</title>
<style>
@page{size:A4 portrait;margin:${A4.marginMm}mm}
*{box-sizing:border-box}
body{font:14px/1.45 Arial,Helvetica,sans-serif;color:#000;margin:0;padding:16px;background:#f4f6f9}
.sheet{max-width:210mm;margin:0 auto}
.band h2{max-width:210mm;margin:24px auto 8px;font:700 15px Arial}
.page{width:${A4.widthMm}mm;height:${A4.heightMm}mm;padding:${A4.marginMm}mm;margin:0 auto 18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.12);display:flex;flex-direction:column;overflow:hidden}
.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--cols),1fr);grid-template-rows:repeat(var(--rows),1fr);gap:4mm;flex:1}
.grid li{border:1px solid #b9c4d2;border-radius:2mm;padding:2mm 2.5mm;overflow:hidden;display:flex;flex-direction:column;gap:1mm;line-height:1.3;break-inside:avoid}
.grid b{font-size:1.15em;line-height:1.15;word-break:break-word}
.grid .e{color:#444;font-style:italic}
@media print{body{background:#fff;padding:0}.band h2{display:none}.page{width:auto;height:auto;margin:0;box-shadow:none;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}}
</style></head><body><div class="sheet">${blocks.join("")}</div></body></html>`;

writeFileSync(out, html);
console.log(`wrote ${out}`);
console.log(
  `${DENSITIES.length} grids x ${CONTENT_MODES.length} content modes = ${
    DENSITIES.length * CONTENT_MODES.length
  } combinations rendered`,
);
for (const density of DENSITIES)
  console.log(
    `  ${density.id.padEnd(5)} cell ${String(density.cellWidthMm).padStart(5)} x ${String(
      density.cellHeightMm,
    ).padStart(5)} mm  max=${density.maxContent.padEnd(7)} sizes: ` +
      CONTENT_MODES.map((mode) => `${mode} ${bodyFontPt(density, mode)}pt`).join("  "),
  );
