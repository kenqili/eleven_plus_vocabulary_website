import { isAcceptedGuess, normalizeGuess } from "@/lib/challenge/five-letters";
import { currentUser, rateLimit, requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { freeWordIds } from "@/lib/server/free-words";
import {
  guessGame,
  hintGame,
  revealGame,
  startOrResume,
  stateFor,
} from "@/lib/server/five-letters";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";

/**
 * Five Letters has one endpoint because it has one state object.
 *
 * The signed-out browser gets a 401 and runs the free sample locally. A signed-in
 * account gets only the cards for the words it has actually guessed; the answer
 * is absent until the round is over. Entitlement is the same membership call and
 * the same free-word set the practice page uses, so a free child can never be
 * handed an answer outside their collection.
 */
async function allowedFor(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) throw new HttpError(401, "Sign in to play Five Letters.");
  const entitlement = await membership(user);
  if (entitlement.access)
    return {
      user,
      allowedWordIds: undefined as ReadonlySet<string> | undefined,
    };
  const allowedWordIds = freeWordIds();
  if (!allowedWordIds.size)
    throw new HttpError(
      402,
      "Your free collection is disabled. Subscribe to continue playing.",
    );
  return { user, allowedWordIds };
}

export async function GET(request: Request) {
  return boundary(async () => {
    const user = await currentUser(request);
    if (!user) throw new HttpError(401, "Sign in to play Five Letters.");
    const { allowedWordIds } = await allowedFor(user);
    return json(await stateFor(user.id, allowedWordIds));
  });
}

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    await rateLimit(`five-letters:${user.id}`, 120, 3_600_000);
    const entitlement = await membership(user);
    const allowedWordIds = entitlement.access ? undefined : freeWordIds();
    if (allowedWordIds?.size === 0)
      throw new HttpError(
        402,
        "Your free collection is disabled. Subscribe to continue playing.",
      );
    const input = await body(request);
    const action = input.action;

    if (action === "start")
      return json(await startOrResume(user.id, allowedWordIds));
    if (action === "next")
      return json(await startOrResume(user.id, allowedWordIds, true));

    if (action === "guess") {
      if (typeof input.gameId !== "string")
        throw new HttpError(400, "Choose a game to play.");
      const guess = normalizeGuess(
        typeof input.guess === "string" ? input.guess : "",
      );
      if (!guess)
        throw new HttpError(400, "A guess must be exactly five letters.");
      if (!isAcceptedGuess(guess))
        throw new HttpError(409, "That word is not in the Five Letters list.");
      return json(
        await guessGame(user.id, input.gameId, guess, allowedWordIds),
      );
    }

    if (action === "hint") {
      if (typeof input.gameId !== "string")
        throw new HttpError(400, "Choose a game to play.");
      if (input.kind !== "syn" && input.kind !== "ant")
        throw new HttpError(400, "Choose a synonym or antonym hint.");
      return json(
        await hintGame(user.id, input.gameId, input.kind, allowedWordIds),
      );
    }

    if (action === "reveal") {
      if (typeof input.gameId !== "string")
        throw new HttpError(400, "Choose a game to play.");
      return json(await revealGame(user.id, input.gameId, allowedWordIds));
    }

    throw new HttpError(400, "Invalid Five Letters action.");
  });
}
