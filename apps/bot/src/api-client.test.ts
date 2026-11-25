import assert from "node:assert/strict";
import test from "node:test";
import { postInternalApi } from "./api-client.js";

const originalFetch = globalThis.fetch;

test("posts to the normalized API path with internal auth and parses JSON", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ clubId: "club-1" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await postInternalApi<{ clubId: string }>(
      "https://api.example.test/",
      "secret",
      "/internal/telegram-clubs/create",
      { name: "Test Club" },
    );

    assert.equal(requestUrl, "https://api.example.test/internal/telegram-clubs/create");
    assert.equal(requestInit?.method, "POST");
    assert.equal(new Headers(requestInit?.headers).get("X-Bot-Internal-Secret"), "secret");
    assert.deepEqual(result, {
      ok: true,
      status: 201,
      data: { clubId: "club-1" },
      error: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a controlled error for non-JSON API responses", async () => {
  globalThis.fetch = (async () => new Response("<html>not found</html>", { status: 404 })) as typeof fetch;
  try {
    const result = await postInternalApi("https://api.example.test", "secret", "/missing", {});
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.data, null);
    assert.equal(result.error, "non_json_error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a controlled error for empty error responses", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
  try {
    const result = await postInternalApi("https://api.example.test", "secret", "/missing", {});
    assert.equal(result.error, "empty_error_response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
