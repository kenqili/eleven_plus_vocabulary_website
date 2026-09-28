import { requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { boundary, HttpError, json } from "@/lib/server/http";
import { bankSize, freeWordIds } from "@/lib/server/free-words";
import { wordSummaryPage } from "@/lib/server/word-summary";
import { WORD_FILTERS, type WordFilter } from "@/lib/challenge/word-summary";
import type { DifficultyFilter } from "@/lib/challenge/difficulty";
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    const entitlement = await membership(user);
    const allowedWordIds = entitlement.access ? undefined : freeWordIds();
    const params = new URL(request.url).searchParams;
    const filter = params.get("filter") || "all";
    const level = params.get("level") || "all";
    const search = params.get("search") || "";
    if (
      !Object.hasOwn(WORD_FILTERS, filter) ||
      !["all", "0", "1", "2", "3", "4", "5"].includes(level) ||
      search.length > 200
    )
      throw new HttpError(400, "Invalid word list filters.");
    // A page at a time. The collection is far too large to send whole, and the
    // page renders forty of it.
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 40));
    return json({
      ...(await wordSummaryPage(user.id, {
        wordIds: allowedWordIds,
        filter: filter as WordFilter,
        search,
        // A level arrives as text and a word's level is a number, so passing the
        // string straight through compared "5" to 5 and every level other than
        // "all" came back empty. The export route already converted; both do now.
        level: (level === "all" ? "all" : Number(level)) as DifficultyFilter,
        offset,
        limit,
      })),
      premium: entitlement.access,
      trial: entitlement.trial,
      trialDaysRemaining: entitlement.trialDaysRemaining,
      trialEndsAt: entitlement.trialEndsAt,
      trialExpired: entitlement.trialExpired,
      freeWordCount: allowedWordIds?.size,
      // How many words there are in total, so the list can say "n of m"
      // without the browser holding all of them.
      collection: entitlement.access ? bankSize() : allowedWordIds!.size,
    });
  });
}
