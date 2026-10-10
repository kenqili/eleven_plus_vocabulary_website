import { rateLimit } from "@/lib/server/auth";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import { CONTACT_EMAIL } from "@/lib/contact";
import { emailReady, sendEmail } from "@/lib/server/email";

/**
 * A message for the owner, from the contact page.
 *
 * Anonymous on purpose: advice arrives from parents who have never made an
 * account, and an account problem is described by its symptoms rather than
 * proven by a session. The recipient is fixed - always the support address -
 * so this cannot be aimed anywhere else, and the sender's address travels as
 * the reply-to rather than the from, so nothing here can send as anyone.
 */
const TOPICS = {
  account: "Account problem",
  feedback: "Advice or feedback",
  other: "Something else",
} as const;

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    // Five per address per quarter hour. A form with no account behind it is
    // the cheapest spam relay on the site; this bounds it.
    await rateLimit(
      `contact-ip:${request.headers.get("cf-connecting-ip") || "local"}`,
      5,
    );
    const input = await body(request);
    const email =
      typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const topic = typeof input.topic === "string" ? input.topic : "other";
    const message = typeof input.message === "string" ? input.message.trim() : "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254
    )
      throw new HttpError(400, "Enter the email address we can reply to.");
    if (!(topic in TOPICS))
      throw new HttpError(400, "Choose what your message is about.");
    if (message.length < 10)
      throw new HttpError(400, "Say a little more so we can help.");
    if (message.length > 2000)
      throw new HttpError(400, "Keep it under 2000 characters, please.");
    if (!emailReady())
      throw new HttpError(
        503,
        "Messages are not working just now. Please email us directly instead.",
      );
    await sendEmail({
      to: CONTACT_EMAIL,
      subject: `MineWords contact: ${TOPICS[topic as keyof typeof TOPICS]}`,
      text: `From: ${email}\nAbout: ${TOPICS[topic as keyof typeof TOPICS]}\n\n${message}`,
      replyTo: email,
    });
    return json({ ok: true });
  });
}
