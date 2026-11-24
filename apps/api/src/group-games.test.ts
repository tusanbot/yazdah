import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify from "fastify";
import { registerGroupGameRoutes } from "./group-games.js";

const apps: ReturnType<typeof Fastify>[] = [];

async function makeApp(options: {
  supabase?: null | "mock";
  secret?: string;
  readSession?: (header?: string) => string | null;
} = {}) {
  const app = Fastify();
  apps.push(app);
  registerGroupGameRoutes(app, {
    supabase: options.supabase === "mock" ? {} as never : null,
    readSession: options.readSession ?? (() => null),
    botInternalSecret: options.secret,
  });
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

test("group game routes report an unavailable database without throwing", async () => {
  const app = await makeApp();
  const response = await app.inject({
    method: "GET",
    url: "/groups/-100123/games",
    headers: { authorization: "Bearer test-session" },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "database_not_configured" });
});

test("internal game creation fails closed when the shared secret is not configured", async () => {
  const app = await makeApp();
  const response = await app.inject({
    method: "POST",
    url: "/internal/telegram-groups/games",
    payload: {
      telegramUserId: 123,
      telegramChatId: -100123,
      gameType: "quiz",
      entryFee: 0,
      maxParticipants: 2,
    },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "group_games_not_configured" });
});

test("internal game creation rejects missing or incorrect bot credentials", async () => {
  const app = await makeApp({ supabase: "mock", secret: "configured-secret" });
  const missing = await app.inject({
    method: "POST",
    url: "/internal/telegram-groups/games",
    payload: {},
  });
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(missing.json(), { error: "bot_auth_invalid" });

  const incorrect = await app.inject({
    method: "POST",
    url: "/internal/telegram-groups/games",
    headers: { "x-bot-internal-secret": "wrong-secret" },
    payload: {},
  });
  assert.equal(incorrect.statusCode, 401);
  assert.deepEqual(incorrect.json(), { error: "bot_auth_invalid" });
});

test("group game routes reject missing user sessions", async () => {
  const app = await makeApp({
    supabase: "mock",
    readSession: () => null,
  });
  const response = await app.inject({
    method: "GET",
    url: "/groups/-100123/games",
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "session_invalid_or_expired" });
});
