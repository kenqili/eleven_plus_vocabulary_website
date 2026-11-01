import { shuffle } from "./words.ts";

/**
 * The relation challenge: pick the synonyms (or the antonyms) of a word.
 *
 * The rules are here rather than in the request handler for the same reason the
 * mastery rules are: the page that shows the question and the endpoint that
 * records the answer have to agree about what counts as right, and the only way
 * to guarantee that is for both to call one function.
 *
 * A question is six options: up to three real relations of the word, and three
 * words that are relations of something else. The wrong options come from the
 * relation lists rather than from the headwords, because a list of random
 * dictionary words gives the answer away by register - a verb surrounded by
 * three nouns is not a question - and because a word met as somebody else's
 * synonym is exactly the vocabulary this game is for.
 */

export const RELATION_KINDS = ["syn", "ant"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/**
 * Every game that writes a row to `game_matches`.
 *
 * `mix` is the mixed-practice game: ten questions of every practice type rather
 * than a relation pick. It shares the match history and the correctness write,
 * so it belongs in the same list even though its questions are built elsewhere.
 */
export const GAME_KINDS = [...RELATION_KINDS, "mix"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

/** Questions in one match. A sitting, not a test. */
export const QUESTIONS_PER_MATCH = 10;
/** Correct options per question. */
export const ANSWERS_PER_QUESTION = 3;
/** Wrong options per question. */
export const DISTRACTORS_PER_QUESTION = 3;

/** The part of a bank word this game needs. `Word` satisfies it. */
export type RelationWord = {
  id: string;
  word: string;
  definition: string;
  example: string;
  syn: string;
  ant: string;
  help?: string;
};

/** One finished match, as the history panel shows it. */
export type RelationMatch = {
  id: string;
  kind: GameKind;
  score: number;
  questions: number;
  seconds: number;
  createdAt: number;
};

/** What one word was worth at the end of a match. */
export type RelationResult = {
  wordId: string;
  word: string;
  correct: boolean;
};

/** The answer to a finished match. */
export type RelationFinish = {
  score: number;
  questions: number;
  seconds: number;
  /** Words that gained one correctness. */
  awarded: number;
  results: RelationResult[];
  history: RelationMatch[];
  duplicate?: boolean;
};

export type RelationQuestion = {
  wordId: string;
  word: string;
  /** The plain-language meaning shown when the answer is revealed. */
  definition: string;
  example: string;
  synonyms: string[];
  antonyms: string[];
  /** The options that are right, as the bank records them. */
  answers: string[];
  /** Every option, in the order shown. */
  options: string[];
  /**
   * The plain-language meaning of each option the bank has as a headword.
   * Options are relations of other words, so not every one of them is a
   * headword; the ones that are not simply have no entry here.
   */
  optionDefinitions: Record<string, string>;
  /** How many of the options the child must pick. */
  selectCount: number;
};

/**
 * A relation list as a list of words.
 *
 * The CSVs use `;` and use an em dash or a hyphen for "none", and a few words
 * repeat a relation. Duplicates would show up twice in the options and make an
 * exact-set answer impossible to give, so they are dropped here.
 */
export function splitRelations(value: string): string[] {
  const seen = new Set<string>();
  const relations: string[] = [];
  for (const part of (value ?? "").split(";")) {
    const text = part.trim();
    if (!text || text === "—" || text === "-") continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push(text);
  }
  return relations;
}

/** Every relation of one kind, with the word itself removed. */
export function relationList(
  word: RelationWord,
  kind: RelationKind,
): string[] {
  const own = word.word.trim().toLowerCase();
  return splitRelations(kind === "syn" ? word.syn : word.ant).filter(
    (relation) => relation.toLowerCase() !== own,
  );
}

/** The relations a question asks for: the first three, or fewer if that is all. */
export function relationAnswers(
  word: RelationWord,
  kind: RelationKind,
  limit = ANSWERS_PER_QUESTION,
): string[] {
  return relationList(word, kind).slice(0, limit);
}

/**
 * Whether the child picked exactly the right set.
 *
 * Order is irrelevant and so is case, but nothing else is: a selection that
 * misses one synonym or includes one distractor is wrong. Partial credit would
 * teach the child that a half-known word is enough, which is the habit the
 * question exists to break.
 */
export function gradeSelection(
  selected: readonly string[],
  answers: readonly string[],
): boolean {
  const chosen = new Set(
    selected.map((word) => word.trim().toLowerCase()).filter(Boolean),
  );
  const right = new Set(
    answers.map((word) => word.trim().toLowerCase()).filter(Boolean),
  );
  if (chosen.size !== right.size) return false;
  for (const word of chosen) if (!right.has(word)) return false;
  return true;
}

/**
 * Build one match's questions.
 *
 * `targets` are the words that may be asked (already filtered to what the
 * account is allowed to see); `vocabulary` is the whole bank, used only to find
 * wrong options. A distractor is excluded when it appears anywhere in the
 * target's own relation lists, and also when it sits in a list that names one
 * of the answers or the target itself: if `pleased` sits beside `glad` in some
 * other word's entry, then it is close enough to `glad` that offering it would
 * mark a right answer wrong. That check is the difference between a fair
 * question and an argument.
 */
export function buildQuestions(input: {
  kind: RelationKind;
  targets: readonly RelationWord[];
  vocabulary: readonly RelationWord[];
  count?: number;
  random?: () => number;
}): RelationQuestion[] {
  const {
    kind,
    targets,
    vocabulary,
    count = QUESTIONS_PER_MATCH,
    random = Math.random,
  } = input;

  // Every relation in the bank, once, in the spelling it is first met.
  const pool = new Map<string, string>();
  for (const word of vocabulary) {
    for (const relation of [
      ...splitRelations(word.syn),
      ...splitRelations(word.ant),
    ]) {
      const key = relation.toLowerCase();
      if (!pool.has(key)) pool.set(key, relation);
    }
  }

  // The options are relations rather than headwords, so this is a lookup by
  // headword with the misses left out. It is what lets a wrong pick be
  // explained instead of only marked.
  const definitionByHeadword = new Map<string, string>();
  for (const word of vocabulary) {
    const meaning = (word.help || word.definition || "").trim();
    if (meaning)
      definitionByHeadword.set(word.word.trim().toLowerCase(), meaning);
  }

  const questions: RelationQuestion[] = [];
  for (const target of shuffle([...targets], random)) {
    if (questions.length >= count) break;
    const answers = relationAnswers(target, kind);
    if (!answers.length) continue;

    const answerKeys = new Set(
      answers.map((answer) => answer.toLowerCase()),
    );
    const targetKey = target.word.trim().toLowerCase();
    const banned = new Set<string>([
      targetKey,
      ...splitRelations(target.syn).map((word) => word.toLowerCase()),
      ...splitRelations(target.ant).map((word) => word.toLowerCase()),
      ...answerKeys,
    ]);
    for (const word of vocabulary) {
      // The headword belongs in the set: an entry for `glad` with
      // `pleased; happy` in its list is exactly the evidence that `pleased`
      // and `glad` are close, and `glad` is one of the answers.
      //
      // The target itself is a trigger as well as the answers. An entry whose
      // list names `happy` is a statement that its other words are close to
      // `happy`, even when the target's own list never recorded them, and a
      // word that close is not a wrong option.
      const relations = [
        word.word,
        ...splitRelations(word.syn),
        ...splitRelations(word.ant),
      ];
      if (
        relations.some((relation) => {
          const key = relation.toLowerCase();
          return key === targetKey || answerKeys.has(key);
        })
      )
        for (const relation of relations)
          banned.add(relation.toLowerCase());
    }

    const candidates: string[] = [];
    for (const [key, relation] of pool) {
      if (banned.has(key)) continue;
      candidates.push(relation);
    }
    const distractors = shuffle(candidates, random).slice(
      0,
      DISTRACTORS_PER_QUESTION,
    );
    if (!distractors.length) continue;

    const options = shuffle([...answers, ...distractors], random);
    questions.push({
      wordId: target.id,
      word: target.word,
      definition: (target.help || target.definition).trim(),
      example: target.example.trim(),
      synonyms: splitRelations(target.syn),
      antonyms: splitRelations(target.ant),
      answers,
      options,
      optionDefinitions: Object.fromEntries(
        options
          .map((option) => [
            option,
            definitionByHeadword.get(option.trim().toLowerCase()),
          ])
          .filter((entry): entry is [string, string] => Boolean(entry[1])),
      ),
      selectCount: answers.length,
    });
  }
  return questions;
}

/** The label a child reads for a relation, singular and plural. */
export const relationLabel = (kind: RelationKind, count = 1) =>
  kind === "syn"
    ? count === 1
      ? "synonym"
      : "synonyms"
    : count === 1
      ? "antonym"
      : "antonyms";
