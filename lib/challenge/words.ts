export const SOURCE_ORDER = [
  "flash_card_1",
  "flash_card_2",
  "blue_book",
] as const;
export type WordSource = (typeof SOURCE_ORDER)[number];
export const SOURCE_LABELS: Record<WordSource, string> = {
  flash_card_1: "Flash Card 1",
  flash_card_2: "Flash Card 2",
  blue_book: "Blue Book",
};
export type Word = {
  id: string;
  word: string;
  definition: string;
  source: WordSource;
  syn: string;
  ant: string;
  example: string;
};

/** RFC-style CSV fields: commas, escaped quotes and multiline quoted cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, "");
  const finishRow = () => {
    row.push(field.trim());
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
    field = "";
    closed = false;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ",") {
      row.push(field.trim());
      field = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      finishRow();
      if (c === "\r" && input[i + 1] === "\n") i++;
    } else if (c === '"' && !field.trim() && !closed) {
      field = "";
      quoted = true;
    } else if (c === '"' || (closed && c.trim()))
      throw new Error("Invalid CSV quoting.");
    else if (!closed) field += c;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field.");
  if (row.length || field || closed) finishRow();
  return rows;
}

export function parseWordCsv(text: string, source: WordSource): Word[] {
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    throw new Error(`${source}: ${(error as Error).message}`);
  }
  const header = rows.shift()?.map((cell) => cell.toLowerCase());
  if (
    !header ||
    new Set(header).size !== header.length ||
    !header.includes("word") ||
    !header.includes("def")
  )
    throw new Error(
      `${source}: CSV needs unique headers including word and def.`,
    );
  return rows.map((row, i) => {
    const value = (key: string) => row[header.indexOf(key)] || "";
    const word = value("word");
    if (row.length !== header.length || !word || !value("def"))
      throw new Error(
        `${source}: Invalid word record ${i + 2}; check column count, word and def.`,
      );
    return {
      id: word.normalize("NFKC").toLowerCase(),
      word,
      definition: value("def"),
      source,
      syn: value("syn"),
      ant: value("ant"),
      example: value("example"),
    };
  });
}

/** First appearance wins, including every field and source of that occurrence. */
export function mergeWordSources(sources: Record<WordSource, string>): Word[] {
  const merged = new Map<string, Word>();
  for (const source of SOURCE_ORDER) {
    for (const word of parseWordCsv(sources[source], source)) {
      if (!merged.has(word.id)) merged.set(word.id, word);
    }
  }
  if (merged.size < 4)
    throw new Error(
      "The merged word database needs at least four unique words.",
    );
  return [...merged.values()];
}

const ignored = new Set(
  "a an and as at be because by for from in into is it of on or someone something that the to very with".split(
    " ",
  ),
);
export function similarDefinitions(a: string, b: string) {
  const terms = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !ignored.has(w)),
    );
  const x = terms(a),
    y = terms(b);
  if (!x.size || !y.size) return a.toLowerCase() === b.toLowerCase();
  return (
    [...x].filter((w) => y.has(w)).length / Math.min(x.size, y.size) >= 0.6
  );
}
export function shuffle<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function choicesFor(
  word: Word,
  bank: Word[],
  random = Math.random,
): string[] {
  const definitions = [
    ...new Set(
      bank
        .filter(
          (w) =>
            w.id !== word.id &&
            !similarDefinitions(word.definition, w.definition),
        )
        .map((w) => w.definition),
    ),
  ];
  if (definitions.length < 3)
    throw new Error(`Not enough distinct definitions for ${word.word}.`);
  return shuffle(
    [word.definition, ...shuffle(definitions, random).slice(0, 3)],
    random,
  );
}
