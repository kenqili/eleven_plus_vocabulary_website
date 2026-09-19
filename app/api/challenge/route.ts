import { interleaveQuestions } from "@/lib/challenge/ordering";
import { words, problems } from "@/lib/challenge/bank";
import { choicesFor, shuffle } from "@/lib/challenge/words";
import { parseQuestionTypes } from "@/lib/challenge/config";
import { currentUser, requireUser, rateLimit } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { nextQuestion, answerQuestion, statsFor } from "@/lib/server/challenge";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
export async function GET(request: Request) {
  return boundary(async () => {
    let types;
    try {
      const selection = new URL(request.url).searchParams.get("types");
      types = parseQuestionTypes(
        selection === null ? undefined : selection.split(","),
      );
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    const user = await currentUser(request);
    if (user && (await membership(user)).active)
      return json({ demo: false, stats: await statsFor(user.id) });
    return json({
      demo: true,
      words: interleaveQuestions(
        shuffle(
          words.filter((word) =>
            problems.some(
              (problem) =>
                problem.wordId === word.id && types.includes(problem.type),
            ),
          ),
        )
          .slice(0, 5)
          .flatMap((word, index) =>
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
                number: index + 1,
                choices: problem.choices
                  ? shuffle(problem.choices)
                  : choicesFor(word, words),
              })),
          ),
      ),
      stats: {
        total: words.length,
        mastered: 0,
        correct: 0,
        todaySeconds: 0,
        totalSeconds: 0,
      },
    });
  });
}
export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    if (!(await membership(user)).active)
      throw new HttpError(
        402,
        "A monthly membership is needed for the full word collection.",
      );
    await rateLimit(`practice:${user.id}`, 250);
    const input = await body(request);
    if (input.action === "next") {
      let types;
      try {
        types = parseQuestionTypes(input.types);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      const question = await nextQuestion(user.id, types);
      return json({
        question,
        complete: !question,
        stats: await statsFor(user.id),
        demo: false,
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
      );
      return json({ feedback, stats: await statsFor(user.id), demo: false });
    }
    throw new HttpError(400, "Invalid challenge action.");
  });
}
