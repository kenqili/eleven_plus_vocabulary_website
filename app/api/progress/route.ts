import { currentUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { progressSnapshot } from "@/lib/server/snapshot";
import { boundary, HttpError, json } from "@/lib/server/http";

/**
 * The whole of a child's state, in one response, once per session.
 *
 * The practice page used to ask for one question at a time, and each of those
 * cost a round trip and a database read. This is what replaces it. The ordering
 * rules are already pure and already client-safe, so the browser can be handed
 * the state those rules read and left to run them, and the server keeps only
 * what genuinely needs a database: the progress itself, the parent's own
 * settings, and the derived counters.
 *
 * `no-store`, which `json()` sets by default. This is per child and it changes
 * with every answer, and it is the input to question ordering, so a cached copy
 * would be worse than a slow one.
 */
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await currentUser(request);
    if (!user) throw new HttpError(401, "Sign in to practise.");
    const access = await membership(user);
    return json(
      await progressSnapshot(user.id, {
        // Not `!access.active`: a trialling child has not paid and may still use
        // the whole collection, so access - active or trial - is the test.
        freeTier: !access.access,
        trialDaysRemaining: access.trialDaysRemaining,
        trialExpired: access.trialExpired,
        trialEndsAt: access.trialEndsAt,
        trialDays: access.trialDays,
      }),
    );
  });
}
