import { requireUser, rateLimit } from "@/lib/server/auth";
import { boundary, body, HttpError, json, sameOrigin } from "@/lib/server/http";
import {
  checkpoint,
  progressSummary,
  redeem,
  rewardHistory,
} from "@/lib/server/rewards";
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
      throw new HttpError(400, "Invalid history page.");
    return json({
      ...(await progressSummary(user.id)),
      ...(await rewardHistory(user.id, offset)),
    });
  });
}
export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request),
      input = await body(request);
    if (
      input.action === "time" &&
      typeof input.owner === "string" &&
      typeof input.sequence === "number" &&
      typeof input.seconds === "number" &&
      typeof input.attemptId === "string"
    ) {
      await rateLimit(`study-time:${user.id}`, 600);
      return json(
        await checkpoint(user.id, {
          owner: input.owner,
          sequence: input.sequence,
          seconds: input.seconds,
          attemptId: input.attemptId,
        }),
      );
    }
    if (
      input.action === "redeem" &&
      typeof input.badgeId === "string" &&
      typeof input.requestKey === "string"
    ) {
      await rateLimit(`redeem:${user.id}`, 30);
      const receipt = await redeem(user.id, input.badgeId, input.requestKey);
      return json({
        receipt,
        ...(await progressSummary(user.id)),
        ...(await rewardHistory(user.id, 0)),
      });
    }
    throw new HttpError(400, "Invalid rewards action.");
  });
}
