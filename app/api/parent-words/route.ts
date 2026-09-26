import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import { currentUser, requireUser, rateLimit } from "@/lib/server/auth";
import { database } from "@/lib/server/db";
import {
  customWordsFor,
  excludedWordIds,
} from "@/lib/server/parent-words";
import { isAlreadyInBank } from "@/lib/challenge/added-words";
import { words as bankWords } from "@/lib/challenge/bank";
import levels from "@/data/word-levels/levels.json";

const MAX_ADDED_WORDS = 500;
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const normalise = (value: string) => value.normalize("NFKC").toLowerCase().trim();

/** Everything the settings page needs: what is excluded, and what was added. */
async function snapshot(userId: string) {
  const [added, excluded] = await Promise.all([
    customWordsFor(userId),
    excludedWordIds(userId),
  ]);
  const byId = new Map(bankWords.map((word) => [word.id, word.word]));
  return {
    excluded: [...excluded]
      .map((id) => ({ id, word: byId.get(id) ?? id }))
      .sort((a, b) => a.word.localeCompare(b.word)),
    added: added.map((row) => ({
      ...row,
      alreadyInBank: isAlreadyInBank(row.word, bankWords),
      difficulty: (levels.words as Record<string, { difficulty: number }>)[
        normalise(row.word)
      ]?.difficulty,
    })),
    limits: { maxAddedWords: MAX_ADDED_WORDS },
  };
}

export async function GET(request: Request) {
  return boundary(async () => {
    const user = await currentUser(request);
    if (!user) return json({ excluded: [], added: [], limits: { maxAddedWords: MAX_ADDED_WORDS } });
    return json(await snapshot(user.id));
  });
}

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request),
      input = await body(request);
    const db = database();

    if (input.action === "exclude") {
      const wordId = typeof input.wordId === "string" ? input.wordId : "";
      if (!wordId || wordId.length > 120)
        throw new HttpError(400, "Choose a word to set aside.");
      await rateLimit(`word-exclusions:${user.id}`, 300);
      // A pending question for an excluded word would strand the learner, so
      // retire it the same way a removed word is retired.
      await db
        .prepare(
          `INSERT INTO word_exclusions(user_id,word_id,created_at) VALUES(?,?,?)
       ON CONFLICT(user_id,word_id) DO NOTHING`,
        )
        .bind(user.id, wordId, Date.now())
        .run();
      await db
        .prepare(
          "UPDATE attempts SET answered_at=?,selected=-2,is_correct=0 WHERE id=? AND user_id=? AND answered_at IS NULL",
        )
        .bind(Date.now(), input.attemptId ?? "", user.id)
        .run();
      return json(await snapshot(user.id));
    }

    if (input.action === "restore") {
      const wordId = typeof input.wordId === "string" ? input.wordId : "";
      if (!wordId) throw new HttpError(400, "Choose a word to bring back.");
      await rateLimit(`word-exclusions:${user.id}`, 300);
      await db
        .prepare("DELETE FROM word_exclusions WHERE user_id=? AND word_id=?")
        .bind(user.id, wordId)
        .run();
      return json(await snapshot(user.id));
    }

    if (input.action === "add") {
      const word = clean(input.word, 60);
      const definition = clean(input.definition, 200);
      const example = clean(input.example, 240);
      if (!word) throw new HttpError(400, "Add the word you want to practise.");
      if (!definition) throw new HttpError(400, "Add what the word means.");
      if (!example)
        throw new HttpError(400, "Add a sentence that shows the word in use.");
      if (isAlreadyInBank(word, bankWords))
        throw new HttpError(
          409,
          "We already teach that word, so there is no need to add it.",
        );
      await rateLimit(`custom-words:${user.id}`, 120);
      const count = (
        await db
          .prepare("SELECT COUNT(*) AS count FROM custom_words WHERE user_id=?")
          .bind(user.id)
          .first<{ count: number }>()
      )?.count;
      if ((count ?? 0) >= MAX_ADDED_WORDS)
        throw new HttpError(
          409,
          `You can keep up to ${MAX_ADDED_WORDS} of your own words.`,
        );
      await db
        .prepare(
          `INSERT INTO custom_words(id,user_id,word,definition,example,created_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(user_id,word) DO UPDATE SET definition=excluded.definition,example=excluded.example`,
        )
        .bind(crypto.randomUUID(), user.id, word, definition, example, Date.now())
        .run();
      return json(await snapshot(user.id));
    }

    if (input.action === "remove") {
      const id = typeof input.id === "string" ? input.id : "";
      if (!id) throw new HttpError(400, "Choose one of your words to remove.");
      await rateLimit(`custom-words:${user.id}`, 120);
      await db
        .prepare("DELETE FROM custom_words WHERE user_id=? AND id=?")
        .bind(user.id, id)
        .run();
      await db
        .prepare("DELETE FROM word_exclusions WHERE user_id=? AND word_id=?")
        .bind(user.id, `own:${normalise(id)}`)
        .run();
      return json(await snapshot(user.id));
    }

    throw new HttpError(400, "Unknown word settings action.");
  });
}
