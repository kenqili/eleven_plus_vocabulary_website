import { currentUser, rateLimit, requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { freeWordIds } from "@/lib/server/free-words";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import {
  finishRelationMatch,
  relationKind,
  startRelationGame,
} from "@/lib/server/relations";

/**
 * One endpoint for the two relation challenges.
 *
 * The kind is a parameter rather than a second route because the game is the
 * same game with a different question. Entitlement is the same membership call
 * and the same free-word set the practice page and Five Letters use, so a free
 * child can never be asked about a word outside their collection.
 */
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
    const kind = relationKind(new URL(request.url).searchParams.get("kind"));
    return json(
      await startRelationGame(user.id, kind, await allowedFor(user)),
    );
  });
}

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    await rateLimit(`games:${user.id}`, 120, 3_600_000);
    const input = await body(request);
    const kind = relationKind(input.kind);
    const matchId = input.matchId;
    if (typeof matchId !== "string" || !/^[a-z0-9-]{8,64}$/i.test(matchId))
      throw new HttpError(400, "That match could not be saved.");
    const answers = Array.isArray(input.answers) ? input.answers : [];
    return json(
      await finishRelationMatch(
        user.id,
        kind,
        matchId,
        answers,
        input.seconds,
        await allowedFor(user),
      ),
    );
  });
}
