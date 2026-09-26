import { parseCsv, type Word } from "./words.ts";
import type { QuestionType } from "./config.ts";
export type Problem = {
  id: string;
  wordId: string;
  type: QuestionType;
  prompt: string;
  choices: string[] | null;
  answer: string;
};
export const CHOICES_PER_PROBLEM = 4;
/** Shown where the missing word goes in a cloze sentence. */
export const CLOZE_BLANK = "______";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word test, so "art" does not match inside "start". */
export const hasWholeWord = (text: string, phrase: string) =>
  new RegExp(`(?:^|\\W)${escapeRegExp(phrase)}(?:$|\\W)`, "i").test(text);

/** Stable, seed-based ordering so the server and client always agree. */
function hash(value: string) {
  let n = 2166136261;
  for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}

/** Common inflections, so a cloze can blank "coveted" for the answer "covet". */
export function inflectionsOf(word: string): string[] {
  const out = new Set<string>([word]);
  const add = (value: string) => value.trim() && out.add(value.trim());
  if (/[^aeiou]y$/i.test(word)) {
    add(`${word.slice(0, -1)}ies`);
    add(`${word.slice(0, -1)}ied`);
  }
  if (/(s|x|z|ch|sh|o)$/i.test(word)) add(`${word}es`);
  else add(`${word}s`);
  add(`${word}ed`);
  add(`${word}ing`);
  if (/[^aeiou][aeiou][^aeiouwxy]$/i.test(word)) {
    add(`${word}${word.slice(-1)}ed`);
    add(`${word}${word.slice(-1)}ing`);
  }
  add(`${word}er`);
  add(`${word}est`);
  return [...out];
}

/**
 * Replaces the word, or an inflection of it, with a blank.
 * Returns null when the sentence never uses the word, so no question is invented.
 */
export function blankExample(
  example: string,
  word: string,
): string | null {
  for (const form of inflectionsOf(word)) {
    if (!hasWholeWord(example, form)) continue;
    return example.replace(
      new RegExp(`(?:^|\\W)${escapeRegExp(form)}(?=\\W|$)`, "i"),
      (match) => `${match.startsWith(" ") ? " " : ""}${CLOZE_BLANK}`,
    );
  }
  return null;
}

/**
 * Words that must never appear as a distractor for a given word: the word
 * itself, anything its relations point at, and the reverse of those links.
 * This is what keeps a synonym out of a cloze's options, where it would also
 * fit the blank. Built from a reverse index so it costs O(relations), not
 * O(words squared).
 */
export function relatedMap(words: Word[]): Map<string, Set<string>> {
  const terms = (value: string) =>
    value
      .split(";")
      .map((x) => x.normalize("NFKC").trim().toLowerCase())
      .filter((x) => x && !/^[—–-]$/.test(x));
  const related = new Map(
    words.map((word) => [
      word.id,
      new Set([word.id, ...terms(word.syn), ...terms(word.ant)]),
    ]),
  );
  // term -> words that name it, so a word can collect its reverse links
  // without scanning the whole bank.
  const reverse = new Map<string, string[]>();
  for (const [id, set] of related)
    for (const term of set) {
      if (term === id) continue;
      reverse.set(term, [...(reverse.get(term) ?? []), id]);
    }
  for (const set of related.values())
    for (const term of [...set])
      for (const other of reverse.get(term) ?? []) set.add(other);
  return related;
}

/** Significant words in a definition, used to find definitions worth comparing. */
const significantTerms = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_TERMS.has(w)),
  );
const STOP_TERMS = new Set(
  "a an and as at be because by for from in into is it of on or someone something that the to very with".split(
    " ",
  ),
);
/** Same 0.6 overlap rule as similarDefinitions, but over pre-tokenised sets. */
const overlapRatio = (x: Set<string>, y: Set<string>) =>
  x.size && y.size
    ? [...x].filter((term) => y.has(term)).length / Math.min(x.size, y.size) >= 0.6
    : false;

/**
 * Definitions can only read alike if they share a significant word, so the
 * overlap test is done on candidates as they are offered rather than across
 * every pair in the bank. The bank is over two thousand words, and a global
 * pass would cost far more than the handful of comparisons a question needs.
 */
export type DistractorContext = {
  related: Map<string, Set<string>>;
  /** Per word: ids that may never be offered as a distractor for it. */
  blocked: Map<string, Set<string>>;
  /** Bank order, fixed once, so a seeded walk is deterministic. */
  ordered: Word[];
  defTerms: Map<string, Set<string>>;
};

export function buildDistractorContext(words: Word[]): DistractorContext {
  const defTerms = new Map(
    words.map((w) => [w.id, significantTerms(w.definition)]),
  );
  const related = relatedMap(words);
  // Both new question types answer with the word itself, so the blocked set
  // depends only on the word and is built once rather than per question.
  // relatedMap already folds in reverse links, so a synonym of the answer is
  // in here whichever way round the relation was written.
  const blocked = new Map<string, Set<string>>();
  for (const word of words)
    blocked.set(word.id, new Set([word.id, ...(related.get(word.id) ?? [])]));
  return {
    related,
    blocked,
    defTerms,
    // Scattered once, deterministically, so that walking this order for a
    // question does not hand back three words that merely share a prefix.
    ordered: [...words].sort((a, b) => hash(`order:${a.id}`) - hash(`order:${b.id}`)),
  };
}

/**
 * Picks three wrong options deterministically, avoiding the answer, anything
 * related to it, and anything whose definition reads too much like the
 * answer's - which is what stops a second valid option being offered, and so
 * keeps a synonym of the answer out of a cloze's choices.
 *
 * Rather than sorting the whole pool for every question, the seed picks a
 * starting point in a fixed order and the first three eligible words are taken
 * from there. That is O(few) per question instead of O(bank log bank).
 */
export function pickDistractors(
  key: string,
  word: Word,
  answer: string,
  context: DistractorContext,
): string[] {
  const answerWord = context.ordered.find(
    (w) => w.id === answer.toLowerCase(),
  );
  const answerTerms = answerWord
    ? context.defTerms.get(answerWord.id)!
    : new Set<string>();
  const mine = context.defTerms.get(word.id)!;
  const answerText = answer.toLowerCase();
  const blocked = context.blocked.get(word.id) ?? new Set<string>();
  const termsOf = (other: Word) =>
    context.defTerms.get(other.id) ?? significantTerms(other.definition);

  const ordered = context.ordered;
  const start = hash(key) % ordered.length;
  const picked: string[] = [];
  for (let step = 0; step < ordered.length && picked.length < CHOICES_PER_PROBLEM - 1; step++) {
    const candidate = ordered[(start + step) % ordered.length];
    if (candidate.id === word.id || blocked.has(candidate.id)) continue;
    if (candidate.word.toLowerCase() === answerText) continue;
    if (overlapRatio(mine, termsOf(candidate))) continue;
    if (overlapRatio(answerTerms, termsOf(candidate))) continue;
    picked.push(candidate.word);
  }
  return picked;
}

export function parseProblemCsv(
  text: string,
  expectedType: "syn" | "ant",
  words: Word[],
): Problem[] {
  const [header, ...rows] = parseCsv(text);
  const required = ["problem", "options", "answer", "syn/ant", "word"];
  if (
    !header ||
    new Set(header).size !== header.length ||
    required.some((key) => !header.includes(key))
  )
    throw Error(`${expectedType}.csv has invalid headers.`);
  const wordIds = new Set(words.map((word) => word.id)),
    seen = new Set<string>();
  return rows.map((row, index) => {
    const cell = (name: string) => row[header.indexOf(name)];
    const wordId = cell("word")?.normalize("NFKC").toLowerCase();
    if (
      row.length !== header.length ||
      !wordIds.has(wordId) ||
      seen.has(wordId) ||
      cell("syn/ant") !== expectedType ||
      !cell("problem")
    )
      throw Error(
        `${expectedType}.csv: invalid/duplicate problem at record ${index + 2}.`,
      );
    let choices: unknown;
    try {
      choices = JSON.parse(cell("options"));
    } catch {
      throw Error(
        `${expectedType}.csv: options must be a JSON array at record ${index + 2}.`,
      );
    }
    const answer = cell("answer");
    if (
      !Array.isArray(choices) ||
      choices.length !== 4 ||
      choices.some((x) => typeof x !== "string" || !x.trim()) ||
      new Set(choices.map((x) => x.trim().toLowerCase())).size !== 4 ||
      choices.filter((x) => x === answer).length !== 1
    )
      throw Error(
        `${expectedType}.csv: four distinct options and exactly one matching answer required at record ${index + 2}.`,
      );
    seen.add(wordId);
    return {
      id: `${expectedType}:${wordId}`,
      wordId,
      type: expectedType,
      prompt: cell("problem"),
      choices: choices as string[],
      answer,
    };
  });
}

export function createProblemBank(
  words: Word[],
  syn: string,
  ant: string,
): Problem[] {
  const context = buildDistractorContext(words);
  const byId = new Map(words.map((w) => [w.id, w]));
  const multiple = (type: QuestionType, key: string, prompt: string, answer: string) => {
    const word = byId.get(key.slice(key.indexOf(":") + 1))!;
    const distractors = pickDistractors(key, word, answer, context);
    if (distractors.length !== CHOICES_PER_PROBLEM - 1) return null;
    const choices = [...distractors];
    choices.splice(hash(key) % CHOICES_PER_PROBLEM, 0, answer);
    if (new Set(choices.map((c) => c.toLowerCase())).size !== CHOICES_PER_PROBLEM)
      return null;
    return { id: key, wordId: word.id, type, prompt, choices, answer };
  };
  // "word": the definition is the question, so the answer word is never shown.
  const wordProblems = words
    .filter((word) => !hasWholeWord(word.definition, word.word))
    .map((word) =>
      multiple("word", `word:${word.id}`, word.definition, word.word),
    );
  // "cloze": the example with the word blanked, so the sentence gives it away.
  const clozeProblems = words
    .map((word) => {
      const prompt = word.example ? blankExample(word.example, word.word) : null;
      return prompt
        ? multiple("cloze", `cloze:${word.id}`, prompt, word.word)
        : null;
    });
  return [
    ...words.map((word) => ({
      id: `def:${word.id}`,
      wordId: word.id,
      type: "def" as const,
      prompt: `Choose the definition for '${word.word}'.`,
      choices: null,
      answer: word.definition,
    })),
    ...parseProblemCsv(syn, "syn", words),
    ...parseProblemCsv(ant, "ant", words),
    ...wordProblems.filter((p) => p !== null),
    ...clozeProblems.filter((p) => p !== null),
  ];
}
