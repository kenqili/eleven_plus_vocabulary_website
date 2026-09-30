import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  localDay,
  weekStart,
  dayStart,
  studyDuration,
} from "../lib/challenge/rewards.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`drizzle/${file}`, "utf8"));
  db.prepare(
    "INSERT INTO users(id,email,password,created_at) VALUES('u','test@example.test','not-a-password',0)",
  ).run();
  return db;
}
function answer(
  db,
  id,
  {
    correct = 1,
    revealed = 0,
    eligible = 1,
    mastered = 0,
    word = id,
    day = "2026-09-20",
  } = {},
) {
  db.prepare(
    "INSERT OR IGNORE INTO attempts(id,user_id,word_id,choices,created_at,answered_at,selected,is_correct) VALUES(?,'u',?,'[]',0,1,?,?)",
  ).run(id, word, revealed ? -1 : 0, correct);
  db.prepare(
    "INSERT OR IGNORE INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered) VALUES(?,'u',?,1,?,?,?,?,?)",
  ).run(id, word, day, correct, revealed, eligible, mastered);
}
const wallet = (db) =>
  db.prepare("SELECT * FROM credit_wallets WHERE user_id='u'").get();

test("three correct earn 11, six earn 22, replay is harmless, mastery stacks", () => {
  const db = database();
  for (let i = 1; i <= 3; i++) answer(db, String(i));
  assert.equal(wallet(db).balance, 11);
  answer(db, "3");
  assert.equal(wallet(db).balance, 11);
  assert.equal(wallet(db).streak, 3);
  for (let i = 4; i <= 6; i++) answer(db, String(i));
  assert.equal(wallet(db).balance, 22);
  answer(db, "7");
  answer(db, "8");
  answer(db, "9", { mastered: 1 });
  const event = db
    .prepare("SELECT * FROM learning_events WHERE attempt_id='9'")
    .get();
  assert.equal(
    event.base_credits + event.streak_credits + event.mastery_credits,
    17,
  );
  assert.equal(wallet(db).balance, 43);
  db.close();
});
test("wrong and reveal reset only the streak; ineligible correct cannot farm credits", () => {
  const db = database();
  answer(db, "1");
  answer(db, "2");
  answer(db, "3", { correct: 0, eligible: 0 });
  assert.equal(wallet(db).streak, 0);
  assert.equal(wallet(db).balance, 4);
  answer(db, "4");
  answer(db, "5", { correct: 0, revealed: 1, eligible: 0 });
  assert.equal(wallet(db).streak, 0);
  assert.equal(wallet(db).balance, 6);
  answer(db, "6", { eligible: 0 });
  assert.equal(wallet(db).balance, 6);
  assert.equal(wallet(db).streak, 0);
  assert.equal(wallet(db).best_streak, 2);
  db.close();
});
test("daily counters distinguish exposure, repeat practice, reveals and mastery", () => {
  const db = database();
  answer(db, "1", { word: "hello", day: "2026-09-19" });
  answer(db, "2", { word: "hello" });
  answer(db, "3", { word: "world", correct: 0, revealed: 1, eligible: 0 });
  answer(db, "4", { word: "hello", mastered: 1 });
  const day = db
    .prepare("SELECT * FROM daily_stats WHERE user_id='u' AND day='2026-09-20'")
    .get();
  assert.equal(day.questions, 3);
  assert.equal(day.correct, 2);
  assert.equal(day.reveals, 1);
  assert.equal(day.new_words, 1);
  assert.equal(day.mastered, 1);
  db.close();
});
test("badge debit and receipt are atomic; duplicate request and insufficient funds cannot double-spend", () => {
  const db = database();
  for (let i = 0; i < 6; i++) answer(db, String(i));

  // The three statements redeem() runs, in the same order, in one transaction.
  // They used to be a BEFORE INSERT and an AFTER INSERT trigger; the rule now
  // lives in the application, so it is asserted here rather than assumed.
  //
  // The id is derived from the request key. That is the part that matters: the
  // first version of this guarded the balance but not the key, so a retry
  // debited twice while the receipt insert was quietly ignored.
  const redeem = (requestKey, cost = 20) => {
    const id = `r:${requestKey}`;
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT OR IGNORE INTO credit_transactions(id,user_id,amount,reason,reference,balance_after,created_at)
         SELECT ?,?,-?,'badge',?,balance-?,1 FROM credit_wallets WHERE user_id='u' AND balance>=?`,
      ).run(id, "u", cost, id, cost, cost);
      db.prepare(
        `INSERT OR IGNORE INTO badge_redemptions(id,user_id,request_key,badge_id,badge_name,cost,created_at)
         SELECT ?,'u',?,'spark','Vocabulary Spark',?,1 WHERE EXISTS(SELECT 1 FROM credit_transactions WHERE id=?)`,
      ).run(id, requestKey, cost, id);
      // The guard is a comparison, not an EXISTS: the ledger row records the
      // balance the purse should hold after the debit, so the debit fires only
      // while the purse still matches. An EXISTS would also be true on every
      // replay, and a retry would debit twice.
      db.prepare(
        `UPDATE credit_wallets SET balance=balance-?
         WHERE user_id='u' AND EXISTS(
           SELECT 1 FROM credit_transactions WHERE id=? AND balance_after=credit_wallets.balance-?
         )`,
      ).run(cost, id, cost);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return db
      .prepare(
        "SELECT id FROM badge_redemptions WHERE user_id='u' AND request_key=?",
      )
      .get(requestKey);
  };

  assert.ok(redeem("key"), "an affordable redemption writes a receipt");
  assert.equal(wallet(db).balance, 2);
  // The same request key again: must not move the balance a second time.
  redeem("key");
  assert.equal(
    wallet(db).balance,
    2,
    "a retried request must not double-spend",
  );
  // Insufficient funds: the balance is 2 and the badge costs 20.
  assert.equal(
    redeem("different"),
    undefined,
    "an unaffordable redemption writes no receipt",
  );
  assert.equal(
    wallet(db).balance,
    2,
    "an unaffordable redemption must not debit",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM badge_redemptions").get().count,
    1,
    "only the affordable request leaves a receipt",
  );
  assert.equal(
    db.prepare("SELECT SUM(amount) AS balance FROM credit_transactions").get()
      .balance,
    2,
    "the ledger must agree with the purse",
  );
  db.prepare("DELETE FROM users WHERE id='u'").run();
  for (const table of [
    "credit_wallets",
    "credit_transactions",
    "learning_events",
    "badge_redemptions",
    "daily_stats",
  ])
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      0,
    );
  db.close();
});
test("study checkpoints split midnight and do not duplicate on replay", () => {
  const db = database();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO study_ticks(id,user_id,created_at,seconds,day,previous_day,since_midnight) VALUES('tick','u',1,15,'2026-09-20','2026-09-19',5)",
  );
  insert.run();
  insert.run();
  assert.equal(
    db.prepare("SELECT seconds FROM daily_stats WHERE day='2026-09-20'").get()
      .seconds,
    5,
  );
  assert.equal(
    db.prepare("SELECT seconds FROM daily_stats WHERE day='2026-09-19'").get()
      .seconds,
    10,
  );
  db.close();
});
test("London calendar uses local midnight, Monday weeks and DST boundaries", () => {
  assert.equal(localDay(Date.parse("2026-09-19T23:30:00Z")), "2026-09-20");
  assert.equal(weekStart("2026-09-20"), "2026-09-14");
  assert.equal(weekStart("2026-09-21"), "2026-09-21");
  assert.equal(
    new Date(dayStart(Date.parse("2026-03-29T20:00:00Z"))).toISOString(),
    "2026-03-29T00:00:00.000Z",
  );
  assert.equal(
    new Date(dayStart(Date.parse("2026-10-25T20:00:00Z"))).toISOString(),
    "2026-10-24T23:00:00.000Z",
  );
  // Seconds are not a unit a child thinks in, and "0 sec" under a heading
  // called learning time reads as a score of zero.
  assert.equal(studyDuration(0), "under a minute");
  assert.equal(studyDuration(8), "under a minute");
  assert.equal(studyDuration(59), "under a minute");
  assert.equal(studyDuration(68), "1 min");
  assert.equal(studyDuration(605), "10 min");
  assert.equal(studyDuration(3 * 3600 + 12 * 60), "3 hr 12 min");
  // Never a negative or a NaN, whatever the clock hands it.
  assert.equal(studyDuration(-5), "under a minute");
});
