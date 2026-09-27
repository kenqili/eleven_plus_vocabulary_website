// A4 word sheets: a grid is only offered for content it can actually show, so
// a parent never prints unreadable text.
import test from "node:test";
import assert from "node:assert/strict";
import {
  A4,
  CONTENT_LABELS,
  CONTENT_MODES,
  DENSITIES,
  bestDensityFor,
  bodyFontPt,
  densityFor,
  isContentMode,
  isDensity,
  resolveSheet,
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
    assert.equal(best.maxContent, mode, `${mode} needs a grid for itself`);
    assert.ok(CONTENT_LABELS[mode]);
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
  assert.deepEqual(resolveSheet(null, null), {
    density: densityFor("4x10"),
    content: "meaning",
  });
  assert.equal(resolveSheet("9x99", "word").density.id, "5x12");
  assert.equal(resolveSheet("DROP TABLE", "nonsense").content, "meaning");
  assert.equal(resolveSheet("3x8", "banana").density.id, "3x8");
  assert.ok(isDensity("2x6") && !isDensity("2x7"));
  assert.ok(isContentMode("word") && !isContentMode("words"));
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
