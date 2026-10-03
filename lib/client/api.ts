/**
 * How long a request may take before the child is told something is wrong.
 *
 * A connection that stalls - a school laptop on flaky wifi, a phone moving
 * between mobile data and a weak signal - can hang for minutes without ever
 * settling. Without a timeout the practice card sat there with every answer
 * button disabled and no message at all, and the only way out was reloading.
 */
export const REQUEST_TIMEOUT_MS = 15000;

export class ApiTimeoutError extends Error {
  /**
   * `retryable` because "try again" is right for a child's answer and dangerous
   * for a checkout.
   *
   * A timeout means the browser stopped waiting; it says nothing about whether the
   * server finished. On a purchase the server may well have created a Stripe
   * session and be about to send the parent to it, so "check your connection and
   * try again" is close to the worst instruction this page can give - it is how a
   * parent ends up with two live sessions and two charges for one intention.
   *
   * So the two cases say different things. A child's answer is safe to repeat and
   * the child is waiting, so they are told to try again. A checkout is not, so it
   * says what is actually true - nothing has been charged, because the card is
   * only ever charged on Stripe's own page and this request never got there - and
   * points at the account page, which can tell them whether a payment landed.
   */
  constructor(ms: number, retryable = true) {
    super(
      retryable
        ? `That took longer than ${Math.round(ms / 1000)} seconds. Check your connection and try again.`
        : `That took longer than ${Math.round(ms / 1000)} seconds. Your card has not been charged - no payment page was reached. Check your account page in a moment to see whether it went through.`,
    );
    this.name = "ApiTimeoutError";
  }
}

export async function api<T>(
  path: string,
  data?: unknown,
  options?: {
    keepalive?: boolean;
    timeoutMs?: number;
    /**
     * Extra headers, which is how a test drives this code against a real server.
     *
     * The browser does not need it: `credentials: "same-origin"` already carries
     * the session. Node's `fetch` has no cookie jar, so without this the only way
     * to exercise the real client path outside a browser would be to reimplement
     * it, and a reimplementation tests nothing.
     */
    headers?: Record<string, string>;
    /**
     * Set to false by the one request that must not be described as safe to
     * repeat: starting a purchase. A timeout there means the browser gave up, not
     * that the server did, so telling the parent to "try again" invites a second
     * session for one intention. Defaults to true, because everything else in this
     * app is a read or an answer.
     */
    safeToRetry?: boolean;
  },
): Promise<T> {
  const controller = new AbortController();
  const limit = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    const response = await fetch(path, {
      method: data ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      keepalive: options?.keepalive,
      signal: controller.signal,
    });
    const result = (await response.json()) as { error?: string; code?: string };
    if (!response.ok) {
      const error = new Error(
        result.error || "Unable to complete the request.",
      ) as Error & {
        status?: number;
        code?: string;
      };
      // Carried, because "not signed in" and "could not reach the server" need
      // opposite responses and the message alone cannot tell them apart: a 401
      // means fall back to the demo, a timeout means say so and keep what is on
      // screen.
      error.status = response.status;
      // The stable identifier, for the same reason and for the same callers. The
      // server already sends one for `email_unverified` - an interface cannot
      // tell a state it can act on from a failure by matching on message text,
      // because a message is written for people and gets reworded.
      if (result.code) error.code = result.code;
      throw error;
    }
    return result as T;
  } catch (cause) {
    // An abort is a timeout, not a cancelled navigation, and the two need very
    // different things said to a child.
    //
    // `options.safeToRetry` is set by the one caller for which repeating the
    // request is not obviously safe - starting a purchase. Everything else here is
    // either a read or an answer to a question, and repeating those costs nothing.
    if ((cause as Error)?.name === "AbortError")
      throw new ApiTimeoutError(limit, options?.safeToRetry ?? true);
    if (
      cause instanceof Error &&
      /network|fetch|load failed/i.test(cause.message)
    )
      throw new Error(
        options?.safeToRetry === false
          ? "No connection, so we could not reach the payment page. Your card has not been charged - check your account page in a moment."
          : "No connection. Check your internet and try again.",
      );
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
