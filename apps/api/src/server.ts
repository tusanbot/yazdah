import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { verifyTelegramInitData } from "./telegram-auth.js";
import { registerGroupGameRoutes } from "./group-games.js";

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
const botInternalSecret = process.env.BOT_INTERNAL_SECRET;

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

app.post<{ Body: { telegramUserId?: number; telegramChatId?: number; title?: string } }>("/internal/telegram-groups/link", async (request, reply) => {
  if (!supabase || !botInternalSecret) return reply.code(503).send({ error: "group_linking_not_configured" });
  const supplied = request.headers["x-bot-internal-secret"];
  if (typeof supplied !== "string") return reply.code(401).send({ error: "bot_auth_required" });
  const expected = Buffer.from(botInternalSecret);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return reply.code(401).send({ error: "bot_auth_invalid" });
  }
  const { telegramUserId, telegramChatId, title } = request.body ?? {};
  if (!Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(telegramChatId) ||
      typeof title !== "string" || title.trim().length < 1 || title.trim().length > 200) {
    return reply.code(400).send({ error: "telegram_group_input_invalid" });
  }
  const { data: user, error: userError } = await supabase.from("game_users")
    .select("id").eq("telegram_user_id", telegramUserId).maybeSingle();
  if (userError) {
    request.log.error({ err: userError }, "telegram group linker lookup failed");
    return reply.code(500).send({ error: "group_linker_lookup_failed" });
  }
  if (!user) return reply.code(404).send({ error: "telegram_user_not_registered" });
  const { data: membership, error: membershipError } = await supabase.from("club_memberships")
    .select("club_id").eq("user_id", user.id).eq("role", "owner").maybeSingle();
  if (membershipError) {
    request.log.error({ err: membershipError }, "telegram group owner lookup failed");
    return reply.code(500).send({ error: "group_linker_club_lookup_failed" });
  }
  if (!membership) return reply.code(409).send({ error: "club_required_before_group_link" });
  const { data: existingGroup, error: existingGroupError } = await supabase.from("telegram_game_groups")
    .select("linked_by_user_id").eq("telegram_chat_id", telegramChatId).maybeSingle();
  if (existingGroupError) return reply.code(500).send({ error: "telegram_group_lookup_failed" });
  if (existingGroup && existingGroup.linked_by_user_id !== user.id) {
    return reply.code(409).send({ error: "telegram_group_already_linked" });
  }
  const { error } = await supabase.from("telegram_game_groups").upsert({
    telegram_chat_id: telegramChatId,
    title: title.trim(),
    linked_by_user_id: user.id,
  }, { onConflict: "telegram_chat_id" });
  if (error) {
    request.log.error({ err: error }, "telegram group link failed");
    return reply.code(500).send({ error: "telegram_group_link_failed" });
  }
  return { linked: true, telegramChatId };
});

async function requireAdmin(userId: string) {
  if (!supabase) return { allowed: false, error: "database_not_configured" };
  const { data, error } = await supabase.from("game_admins").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return { allowed: Boolean(data), role: data?.role ?? null };
}

app.get("/admin/overview", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let admin;
  try { admin = await requireAdmin(userId); } catch (error) {
    request.log.error({ err: error }, "admin permission lookup failed");
    return reply.code(500).send({ error: "admin_permission_lookup_failed" });
  }
  if (!admin.allowed) return reply.code(403).send({ error: "admin_access_required" });
  const [users, clubs, matches, pending, failed] = await Promise.all([
    supabase.from("game_users").select("id", { count: "exact", head: true }),
    supabase.from("clubs").select("id", { count: "exact", head: true }),
    supabase.from("matches").select("id", { count: "exact", head: true }),
    supabase.from("telegram_notification_outbox").select("id", { count: "exact", head: true }).in("status", ["pending","processing"]),
    supabase.from("telegram_notification_outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  const failedQuery = [users, clubs, matches, pending, failed].find((item) => item.error);
  if (failedQuery?.error) {
    request.log.error({ err: failedQuery.error }, "admin overview query failed");
    return reply.code(500).send({ error: "admin_overview_failed" });
  }
  const { data: failedNotifications, error: failedNotificationError } = await supabase.from("telegram_notification_outbox")
    .select("id,match_id,telegram_user_id,attempts,last_error,created_at")
    .eq("status", "failed").order("created_at", { ascending: false }).limit(20);
  if (failedNotificationError) return reply.code(500).send({ error: "admin_notifications_load_failed" });
  const { data: recentAudit, error: auditError } = await supabase.from("admin_audit_log")
    .select("id,actor_user_id,action,target_type,target_id,details,created_at")
    .order("created_at", { ascending: false }).limit(20);
  if (auditError) return reply.code(500).send({ error: "admin_audit_load_failed" });
  return { role: admin.role, stats: {
    users: users.count ?? 0, clubs: clubs.count ?? 0, matches: matches.count ?? 0,
    notificationsPending: pending.count ?? 0, notificationsFailed: failed.count ?? 0,
  }, recentAudit: recentAudit ?? [], failedNotifications: failedNotifications ?? [] };
});

app.post<{ Params: { id: string } }>("/admin/notifications/:id/retry", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let admin;
  try { admin = await requireAdmin(userId); } catch (error) {
    request.log.error({ err: error }, "admin permission lookup failed");
    return reply.code(500).send({ error: "admin_permission_lookup_failed" });
  }
  if (!admin.allowed) return reply.code(403).send({ error: "admin_access_required" });
  const notificationId = request.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) {
    return reply.code(400).send({ error: "notification_id_invalid" });
  }
  const { data, error } = await supabase.rpc("admin_retry_telegram_notification", {
    p_actor_user_id: userId, p_notification_id: notificationId,
  });
  if (error) {
    if (error.code === "42501") return reply.code(403).send({ error: "admin_access_required" });
    request.log.error({ err: error }, "admin notification retry failed");
    return reply.code(500).send({ error: "notification_retry_failed" });
  }
  if (!data) return reply.code(409).send({ error: "notification_not_failed_or_not_found" });
  return { retried: true, notificationId };
});

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

app.get("/clubs/me/players", async (request, reply) => {
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

  const { data, error } = await supabase.from("players")
    .select("id, full_name, birth_date, nationality_code, position, overall, potential, fitness, morale, contract_until, weekly_wage, player_class, ordinary_tier, release_clause, acquisition_source, squad_slot:club_squad_slots(slot_no)")
    .eq("club_id", clubId).order("overall", { ascending: false }).order("full_name", { ascending: true });
  if (error) {
    request.log.error({ err: error }, "club roster lookup failed");
    return reply.code(500).send({ error: "players_load_failed" });
  }
  return { players: data ?? [] };
});

app.post<{ Body: { playerId?: string; contractUntil?: string; weeklyWage?: number } }>("/clubs/me/players/renew-contract", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) { request.log.error({ err: error }, "club ownership lookup failed"); return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { playerId, contractUntil, weeklyWage } = request.body ?? {};
  if (typeof playerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId) ||
      typeof contractUntil !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(contractUntil) ||
      !Number.isSafeInteger(weeklyWage) || weeklyWage! < 0 || weeklyWage! > 100000000) {
    return reply.code(400).send({ error: "player_contract_input_invalid" });
  }
  const { error } = await supabase.rpc("renew_player_contract", {
    p_club_id: clubId, p_player_id: playerId, p_contract_until: contractUntil, p_weekly_wage: weeklyWage,
  });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: "player_contract_input_invalid" });
    if (error.code === "P0002") return reply.code(404).send({ error: "player_not_owned" });
    request.log.error({ err: error }, "player contract renewal failed");
    return reply.code(500).send({ error: "player_contract_renewal_failed" });
  }
  return { renewed: true };
});

app.get("/clubs/me/training-plan", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) { request.log.error({ err: error }, "club ownership lookup failed"); return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { data, error } = await supabase.from("club_training_preferences").select("plan").eq("club_id", clubId).maybeSingle();
  if (error) { request.log.error({ err: error }, "training plan lookup failed"); return reply.code(500).send({ error: "training_plan_load_failed" }); }
  return { plan: data?.plan ?? "balanced" };
});

app.post<{ Body: { plan?: string } }>("/clubs/me/training-plan", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) { request.log.error({ err: error }, "club ownership lookup failed"); return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const plan = request.body?.plan;
  if (typeof plan !== "string" || !["balanced","development","recovery"].includes(plan)) return reply.code(400).send({ error: "training_plan_invalid" });
  const { error } = await supabase.rpc("set_club_training_plan", { p_club_id: clubId, p_plan: plan });
  if (error) { request.log.error({ err: error }, "training plan update failed"); return reply.code(500).send({ error: "training_plan_update_failed" }); }
  return { plan };
});

app.get("/market", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  try {
    const { data, error } = await supabase.from("transfer_listings")
      .select("id, asking_price, listed_at, expires_at, player:players(id, full_name, position, overall, potential, nationality_code), seller:clubs!transfer_listings_seller_club_id_fkey(id, name, slug)")
      .eq("status", "listed").or("expires_at.is.null,expires_at.gt." + new Date().toISOString()).order("listed_at", { ascending: false }).limit(50);
    if (error) throw error;
    return { listings: data ?? [] };
  } catch (error) {
    request.log.error({ err: error }, "transfer market lookup failed");
    return reply.code(500).send({ error: "market_load_failed" });
  }
});

app.get("/clubs/me/transfer-listings", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { data, error } = await supabase.from("transfer_listings")
    .select("id, player_id, asking_price, listed_at, expires_at, status")
    .eq("seller_club_id", clubId).eq("status", "listed").order("listed_at", { ascending: false });
  if (error) {
    request.log.error({ err: error }, "club transfer listings lookup failed");
    return reply.code(500).send({ error: "transfer_listings_load_failed" });
  }
  return { listings: data ?? [] };
});

app.post<{ Body: { playerId?: string; askingPrice?: number } }>("/clubs/me/transfer-listings", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { playerId, askingPrice } = request.body ?? {};
  if (typeof playerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId) ||
      !Number.isSafeInteger(askingPrice) || askingPrice! < 1 || askingPrice! > 1000000000000) {
    return reply.code(400).send({ error: "transfer_input_invalid" });
  }
  const { data, error } = await supabase.rpc("list_player_for_transfer", {
    p_club_id: clubId, p_player_id: playerId, p_asking_price: askingPrice,
  });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: "transfer_player_invalid_or_not_owned" });
    if (error.code === "23505") return reply.code(409).send({ error: "transfer_already_listed" });
    request.log.error({ err: error }, "player listing failed");
    return reply.code(500).send({ error: "transfer_listing_failed" });
  }
  return reply.code(201).send({ listingId: data });
});

app.post<{ Body: { listingId?: string } }>("/market/buy", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const listingId = request.body?.listingId;
  if (typeof listingId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId)) {
    return reply.code(400).send({ error: "transfer_listing_id_invalid" });
  }
  const { error } = await supabase.rpc("buy_transfer_listing", { p_buyer_club_id: clubId, p_listing_id: listingId });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: error.message.includes("insufficient_funds") ? "insufficient_funds" : "transfer_unavailable" });
    if (error.code === "P0002") return reply.code(404).send({ error: "transfer_listing_not_found" });
    request.log.error({ err: error }, "transfer purchase failed");
    return reply.code(500).send({ error: "transfer_purchase_failed" });
  }
  return { success: true };
});

app.post<{ Body: { listingId?: string } }>("/clubs/me/transfer-listings/withdraw", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const listingId = request.body?.listingId;
  if (typeof listingId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId)) {
    return reply.code(400).send({ error: "transfer_listing_id_invalid" });
  }
  const { error } = await supabase.rpc("withdraw_transfer_listing", { p_club_id: clubId, p_listing_id: listingId });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: "transfer_listing_not_owned_or_unavailable" });
    if (error.code === "P0002") return reply.code(404).send({ error: "transfer_listing_not_found" });
    request.log.error({ err: error }, "transfer listing withdrawal failed");
    return reply.code(500).send({ error: "transfer_withdraw_failed" });
  }
  return { success: true };
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

app.get("/clubs/me/matches", async (request, reply) => {
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
  const { data, error } = await supabase.from("matches")
    .select("id, competition_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, competition:competitions(name, competition_type, season)")
    .or(`home_club_id.eq.${clubId},away_club_id.eq.${clubId}`)
    .order("kickoff_at", { ascending: false }).limit(30);
  if (error) {
    request.log.error({ err: error }, "club matches lookup failed");
    return reply.code(500).send({ error: "matches_load_failed" });
  }
  return { matches: data ?? [] };
});

app.post<{ Params: { matchId: string } }>("/clubs/me/matches/:matchId/resolve", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  const matchId = request.params.matchId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(matchId)) {
    return reply.code(400).send({ error: "match_id_invalid" });
  }

  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });

  const { data: match, error: matchError } = await supabase.from("matches")
    .select("id, home_club_id, away_club_id, kickoff_at, status")
    .eq("id", matchId).maybeSingle();
  if (matchError) {
    request.log.error({ err: matchError }, "match lookup failed");
    return reply.code(500).send({ error: "match_lookup_failed" });
  }
  if (!match) return reply.code(404).send({ error: "match_not_found" });
  if (match.home_club_id !== clubId && match.away_club_id !== clubId) {
    return reply.code(403).send({ error: "match_not_owned" });
  }
  if (new Date(match.kickoff_at).getTime() > Date.now()) {
    return reply.code(409).send({ error: "match_not_started" });
  }

  const { data, error } = await supabase.rpc("resolve_match", { p_match_id: matchId });
  if (error) {
    if (error.message.includes("match_not_started")) return reply.code(409).send({ error: "match_not_started" });
    if (error.message.includes("match_not_resolvable")) return reply.code(409).send({ error: "match_not_resolvable" });
    request.log.error({ err: error }, "match resolution failed");
    return reply.code(500).send({ error: "match_resolution_failed" });
  }
  return { match: data };
});

app.get("/competitions", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  const { data, error } = await supabase.from("competitions")
    .select("id, name, competition_type, season, status, starts_at")
    .in("status", ["scheduled", "running"])
    .order("starts_at", { ascending: true, nullsFirst: false }).limit(50);
  if (error) {
    request.log.error({ err: error }, "competitions lookup failed");
    return reply.code(500).send({ error: "competitions_load_failed" });
  }
  return { competitions: data ?? [] };
});

app.get<{ Params: { competitionId: string } }>("/competitions/:competitionId/standings", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  const competitionId = request.params.competitionId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(competitionId)) {
    return reply.code(400).send({ error: "competition_id_invalid" });
  }
  const { data, error } = await supabase.from("competition_entries")
    .select("club_id, points, played, wins, draws, losses, goals_for, goals_against, club:clubs(name, slug)")
    .eq("competition_id", competitionId)
    .order("points", { ascending: false })
    .order("goals_for", { ascending: false })
    .order("goals_against", { ascending: true })
    .limit(100);
  if (error) {
    request.log.error({ err: error }, "competition standings lookup failed");
    return reply.code(500).send({ error: "competition_standings_load_failed" });
  }
  return { standings: data ?? [] };
});

app.post<{ Body: { fullName?: string; birthDate?: string; position?: string; potential?: number } }>("/clubs/me/academy", async (request, reply) => {
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

  const { fullName, birthDate, position, potential } = request.body ?? {};
  if (typeof fullName !== "string" || fullName.trim().length < 2 || fullName.trim().length > 80 ||
      typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
      typeof position !== "string" || !["GK","CB","LB","RB","DM","CM","AM","LW","RW","ST"].includes(position) ||
      !Number.isInteger(potential) || potential! < 1 || potential! > 100) {
    return reply.code(400).send({ error: "academy_input_invalid" });
  }
  const { data, error } = await supabase.rpc("recruit_academy_player", {
    p_club_id: clubId, p_full_name: fullName.trim(), p_birth_date: birthDate,
    p_position: position, p_potential: potential,
  });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: "academy_input_invalid" });
    request.log.error({ err: error }, "academy recruitment failed");
    return reply.code(500).send({ error: "academy_recruitment_failed" });
  }
  return reply.code(201).send({ prospectId: data });
});

app.get("/clubs/me/staff", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { data, error } = await supabase.from("club_staff")
    .select("id, full_name, staff_role, staff_tier, specialty, skill, weekly_wage, signing_fee, generated_source, effect_profile, contract_until, hired_at, released_at")
    .eq("club_id", clubId).order("hired_at", { ascending: false }).limit(100);
  if (error) {
    request.log.error({ err: error }, "staff lookup failed");
    return reply.code(500).send({ error: "staff_load_failed" });
  }
  return { staff: data ?? [] };
});

app.post<{ Body: { fullName?: string; staffRole?: string; specialty?: string; skill?: number; weeklyWage?: number; contractUntil?: string; idempotencyKey?: string } }>("/clubs/me/staff", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { fullName, staffRole, specialty, skill, weeklyWage, contractUntil, idempotencyKey } = request.body ?? {};
  if (typeof fullName !== "string" || fullName.trim().length < 2 || fullName.trim().length > 80 ||
      typeof staffRole !== "string" || !["head_coach","coach","technical","medical","fitness","transfer_director"].includes(staffRole) ||
      (specialty !== undefined && (typeof specialty !== "string" || specialty.length > 80)) ||
      !Number.isInteger(skill) || skill! < 1 || skill! > 100 ||
      !Number.isSafeInteger(weeklyWage) || weeklyWage! < 0 || weeklyWage! > 100000000 ||
      typeof contractUntil !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(contractUntil) ||
      typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 160) {
    return reply.code(400).send({ error: "staff_input_invalid" });
  }
  const { data, error } = await supabase.rpc("hire_club_staff", {
    p_club_id: clubId, p_full_name: fullName.trim(), p_staff_role: staffRole,
    p_specialty: specialty ?? null, p_skill: skill, p_weekly_wage: weeklyWage,
    p_contract_until: contractUntil, p_idempotency_key: idempotencyKey,
  });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: error.message === "insufficient_funds" ? "insufficient_funds" : "staff_input_invalid" });
    request.log.error({ err: error }, "staff hiring failed");
    return reply.code(500).send({ error: "staff_hiring_failed" });
  }
  return reply.code(201).send({ staffId: data });
});

app.post<{ Body: { staffId?: string } }>("/clubs/me/staff/release", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch (error) {
    request.log.error({ err: error }, "club ownership lookup failed");
    return reply.code(500).send({ error: "club_lookup_failed" });
  }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const staffId = request.body?.staffId;
  if (typeof staffId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(staffId)) {
    return reply.code(400).send({ error: "staff_id_invalid" });
  }
  const { data, error } = await supabase.rpc("release_club_staff", { p_club_id: clubId, p_staff_id: staffId });
  if (error) {
    request.log.error({ err: error }, "staff release failed");
    return reply.code(500).send({ error: "staff_release_failed" });
  }
  if (!data) return reply.code(404).send({ error: "active_staff_not_found" });
  return { released: true };
});

app.get("/clubs/me/academy", async (request, reply) => {
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
  const { data, error } = await supabase.from("academy_players")
    .select("id, full_name, birth_date, position, potential, development, status, created_at")
    .eq("club_id", clubId).order("created_at", { ascending: true }).limit(100);
  if (error) {
    request.log.error({ err: error }, "academy lookup failed");
    return reply.code(500).send({ error: "academy_load_failed" });
  }
  return { prospects: data ?? [] };
});

app.post<{ Body: { academyPlayerId?: string } }>("/clubs/me/academy/promote", async (request, reply) => {
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
  const academyPlayerId = request.body?.academyPlayerId;
  if (typeof academyPlayerId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(academyPlayerId)) {
    return reply.code(400).send({ error: "academy_player_id_invalid" });
  }
  const { data, error } = await supabase.rpc("promote_academy_player", {
    p_club_id: clubId,
    p_academy_player_id: academyPlayerId,
  });
  if (error) {
    if (error.code === "22023") return reply.code(400).send({ error: "academy_prospect_unavailable" });
    request.log.error({ err: error }, "academy promotion failed");
    return reply.code(500).send({ error: "academy_promotion_failed" });
  }
  return reply.code(201).send({ playerId: data });
});

app.get("/clubs/me/finance", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) { request.log.error({ err: error }, "club ownership lookup failed"); return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });

  const [economy, ledger] = await Promise.all([
    supabase.from("club_economy").select("balance, updated_at").eq("club_id", clubId).single(),
    supabase.from("ledger_transactions")
      .select("id, reason, created_at, entries:ledger_entries(amount, memo)")
      .eq("club_id", clubId).order("created_at", { ascending: false }).limit(50),
  ]);
  if (economy.error || ledger.error) {
    request.log.error({ economy: economy.error, ledger: ledger.error }, "club finance lookup failed");
    return reply.code(500).send({ error: "club_finance_load_failed" });
  }
  return { balance: economy.data.balance, updatedAt: economy.data.updated_at, transactions: ledger.data ?? [] };
});

app.get("/clubs/me/missions", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) { request.log.error({ err: error }, "club ownership lookup failed"); return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { data, error } = await supabase.from("mission_definitions")
    .select("id,title,description,mission_type,target_count,reward_coins,progress:club_mission_progress(progress,claimed_at)")
    .eq("active", true).order("id");
  if (error) { request.log.error({ err: error }, "mission list failed"); return reply.code(500).send({ error: "missions_load_failed" }); }
  return { missions: (data ?? []).map((mission: any) => ({ ...mission, progress: mission.progress?.[0]?.progress ?? 0, claimedAt: mission.progress?.[0]?.claimed_at ?? null })) };
});

app.post<{ Body: { missionId?: string } }>("/clubs/me/missions/claim", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); }
  catch (error) { request.log.error({ err: error }, "club ownership lookup failed"); return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const missionId = request.body?.missionId;
  if (typeof missionId !== "string" || !/^[a-z0-9_]{2,80}$/.test(missionId)) return reply.code(400).send({ error: "mission_id_invalid" });
  const { data, error } = await supabase.rpc("claim_club_mission", { p_club_id: clubId, p_mission_id: missionId });
  if (error) {
    if (error.code === "22023") return reply.code(409).send({ error: "mission_incomplete" });
    if (error.code === "23505") return reply.code(409).send({ error: "mission_already_claimed" });
    if (error.code === "P0002") return reply.code(404).send({ error: "mission_unavailable" });
    request.log.error({ err: error }, "mission reward claim failed");
    return reply.code(500).send({ error: "mission_claim_failed" });
  }
  return { claimed: true, reward: data };
});

app.get("/unions", async (_request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const { data, error } = await supabase.from("club_unions")
    .select("id,name,tag,leader_club_id,created_at,members:club_union_members(count)")
    .order("created_at", { ascending: false }).limit(100);
  if (error) { app.log.error({ err: error }, "union list failed"); return reply.code(500).send({ error: "unions_load_failed" }); }
  return { unions: data ?? [] };
});

app.post<{ Body: { name?: string; tag?: string } }>("/clubs/me/unions", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch { return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { name, tag } = request.body ?? {};
  if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 60 ||
      typeof tag !== "string" || !/^[a-z0-9]{2,6}$/i.test(tag)) return reply.code(400).send({ error: "union_input_invalid" });
  const { data, error } = await supabase.rpc("create_club_union", { p_club_id: clubId, p_name: name.trim(), p_tag: tag.toUpperCase() });
  if (error) {
    if (error.code === "23505") return reply.code(409).send({ error: "union_name_tag_or_membership_conflict" });
    request.log.error({ err: error }, "union creation failed");
    return reply.code(500).send({ error: "union_create_failed" });
  }
  return reply.code(201).send({ unionId: data });
});

app.post<{ Body: { unionId?: string } }>("/clubs/me/unions/join", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch { return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const unionId = request.body?.unionId;
  if (typeof unionId !== "string" || !/^[0-9a-f-]{36}$/i.test(unionId)) return reply.code(400).send({ error: "union_id_invalid" });
  const { error } = await supabase.rpc("join_club_union", { p_club_id: clubId, p_union_id: unionId });
  if (error) {
    if (error.code === "23505") return reply.code(409).send({ error: "club_already_in_union" });
    if (error.code === "22023") return reply.code(409).send({ error: "union_full" });
    if (error.code === "P0002") return reply.code(404).send({ error: "union_not_found" });
    request.log.error({ err: error }, "union join failed");
    return reply.code(500).send({ error: "union_join_failed" });
  }
  return { joined: true };
});

app.post<{ Body: { action?: string; telegramUserId?: number; telegramChatId?: number; opponentClubId?: string; challengeId?: string; kickoffAt?: string } }>("/internal/telegram-groups/challenge", async (request, reply) => {
  if (!supabase || !botInternalSecret) return reply.code(503).send({ error: "group_challenges_not_configured" });
  const supplied = request.headers["x-bot-internal-secret"];
  if (typeof supplied !== "string") return reply.code(401).send({ error: "bot_auth_required" });
  const expected = Buffer.from(botInternalSecret);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({ error: "bot_auth_invalid" });
  const { action, telegramUserId, telegramChatId, opponentClubId, challengeId, kickoffAt } = request.body ?? {};
  if (!Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(telegramChatId) || !["create","accept"].includes(action ?? "")) {
    return reply.code(400).send({ error: "group_challenge_input_invalid" });
  }
  const { data: user, error: userError } = await supabase.from("game_users").select("id")
    .eq("telegram_user_id", telegramUserId).maybeSingle();
  if (userError) return reply.code(500).send({ error: "group_challenge_user_lookup_failed" });
  if (!user) return reply.code(404).send({ error: "telegram_user_not_registered" });
  const { data: group, error: groupError } = await supabase.from("telegram_game_groups")
    .select("telegram_chat_id,linked_by_user_id").eq("telegram_chat_id", telegramChatId).maybeSingle();
  if (groupError) return reply.code(500).send({ error: "telegram_group_lookup_failed" });
  if (!group) return reply.code(404).send({ error: "telegram_group_not_linked" });
  if (group.linked_by_user_id !== user.id) return reply.code(403).send({ error: "telegram_group_owner_required" });
  const { data: membership, error: membershipError } = await supabase.from("club_memberships")
    .select("club_id").eq("user_id", user.id).eq("role", "owner").maybeSingle();
  if (membershipError) return reply.code(500).send({ error: "club_lookup_failed" });
  if (!membership) return reply.code(409).send({ error: "club_required_before_group_challenge" });
  if (action === "create") {
    if (typeof opponentClubId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(opponentClubId) ||
        typeof kickoffAt !== "string" || !Number.isFinite(Date.parse(kickoffAt)) || Date.parse(kickoffAt) <= Date.now()) {
      return reply.code(400).send({ error: "group_challenge_input_invalid" });
    }
    const { data, error } = await supabase.rpc("create_group_challenge", {
      p_telegram_chat_id: telegramChatId, p_challenger_club_id: membership.club_id,
      p_opponent_club_id: opponentClubId, p_kickoff_at: kickoffAt,
    });
    if (error) {
      if (error.code === "22023") return reply.code(400).send({ error: "group_challenge_input_invalid" });
      if (error.code === "23503") return reply.code(404).send({ error: "opponent_club_not_found" });
      request.log.error({ err: error }, "group challenge creation failed");
      return reply.code(500).send({ error: "group_challenge_create_failed" });
    }
    return reply.code(201).send({ challengeId: data });
  }
  if (typeof challengeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)) {
    return reply.code(400).send({ error: "challenge_id_invalid" });
  }
  const { data: challenge, error: challengeError } = await supabase.from("group_challenges")
    .select("id,telegram_chat_id,opponent_club_id,requested_kickoff_at,status")
    .eq("id", challengeId).eq("telegram_chat_id", telegramChatId).maybeSingle();
  if (challengeError) return reply.code(500).send({ error: "challenge_lookup_failed" });
  if (!challenge) return reply.code(404).send({ error: "challenge_not_found" });
  if (challenge.opponent_club_id !== membership.club_id) return reply.code(403).send({ error: "challenge_opponent_club_required" });
  const { data, error } = await supabase.rpc("accept_group_challenge", {
    p_challenge_id: challengeId, p_opponent_club_id: membership.club_id,
    p_kickoff_at: challenge.requested_kickoff_at,
  });
  if (error) {
    if (error.code === "P0002") return reply.code(404).send({ error: "challenge_not_found" });
    if (error.code === "22023") return reply.code(409).send({ error: "challenge_not_available" });
    request.log.error({ err: error }, "group challenge acceptance failed");
    return reply.code(500).send({ error: "group_challenge_accept_failed" });
  }
  return { accepted: true, matchId: data };
});

app.get("/clubs/me/group-challenges", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch { return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { data, error } = await supabase.from("group_challenges")
    .select("id,telegram_chat_id,challenger_club_id,opponent_club_id,match_id,requested_kickoff_at,status,created_at")
    .or(`challenger_club_id.eq.${clubId},opponent_club_id.eq.${clubId}`)
    .order("created_at", { ascending: false }).limit(50);
  if (error) {
    request.log.error({ err: error }, "group challenges list failed");
    return reply.code(500).send({ error: "group_challenges_list_failed" });
  }
  return { challenges: data ?? [] };
});

app.post<{ Body: { telegramChatId?: number; opponentClubId?: string; kickoffAt?: string } }>("/clubs/me/group-challenges", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch { return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { telegramChatId, opponentClubId, kickoffAt } = request.body ?? {};
  if (!Number.isSafeInteger(telegramChatId) || typeof opponentClubId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(opponentClubId) || typeof kickoffAt !== "string" ||
      !Number.isFinite(Date.parse(kickoffAt)) || Date.parse(kickoffAt) <= Date.now()) {
    return reply.code(400).send({ error: "group_challenge_input_invalid" });
  }
  const { data: linkedGroup, error: linkedGroupError } = await supabase.from("telegram_game_groups")
    .select("telegram_chat_id").eq("telegram_chat_id", telegramChatId).eq("linked_by_user_id", userId).maybeSingle();
  if (linkedGroupError) return reply.code(500).send({ error: "telegram_group_lookup_failed" });
  if (!linkedGroup) return reply.code(403).send({ error: "telegram_group_owner_required" });
  const { data, error } = await supabase.rpc("create_group_challenge", {
    p_telegram_chat_id: telegramChatId, p_challenger_club_id: clubId,
    p_opponent_club_id: opponentClubId, p_kickoff_at: kickoffAt,
  });
  if (error) {
    if (error.code === "P0002") return reply.code(404).send({ error: "telegram_group_not_linked" });
    if (error.code === "22023") return reply.code(400).send({ error: "group_challenge_input_invalid" });
    if (error.code === "23503") return reply.code(404).send({ error: "opponent_club_not_found" });
    request.log.error({ err: error }, "group challenge creation failed");
    return reply.code(500).send({ error: "group_challenge_create_failed" });
  }
  return reply.code(201).send({ challengeId: data });
});

app.post<{ Body: { challengeId?: string; kickoffAt?: string } }>("/clubs/me/group-challenges/accept", async (request, reply) => {
  if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
  const userId = readSession(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
  let clubId: string | null;
  try { clubId = await ownedClubId(userId); } catch { return reply.code(500).send({ error: "club_lookup_failed" }); }
  if (!clubId) return reply.code(404).send({ error: "club_not_found" });
  const { challengeId, kickoffAt } = request.body ?? {};
  if (typeof challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(challengeId) ||
      typeof kickoffAt !== "string" || !Number.isFinite(Date.parse(kickoffAt)) || Date.parse(kickoffAt) <= Date.now()) {
    return reply.code(400).send({ error: "group_challenge_input_invalid" });
  }
  const { data, error } = await supabase.rpc("accept_group_challenge", {
    p_challenge_id: challengeId, p_opponent_club_id: clubId, p_kickoff_at: kickoffAt,
  });
  if (error) {
    if (error.code === "P0002") return reply.code(404).send({ error: "challenge_not_found" });
    if (error.code === "22023") return reply.code(409).send({ error: "challenge_not_available" });
    request.log.error({ err: error }, "group challenge acceptance failed");
    return reply.code(500).send({ error: "group_challenge_accept_failed" });
  }
  return { accepted: true, matchId: data };
});

registerGroupGameRoutes(app, { supabase, readSession, botInternalSecret, botToken });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
