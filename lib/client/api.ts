export async function api<T>(
  path: string,
  data?: unknown,
  options?: { keepalive?: boolean },
): Promise<T> {
  const response = await fetch(path, {
    method: data ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    keepalive: options?.keepalive,
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new Error(result.error || "Unable to complete the request.");
  return result as T;
}
