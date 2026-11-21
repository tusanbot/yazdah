import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramWebAppUser {
  if (!initData || !botToken) throw new Error("telegram_auth_missing");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const userRaw = params.get("user");

  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isInteger(authDate) || !userRaw) {
    throw new Error("telegram_auth_malformed");
  }
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > 300) {
    throw new Error("telegram_auth_expired");
  }

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const supplied = Buffer.from(hash, "hex");

  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("telegram_auth_invalid_hash");
  }

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new Error("telegram_auth_invalid_user");
  }
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string") {
    throw new Error("telegram_auth_invalid_user");
  }
  return user;
}
