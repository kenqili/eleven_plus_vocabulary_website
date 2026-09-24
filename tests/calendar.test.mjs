import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarCells,
  calendarTime,
  calendarTotals,
  fillCalendarDays,
  monthDays,
  shiftMonth,
  validMonth,
} from "../lib/challenge/calendar.ts";
import { emptyPeriod, localDay } from "../lib/challenge/rewards.ts";

test("calendar months handle leap years, Monday alignment and year transitions", () => {
  assert.equal(monthDays("2024-02").length, 29);
  assert.equal(monthDays("2025-02").length, 28);
  assert.equal(monthDays("2026-04").length, 30);
  assert.equal(monthDays("2026-12").length, 31);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.deepEqual(calendarCells("2024-02").slice(0, 4), [
    null,
    null,
    null,
    "2024-02-01",
  ]);
  assert.equal(calendarCells("2026-02").length % 7, 0);
  assert.equal(calendarCells("2026-06")[0], "2026-06-01");
  for (const month of [
    "2026-00",
    "2026-13",
    "2026-2",
    "26-02",
    "2026-02-01",
    "1999-12",
    "anything",
  ])
    assert.equal(validMonth(month), false);
});
test("empty days are filled and monthly words do not double count daily repeats", () => {
  const days = fillCalendarDays("2024-02", [
    {
      ...emptyPeriod(),
      day: "2024-02-28",
      words: 1,
      questions: 2,
      seconds: 30,
      newWords: 1,
    },
    {
      ...emptyPeriod(),
      day: "2024-02-29",
      words: 2,
      questions: 3,
      seconds: 90,
      newWords: 1,
      mastered: 1,
    },
  ]);
  assert.equal(days.length, 29);
  assert.equal(days[0].seconds, 0);
  const totals = calendarTotals(days, 2);
  assert.equal(totals.words, 2);
  assert.equal(totals.questions, 5);
  assert.equal(totals.seconds, 120);
  assert.equal(totals.studyDays, 2);
  assert.equal(totals.newWords, 2);
  assert.equal(totals.mastered, 1);
  assert.equal(
    calendarTotals([{ ...emptyPeriod(), day: "2024-02-01", seconds: 5 }], 0)
      .studyDays,
    1,
  );
});
test("calendar respects London dates near midnight and formats short study time accurately", () => {
  assert.equal(localDay(Date.parse("2026-06-30T23:15:00Z")), "2026-07-01");
  assert.equal(localDay(Date.parse("2026-12-31T23:15:00Z")), "2026-12-31");
  assert.equal(calendarTime(0), "0s");
  assert.equal(calendarTime(59), "59s");
  assert.equal(calendarTime(60), "1m");
  assert.equal(calendarTime(90), "1m 30s");
  assert.equal(calendarTime(3600), "1h");
  assert.equal(calendarTime(3660), "1h 1m");
});
