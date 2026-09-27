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
  constructor(ms: number) {
    super(
      `That took longer than ${Math.round(ms / 1000)} seconds. Check your connection and try again.`,
    );
    this.name = "ApiTimeoutError";
  }
}

export async function api<T>(
  path: string,
  data?: unknown,
  options?: { keepalive?: boolean; timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const limit = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    const response = await fetch(path, {
      method: data ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      keepalive: options?.keepalive,
      signal: controller.signal,
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(result.error || "Unable to complete the request.");
    return result as T;
  } catch (cause) {
    // An abort is a timeout, not a cancelled navigation, and the two need very
    // different things said to a child.
    if ((cause as Error)?.name === "AbortError")
      throw new ApiTimeoutError(limit);
    if (cause instanceof Error && /network|fetch|load failed/i.test(cause.message))
      throw new Error("No connection. Check your internet and try again.");
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
