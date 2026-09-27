import { interleaveQuestions } from "@/lib/challenge/ordering";
import { optionGlosses } from "@/lib/challenge/option-gloss";
import { storyMeaning, wordClue } from "@/lib/challenge/story-meanings";
import { choicesForProblem, words, problems } from "@/lib/challenge/bank";
import { shuffle } from "@/lib/challenge/words";
import { parsePracticeLevel, parseQuestionTypes } from "@/lib/challenge/config";
import { currentUser, requireUser, rateLimit } from "@/lib/server/auth";
import { configuredFreeTrialDays, membership } from "@/lib/server/billing";
import { freeWordIds } from "@/lib/server/free-words";
import {
  nextQuestion,
  answerQuestion,
  levelFor,
  statsFor,
} from "@/lib/server/challenge";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
export async function GET(request: Request) {
  return boundary(async () => {
    let types, level;
    try {
      const selection = new URL(request.url).searchParams;
      const typesParam = selection.get("types");
      types = parseQuestionTypes(
        typesParam === null ? undefined : typesParam.split(","),
      );
      level = parsePracticeLevel(selection.get("level"));
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    const user = await currentUser(request);
    if (user) {
      const entitlement = await membership(user);
      if (entitlement.access)
        return json({
          demo: false,
          freeTier: false,
          stats: await statsFor(user.id),
          trial: entitlement.trial,
          trialDaysRemaining: entitlement.trialDaysRemaining,
          trialEndsAt: entitlement.trialEndsAt,
          trialDaysConfigured: entitlement.trialDays,
        });
      const allowedWordIds = freeWordIds();
      if (!allowedWordIds.size)
        return json({
          demo: false,
          gated: true,
          trialExpired: true,
          stats: await statsFor(user.id, allowedWordIds),
          freeWordCount: 0,
        });
      return json({
        demo: false,
        freeTier: true,
        trialExpired: true,
        freeWordCount: allowedWordIds.size,
        stats: await statsFor(user.id, allowedWordIds),
      });
    }
    const freeWordSet = freeWordIds();
    const sampleWords = words.filter(
      (word) =>
        freeWordSet.has(word.id) &&
        (level === null || levelFor(word.id) === level) &&
        problems.some(
          (problem) =>
            problem.wordId === word.id && types.includes(problem.type),
        ),
    );
    return json({
      demo: true,
      freeWordCount: freeWordSet.size,
      trialDaysConfigured: configuredFreeTrialDays(),
      words: interleaveQuestions(
        shuffle(sampleWords).flatMap((word, index) =>
          problems
            .filter(
              (problem) =>
                problem.wordId === word.id && types.includes(problem.type),
            )
            .map((problem) => ({
              ...word,
              id: problem.id,
              wordId: word.id,
              type: problem.type,
              prompt: problem.prompt,
              answer: problem.answer,
              // Worked out here rather than in the browser, so the help data is
              // never shipped to a signed-out visitor who is only trying three
              // questions.
              clue: wordClue(word, problem.answer, problem.type),
              help: storyMeaning(word, word.id),
              // A gloss for each option that is a single word, so a child who
              // picks the wrong one is told what it means rather than being
              // left wondering. Definition questions offer meanings, so there
              // is nothing to gloss and the record comes out empty.
              optionHelp: optionGlosses(
                problem.choices ?? [word.definition],
                problem.answer,
                demoLookup,
              ),
              // Sent here so the browser never has to download the level
              // table just to label a question.
              difficulty: levelFor(word.id),
              number: index + 1,
              choices: shuffle(choicesForProblem(problem)),
            })),
        ),
      ),
      stats: {
        total: sampleWords.length,
        mastered: 0,
        correct: 0,
        todaySeconds: 0,
        totalSeconds: 0,
      },
    });
  });
}
/** Resolves a lower-cased word to its bank entry, with the plain-language help. */
const demoLookup = (word: string) => {
  const entry = words.find((candidate) => candidate.word.toLowerCase() === word);
  return entry
    ? { word: entry.word, definition: storyMeaning(entry), example: entry.example }
    : undefined;
};

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    const entitlement = await membership(user);
    const allowedWordIds = entitlement.access ? undefined : freeWordIds();
    if (allowedWordIds?.size === 0)
      throw new HttpError(
        402,
        "Your free collection is disabled. Subscribe to continue practising.",
      );
    // Two requests per question, and a child working briskly can ask for a
    // question every few seconds. The old ceiling of 250 locked a determined
    // player out after about eight minutes, so playing fast was the thing the
    // app punished hardest. It is already behind a session and a same-origin
    // check, so the limit is here to stop a runaway script rather than a child.
    await rateLimit(`practice:${user.id}`, 4000);
    const input = await body(request);
    if (input.action === "next") {
      let types, level;
      try {
        types = parseQuestionTypes(input.types);
        level = parsePracticeLevel(input.level);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      const question = await nextQuestion(
        user.id,
        types,
        allowedWordIds,
        level,
      );
      return json({
        question,
        complete: !question,
        stats: await statsFor(user.id, allowedWordIds),
        demo: false,
        freeTier: Boolean(allowedWordIds),
        freeWordCount: allowedWordIds?.size,
      });
    }
    if (
      input.action === "answer" &&
      typeof input.id === "string" &&
      typeof input.selected === "number" &&
      typeof input.elapsed === "number" &&
      Number.isFinite(input.elapsed)
    ) {
      const feedback = await answerQuestion(
        user.id,
        input.id,
        input.selected,
        input.elapsed,
        allowedWordIds,
        input.assisted === true,
      );
      return json({
        feedback,
        stats: await statsFor(user.id, allowedWordIds),
        demo: false,
        freeTier: Boolean(allowedWordIds),
        freeWordCount: allowedWordIds?.size,
      });
    }
    throw new HttpError(400, "Invalid challenge action.");
  });
}
