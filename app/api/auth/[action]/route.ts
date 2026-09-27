import { database } from "@/lib/server/db";
import {
  configuredFreeTrialDays,
  configuredFreeWordLimit,
  configuredPriceLabel,
} from "@/lib/server/billing";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import {
  createSession,
  currentUser,
  rateLimit,
  requireUser,
  sessionCookie,
} from "@/lib/server/auth";
import {
  hashPassword,
  tokenDigest,
  verifyPassword,
} from "@/lib/server/password";

export async function GET(request: Request) {
  return boundary(async () =>
    json({
      user: await currentUser(request),
      freeTrialDays: configuredFreeTrialDays(),
      freeWordLimit: configuredFreeWordLimit(),
      // Shown before anyone creates an account. A parent should not have to
      // make an account with a twelve-character password to find out what it
      // costs, and a page that says "visit your account for pricing" is asking
      // for an account before it will answer the question.
      price: configuredPriceLabel(),
    }),
  );
}
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return boundary(async () => {
    sameOrigin(request);
    const { action } = await context.params;
    if (action === "logout") {
      const token = request.headers
        .get("cookie")
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("mw_session=") || x.startsWith("__Host-mw_session="))
        ?.split("=")[1];
      if (token)
        await database()
          .prepare("DELETE FROM sessions WHERE token_hash = ?")
          .bind(tokenDigest(token))
          .run();
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie("", request, 0),
      });
    }
    if (action === "delete") {
      // A child's app that cannot be deleted is a child's app a parent cannot
      // leave. Every table cascades from users, so this is one delete, but the
      // password is checked first and the count is returned so the parent is
      // told what is going rather than being asked to trust it.
      const user = await requireUser(request);
      const input = await body(request);
      const password = typeof input.password === "string" ? input.password : "";
      if (!password) throw new HttpError(400, "Enter your password to confirm.");
      const account = (
        await database()
          .prepare("SELECT password_hash FROM users WHERE id=?")
          .bind(user.id)
          .first<{ password_hash: string }>()
      )?.password_hash;
      // A dummy verify on an unknown account, so the timing of this response
      // does not reveal whether the account exists.
      if (!account || !(await verifyPassword(password, account)))
        throw new HttpError(401, "That password does not match.");
      await rateLimit(`delete-account:${user.id}`, 5);
      const recorded = (
        await database()
          .prepare(
            "SELECT COUNT(*) AS count FROM learning_events WHERE user_id=?",
          )
          .bind(user.id)
          .first<{ count: number }>()
      )?.count ?? 0;
      // One row per answer is kept in aggregate form on the account, so the
      // detail has to go first or the cascade will be refused.
      await database()
        .prepare("DELETE FROM users WHERE id=?")
        .bind(user.id)
        .run();
      return json(
        { ok: true, removed: { records: recorded } },
        200,
        { "Set-Cookie": sessionCookie("", request, 0) },
      );
    }
    if (action === "password") {
      // A parent who suspects their password has been seen has to be able to do
      // something about it. Changing the password and signing out every other
      // device are the same request from a parent's point of view: changing a
      // password someone else knows while leaving their session alive would not
      // fix anything.
      const user = await requireUser(request);
      const input = await body(request);
      const current =
        typeof input.currentPassword === "string" ? input.currentPassword : "";
      const next = typeof input.newPassword === "string" ? input.newPassword : "";
      if (!current) throw new HttpError(400, "Enter your current password.");
      if (next.length < 8 || next.length > 128)
        throw new HttpError(400, "The new password must be 8 to 128 characters.");
      if (next === current)
        throw new HttpError(400, "The new password matches the old one.");
      // Counted per account and per address: a stolen session must not be able
      // to grind through passwords by never sending the right one, and a shared
      // address must not be usable to lock a parent out of their own account.
      await rateLimit(`change-password:${user.id}`, 5);
      await rateLimit(
        `change-password-ip:${request.headers.get("cf-connecting-ip") || "local"}`,
        20,
      );
      const account = (
        await database()
          .prepare("SELECT password_hash FROM users WHERE id=?")
          .bind(user.id)
          .first<{ password_hash: string }>()
      )?.password_hash;
      if (!account || !(await verifyPassword(current, account)))
        throw new HttpError(401, "That current password does not match.");

      const live = (
        await database()
          .prepare(
            "SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND expires_at > ?",
          )
          .bind(user.id, Date.now())
          .first<{ count: number }>()
      )?.count ?? 0;

      await database()
        .prepare("UPDATE users SET password = ? WHERE id = ?")
        .bind(hashPassword(next), user.id)
        .run();
      // Deleted rather than left to expire: a token that stays valid for the rest
      // of its week is exactly the thing being revoked. A fresh session is
      // issued below, so the parent stays signed in here.
      await database()
        .prepare("DELETE FROM sessions WHERE user_id = ?")
        .bind(user.id)
        .run();
      return json(
        { ok: true, signedOut: Math.max(0, live - 1) },
        200,
        { "Set-Cookie": await createSession(user.id, request) },
      );
    }
    if (action === "signout-all") {
      const user = await requireUser(request);
      await rateLimit(`signout-all:${user.id}`, 10);
      const removed = await database()
        .prepare("DELETE FROM sessions WHERE user_id = ?")
        .bind(user.id)
        .run();
      return json({ ok: true, signedOut: removed?.meta?.changes ?? 0 }, 200, {
        "Set-Cookie": sessionCookie("", request, 0),
      });
    }
    if (action !== "register" && action !== "login")
      throw new HttpError(404, "Unknown action.");
    const input = await body(request);
    const email =
      typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      password.length < 8 ||
      password.length > 128
    )
      throw new HttpError(
        400,
        "Use a valid email address and a password of 8 to 128 characters.",
      );
    await rateLimit(`auth:email:${email}`, 12);
    // cf-connecting-ip is supplied by Cloudflare; never trust X-Forwarded-For.
    await rateLimit(
      `auth:ip:${request.headers.get("cf-connecting-ip") || "local"}`,
      40,
    );
    const found = await database()
      .prepare("SELECT id,password FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string; password: string }>();
    let userId: string;
    if (action === "register") {
      const passwordHash = hashPassword(password);
      if (found)
        throw new HttpError(
          409,
          "Unable to register this email. Try signing in.",
        );
      userId = crypto.randomUUID();
      try {
        await database()
          .prepare(
            "INSERT INTO users (id,email,password,created_at) VALUES (?,?,?,?)",
          )
          .bind(userId, email, passwordHash, Date.now())
          .run();
      } catch {
        throw new HttpError(
          409,
          "Unable to register this email. Try signing in.",
        );
      }
    } else {
      // Always perform the same expensive password operation, including unknown accounts.
      const valid = verifyPassword(
        password,
        found?.password ||
          "scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000",
      );
      if (!found || !valid)
        throw new HttpError(401, "Email or password is incorrect.");
      userId = found.id;
    }
    return json({ user: { id: userId, email } }, 200, {
      "Set-Cookie": await createSession(userId, request),
    });
  });
}
