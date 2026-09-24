import { requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { boundary, json } from "@/lib/server/http";
import { freeWordIds } from "@/lib/server/free-words";
import { wordSummary } from "@/lib/server/word-summary";
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    const entitlement = await membership(user);
    const allowedWordIds = entitlement.access ? undefined : freeWordIds();
    return json({
      words: await wordSummary(user.id, allowedWordIds),
      premium: entitlement.access,
      trial: entitlement.trial,
      trialDaysRemaining: entitlement.trialDaysRemaining,
      trialEndsAt: entitlement.trialEndsAt,
      trialExpired: entitlement.trialExpired,
      freeWordCount: allowedWordIds?.size,
    });
  });
}
