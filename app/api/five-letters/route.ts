import { currentUser, rateLimit, requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { freeWordIds } from "@/lib/server/free-words";
import {
  finishGame,
  startOrResume,
  stateFor,
} from "@/lib/server/five-letters";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";

/**
 * Five Letters has one endpoint because it has one state object.
 *
 * A round runs in the browser: the answer goes out with it, the child marks
 * their own guesses, and the server is not asked again until the round ends.
 * Then the browser reports the words it guessed, and the server marks them
 * itself and records the round in one request.
 *
 * The signed-out browser gets a 401 and runs the free sample locally. Entitlement
 * is the same membership call and the same free-word set the practice page uses,
 * so a free child can never be handed an answer outside their collection.
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

    if (action === "finish") {
      if (typeof input.gameId !== "string")
        throw new HttpError(400, "Choose a game to finish.");
      const guesses = Array.isArray(input.guesses)
        ? input.guesses.filter((word): word is string => typeof word === "string")
        : [];
      const hints = Array.isArray(input.hints)
        ? input.hints.filter(
            (kind): kind is "syn" | "ant" => kind === "syn" || kind === "ant",
          )
        : [];
      if (input.status !== "solved" && input.status !== "revealed")
        throw new HttpError(400, "A round ends solved or revealed.");
      return json(
        await finishGame(
          user.id,
          input.gameId,
          guesses,
          hints,
          input.status,
          allowedWordIds,
        ),
      );
    }

    throw new HttpError(400, "Invalid Five Letters action.");
  });
}
