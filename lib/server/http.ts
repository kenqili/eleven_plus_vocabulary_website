export class HttpError extends Error {
  /**
   * A stable identifier for the failure, for the interface to act on.
   *
   * Not every error needs one. This exists because some refusals are not failures
   * but states the parent can do something about - an address that has not been
   * confirmed, most of all - and an interface cannot reliably tell those apart by
   * matching on the message text. The message is for people; this is for code.
   */
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
export async function boundary(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HttpError)
      return json(
        // The code is omitted when there is none, so the shape of a response does
        // not change for the errors that do not have one.
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        error.status,
      );
    console.error(
      "MineWords request failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return json({ error: "Something went wrong. Please try again." }, 503);
  }
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new HttpError(403, "Please submit this form from MineWords.");
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Expected JSON.");
  const text = await request.text();
  if (text.length > 16384) throw new HttpError(413, "Request is too large.");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
      throw Error();
    return parsed;
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}
