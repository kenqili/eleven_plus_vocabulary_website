#!/usr/bin/env node
/**
 * Build the Five Letters word list and dictionary.
 *
 * The game needs two different things, and they are generated from different
 * sources:
 *
 *   accepted.json   the words a child may guess. It is the 2,315-word common
 *                   Wordle answer list plus the eight five-letter bank words
 *                   that list does not contain.
 *   dictionary.json one card for every accepted word. The 194 five-letter bank
 *                   words copy their curated card; every other word takes its
 *                   first useful WordNet 3.0 sense, with a small manual
 *                   supplement for words WordNet does not define (inflected
 *                   forms, function words and modern coinages).
 *
 * The normal check (`--check`, also `npm run words:five:check`) needs no
 * WordNet install: it validates the committed files, including the public copy
 * the browser fetches. Regenerating (`--write`) needs a WordNet 3.0 dictionary
 * directory:
 *
 *   WORDNET_DIR=/path/to/WordNet-3.0/dict \
 *     node scripts/build-five-letters-dictionary.mjs --write
 *
 * WordNet is free for commercial use with its copyright notice; see
 * THIRD_PARTY_NOTICES.md. The generated files are committed, so a deploy never
 * downloads a dictionary and the Worker never calls a third party.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data/five-letters");
const acceptedPath = path.join(dataDir, "accepted.json");
const dictionaryPath = path.join(dataDir, "dictionary.json");
const manualPath = path.join(dataDir, "manual-glosses.json");
const commonPath = path.join(dataDir, "common-answers.txt");
const blocklistPath = path.join(dataDir, "blocklist.txt");
const publicPath = path.join(root, "public/five-letters/dictionary.json");
const bankPath = path.join(root, "data/problem-bank.json");

const WORD_LENGTH = 5;
const EXPECTED_ACCEPTED = 2323;
const EXPECTED_ANSWERS = 194;

const writing = process.argv.includes("--write");
const checking = process.argv.includes("--check") || !writing;

const fail = (message) => {
  console.error(`five-letters: ${message}`);
  process.exit(1);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const words = (text) =>
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);

function readBlocklist() {
  if (!fs.existsSync(blocklistPath)) return new Set();
  return new Set(
    words(fs.readFileSync(blocklistPath, "utf8")).filter(
      (word) => !word.startsWith("#"),
    ),
  );
}

/** The bank's curated rows, keyed by the word a child sees. */
function bankRows() {
  const bank = readJson(bankPath);
  const rows = new Map();
  for (const row of bank.words) {
    const [, word, definition, example, syn, ant, , source, help] = row;
    const id = String(word).toLowerCase();
    rows.set(id, {
      id,
      word,
      definition,
      example: example || "",
      syn: syn || "",
      ant: ant || "",
      source,
      help: help || "",
    });
  }
  return rows;
}

function splitRelations(value) {
  return String(value || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && part !== "—" && part !== "-");
}

function bankCard(row) {
  return {
    definition: (row.help || row.definition).trim(),
    example: row.example.trim(),
    synonyms: splitRelations(row.syn),
    antonyms: splitRelations(row.ant),
    source: "MineWords",
  };
}

function sourceAccepted(bank) {
  if (!fs.existsSync(commonPath))
    fail(`missing ${path.relative(root, commonPath)}`);
  const common = words(fs.readFileSync(commonPath, "utf8"));
  if (common.length !== 2315)
    fail(
      `common-answers.txt has ${common.length} words, expected 2,315; the source list changed`,
    );
  if (new Set(common).size !== common.length)
    fail("common-answers.txt contains a duplicate");
  for (const word of common)
    if (!new RegExp(`^[a-z]{${WORD_LENGTH}}$`).test(word))
      fail(`common-answers.txt contains a non-five-letter word: ${word}`);

  const answers = [...bank.values()]
    .filter((row) => row.word.length === WORD_LENGTH)
    .map((row) => row.word.toLowerCase());
  const accepted = [...new Set([...common, ...answers])].sort();
  return { accepted, answers: answers.sort() };
}

function validate(bank, accepted, answers, dictionary) {
  const blocklist = readBlocklist();
  const set = new Set(accepted);
  const source = sourceAccepted(bank).accepted;
  if (accepted.length !== EXPECTED_ACCEPTED)
    fail(
      `accepted.json has ${accepted.length} words, expected ${EXPECTED_ACCEPTED}`,
    );
  if (set.size !== accepted.length) fail("accepted.json contains a duplicate");
  if (accepted.join("\n") !== source.join("\n"))
    fail("accepted.json does not match the common list plus the bank's five-letter words");
  if (answers.length !== EXPECTED_ANSWERS)
    fail(`the bank has ${answers.length} five-letter words, expected ${EXPECTED_ANSWERS}`);
  if (new Set(answers).size !== answers.length)
    fail("the bank's five-letter words are not distinct");
  for (const answer of answers)
    if (!set.has(answer)) fail(`answer "${answer}" is not an accepted guess`);
  for (const word of accepted) {
    if (!new RegExp(`^[a-z]{${WORD_LENGTH}}$`).test(word))
      fail(`accepted guess "${word}" is not five lower-case letters`);
    if (blocklist.has(word))
      fail(`blocklisted word is in the accepted list: ${word}`);
    const card = dictionary[word];
    if (!card) fail(`no dictionary card for "${word}"`);
    if (typeof card.definition !== "string" || !card.definition.trim())
      fail(`card for "${word}" has no definition`);
    if (!Array.isArray(card.synonyms) || !Array.isArray(card.antonyms))
      fail(`card for "${word}" has malformed synonyms/antonyms`);
    if (card.source !== "MineWords" && card.source !== "WordNet 3.0")
      fail(`card for "${word}" has an unknown source: ${card.source}`);
    if (typeof card.example !== "string")
      fail(`card for "${word}" has a malformed example`);
  }
  for (const key of Object.keys(dictionary))
    if (!set.has(key)) fail(`dictionary has an unaccepted word: ${key}`);
  if (Object.keys(dictionary).length !== accepted.length)
    fail("dictionary and accepted list differ in length");
  if (fs.existsSync(publicPath)) {
    const published = readJson(publicPath);
    if (JSON.stringify(published) !== JSON.stringify(dictionary))
      fail("public/five-letters/dictionary.json is stale; run --write");
  } else {
    fail("public/five-letters/dictionary.json is missing");
  }
}

// ---------------------------------------------------------------------------
// WordNet parsing
// ---------------------------------------------------------------------------

const POS_FILES = {
  n: "data.noun",
  v: "data.verb",
  a: "data.adj",
  s: "data.adj",
  r: "data.adv",
};
const POS_FROM_KEY = { 1: "n", 2: "v", 3: "a", 4: "r", 5: "s" };
const samePos = (a, b) =>
  a === b || ((a === "a" || a === "s") && (b === "a" || b === "s"));

function loadWordNet(dir) {
  if (!dir || !fs.existsSync(dir))
    fail(
      "set WORDNET_DIR to a WordNet 3.0 dict directory (e.g. WordNet-3.0/dict) to regenerate",
    );

  const synsets = new Map();
  for (const file of new Set(Object.values(POS_FILES))) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) fail(`missing WordNet file: ${full}`);
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      if (!line || line.startsWith("  ")) continue;
      const bar = line.indexOf("|");
      if (bar < 0) continue;
      const left = line.slice(0, bar).trim();
      const gloss = line.slice(bar + 1).trim();
      const parts = left.split(/\s+/);
      const offset = parts[0];
      const ssType = parts[2];
      const wordCount = parseInt(parts[3], 16);
      if (!Number.isFinite(wordCount)) continue;
      let at = 4;
      const lemmas = [];
      for (let i = 0; i < wordCount; i++) {
        lemmas.push(parts[at]);
        at += 2;
      }
      const pointerCount = parseInt(parts[at], 10);
      at += 1;
      const pointers = [];
      if (Number.isFinite(pointerCount))
        for (let i = 0; i < pointerCount; i++) {
          pointers.push({
            symbol: parts[at],
            offset: parts[at + 1],
            pos: parts[at + 2],
            sourceTarget: parts[at + 3],
          });
          at += 4;
        }
      const key = `${ssType}:${offset}`;
      if (!synsets.has(key))
        synsets.set(key, { pos: ssType, offset, lemmas, pointers, gloss });
    }
  }

  const senses = new Map();
  const indexSense = path.join(dir, "index.sense");
  if (!fs.existsSync(indexSense)) fail(`missing WordNet file: ${indexSense}`);
  for (const line of fs.readFileSync(indexSense, "utf8").split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const [senseKey, offset, senseNumber, tagCount] = line
      .trim()
      .split(/\s+/);
    const percent = senseKey.indexOf("%");
    if (percent < 0) continue;
    const lemma = senseKey.slice(0, percent).toLowerCase();
    const pos = POS_FROM_KEY[senseKey[percent + 1]];
    if (!pos) continue;
    // The accepted words are ordinary lower-case words. Proper nouns and
    // multi-word lemmas only add noise to a five-letter card.
    if (!/^[a-z]+$/.test(lemma)) continue;
    if (!senses.has(lemma)) senses.set(lemma, []);
    senses.get(lemma).push({
      key: senseKey,
      pos,
      offset,
      senseNumber: Number(senseNumber),
      tagCount: Number(tagCount),
      order: senses.get(lemma).length,
    });
  }

  const exceptions = new Map();
  for (const file of ["noun.exc", "verb.exc", "adj.exc", "adv.exc"]) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    const pos = file.startsWith("noun")
      ? "n"
      : file.startsWith("verb")
        ? "v"
        : file.startsWith("adj")
          ? "a"
          : "r";
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      const [inflected, base] = line.trim().split(/\s+/);
      if (!inflected || !base || exceptions.has(inflected)) continue;
      exceptions.set(inflected, { base, pos });
    }
  }

  return { synsets, senses, exceptions };
}

const cleanLemma = (lemma) => lemma.replace(/_/g, " ").trim();
const isProper = (lemma) => /^[A-Z]/.test(lemma.replace(/_/g, " "));

function synsetFor(synsets, pos, offset) {
  return (
    synsets.get(`${pos}:${offset}`) ||
    synsets.get(`${pos === "s" ? "a" : "s"}:${offset}`)
  );
}

function parseGloss(gloss) {
  const text = gloss.replace(/\s+/g, " ").trim();
  const quote = text.indexOf('"');
  let definition = quote >= 0 ? text.slice(0, quote) : text;
  definition = definition.replace(/[;,]\s*$/, "").trim();
  const examples = [];
  const source = quote >= 0 ? text.slice(quote) : "";
  for (const match of source.matchAll(/"([^"]+)"/g))
    examples.push(match[1].replace(/--/g, "—").trim());
  return { definition, example: examples[0] || "" };
}

function pickSense(synsets, senses, word, preferredPos) {
  let candidates = (senses.get(word) || []).filter((sense) =>
    synsetFor(synsets, sense.pos, sense.offset),
  );
  if (preferredPos) {
    const preferred = candidates.filter((sense) =>
      samePos(sense.pos, preferredPos),
    );
    if (preferred.length) candidates = preferred;
  }
  if (!candidates.length) return null;
  const tagged = candidates
    .filter((sense) => sense.tagCount >= 10)
    .sort((a, b) => b.tagCount - a.tagCount || a.order - b.order);
  return tagged[0] || candidates[0];
}

function synonymsAndAntonyms(synsets, sense, word) {
  const synset = synsetFor(synsets, sense.pos, sense.offset);
  if (!synset) return { synonyms: [], antonyms: [] };
  const synonyms = [];
  for (const lemma of synset.lemmas) {
    const clean = cleanLemma(lemma).toLowerCase();
    if (
      clean === word ||
      !/^[a-z][a-z '-]*$/.test(clean) ||
      isProper(lemma) ||
      clean.includes(" ")
    )
      continue;
    if (!synonyms.includes(clean)) synonyms.push(clean);
  }

  const wordIndex = synset.lemmas.findIndex(
    (lemma) => cleanLemma(lemma).toLowerCase() === word,
  );
  const antonyms = [];
  for (const pointer of synset.pointers) {
    if (pointer.symbol !== "!") continue;
    const sourceTarget = parseInt(pointer.sourceTarget || "0", 16);
    const sourceWord = (sourceTarget >> 8) & 0xff;
    const targetWord = sourceTarget & 0xff;
    // Word-level pointers name the lemma they apply to. When the source is
    // unknown (0000) or this word is the named source, accept it; otherwise
    // the pointer belongs to a different sense of another lemma.
    if (sourceWord && wordIndex >= 0 && sourceWord !== wordIndex + 1) continue;
    const target = synsetFor(synsets, pointer.pos, pointer.offset);
    if (!target) continue;
    const targetLemma =
      targetWord > 0 && target.lemmas[targetWord - 1]
        ? target.lemmas[targetWord - 1]
        : null;
    const lemmas = targetLemma ? [targetLemma] : target.lemmas;
    for (const lemma of lemmas) {
      const clean = cleanLemma(lemma).toLowerCase();
      if (
        clean === word ||
        !/^[a-z][a-z '-]*$/.test(clean) ||
        isProper(lemma) ||
        clean.includes(" ")
      )
        continue;
      if (!antonyms.includes(clean)) antonyms.push(clean);
    }
  }
  return { synonyms: synonyms.slice(0, 6), antonyms: antonyms.slice(0, 6) };
}

function wordNetCard(wordnet, word, preferredPos, depth = 0) {
  if (depth > 4) return null;
  const known = bank.get(word);
  if (known) return bankCard(known);
  const sense = pickSense(
    wordnet.synsets,
    wordnet.senses,
    word,
    preferredPos,
  );
  if (sense) {
    const synset = synsetFor(wordnet.synsets, sense.pos, sense.offset);
    if (synset) {
      const gloss = parseGloss(synset.gloss);
      if (gloss.definition) {
        const relations = synonymsAndAntonyms(wordnet.synsets, sense, word);
        return {
          definition: gloss.definition,
          example: gloss.example,
          ...relations,
          source: "WordNet 3.0",
        };
      }
    }
  }

  const exception = wordnet.exceptions.get(word);
  if (exception) {
    const base = wordNetCard(
      wordnet,
      exception.base,
      exception.pos,
      depth + 1,
    );
    if (base) return derived(word, exception.base, base, exception.pos);
  }

  const rules = [
    [/iest$/, (word) => word.slice(0, -4) + "y", "a"],
    [/ier$/, (word) => word.slice(0, -3) + "y", "a"],
    [/est$/, (word) => word.slice(0, -3), "a"],
    [/er$/, (word) => word.slice(0, -2), "a"],
    [/ing$/, (word) => word.slice(0, -3), "v"],
    [/ied$/, (word) => word.slice(0, -3) + "y", "v"],
    [/ed$/, (word) => word.slice(0, -2), "v"],
    [/ies$/, (word) => word.slice(0, -3) + "y", "n"],
    [/es$/, (word) => word.slice(0, -2), "n"],
    [/s$/, (word) => word.slice(0, -1), "n"],
  ];
  for (const [pattern, stem, pos] of rules) {
    if (!pattern.test(word)) continue;
    const candidates = [stem(word), `${stem(word)}e`];
    for (const candidate of candidates) {
      if (candidate === word || candidate.length < 3) continue;
      const base = wordNetCard(wordnet, candidate, pos, depth + 1);
      if (base) return derived(word, candidate, base, pos);
    }
  }
  return null;
}

function derived(word, base, card, pos) {
  let label;
  // Every noun exception in the list is an irregular plural (cacti, geese,
  // pence). A future exception that is only a spelling variant would be better
  // hand-written than guessed from the suffix.
  if (pos === "n" && word !== base) label = `The plural of ${base}.`;
  else if (pos === "v" && /ing$/.test(word))
    label = `The present participle of ${base}.`;
  else if (pos === "v" && /en$/.test(word))
    label = `The past participle of ${base}.`;
  else if (pos === "v" && /s$/.test(word) && word !== base)
    label = `The third-person form of ${base}.`;
  else if (pos === "v")
    label = `A past form of ${base}.`;
  else if (pos === "a" && /est$/.test(word))
    label = `The superlative of ${base}.`;
  else if (pos === "a" && /er$/.test(word))
    label = `The comparative of ${base}.`;
  else label = `A form of ${base}.`;
  return {
    definition: `${label} ${card.definition}`.trim(),
    example: card.example,
    synonyms: card.synonyms,
    antonyms: card.antonyms,
    source: card.source,
    base,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const bank = bankRows();
const blocklist = readBlocklist();
const dictionaryFromDisk = fs.existsSync(dictionaryPath)
  ? readJson(dictionaryPath)
  : {};

if (checking && !writing) {
  if (!fs.existsSync(acceptedPath))
    fail(`missing ${path.relative(root, acceptedPath)}`);
  const accepted = readJson(acceptedPath);
  const { answers } = sourceAccepted(bank);
  validate(bank, accepted, answers, dictionaryFromDisk);
  const manual = fs.existsSync(manualPath) ? readJson(manualPath) : {};
  const unused = Object.keys(manual).filter((word) => !dictionaryFromDisk[word]);
  if (unused.length)
    console.log(
      `five-letters: note: ${unused.length} manual gloss(es) not used: ${unused.join(", ")}`,
    );
  console.log(
    `five-letters: ok: ${accepted.length} accepted words, ${answers.length} answers, ${Object.keys(dictionaryFromDisk).length} cards`,
  );
  process.exit(0);
}

const { accepted, answers } = sourceAccepted(bank);
const wordnet = loadWordNet(process.env.WORDNET_DIR);
const manual = fs.existsSync(manualPath) ? readJson(manualPath) : {};
const dictionary = {};
const gaps = [];

function manualCard(entry) {
  return {
    definition: String(entry.definition || "").trim(),
    example: String(entry.example || "").trim(),
    synonyms: Array.isArray(entry.synonyms) ? entry.synonyms : [],
    antonyms: Array.isArray(entry.antonyms) ? entry.antonyms : [],
    source: "MineWords",
  };
}

for (const word of accepted) {
  const row = bank.get(word);
  // A manual gloss is a deliberate correction for a word WordNet either lacks
  // or explains badly. It outranks the generated card, but never the curated
  // bank card for a five-letter answer.
  let card = row
    ? bankCard(row)
    : manual[word]
      ? manualCard(manual[word])
      : null;
  if (!card) card = wordNetCard(wordnet, word);
  if (!card || !card.definition) {
    gaps.push(word);
    continue;
  }
  dictionary[word] = card;
}

if (gaps.length) {
  console.error(
    `five-letters: ${gaps.length} accepted words have no dictionary card. Add a manual gloss to ${path.relative(root, manualPath)} or remove the word from the accepted list:`,
  );
  console.error(gaps.join(" "));
  process.exit(1);
}

// A blocklisted word is a hard error rather than a silent drop: the accepted
// count is a product decision, so removing one has to be deliberate.
for (const word of accepted)
  if (blocklist.has(word))
    fail(`blocklisted word is in the accepted list: ${word}`);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.dirname(publicPath), { recursive: true });
fs.writeFileSync(
  acceptedPath,
  `${JSON.stringify(accepted, null, 2)}\n`,
);
fs.writeFileSync(dictionaryPath, JSON.stringify(dictionary));
fs.writeFileSync(publicPath, JSON.stringify(dictionary));

validate(bank, accepted, answers, dictionary);
console.log(
  `five-letters: wrote ${accepted.length} accepted words, ${answers.length} answers and ${Object.keys(dictionary).length} cards`,
);
const usedManual = Object.keys(manual).filter((word) => dictionary[word]);
if (usedManual.length)
  console.log(`five-letters: manual glosses used: ${usedManual.length}`);
