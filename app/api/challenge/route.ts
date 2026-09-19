import { words } from "@/lib/challenge/bank";
import { choicesFor } from "@/lib/challenge/words";
import { currentUser, requireUser, rateLimit } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { nextQuestion, answerQuestion, statsFor } from "@/lib/server/challenge";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await currentUser(request);
    if (user && (await membership(user)).active)
      return json({ demo: false, stats: await statsFor(user.id) });
    return json({
      demo: true,
      words: words.slice(0, 5).map((w, i) => ({
        ...w,
        number: i + 1,
        choices: choicesFor(w, words),
      })),
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
      const question = await nextQuestion(user.id);
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
