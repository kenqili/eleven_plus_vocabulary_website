import { setting } from "./db";
// The only place in the app that talks to an email provider.
//
// Resend is a plain HTTPS JSON call with no SDK to keep current, which is the
// right trade for a Worker: the reset flow has to work at three in the morning
// without a dependency that has moved underneath it. Everything the app will
// ever send is a parent, on their own account, and the sender is a configured
// address rather than a user-supplied one, so there is nothing here to abuse.
export const emailReady = () =>
  Boolean(setting("RESEND_API_KEY") && setting("EMAIL_FROM"));

export async function sendEmail({
  to,
  subject,
  text,
  replyTo,
}: {
  to: string;
  subject: string;
  text: string;
  /**
   * Where replies go, rather than the sender. Used only by the contact form:
   * the sender stays the configured address, and the parent's address rides
   * along for the reply button. Everything else the app sends is to the
   * parent about their own account, where a reply-to would make no sense.
   */
  replyTo?: string;
}): Promise<void> {
  // Thrown rather than logged and ignored, because the caller has to decide
  // what a failed send means for the reply it gives the browser, and a silent
  // success would leave a parent told an email is on its way that never was.
  if (!emailReady()) throw new Error("Email delivery is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${setting("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: setting("EMAIL_FROM"),
      to,
      subject,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!response.ok) {
    // The status, and nothing else. A provider's error body quotes the message
    // it was given, and a reset message contains the only copy of a live token,
    // so logging the body would put a working link in the log store.
    console.error("Email delivery failed", response.status);
    throw new Error("The email service is unavailable.");
  }
}

/**
 * The message a parent reads when they ask to recover their account. Plain text,
 * the link on its own line so it survives a plain-text mail client, and no
 * markup to render. The hour it promises is RESET_TTL_MS in ./password-reset,
 * which is what the server actually enforces.
 */
export async function sendPasswordResetEmail(
  to: string,
  link: string,
): Promise<void> {
  await sendEmail({
    to,
    subject: "Reset your MineWords password",
    text: [
      "Somebody asked to reset the password on this MineWords account.",
      "",
      "Open this link to choose a new one:",
      "",
      link,
      "",
      "The link lasts one hour, and it works once. If that was not you, ignore",
      "this email: nothing has changed and nobody has been signed in.",
      "",
      "MineWords",
    ].join("\n"),
  });
}

/**
 * When it happened, in a form a parent can read and check against their own day.
 *
 * A fixed locale and UTC rather than the runtime's own, because this line is a
 * record of when a password changed: "14:05" with no zone on it, in whatever
 * language the Worker happens to be running, is not a record of anything.
 */
const when = (at: number) =>
  `${new Date(at).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;

/**
 * The message a parent reads after the password on their account has changed,
 * whichever route changed it.
 *
 * `how` is not decoration. A parent who changed their own password and one whose
 * account was recovered through a link have just had the same thing happen to
 * them, and the only thing that tells them apart is that one of them had to open
 * a link to get in. The subjects differ for that reason too: a parent deciding
 * whether to worry reads the subject line in the list before the body.
 *
 * The link is the account page and carries no token. That page holds both halves
 * of what comes next - the form that changes a password, and the "Forgotten your
 * password?" control for a parent who cannot sign in - and a token here would be
 * a second way into an account that nobody asked for one.
 *
 * No IP address, and no user agent either, both rejected rather than dropped:
 * neither is a thing a parent can act on, a user agent names a browser rather
 * than whose hands were on it, and a real one wraps badly in a plain-text client.
 * What is left is the time and the sign-out, the two facts that can be compared
 * against memory.
 *
 * `at` is passed in rather than read here, so the caller states when the change
 * happened - the moment the password was written, not the moment this was sent.
 */
export async function sendPasswordChangedEmail(
  to: string,
  context: {
    /** Where the account page is, built from APP_ORIGIN by the caller. */
    link: string;
    /** When the password changed, in milliseconds. */
    at: number;
    /** Which of the two routes changed it. A parent has to be able to tell. */
    how: "changed" | "reset";
  },
): Promise<void> {
  // Wording, not behaviour, is all that differs. The session delete is identical
  // in both routes; what a parent needs is to know whether this was them.
  const reset = context.how === "reset";
  const sessions = reset
    ? "Every device signed in to this account was signed out at the same time."
    : "Every other device signed in to this account was signed out at the same time.";
  await sendEmail({
    to,
    subject: reset
      ? "Your MineWords password was reset"
      : "Your MineWords password was changed",
    text: [
      reset
        ? "The password on your MineWords account has been reset, with a link sent to your email address."
        : "The password on your MineWords account has been changed.",
      "",
      `${when(context.at)}. ${sessions}`,
      "",
      "If this was not you, change the password again straight away, from",
      "your account page:",
      "",
      context.link,
      "",
      'If you cannot sign in, choose "Forgotten your password?" on that same',
      "page and we will email you a link to set a new one, to the address on",
      "the account.",
      "",
      "MineWords",
    ].join("\n"),
  });
}

/**
 * The message a parent reads when an address is about to be used for the first
 * time.
 *
 * It says the account is not open yet, because that is the part that would
 * otherwise be a surprise: a parent who registers and is then refused at sign-in
 * with nothing on screen to explain it will reasonably assume the site is broken.
 */
export function verificationEmail({ link }: { link: string }) {
  return {
    subject: "Confirm your email address for MineWords",
    text: [
      "Somebody created a MineWords account with this address.",
      "",
      "Open this link to confirm it, and the account opens straight away:",
      "",
      link,
      "",
      "The link lasts a day, and it works once.",
      "",
      "If this was not you, ignore this message. Nothing has been opened and no",
      "one has been signed in - but somebody may have typed this address by",
      "mistake, in which case the account will sit unopened rather than being",
      "taken over.",
      "",
      "MineWords",
    ].join("\n"),
  };
}
