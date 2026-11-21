import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { verifyTelegramInitData } from "./telegram-auth.js";

const app = Fastify({ logger: true });
const allowedOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("origin_not_allowed"), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const sessionSecret = process.env.SESSION_SECRET;

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

function signSession(userId: string): string {
  if (!sessionSecret) throw new Error("session_secret_missing");
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(header?: string): string | null {
  if (!sessionSecret || !header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", sessionSecret).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    if (!claims.sub || !Number.isInteger(claims.exp) || claims.exp! <= Math.floor(Date.now() / 1000)) return null;
    return claims.sub;
  } catch { return null; }
}

app.get("/health", async () => ({
  status: "ok",
  service: "yazdah-api",
  databaseConfigured: Boolean(supabase),
}));

app.post<{ Body: { initData?: string } }>("/auth/telegram", async (request, reply) => {
  if (!supabase || !botToken || !sessionSecret) {
    return reply.code(503).send({ error: "auth_not_configured" });
  }
  if (typeof request.body?.initData !== "string" || request.body.initData.length > 8192) {
    return reply.code(400).send({ error: "init_data_required" });
  }

  let telegramUser;
  try {
    telegramUser = verifyTelegramInitData(request.body.initData, botToken);
  } catch {
    return reply.code(401).send({ error: "telegram_auth_failed" });
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

  return { user: data, accessToken: signSession(data.id), expiresIn: 900 };
});

app.get("/clubs/me", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });

  const { data: membership, error: membershipError } = await supabase
    .from("club_memberships")
    .select("club_id, role")
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();

  if (membershipError) {
    request.log.error({ err: membershipError }, "club membership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!membership) return { club: null };

  const [clubResult, economyResult, tacticsResult] = await Promise.all([
    supabase.from("clubs")
      .select("id, name, slug, logo_url, country_code, city, founded_at, level, reputation, created_at")
      .eq("id", membership.club_id)
      .single(),
    supabase.from("club_economy").select("balance").eq("club_id", membership.club_id).single(),
    supabase.from("club_tactics").select("formation, mentality, tempo, pressing")
      .eq("club_id", membership.club_id).single(),
  ]);

  if (clubResult.error || economyResult.error || tacticsResult.error) {
    request.log.error({
      club: clubResult.error,
      economy: economyResult.error,
      tactics: tacticsResult.error,
    }, "club profile lookup failed");
    return reply.code(500).send({ error: "club_profile_load_failed" });
  }

  return {
    club: {
      ...clubResult.data,
      role: membership.role,
      economy: economyResult.data,
      tactics: tacticsResult.data,
    },
  };
});

app.post<{ Body: { name?: string; slug?: string; logoUrl?: string; countryCode?: string; city?: string } }>(
  "/clubs",
  async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });

    const { name, slug, logoUrl, countryCode, city } = request.body ?? {};
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60 ||
        typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{2,39}$/i.test(slug)) {
      return reply.code(400).send({ error: "club_name_or_slug_invalid" });
    }
    if (logoUrl !== undefined && (typeof logoUrl !== "string" || logoUrl.length > 2048)) {
      return reply.code(400).send({ error: "logo_url_invalid" });
    }
    if (countryCode !== undefined && (typeof countryCode !== "string" || !/^[A-Za-z]{2}$/.test(countryCode))) {
      return reply.code(400).send({ error: "country_code_invalid" });
    }
    if (city !== undefined && (typeof city !== "string" || city.trim().length > 100)) {
      return reply.code(400).send({ error: "city_invalid" });
    }

    const { data, error } = await supabase.rpc("create_club_for_user", {
      p_user_id: userId,
      p_name: name.trim(),
      p_slug: slug.toLowerCase(),
      p_logo_url: logoUrl ?? null,
      p_country_code: countryCode?.toUpperCase() ?? null,
      p_city: city?.trim() ?? null,
    });
    if (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "club_conflict_or_already_owned" });
      if (error.code === "22023") return reply.code(400).send({ error: "club_input_invalid" });
      request.log.error({ err: error }, "club creation failed");
      return reply.code(500).send({ error: "club_creation_failed" });
    }
    return reply.code(201).send({ clubId: data });
  },
);

async function ownedClubId(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("club_memberships")
    .select("club_id").eq("user_id", userId).eq("role", "owner").maybeSingle();
  if (error) throw error;
  return data?.club_id ?? null;
}

app.get("/market", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  try {
    const { data, error } = await supabase.from("transfer_listings")
      .select("id, asking_price, listed_at, expires_at, player:players(id, full_name, position, overall, potential, nationality_code), seller:clubs!transfer_listings_seller_club_id_fkey(id, name, slug)")
      .eq("status", "listed").order("listed_at", { ascending: false }).limit(50);
    if (error) throw error;
    return { listings: data ?? [] };
  } catch (error) {
    request.log.error({ err: error }, "transfer market lookup failed");
    return reply.code(500).send({ error: "market_load_failed" });
  }
});

app.get("/inbox", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  const { data, error } = await supabase.from("game_inbox")
    .select("id, category, title, body, payload, read_at, created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  if (error) {
    request.log.error({ err: error }, "inbox lookup failed");
    return reply.code(500).send({ error: "inbox_load_failed" });
  }
  return { messages: data ?? [] };
});

app.post<{ Body: { formation?: string; mentality?: string; tempo?: string; pressing?: string } }>(
  "/clubs/me/tactics",
  async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    let clubId: string | null;
    try { clubId = await ownedClubId(userId); }
    catch (error) {
      request.log.error({ err: error }, "club ownership lookup failed");
      return reply.code(500).send({ error: "club_lookup_failed" });
    }
    if (!clubId) return reply.code(404).send({ error: "club_not_found" });

    const { formation, mentality, tempo, pressing } = request.body ?? {};
    if (formation !== undefined && !/^(4-4-2|4-3-3|4-2-3-1|3-5-2|5-3-2)$/.test(formation)) {
      return reply.code(400).send({ error: "formation_invalid" });
    }
    if (mentality !== undefined && !["very_defensive", "defensive", "balanced", "attacking", "very_attacking"].includes(mentality)) {
      return reply.code(400).send({ error: "mentality_invalid" });
    }
    if (tempo !== undefined && !["slow", "normal", "fast"].includes(tempo)) {
      return reply.code(400).send({ error: "tempo_invalid" });
    }
    if (pressing !== undefined && !["low", "standard", "high"].includes(pressing)) {
      return reply.code(400).send({ error: "pressing_invalid" });
    }
    const { data, error } = await supabase.from("club_tactics").upsert({
      club_id: clubId,
      ...(formation !== undefined ? { formation } : {}),
      ...(mentality !== undefined ? { mentality } : {}),
      ...(tempo !== undefined ? { tempo } : {}),
      ...(pressing !== undefined ? { pressing } : {}),
      updated_at: new Date().toISOString(),
    }).select("formation, mentality, tempo, pressing").single();
    if (error) {
      request.log.error({ err: error }, "tactics update failed");
      return reply.code(500).send({ error: "tactics_update_failed" });
    }
    return { tactics: data };
  },
);

app.post<{ Body: { playerIds?: string[] } }>("/clubs/me/lineup", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const playerIds = request.body?.playerIds;
  if (!Array.isArray(playerIds) || playerIds.length !== 11 ||
      playerIds.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ||
      new Set(playerIds).size !== 11) {
    return reply.code(400).send({ error: "lineup_requires_11_unique_player_ids" });
  }
  const { error } = await supabase.rpc("set_club_lineup", {
    p_club_id: clubId,
    p_player_ids: playerIds,
  });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: "lineup_players_invalid_or_not_owned" });
    request.log.error({ err: error }, "lineup update failed");
    return reply.code(500).send({ error: "lineup_update_failed" });
  }
  return { success: true };
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
