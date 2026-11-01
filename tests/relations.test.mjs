/**
 * The relation challenge's rules, against the real bank and against small
 * vocabularies built to contain the traps.
 *
 * The question this suite exists to answer is not "does it build ten questions"
 * but "can a child ever be marked wrong for a right answer". That is why the
 * tests below spend most of their length on the wrong options: the distractors
 * have to be unrelated enough to be clearly wrong, and the answer set has to be
 * exactly what the endpoint will recompute at the end of the match.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  ANSWERS_PER_QUESTION,
  DISTRACTORS_PER_QUESTION,
  QUESTIONS_PER_MATCH,
  buildQuestions,
  gradeSelection,
  relationAnswers,
  relationLabel,
  relationList,
  splitRelations,
} from "../lib/challenge/relations.ts";
import { GAMES } from "../lib/games.ts";

const bank = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));
/** The bank rows in the shape the game takes, in the bank's own order. */
const words = bank.words.map((row) => ({
  id: row[0],
  word: row[1],
  definition: row[2],
  example: row[3],
  syn: row[4],
  ant: row[5],
  help: row[8],
}));

/** A repeatable random source, so a failing shuffle can be reproduced. */
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const normalise = (value) => value.trim().toLowerCase();

test("relation lists drop blanks, dashes and duplicates", () => {
  assert.deepEqual(splitRelations("desert; forsake ; leave; desert"), [
    "desert",
    "forsake",
    "leave",
  ]);
  assert.deepEqual(splitRelations("—"), []);
  assert.deepEqual(splitRelations("-"), []);
  assert.deepEqual(splitRelations(""), []);
});

test("the answers are at most three, and never the word itself", () => {
  assert.deepEqual(
    relationAnswers({ word: "abandon", syn: "abandon; desert; forsake; leave; quit", ant: "" }, "syn"),
    ["desert", "forsake", "leave"],
  );
  assert.equal(ANSWERS_PER_QUESTION, 3);
  assert.deepEqual(relationList({ word: "abandon", syn: "desert", ant: "retain" }, "ant"), ["retain"]);
});

test("a selection is right only when it is exactly the answer set", () => {
  const answers = ["desert", "forsake", "leave"];
  assert.ok(gradeSelection(["leave", "Desert", "forsake"], answers));
  assert.ok(gradeSelection([], []));
  assert.ok(!gradeSelection(["desert", "forsake"], answers), "a missing answer is wrong");
  assert.ok(
    !gradeSelection(["desert", "forsake", "leave", "retain"], answers),
    "an extra word is wrong",
  );
  assert.ok(
    !gradeSelection(["desert", "forsake", "keep"], answers),
    "a wrong word in place of a right one is wrong",
  );
});

test("every question the real bank builds is fair and gradeable", () => {
  for (const kind of ["syn", "ant"]) {
    const targets = words.filter((word) => relationAnswers(word, kind).length);
    const questions = buildQuestions({
      kind,
      targets,
      vocabulary: words,
      random: seeded(7),
    });
    assert.equal(questions.length, QUESTIONS_PER_MATCH, `${kind}: not a full match`);
    assert.equal(
      new Set(questions.map((question) => question.wordId)).size,
      questions.length,
      `${kind}: the same word was asked twice`,
    );
    for (const question of questions) {
      const word = words.find((entry) => entry.id === question.wordId);
      assert.ok(word, `${kind}: ${question.wordId} is not a bank word`);
      assert.equal(question.selectCount, question.answers.length);
      assert.ok(
        question.selectCount >= 1 && question.selectCount <= ANSWERS_PER_QUESTION,
        `${kind}: ${question.word} asks for ${question.selectCount} answers`,
      );
      assert.deepEqual(
        question.answers,
        relationAnswers(word, kind),
        `${kind}: ${question.word} would be graded against a different list`,
      );
      assert.equal(
        question.options.length,
        question.selectCount + DISTRACTORS_PER_QUESTION,
        `${kind}: ${question.word} does not have three wrong options`,
      );
      assert.equal(
        new Set(question.options.map(normalise)).size,
        question.options.length,
        `${kind}: ${question.word} repeats an option`,
      );
      for (const answer of question.answers)
        assert.ok(
          question.options.map(normalise).includes(normalise(answer)),
          `${kind}: ${question.word} does not offer ${answer}`,
        );
      for (const [option, meaning] of Object.entries(
        question.optionDefinitions,
      )) {
        assert.ok(
          question.options.includes(option),
          `${kind}: ${question.word} defines ${option}, which is not an option`,
        );
        assert.ok(meaning.trim(), `${kind}: ${option} has an empty meaning`);
      }
      const own = new Set(
        [...splitRelations(word.syn), ...splitRelations(word.ant)].map(normalise),
      );
      own.add(normalise(word.word));
      for (const option of question.options) {
        if (question.answers.map(normalise).includes(normalise(option))) continue;
        assert.ok(
          !own.has(normalise(option)),
          `${kind}: ${question.word} offers ${option}, which is one of its own relations`,
        );
      }
    }
  }
});

test("a word with fewer than three relations asks for the number it has", () => {
  const vocabulary = [
    { id: "a", word: "alone", definition: "by oneself", example: "", syn: "solitary", ant: "together" },
    { id: "b", word: "brave", definition: "not afraid", example: "", syn: "courageous", ant: "afraid" },
    { id: "c", word: "calm", definition: "not excited", example: "", syn: "peaceful", ant: "agitated" },
    { id: "d", word: "dull", definition: "not bright", example: "", syn: "boring", ant: "bright" },
  ];
  const [question] = buildQuestions({
    kind: "syn",
    targets: [vocabulary[0]],
    vocabulary,
    count: 1,
    random: seeded(3),
  });
  assert.equal(question.selectCount, 1);
  assert.deepEqual(question.answers, ["solitary"]);
  assert.equal(question.options.length, 1 + DISTRACTORS_PER_QUESTION);
  assert.ok(!question.options.map(normalise).includes("together"), "the antonym was offered");
});

test("a word another entry names as a synonym of the target is not offered", () => {
  // The target's own list is incomplete - it does not say `glad`. The entry
  // for `glad` says `happy`, which is just as good evidence that the two are
  // close, so `glad` must not be offered as a wrong option.
  const vocabulary = [
    { id: "a", word: "happy", definition: "feeling good", example: "", syn: "cheerful; content", ant: "sad" },
    { id: "b", word: "glad", definition: "pleased", example: "", syn: "happy; pleased", ant: "sad" },
    { id: "c", word: "brave", definition: "not afraid", example: "", syn: "courageous", ant: "afraid" },
    { id: "d", word: "calm", definition: "not excited", example: "", syn: "peaceful", ant: "agitated" },
    { id: "e", word: "dull", definition: "not bright", example: "", syn: "boring", ant: "bright" },
    { id: "f", word: "eager", definition: "wanting to do something", example: "", syn: "keen", ant: "reluctant" },
  ];
  const [question] = buildQuestions({
    kind: "syn",
    targets: [vocabulary[0]],
    vocabulary,
    count: 1,
    random: seeded(11),
  });
  assert.ok(
    !question.options.map(normalise).includes("glad"),
    "a synonym recorded only in the other word's entry was offered",
  );
});

test("a word that shares a relation list with an answer is not offered", () => {
  // `pleased` sits beside `glad` in another word's entry, so it is close enough
  // to `glad` that offering it would mark a right answer wrong.
  const vocabulary = [
    { id: "a", word: "happy", definition: "feeling good", example: "", syn: "glad; cheerful; content", ant: "sad" },
    { id: "b", word: "glad", definition: "pleased", example: "", syn: "pleased; happy", ant: "sad" },
    { id: "c", word: "brave", definition: "not afraid", example: "", syn: "courageous", ant: "afraid" },
    { id: "d", word: "calm", definition: "not excited", example: "", syn: "peaceful", ant: "agitated" },
    { id: "e", word: "dull", definition: "not bright", example: "", syn: "boring", ant: "bright" },
    { id: "f", word: "eager", definition: "wanting to do something", example: "", syn: "keen", ant: "reluctant" },
  ];
  const [question] = buildQuestions({
    kind: "syn",
    targets: [vocabulary[0]],
    vocabulary,
    count: 1,
    random: seeded(5),
  });
  assert.ok(
    !question.options.map(normalise).includes("pleased"),
    "a near-synonym of an answer was offered as a distractor",
  );
});

test("a word with no relation of the kind asked is never a question", () => {
  const vocabulary = [
    { id: "a", word: "lonely", definition: "alone", example: "", syn: "", ant: "" },
    { id: "b", word: "brave", definition: "not afraid", example: "", syn: "courageous", ant: "afraid" },
  ];
  assert.deepEqual(
    buildQuestions({
      kind: "syn",
      targets: [vocabulary[0]],
      vocabulary,
      count: 1,
      random: seeded(1),
    }),
    [],
  );
});

test("an option that is a headword carries its meaning", () => {
  const vocabulary = [
    {
      id: "a",
      word: "happy",
      definition: "feeling good",
      example: "",
      syn: "glad; cheerful",
      ant: "sad",
      help: "Feeling pleased about something.",
    },
    {
      id: "b",
      word: "glad",
      definition: "pleased",
      example: "",
      syn: "happy",
      ant: "sad",
      help: "Pleased about something that happened.",
    },
    {
      id: "c",
      word: "brave",
      definition: "not afraid",
      example: "",
      syn: "courageous",
      ant: "afraid",
      help: "Not frightened.",
    },
    {
      id: "d",
      word: "calm",
      definition: "not excited",
      example: "",
      syn: "peaceful",
      ant: "agitated",
      help: "Quiet and steady.",
    },
    {
      id: "e",
      word: "dull",
      definition: "not bright",
      example: "",
      syn: "boring",
      ant: "bright",
      help: "Not interesting.",
    },
  ];
  const [question] = buildQuestions({
    kind: "syn",
    targets: [vocabulary[0]],
    vocabulary,
    count: 1,
    random: seeded(7),
  });
  assert.ok(
    question.optionDefinitions.glad,
    "the answer `glad` is a headword but has no meaning",
  );
  for (const [option, meaning] of Object.entries(
    question.optionDefinitions,
  )) {
    assert.ok(question.options.includes(option));
    assert.equal(
      meaning,
      vocabulary.find((entry) => entry.word === option)?.help,
      `${option} is explained with another word's meaning`,
    );
  }
});

test("the labels a child reads are singular and plural", () => {
  assert.equal(relationLabel("syn", 1), "synonym");
  assert.equal(relationLabel("syn", 2), "synonyms");
  assert.equal(relationLabel("ant", 1), "antonym");
  assert.equal(relationLabel("ant", 3), "antonyms");
});

test("every game in the navigation has a page, and the header points at the section", () => {
  for (const game of GAMES)
    assert.ok(
      existsSync(`app${game.href}/page.tsx`),
      `${game.label} is in the navigation but app${game.href}/page.tsx does not exist`,
    );
  assert.ok(existsSync("app/games/page.tsx"), "the games index is missing");
  const header = readFileSync("components/minewords/header.tsx", "utf8");
  assert.match(header, /href: "\/games"/, "the header has no Games link");
  assert.doesNotMatch(
    header,
    /href: "\/five-letters"/,
    "the header still points at the old Five Letters address",
  );
  assert.match(
    readFileSync("app/five-letters/page.tsx", "utf8"),
    /permanentRedirect\("\/games\/five-letters"\)/,
    "the old Five Letters address no longer redirects",
  );
});
