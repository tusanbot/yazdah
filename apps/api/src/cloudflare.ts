import { createClient } from "@supabase/supabase-js";
import { app } from "./server.js";

type TelegramSectionBody = { telegramUserId?: number; section?: string };
type TelegramCreateBody = {
  telegramUserId?: number; firstName?: string; lastName?: string;
  username?: string; name?: string; slug?: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function sameSecret(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

async function handleTelegramSection(request: Request, supabase: ReturnType<typeof createClient>, internalSecret: string): Promise<Response> {
  const supplied = request.headers.get("x-bot-internal-secret");
  if (!supplied) return json({ error: "bot_auth_required" }, 401);
  if (!sameSecret(supplied, internalSecret)) return json({ error: "bot_auth_invalid" }, 401);

  let body: TelegramSectionBody;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) return json({ error: "telegram_section_input_invalid" }, 400);
    body = parsed as TelegramSectionBody;
  } catch {
    return json({ error: "telegram_section_input_invalid" }, 400);
  }

  const allowedSections = ["overview", "squad", "matches", "finance", "missions", "staff", "academy", "tactics"];
  if (!Number.isSafeInteger(body.telegramUserId) || typeof body.section !== "string" || !allowedSections.includes(body.section)) {
    return json({ error: "telegram_section_input_invalid" }, 400);
  }

  const { data: user, error: userError } = await supabase.from("game_users")
    .select("id").eq("telegram_user_id", body.telegramUserId).maybeSingle();
  if (userError) return json({ error: "telegram_user_lookup_failed" }, 500);
  if (!user) return json({ error: "telegram_user_not_registered" }, 404);

  const { data: membership, error: membershipError } = await supabase.from("club_memberships")
    .select("club_id").eq("user_id", user.id).eq("role", "owner").maybeSingle();
  if (membershipError) return json({ error: "club_lookup_failed" }, 500);
  if (!membership) return json({ error: "club_not_found" }, 404);

  // The bot's /start flow requests the overview. Handle it natively in Workers;
  // other sections continue through the existing Fastify route adapter.
  if (body.section !== "overview") return json({ error: "worker_native_section_not_supported" }, 501);

  const clubId = membership.club_id;
  const [club, economy, players, matches] = await Promise.all([
    supabase.from("clubs").select("name,slug,level,reputation,city").eq("id", clubId).single(),
    supabase.from("club_economy").select("balance").eq("club_id", clubId).single(),
    supabase.from("players").select("id", { count: "exact", head: true }).eq("club_id", clubId),
    supabase.from("matches").select("id", { count: "exact", head: true }).or(`home_club_id.eq.${clubId},away_club_id.eq.${clubId}`),
  ]);
  const error = club.error ?? economy.error ?? players.error ?? matches.error;
  if (error || !club.data || !economy.data) return json({ error: "club_overview_load_failed" }, 500);
  return json({
    section: "overview", club: club.data, balance: economy.data.balance,
    playerCount: players.count ?? 0, matchCount: matches.count ?? 0,
  });
}

async function handleTelegramClubCreate(request: Request, supabase: ReturnType<typeof createClient>, internalSecret: string): Promise<Response> {
  const supplied = request.headers.get("x-bot-internal-secret");
  if (!supplied) return json({ error: "bot_auth_required" }, 401);
  if (!sameSecret(supplied, internalSecret)) return json({ error: "bot_auth_invalid" }, 401);

  let body: TelegramCreateBody;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) return json({ error: "club_name_or_slug_invalid" }, 400);
    body = parsed as TelegramCreateBody;
  } catch {
    return json({ error: "club_name_or_slug_invalid" }, 400);
  }

  const { telegramUserId, firstName, lastName, username, name, slug } = body;
  if (!Number.isSafeInteger(telegramUserId) || typeof firstName !== "string" || !firstName.trim() ||
      typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60 ||
      typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{2,39}$/i.test(slug)) {
    return json({ error: "club_name_or_slug_invalid" }, 400);
  }

  const { data: user, error: userError } = await supabase.from("game_users").upsert({
    telegram_user_id: telegramUserId,
    username: typeof username === "string" ? username : null,
    first_name: firstName.trim(),
    last_name: typeof lastName === "string" ? lastName : null,
    language_code: "fa",
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id" }).select("id").single();
  if (userError || !user) return json({ error: "account_initialization_failed" }, 500);

  const { data: clubId, error } = await supabase.rpc("create_club_for_user", {
    p_user_id: user.id, p_name: name.trim(), p_slug: slug.toLowerCase(),
    p_logo_url: null, p_country_code: null, p_city: null,
  });
  if (error) {
    if (error.code === "23505") return json({ error: "club_conflict_or_already_owned" }, 409);
    if (error.code === "22023") return json({ error: "club_name_or_slug_invalid" }, 400);
    return json({ error: "club_creation_failed" }, 500);
  }
  return json({ clubId }, 201);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const internalSecret = process.env.BOT_INTERNAL_SECRET;

    if (url.pathname.startsWith("/internal/telegram-clubs/") && request.method === "POST") {
      if (!supabaseUrl || !serviceRoleKey || !internalSecret) {
        return json({ error: "telegram_clubs_not_configured" }, 503);
      }
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      try {
        if (url.pathname === "/internal/telegram-clubs/section") {
          return await handleTelegramSection(request, supabase, internalSecret);
        }
        if (url.pathname === "/internal/telegram-clubs/create") {
          return await handleTelegramClubCreate(request, supabase, internalSecret);
        }
      } catch {
        return json({ error: "telegram_club_request_failed" }, 500);
      }
    }

    const payload = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text();
    const response = await app.inject({
      method: request.method,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers.entries()),
      payload,
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as HeadersInit,
    });
  },
};

// Keep the historical Durable Object class export available while existing
// Cloudflare instances still reference its namespace. The current API no
// longer routes work through this class; retain a safe, explicit tombstone.
export class MatchCoordinator {
  async fetch(request: Request): Promise<Response> {
    void request;
    return new Response("MatchCoordinator is retired.", { status: 410 });
  }
}
