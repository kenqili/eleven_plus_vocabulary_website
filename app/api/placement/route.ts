import { requireUser } from "@/lib/server/auth";
import { accountPlacement } from "@/lib/server/placement";
import { boundary, json } from "@/lib/server/http";

/**
 * Where the child is, right now.
 *
 * Read-only and personal: the level bar on the practice page and the story
 * recommendations both come from here. It answers with derived numbers only —
 * a level and a score — never rows, never words, so there is nothing here an
 * account could not already see about itself.
 */
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    return json(await accountPlacement(user.id));
  });
}
