export type InternalApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

export async function postInternalApi<T>(
  apiUrl: string,
  secret: string,
  path: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<InternalApiResult<T>> {
  const base = apiUrl.replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bot-Internal-Secret": secret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let data: T | null = null;
  let error: string | null = null;
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        data = parsed as T;
        const candidate = (parsed as { error?: unknown }).error;
        if (typeof candidate === "string") error = candidate;
      }
    } catch {
      error = "non_json_error";
    }
  } else if (!response.ok) {
    error = "empty_error_response";
  }

  return { ok: response.ok, status: response.status, data, error };
}
