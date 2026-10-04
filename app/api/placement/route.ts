import { requireUser } from "@/lib/server/auth";
import { accountPlacement, scoreHistory } from "@/lib/server/placement";
import { boundary, json } from "@/lib/server/http";

/**
 * Where the child is, and how they got there.
 *
 * Read-only and personal: the score chart on the practice page and the story
 * recommendations both come from here. It answers with derived numbers only —
 * a level, a score and one point per day — never rows, never words, so there
 * is nothing here an account could not already see about itself.
 */
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    const [placed, history] = await Promise.all([
      accountPlacement(user.id),
      scoreHistory(user.id),
    ]);
    return json({ ...placed, history });
  });
}
