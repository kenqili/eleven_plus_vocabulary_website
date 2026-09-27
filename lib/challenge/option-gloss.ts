/**
 * Explains the option a child actually chose, when there is something to
 * explain.
 *
 * A definition question offers four meanings, so there is no word to define and
 * nothing comes back. The other four types offer words or phrases, and picking
 * "debris" instead of "timid" teaches a child nothing about debris unless the
 * app says what it is. A wrong answer is exactly when a child most wants to
 * know the word they did not pick, because they will meet it again.
 *
 * A phrase or a whole sentence is not explained. A child does not need a gloss
 * on "in spite of the fact that", and one would be noise rather than help.
 */
export type ChoiceGloss = {
  word: string;
  meaning: string;
  example?: string;
};

/** The part of a word entry this needs, so the caller supplies the source. */
export type GlossableWord = {
  word: string;
  definition: string;
  example?: string;
};

export function chosenWordExplanation(
  options: readonly string[],
  selected: number,
  answer: string,
  lookup: (word: string) => GlossableWord | undefined,
): ChoiceGloss | undefined {
  if (selected < 0 || selected >= options.length) return undefined;
  const chosen = options[selected];
  if (!chosen || chosen.toLowerCase() === answer.toLowerCase()) return undefined;
  const single = chosen.trim();
  if (!single || /\s/.test(single) || single.length > 40) return undefined;
  const entry = lookup(single.toLowerCase());
  if (!entry) return undefined;
  return {
    word: entry.word,
    meaning: entry.definition,
    example: entry.example || undefined,
  };
}

/**
 * A gloss for every offered option that is a single word, so a client can show
 * one without another round trip. Keys are the option exactly as offered,
 * because that is how a client looks it up.
 */
export function optionGlosses(
  options: readonly string[],
  answer: string,
  lookup: (word: string) => GlossableWord | undefined,
): Record<string, { meaning: string; example?: string }> {
  const out: Record<string, { meaning: string; example?: string }> = {};
  for (let index = 0; index < options.length; index += 1) {
    const gloss = chosenWordExplanation(options, index, answer, lookup);
    if (gloss) out[options[index]] = { meaning: gloss.meaning, example: gloss.example };
  }
  return out;
}
