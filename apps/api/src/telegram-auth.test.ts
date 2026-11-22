import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyTelegramInitData } from "./telegram-auth.js";

const token = "123456:example-token";
const now = 1_800_000_000;

function makeInitData(user: Record<string, unknown>, authDate = now): string {
  const values = new Map<string, string>([
    ["auth_date", String(authDate)],
    ["query_id", "AAE-test-query"],
    ["user", JSON.stringify(user)],
  ]);
  const checkString = [...values.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  values.set("hash", hash);
  return new URLSearchParams([...values.entries()]).toString();
}

test("accepts valid signed Telegram initData", () => {
  const data = makeInitData({ id: 12345, first_name: "Test", username: "test_user" });
  assert.deepEqual(verifyTelegramInitData(data, token, now), {
    id: 12345, first_name: "Test", username: "test_user",
  });
});

test("rejects expired initData", () => {
  const data = makeInitData({ id: 12345, first_name: "Test" }, now - 301);
  assert.throws(() => verifyTelegramInitData(data, token, now), /telegram_auth_expired/);
});

test("rejects altered user data", () => {
  const data = makeInitData({ id: 12345, first_name: "Test" }).replace("Test", "Other");
  assert.throws(() => verifyTelegramInitData(data, token, now), /telegram_auth_invalid_hash/);
});

test("rejects malformed user identity", () => {
  const data = makeInitData({ id: -5, first_name: "Test" });
  assert.throws(() => verifyTelegramInitData(data, token, now), /telegram_auth_invalid_user/);
});
