import { boundary, HttpError, json } from "@/lib/server/http";
import { confirmEmail } from "@/lib/server/email-verification";
import { createSession } from "@/lib/server/auth";

/**
 * Opening the link a parent was sent.
 *
 * A GET, not a POST, because it arrives as a link in an email and because it
 * changes nothing: the account was created at registration, and this only records
 * that the address answers. A link that could be used to change something should
 * not be reachable by a mail client prefetching it.
 *
 * It signs the parent in, because they have just proved they own the address and
 * because making them type a password they chose a moment ago, on a device that
 * may have forgotten it, is a small cruelty for no security gain. The link is
 * single use, so the window in which the session exists is short.
 */
export async function GET(request: Request) {
  return boundary(async () => {
    // No origin check, and there cannot be one: this arrives as a link clicked in
    // a mail client, which sends no `Origin` header. The token is the proof, and
    // it is single use, so a request that could forge one would have nothing to
    // forge.
    //
    // The cost of a GET is that a mail client which prefetches links can consume
    // the token before the parent sees it. That is recoverable - the resend button
    // on the sign-in page issues a new one - and the alternative, a form the parent
    // has to submit, is a worse first impression on the one screen that has to
    // convince someone their account works.
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!token) throw new HttpError(400, "This link is not valid.");
    const userId = await confirmEmail(token);
    return json({ ok: true }, 200, {
      "Set-Cookie": await createSession(userId, request),
    });
  });
}
