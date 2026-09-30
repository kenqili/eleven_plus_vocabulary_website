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
}: {
  to: string;
  subject: string;
  text: string;
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
