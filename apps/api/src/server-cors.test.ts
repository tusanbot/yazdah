import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.CORS_ORIGINS = "https://web.example";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.BOT_INTERNAL_SECRET;

const { app } = await import("./server.js");

after(async () => {
  await app.close();
});

test("API CORS preflight completes without plugin boot and allows the configured origin", async () => {
  const response = await app.inject({
    method: "OPTIONS",
    url: "/auth/telegram",
    headers: {
      origin: "https://web.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://web.example");
  assert.equal(response.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
});

test("API rejects an unconfigured CORS origin", async () => {
  const response = await app.inject({
    method: "OPTIONS",
    url: "/auth/telegram",
    headers: { origin: "https://untrusted.example" },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: "origin_not_allowed" });
});

test("bot club creation route is registered and returns its configuration error instead of 404", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/internal/telegram-clubs/create",
    headers: { "content-type": "application/json" },
    payload: {},
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "club_creation_not_configured" });
});
