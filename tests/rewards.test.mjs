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
  const redeem = db.prepare(
    "INSERT OR IGNORE INTO badge_redemptions(id,user_id,request_key,badge_id,badge_name,cost,created_at) VALUES(?,'u',?,'spark','Vocabulary Spark',20,1)",
  );
  redeem.run("r1", "key");
  assert.equal(wallet(db).balance, 2);
  redeem.run("r2", "key");
  assert.equal(wallet(db).balance, 2);
  assert.throws(() => redeem.run("r3", "different"), /INSUFFICIENT_CREDITS/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM badge_redemptions").get().count,
    1,
  );
  assert.equal(
    db.prepare("SELECT SUM(amount) AS balance FROM credit_transactions").get()
      .balance,
    2,
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
  assert.equal(studyDuration(8), "8 sec");
  assert.equal(studyDuration(68), "1 min 8 sec");
});
