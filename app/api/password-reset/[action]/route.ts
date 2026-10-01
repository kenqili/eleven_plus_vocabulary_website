import { createSession, rateLimit } from "@/lib/server/auth";
import { database, setting } from "@/lib/server/db";
import {
  emailReady,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from "@/lib/server/email";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import {
  hashPassword,
  tokenDigest,
  verifyPassword,
} from "@/lib/server/password";
import { markVerified } from "@/lib/server/email-verification";
import {
  findLiveReset,
  issueResetToken,
  RESET_LINK_PATH,
} from "@/lib/server/password-reset";

// The one reply this endpoint ever gives about whether an address is registered.
// It is a constant rather than a message chosen per branch, because the two
// paths have to be byte-identical: a parent who mistypes their address should
// not be told so, and an attacker who has a list of addresses should not be
// told so either. The wording is written for the parent who mistyped it - it
// says what will happen, not whether it already has.
const GENERIC_REPLY =
  "If that address has a MineWords account, a reset link is on its way. The link lasts one hour.";

// The shape a token from newToken() has, and the only shape worth a database
// lookup: 32 random bytes, hex. Anything else cannot be in the table, so it is
// answered as "not valid" instead of being looked up.
const TOKEN_SHAPE = /^[a-f0-9]{64}$/;

// Once per Worker instance, so a deployment with no email provider says so in
// its logs on the first request instead of staying quiet.
let warnedAboutEmail = false;

export async function GET(request: Request) {
  // No sameOrigin here, and deliberately: this is opened by a browser following
  // a link in an email, which sends no Origin header, and refusing it would
  // make the whole feature unusable. It only reads.
  return boundary(async () => {
    // Counted per address and not per token. A per-token limit would be an
    // oracle in the wrong direction: the limit would only be reached by a guess
    // that was right, so the 429 would answer "is that token real".
    // cf-connecting-ip is supplied by Cloudflare; never trust X-Forwarded-For.
    await rateLimit(
      `password-reset-check-ip:${request.headers.get("cf-connecting-ip") || "local"}`,
      60,
    );
    const token = new URL(request.url).searchParams.get("token") || "";
    const reset = TOKEN_SHAPE.test(token) ? await findLiveReset(token) : null;
    // 200 either way. A dead link, a used link and a guessed link are the same
    // answer, so there is nothing here to time or compare against a request
    // made with a real one. The email is returned only to somebody holding a
    // live token, which is the point: it tells them which account they are on.
    //
    // no-referrer because this URL carries the token, and a link out of the
    // reset page must not carry it in a Referer header. Cache-Control is
    // no-store from json(), so it does not sit in a shared cache either.
    return json(reset ? { ok: true, email: reset.email } : { ok: false }, 200, {
      "Referrer-Policy": "no-referrer",
    });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return boundary(async () => {
    sameOrigin(request);
    const { action } = await context.params;
    if (action === "request") return requestReset(request);
    if (action === "confirm") return confirmReset(request);
    throw new HttpError(404, "Unknown action.");
  });
}

/** Ask for a link. Says the same thing either way; see GENERIC_REPLY. */
async function requestReset(request: Request) {
  const input = await body(request);
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new HttpError(400, "Enter a valid email address.");
  // Counted before the lookup, not after it. If the limit only applied once an
  // account had been found, the 429 would be the answer to "does this address
  // have an account here", which is the one question this endpoint exists not to
  // answer. Three inside the fifteen-minute window rateLimit() defaults to, and
  // ten per address in the same window. Three because a parent who has genuinely
  // forgotten their password will get it wrong, and because a parent asking
  // again retires the first link anyway.
  await rateLimit(`password-reset-request-email:${email}`, 3);
  await rateLimit(
    `password-reset-request-ip:${request.headers.get("cf-connecting-ip") || "local"}`,
    10,
  );
  const found = await database()
    .prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string }>();
  // Nothing more is done for an unknown address, and nothing less is said
  // about it, so the two cases are the same request as far as a caller can see.
  if (!found) return json({ ok: true, message: GENERIC_REPLY });
  if (!emailReady() && !warnedAboutEmail) {
    warnedAboutEmail = true;
    console.warn(
      "Password reset cannot send mail. Set RESEND_API_KEY and EMAIL_FROM.",
    );
  }
  // One live link per account: this retires any previous one.
  const token = await issueResetToken(found.id);
  try {
    // The link is built in here as well as the send, so that a deployment with
    // no APP_ORIGIN - which would throw while building it - lands in the same
    // place as a provider that is down.
    //
    // That matters more than it looks. A failure that produced its own status
    // would be an account-existence oracle: 200 for an address nobody has and
    // 503 for one somebody does would answer the only question worth asking
    // this endpoint. So the failure is logged for the person running the app,
    // who can see their own configuration, and the parent is told the same
    // sentence either way. The cost is a link that never arrives; the benefit
    // is that the endpoint cannot be used to enumerate accounts.
    // Checked, because `new URL("")` throws "Invalid URL string", which says
    // nothing about which setting is missing. A deployment without APP_ORIGIN
    // otherwise logs that and a parent waits forever for a message that cannot
    // be addressed - and APP_ORIGIN is also what builds the Stripe return URLs,
    // so its absence breaks more than this one link.
    const origin = setting("APP_ORIGIN");
    if (!origin)
      throw new Error("APP_ORIGIN is not set, so the link cannot be built.");
    const link = `${new URL(origin).origin}${RESET_LINK_PATH}?token=${token}`;
    await sendPasswordResetEmail(found.email, link);
  } catch (error) {
    console.error(
      "Password reset email could not be sent",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
  return json({ ok: true, message: GENERIC_REPLY });
}

/** Use a link to set a new password. */
async function confirmReset(request: Request) {
  const input = await body(request);
  const token = typeof input.token === "string" ? input.token : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!TOKEN_SHAPE.test(token))
    throw new HttpError(400, "This reset link is not valid.");
  if (password.length < 8 || password.length > 128)
    throw new HttpError(400, "The new password must be 8 to 128 characters.");
  // Ten per address and five per token, both inside the default fifteen-minute
  // window. The per-token limit is the one that bounds guessing at a password
  // for a known account; the per-address limit is what stops a script cycling
  // tokens it has been handed by some other means.
  await rateLimit(
    `password-reset-confirm-ip:${request.headers.get("cf-connecting-ip") || "local"}`,
    10,
  );
  await rateLimit(`password-reset-confirm-token:${tokenDigest(token)}`, 5);
  const reset = await findLiveReset(token);
  if (!reset)
    throw new HttpError(
      400,
      "This reset link has expired or has already been used. Ask for a new one.",
    );
  // The same refusal as changing a password while signed in. It is not a
  // security measure, and it is worth saying so: a new password identical to the
  // old one is a parent who believed they had recovered the account and did not.
  if (verifyPassword(password, reset.storedHash))
    throw new HttpError(400, "The new password matches the old one.");
  const changedAt = Date.now();
  const db = database();
  await db.batch([
    db
      .prepare("UPDATE users SET password = ? WHERE id = ?")
      .bind(hashPassword(password), reset.userId),
    // Single use, deleted by id: the row that was just spent.
    db.prepare("DELETE FROM password_resets WHERE id = ?").bind(reset.id),
    // And nothing left over. The two deletes are redundant on a correct row and
    // are not redundant on any other, which is the point of writing both.
    db
      .prepare("DELETE FROM password_resets WHERE user_id = ?")
      .bind(reset.userId),
    // Every existing session dies here, and that is the reason a reset is worth
    // doing at all. The whole reason a parent reaches for this is that the
    // password may have been seen, and a password change that leaves somebody
    // else's session alive has not fixed anything - it has just told the person
    // in the account to sign in again. Deleted rather than left to expire, the
    // same reason the change-password route deletes them.
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(reset.userId),
  ]);
  // Signed in here, which is a convenience the parent is glad of after the
  // worst hour of their week, and it is safe because of what the token proved:
  // whoever holds it read the mailbox, it lasts an hour, and the row has just
  // been deleted, so it cannot be replayed for a second password.
  //
  // It happens after the batch rather than inside it, and that ordering is
  // required rather than tidy. createSession writes a row of its own, so if it
  // ran first the DELETE FROM sessions above would take the new session with it
  // and the parent would be locked out of the account they just recovered.
  // Confirms the address as a side effect, and this is the escape hatch that keeps
  // "sign-in needs a confirmed address" from becoming a trap.
  //
  // Without it there is a dead end: a parent whose confirmation mail was lost
  // cannot sign in, and a password reset that required a confirmed address would
  // refuse them too, so the account is unreachable by every route and only support
  // can open it. Receiving this message at all is the proof the other link was
  // asking for - it arrived at the same address - so a successful reset is allowed
  // to confirm it.
  await markVerified(reset.userId);
  // The notice a reset owes its account owner, and the same one the change-
  // password route sends, because a parent who hears that their address was used
  // to reset the account can change the password again straight away rather than
  // find out from a child who cannot sign in.
  //
  // It is also the only message some accounts will ever get: an address whose
  // confirmation was lost has no other evidence that it can receive mail at all,
  // which is the trap markVerified above exists to stop being fatal.
  //
  // emailReady() first, sharing this module's flag with requestReset, so one
  // deployment with no mail configured says so once rather than once per route.
  // Then the same try that requestReset uses: nothing here may change the reply,
  // because the reply is the one that signs the parent in, and a parent who has
  // just recovered their account cannot be told their mail is broken.
  if (!emailReady() && !warnedAboutEmail) {
    warnedAboutEmail = true;
    console.warn(
      "Password reset cannot send mail. Set RESEND_API_KEY and EMAIL_FROM.",
    );
  }
  try {
    const origin = setting("APP_ORIGIN");
    if (!origin)
      throw new Error("APP_ORIGIN is not set, so the link cannot be built.");
    await sendPasswordChangedEmail(reset.email, {
      link: `${new URL(origin).origin}/account`,
      at: changedAt,
      how: "reset",
    });
  } catch (error) {
    console.error(
      "Password reset email could not be sent",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
  return json({ ok: true }, 200, {
    "Set-Cookie": await createSession(reset.userId, request),
  });
}
