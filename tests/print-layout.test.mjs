// A4 word sheets: a grid is only offered for content it can actually show, so
// a parent never prints unreadable text.
import test from "node:test";
import assert from "node:assert/strict";
import { words } from "../scripts/load-word-bank.mjs";
import {
  A4,
  CONTENT_LABELS,
  CONTENT_MODES,
  DENSITIES,
  MEASURE,
  MIN_BODY_PT,
  SHEET_TEXT_PROFILE,
  SHEETS,
  bestDensityFor,
  bodyFontPt,
  canShow,
  cellText,
  densityFor,
  fitSheet,
  isContentMode,
  isDensity,
  resolveSheet,
  textHeightMm,
  usableCellHeightMm,
} from "../lib/challenge/print-layout.ts";

test("A4 with margins leaves a sane area to fill", () => {
  assert.equal(A4.widthMm, 210);
  assert.equal(A4.heightMm, 297);
  assert.equal(A4.usableWidthMm, 186);
  assert.equal(A4.usableHeightMm, 273);
  assert.ok(A4.usableAreaMm2 > 50000, "usable area should be about half a page");
});

test("the four requested grids are offered", () => {
  assert.deepEqual(
    DENSITIES.map((entry) => entry.id),
    ["2x6", "3x8", "4x10", "5x12"],
  );
  assert.deepEqual(
    DENSITIES.map((entry) => entry.columns * entry.rows),
    [12, 24, 40, 60],
  );
  for (const entry of DENSITIES)
    assert.ok(
      entry.cellWidthMm > 10 && entry.cellHeightMm > 5,
      `${entry.id} cells must be physically usable`,
    );
});

test("denser grids get smaller cells and less content", () => {
  const areas = DENSITIES.map((entry) => entry.cellAreaMm2);
  assert.deepEqual(
    [...areas].sort((a, b) => b - a),
    areas,
    "each grid must hold less than the last",
  );
  for (let i = 1; i < DENSITIES.length; i += 1)
    assert.ok(
      CONTENT_MODES.indexOf(DENSITIES[i].maxContent) <=
        CONTENT_MODES.indexOf(DENSITIES[i - 1].maxContent),
      "a denser grid can never show more than a looser one",
    );
});

test("every content mode has a grid that fits it", () => {
  for (const mode of CONTENT_MODES) {
    const best = bestDensityFor(mode);
    assert.ok(
      CONTENT_MODES.indexOf(mode) <= CONTENT_MODES.indexOf(best.maxContent),
      `${mode} has no grid that can carry it`,
    );
    assert.ok(CONTENT_LABELS[mode]);
    // And it is the first such grid, so a parent starts with the most room.
    const first = DENSITIES.find(
      (entry) =>
        CONTENT_MODES.indexOf(mode) <= CONTENT_MODES.indexOf(entry.maxContent),
    );
    assert.equal(best.id, first.id, mode);
  }
});

test("a content mode is only paired with a grid that can hold it", () => {
  for (const content of CONTENT_MODES)
    for (const layout of ["2x6", "3x8", "4x10", "5x12"]) {
      const { density, content: resolved } = resolveSheet(layout, content);
      assert.equal(resolved, content, `${layout}/${content}`);
      assert.ok(
        CONTENT_MODES.indexOf(content) <=
          CONTENT_MODES.indexOf(density.maxContent),
        `${layout} cannot show ${content}, so it must fall back to a roomier grid`,
      );
      // The requested grid is kept whenever it genuinely fits.
      if (CONTENT_MODES.indexOf(content) <= CONTENT_MODES.indexOf(densityFor(layout).maxContent))
        assert.equal(density.id, layout);
    }
});

test("a nonsense layout or mode falls back instead of throwing", () => {
  // Nothing asked for means the default, word plus meaning, on the roomiest
  // grid that can hold it.
  // Nothing asked for means the default, word plus meaning, on the roomiest
  // grid that can hold it. That grid is the one a child can read.
  const fallback = resolveSheet(null, null);
  assert.equal(fallback.content, "meaning");
  assert.equal(fallback.density.id, "2x6");
  assert.ok(fallback.bodyPt >= MIN_BODY_PT);
  assert.equal(resolveSheet("9x99", "word").density.id, "2x6");
  // A combination that cannot be printed at a readable size falls back to the
  // roomiest one that can. The picker disables these, so this only happens for
  // a hand-edited link, and readable is the right answer when it does.
  for (const [layout, content] of [
    ["5x12", "meaning"],
    ["4x10", "example"],
    ["5x12", "example"],
  ])
    assert.equal(
      resolveSheet(layout, content).density.id,
      "2x6",
      `${layout}/${content}`,
    );
  assert.equal(resolveSheet("DROP TABLE", "nonsense").content, "meaning");
  assert.equal(resolveSheet("3x8", "banana").density.id, "3x8");
  assert.ok(isDensity("2x6") && !isDensity("2x7"));
  assert.ok(isContentMode("word") && !isContentMode("words"));
});

test("nothing is offered in a size a child cannot read", () => {
  // A sheet a ten-year-old cannot read is not a faster sheet. Every combination
  // the picker offers has to clear the floor, which means the tighter grids
  // quietly stop carrying meanings rather than printing them in contract type.
  assert.ok(MIN_BODY_PT >= 10, `the floor is ${MIN_BODY_PT}pt`);
  for (const density of DENSITIES)
    for (const content of CONTENT_MODES) {
      if (!canShow(density, content)) continue;
      const sheet = fitSheet(density, content);
      assert.ok(
        sheet.bodyPt >= MIN_BODY_PT,
        `${density.id}/${content} is offered at ${sheet.bodyPt}pt`,
      );
    }
  // And the roomy grid, which is what a child gets by default, is properly big.
  assert.ok(fitSheet(densityFor("2x6"), "meaning").bodyPt >= 13);
});

test("body text never drops below a legible size", () => {
  // Even the tightest grid at its densest content must stay readable.
  const smallest = Math.min(
    ...DENSITIES.flatMap((entry) =>
      CONTENT_MODES.map((mode) => bodyFontPt(entry, mode)),
    ),
  );
  assert.ok(smallest >= 7, `smallest was ${smallest}pt`);
  // And looser grids get larger text.
  assert.ok(bodyFontPt(DENSITIES[0], "word") > bodyFontPt(DENSITIES[3], "word"));
  assert.ok(
    bodyFontPt(densityFor("2x6"), "word") > bodyFontPt(densityFor("5x12"), "word"),
  );
});

/**
 * The size a cell is allowed to fill is what the whole fit rests on, so these
 * two are the check that the print output is actually clear to read.
 */
test("every offered combination shows the longest entry in the whole bank", () => {
  const overflowing = [];
  const cramped = [];
  for (const density of DENSITIES)
    for (const content of CONTENT_MODES) {
      if (!canShow(density, content)) continue;
      const sheet = fitSheet(density, content);
      assert.ok(sheet, `${density.id}/${content} is offered but unsolvable`);
      const budget = {
        meaning: sheet.meaningChars,
        example: sheet.exampleChars,
      };
      assert.ok(sheet.bodyPt >= MIN_BODY_PT, `${density.id}/${content} too small`);
      for (const word of words) {
        const need = textHeightMm(
          cellText(word, content, budget),
          sheet.bodyPt,
          density.cellWidthMm,
        );
        const margin = density.cellHeightMm - need;
        if (margin < 0)
          overflowing.push(`${density.id}/${content} ${word.word} by ${-margin.toFixed(1)}mm`);
        // Browsers break text slightly differently from the estimate, so a
        // fit that only just works would print clipped in the real thing.
        else if (margin < 1)
          cramped.push(`${density.id}/${content} ${word.word} +${margin.toFixed(1)}mm`);
      }
    }
  assert.deepEqual(overflowing.slice(0, 5), [], "text would be cut off");
  assert.deepEqual(cramped.slice(0, 5), [], "no headroom left for browser quirks");
});

test("the text budget matches the bank it was measured from", () => {
  // If the bank's prose grows, this constant is stale and the fit above is
  // being measured against the wrong thing.
  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[
      Math.min(values.length - 1, Math.floor(values.length * p))
    ];
  for (const [key, actual] of [
    ["word", percentile(words.map((w) => w.word.length), 0.95)],
    ["meaning", percentile(words.map((w) => w.definition.length), 0.95)],
    ["example", percentile(words.map((w) => (w.example || "").length), 0.95)],
  ]) {
    assert.ok(
      SHEET_TEXT_PROFILE[key] >= actual,
      `SHEET_TEXT_PROFILE.${key} is ${SHEET_TEXT_PROFILE[key]} but the bank now needs ${actual}`,
    );
    // and not wastefully generous
    assert.ok(
      SHEET_TEXT_PROFILE[key] <= actual * 1.15,
      `SHEET_TEXT_PROFILE.${key} is ${SHEET_TEXT_PROFILE[key]}, well past the bank's ${actual}`,
    );
  }
});

test("cell text is shortened with a marker rather than cut off", () => {
  const long = {
    word: "choreographer",
    definition: "A person who arranges the movements of a dance. ".repeat(6).trim(),
    example: "She spoke to the choreographer about the opening routine. ".repeat(4).trim(),
  };
  const budget = { meaning: 30, example: 25 };
  const segments = cellText(long, "example", budget);
  assert.equal(segments.length, 3);
  assert.equal(segments[1].text.length, budget.meaning);
  assert.ok(segments[1].text.endsWith("…"), "a shortened meaning is marked");
  assert.equal(segments[2].text.length, budget.example);
  assert.ok(segments[2].text.endsWith("…"));
  // Word-only mode never carries a meaning or an example.
  assert.equal(cellText(long, "word").length, 1);
  // And a meaning mode drops the example entirely.
  assert.equal(cellText(long, "meaning").length, 2);
  // A word with no example simply omits that line.
  assert.equal(cellText({ word: "quaff", definition: "To drink loudly." }, "example").length, 2);
});

test("the offered sheets are exactly the ones that fit", () => {
  const expected = DENSITIES.flatMap((entry) =>
    CONTENT_MODES.filter((mode) => canShow(entry, mode)).map((mode) => `${entry.id}/${mode}`),
  );
  assert.deepEqual(
    SHEETS.map((sheet) => `${sheet.density.id}/${sheet.content}`).sort(),
    expected.sort(),
  );
  for (const sheet of SHEETS)
    assert.ok(sheet.bodyPt >= MIN_BODY_PT && sheet.bodyPt <= 22, sheet.density.id);
  assert.ok(MEASURE.headroom > 0.8 && MEASURE.headroom < 1, "headroom must be real but small");
  assert.ok(usableCellHeightMm(DENSITIES[0]) < DENSITIES[0].cellHeightMm);
});
