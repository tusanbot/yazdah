import Fastify from "fastify";
import { createClient } from "@supabase/supabase-js";
import { verifyTelegramInitData } from "./telegram-auth.js";

const app = Fastify({ logger: true });
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

app.get("/health", async () => ({
  status: "ok",
  service: "yazdah-api",
  databaseConfigured: Boolean(supabase),
}));

app.post<{ Body: { initData?: string } }>("/auth/telegram", async (request, reply) => {
  if (!supabase || !botToken) {
    return reply.code(503).send({ error: "auth_not_configured" });
  }
  if (typeof request.body?.initData !== "string" || request.body.initData.length > 8192) {
    return reply.code(400).send({ error: "init_data_required" });
  }

  let telegramUser;
  try {
    telegramUser = verifyTelegramInitData(request.body.initData, botToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "telegram_auth_failed";
    return reply.code(401).send({ error: reason });
  }

  const { data, error } = await supabase
    .from("game_users")
    .upsert({
      telegram_user_id: telegramUser.id,
      username: telegramUser.username ?? null,
      first_name: telegramUser.first_name,
      last_name: telegramUser.last_name ?? null,
      language_code: telegramUser.language_code ?? "fa",
      updated_at: new Date().toISOString(),
    }, { onConflict: "telegram_user_id" })
    .select("id, telegram_user_id, username, first_name, last_name, language_code")
    .single();

  if (error) {
    request.log.error({ err: error }, "telegram user upsert failed");
    return reply.code(500).send({ error: "account_initialization_failed" });
  }

  return { user: data };
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
