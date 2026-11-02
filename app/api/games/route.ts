import { currentUser, rateLimit, requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { freeWordIds } from "@/lib/server/free-words";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import {
  finishPracticeMatch,
  startPracticeGame,
} from "@/lib/server/practice-game";
import {
  finishRelationMatch,
  startRelationGame,
} from "@/lib/server/relations";
import { GAME_KINDS, type GameKind } from "@/lib/challenge/relations";

/**
 * One endpoint for the games.
 *
 * The kind is a parameter rather than a second route because the games share
 * the match history, the correctness write and the entitlement check. Syn and
 * ant differ in one list of the bank; mix is the mixed-practice game, which
 * builds its questions from the practice collection instead.
 *
 * Entitlement is the same membership call and the same free-word set the
 * practice page and Five Letters use, so a free child can never be asked about
 * a word outside their collection.
 */
function gameKind(value: unknown): GameKind {
  if (
    typeof value === "string" &&
    (GAME_KINDS as readonly string[]).includes(value)
  )
    return value as GameKind;
  throw new HttpError(400, "Choose a game.");
}

async function allowedFor(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) throw new HttpError(401, "Sign in to play.");
  const entitlement = await membership(user);
  if (entitlement.access) return undefined;
  const allowedWordIds = freeWordIds();
  if (!allowedWordIds.size)
    throw new HttpError(
      402,
      "Your free collection is disabled. Subscribe to continue playing.",
    );
  return allowedWordIds;
}

export async function GET(request: Request) {
  return boundary(async () => {
    const user = await currentUser(request);
    if (!user) throw new HttpError(401, "Sign in to play.");
    const selection = new URL(request.url).searchParams;
    const kind = gameKind(selection.get("kind"));
    // Off by default: a game that keeps asking words the child has mastered
    // stops teaching. `includeMastered=1` is the review mode.
    const includeMastered = selection.get("includeMastered") === "1";
    const allowedWordIds = await allowedFor(user);
    if (kind === "mix")
      return json(
        await startPracticeGame(user.id, allowedWordIds, includeMastered),
      );
    return json(
      await startRelationGame(user.id, kind, allowedWordIds, includeMastered),
    );
  });
}

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    await rateLimit(`games:${user.id}`, 120, 3_600_000);
    const input = await body(request);
    const kind = gameKind(input.kind);
    const matchId = input.matchId;
    if (typeof matchId !== "string" || !/^[a-z0-9-]{8,64}$/i.test(matchId))
      throw new HttpError(400, "That match could not be saved.");
    const answers = Array.isArray(input.answers) ? input.answers : [];
    const allowedWordIds = await allowedFor(user);
    if (kind === "mix")
      return json(
        await finishPracticeMatch(
          user.id,
          matchId,
          answers,
          input.seconds,
          allowedWordIds,
        ),
      );
    return json(
      await finishRelationMatch(
        user.id,
        kind,
        matchId,
        answers,
        input.seconds,
        allowedWordIds,
      ),
    );
  });
}
