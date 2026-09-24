import { database } from "@/lib/server/db";
import {
  configuredFreeTrialDays,
  configuredFreeWordLimit,
} from "@/lib/server/billing";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import {
  createSession,
  currentUser,
  rateLimit,
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
        .find((x) => x.startsWith("mw_session="))
        ?.slice(11);
      if (token)
        await database()
          .prepare("DELETE FROM sessions WHERE token_hash = ?")
          .bind(tokenDigest(token))
          .run();
      return json({ ok: true }, 200, {
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
      password.length < 12 ||
      password.length > 128
    )
      throw new HttpError(
        400,
        "Use a valid email and a password of 12–128 characters.",
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
