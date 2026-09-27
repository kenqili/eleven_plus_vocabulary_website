import { requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { boundary, HttpError } from "@/lib/server/http";
import { wordSummary } from "@/lib/server/word-summary";
import {
  filterWords,
  WORD_FILTERS,
  LEARNING_STATUS,
  wordSummaryCsv,
  type WordFilter,
} from "@/lib/challenge/word-summary";
import {
  DIFFICULTY_LEVELS,
  type DifficultyFilter,
} from "@/lib/challenge/difficulty";
import {
  CUMULATIVE_FLOOR,
  describeRecallTargets,
  runTarget,
} from "@/lib/challenge/mastery";
import {
  A4,
  CONTENT_LABELS,
  resolveSheet,
} from "@/lib/challenge/print-layout";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
type SheetWord = Awaited<ReturnType<typeof wordSummary>>[number];

/**
 * A grid sheet sized for A4. Each page holds exactly one page's worth of
 * cells, and a page break is forced between them, so the browser cannot drift
 * a row onto the next sheet and leave a ragged gap.
 */
function sheetResponse(
  request: Request,
  headers: Record<string, string>,
  words: SheetWord[],
  filter: string,
  level: string,
) {
  const params = new URL(request.url).searchParams;
  const sheet = resolveSheet(params.get("layout"), params.get("content"));
  const { density, content } = sheet;
  const perPage = density.columns * density.rows;
  const body = sheet.bodyPt;
  const budget = { meaning: sheet.meaningChars, example: sheet.exampleChars };
  const clamp = (value: string, max: number) =>
    value.length > max ? value.slice(0, max - 1).trimEnd() + "…" : value;
  const cell = (word: SheetWord) => {
    const parts = [`<b>${escape(word.word)}</b>`];
    if (content !== "word")
      parts.push(`<span class="m">${escape(clamp(word.definition, budget.meaning))}</span>`);
    if (content === "example" && word.example)
      parts.push(`<span class="e">${escape(clamp(word.example, budget.example))}</span>`);
    return `<li>${parts.join("")}</li>`;
  };
  const pages: string[] = [];
  for (let i = 0; i < words.length; i += perPage) {
    const slice = words.slice(i, i + perPage);
    pages.push(
      `<section class="page"><ol class="grid" style="--cols:${density.columns};--rows:${density.rows}">${slice
        .map(cell)
        .join("")}</ol></section>`,
    );
  }
  const title = `MineWords · ${WORD_FILTERS[filter as WordFilter]}${level === "all" ? "" : ` · Level ${level}`}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>
@page{size:A4 portrait;margin:${A4.marginMm}mm}
*{box-sizing:border-box}
body{font:14px/1.45 Arial,Helvetica,sans-serif;color:#000;margin:0;padding:16px;background:#f4f6f9}
.controls{max-width:210mm;margin:0 auto 18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.controls button{padding:11px 18px;font:inherit;font-weight:700;cursor:pointer;border:0;border-radius:8px;background:#224f82;color:#fff}
.sheet{max-width:210mm;margin:0 auto}
.page{width:${A4.widthMm}mm;min-height:${A4.heightMm}mm;padding:${A4.marginMm}mm;margin:0 auto 18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.12);display:flex;flex-direction:column}
.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--cols),1fr);grid-template-rows:repeat(var(--rows),1fr);gap:4mm;flex:1}
.grid li{border:1px solid #b9c4d2;border-radius:2mm;padding:2mm 2.5mm;overflow:hidden;display:flex;flex-direction:column;gap:1mm;font-size:${body}pt;line-height:1.3;break-inside:avoid}
.grid b{font-size:1.15em;line-height:1.15;word-break:break-word}
.grid .m{color:#1a1a1a}
.grid .e{color:#444;font-style:italic}
.legend{max-width:210mm;margin:10px auto 0;font-size:13px;color:#334}
@media print{
  body{background:#fff;padding:0}
  .controls,.legend{display:none}
  .page{width:auto;min-height:0;margin:0;box-shadow:none;page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
  .grid{height:${A4.usableHeightMm}mm}
}
</style></head><body>
<div class="controls"><button onclick="window.print()">Print or save as PDF</button><span>${escape(title)} · ${words.length} words · ${density.columns}×${density.rows} (${perPage} a page) · ${CONTENT_LABELS[content]}</span></div>
<div class="sheet">${pages.join("") || `<section class="page"><p>No words match these filters.</p></section>`}</div>
<p class="legend">Difficulty levels are relative estimates for this collection, not exam grades. Printed from MineWords on ${new Date().toISOString().slice(0, 10)}.</p>
</body></html>`;
  return new Response(html, {
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
    },
  });
}
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    if (!(await membership(user)).access)
      throw new HttpError(
        402,
        "Your free access has ended. Subscribe to continue exporting and printing words.",
      );
    const params = new URL(request.url).searchParams;
    const filter = params.get("filter") || "all",
      search = params.get("search") || "",
      format = params.get("format") || "csv",
      level = params.get("level") || "all";
    if (
      !Object.hasOwn(WORD_FILTERS, filter) ||
      !["all", "0", "1", "2", "3", "4", "5"].includes(level) ||
      !["csv", "print", "sheet"].includes(format) ||
      search.length > 200
    )
      throw new HttpError(400, "Invalid word export filters.");
    const words = filterWords(
      await wordSummary(user.id),
      filter as WordFilter,
      search,
      (level === "all" ? "all" : Number(level)) as DifficultyFilter,
    );
    const headers = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (format === "csv")
      return new Response(wordSummaryCsv(words), {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="minewords-' +
            filter +
            "-level-" +
            level +
            '.csv"',
        },
      });
    if (format === "sheet") return sheetResponse(request, headers, words, filter, level);
    const title = `MineWords · ${WORD_FILTERS[filter as WordFilter]}${level === "all" ? "" : ` · Level ${level}`}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{font:15px/1.5 Arial,sans-serif;color:#17253b;max-width:850px;margin:30px auto;padding:0 20px}h1{font-size:26px}h2{font-size:20px;margin:0}article{break-inside:avoid;border-bottom:1px solid #aaa;padding:16px 0}p{margin:6px 0}.progress{font-size:12px;color:#444}.notes{height:28px;border-bottom:1px dotted #aaa}button{padding:12px 20px;cursor:pointer;font:inherit}@media print{.controls{display:none}body{margin:0;padding:0;color:#000}article{break-inside:avoid}}@page{margin:16mm}</style></head><body>
<div class="controls"><button onclick="window.print()">Print / Save as PDF</button><p>Use your browser’s print dialog to print this sheet or save it as a PDF.</p></div>
<h1>${escape(title)}</h1><p>${words.length} words${search ? ` · Search: ${escape(search)}` : ""} · ${new Date().toISOString().slice(0, 10)}</p>
<p>${escape(describeRecallTargets())} master a word, as do ${runTarget(0)}–${runTarget(5)} right answers in a row or ${CUMULATIVE_FLOOR} right answers whenever they come. Needs practice means an unmastered word with a mistake or revealed answer.</p>
${words.length ? words.map((word) => `<article><h2>${escape(word.word)}</h2><p class="progress">${DIFFICULTY_LEVELS[word.difficulty]} · ${LEARNING_STATUS[word.status]} · ${word.correct} correct · ${word.mistakes} mistakes · ${word.reveals} reveals</p><p>${escape(word.definition)}</p>${word.example ? `<p><em>${escape(word.example)}</em></p>` : ""}<p><strong>Synonyms:</strong> ${escape(word.syn || "—")}<br><strong>Antonyms:</strong> ${escape(word.ant || "—")}</p><div class="notes">Notes:</div></article>`).join("") : "<p>No words match these filters.</p>"}
<footer><p>Level 0 is the curriculum extension. Difficulty levels 1–5 combine word length and general English frequency; they are estimates relative to this collection, not exam grades. Frequency and derived level data: <a href="https://github.com/rspeer/wordfreq">wordfreq 3.1.1 by Robyn Speer</a>, incorporating freely available SUBTLEX by Marc Brysbaert and colleagues. Derived data licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.</p></footer>
</body></html>`;
    return new Response(html, {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
      },
    });
  });
}
