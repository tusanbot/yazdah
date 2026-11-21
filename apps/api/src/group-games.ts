import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";

type Dependencies = {
  supabase: SupabaseClient | null;
  readSession: (header?: string) => string | null;
  botInternalSecret?: string;
  botToken?: string;
};

const formations = ["1-1-2", "1-2-1", "2-1-1", "2-2"];
const gameTypes = ["draft", "penalty", "cards", "quiz", "guess", "survival"];

function parseChatId(value: string): number | null {
  const chatId = Number(value);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

async function telegramMember(botToken: string | undefined, chatId: number, userId: number) {
  if (!botToken) return { ok: false, admin: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    const body = await response.json() as { ok?: boolean; result?: { status?: string } };
    const status = body.result?.status;
    return {
      ok: Boolean(response.ok && body.ok && status && !["left", "kicked"].includes(status)),
      admin: status === "creator" || status === "administrator",
    };
  } catch {
    return { ok: false, admin: false };
  }
}

function safeGameState(game: Record<string, any>, userId: string) {
  const state = structuredClone(game.state ?? {});
  if (game.game_type === "quiz" || game.game_type === "survival") {
    const q = state.questions?.[(state.round ?? 1) - 1];
    state.currentQuestion = q ? { id: q.id, category: q.category, prompt: q.prompt, options: q.options } : null;
    delete state.questions;
    delete state.answers;
  } else if (game.game_type === "guess") {
    const player = state.players?.[(state.round ?? 1) - 1];
    state.currentPlayer = player ? {
      clues: player.clues,
      round: state.round,
    } : null;
    delete state.players;
    delete state.answers;
  } else if (game.game_type === "cards") {
    state.myHand = state.hands?.[userId] ?? [];
    delete state.hands;
    delete state.deck;
    delete state.selected;
  } else if (game.game_type === "draft") {
    const used = new Set(state.used ?? []);
    state.availablePools = Object.fromEntries(
      Object.entries(state.pools ?? {}).map(([key, cards]) => [
        key,
        (cards as Array<{ id: string }>).filter((card) => !used.has(card.id)),
      ]),
    );
    delete state.pools;
  }
  return state;
}

async function recordEvent(
  supabase: SupabaseClient,
  chatId: number,
  userId: string,
  eventType: string,
  eventKey: string,
) {
  const { error } = await supabase.rpc("record_group_mission_event", {
    p_chat_id: chatId,
    p_user_id: userId,
    p_event_type: eventType,
    p_event_key: eventKey,
  });
  if (error) throw error;
}

export function registerGroupGameRoutes(app: FastifyInstance, deps: Dependencies) {
  const { supabase, readSession, botInternalSecret, botToken } = deps;

  app.post<{
    Body: {
      telegramUserId?: number;
      telegramChatId?: number;
      gameType?: string;
      entryFee?: number;
      maxParticipants?: number;
      title?: string;
    };
  }>("/internal/telegram-groups/games", async (request, reply) => {
    if (!supabase || !botInternalSecret) return reply.code(503).send({ error: "group_games_not_configured" });
    const supplied = request.headers["x-bot-internal-secret"];
    if (typeof supplied !== "string" || supplied.length !== botInternalSecret.length ||
      !Buffer.from(supplied).equals(Buffer.from(botInternalSecret))) {
      return reply.code(401).send({ error: "bot_auth_invalid" });
    }
    const { telegramUserId, telegramChatId, gameType, entryFee = 0, maxParticipants = 2, title } = request.body ?? {};
    if (!Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(telegramChatId) ||
      !gameTypes.includes(gameType ?? "") || !Number.isSafeInteger(entryFee) || entryFee < 0 ||
      !Number.isSafeInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 30 ||
      (title !== undefined && (typeof title !== "string" || title.trim().length > 80))) {
      return reply.code(400).send({ error: "group_game_input_invalid" });
    }
    const permission = await telegramMember(botToken, telegramChatId!, telegramUserId!);
    if (!permission.ok || !permission.admin) return reply.code(403).send({ error: "telegram_group_admin_required" });
    const { data: group, error: groupError } = await supabase.from("telegram_game_groups")
      .select("telegram_chat_id").eq("telegram_chat_id", telegramChatId).maybeSingle();
    if (groupError) return reply.code(500).send({ error: "telegram_group_lookup_failed" });
    if (!group) return reply.code(404).send({ error: "telegram_group_not_linked" });
    const { data: user, error: userError } = await supabase.from("game_users")
      .select("id").eq("telegram_user_id", telegramUserId).maybeSingle();
    if (userError) return reply.code(500).send({ error: "game_user_lookup_failed" });
    if (!user) return reply.code(404).send({ error: "telegram_user_not_registered" });
    const { data: membership, error: membershipError } = await supabase.from("club_memberships")
      .select("club_id").eq("user_id", user.id).eq("role", "owner").maybeSingle();
    if (membershipError) return reply.code(500).send({ error: "club_lookup_failed" });
    if (!membership) return reply.code(409).send({ error: "club_required_before_group_game" });
    const { data, error } = await supabase.rpc("create_group_game", {
      p_chat_id: telegramChatId,
      p_creator_user_id: user.id,
      p_game_type: gameType,
      p_entry_fee: entryFee,
      p_max_participants: maxParticipants,
      p_title: title ?? null,
    });
    if (error) {
      request.log.error({ err: error }, "group game create failed");
      return reply.code(500).send({ error: "group_game_create_failed" });
    }
    return reply.code(201).send({ gameId: data, gameType, entryFee, maxParticipants: gameType === "draft" || gameType === "penalty" || gameType === "cards" ? 2 : maxParticipants });
  });

  app.get<{ Params: { chatId: string } }>("/groups/:chatId/games", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user) return reply.code(404).send({ error: "game_user_not_found" });
    const permission = await telegramMember(botToken, chatId, Number(user.telegram_user_id));
    if (!permission.ok) return reply.code(403).send({ error: "telegram_group_membership_required" });
    const [games, wallet, missions] = await Promise.all([
      supabase.from("group_games").select("id,telegram_chat_id,game_type,title,created_by_user_id,entry_fee,prize_pool,max_participants,status,current_round,deadline_at,winner_user_id,created_at")
        .eq("telegram_chat_id", chatId).in("status", ["open", "active", "completed"]).order("created_at", { ascending: false }).limit(30),
      supabase.from("group_wallets").select("balance").eq("telegram_chat_id", chatId).eq("user_id", userId).maybeSingle(),
      supabase.from("group_mission_definitions").select("id,title,description,cadence,scope,event_type,target_count,reward_coins").eq("active", true).order("cadence"),
    ]);
    const failed = [games, wallet, missions].find((item) => item.error);
    if (failed?.error) {
      request.log.error({ err: failed.error }, "group game overview failed");
      return reply.code(500).send({ error: "group_games_load_failed" });
    }
    const { data: participantRows } = await supabase.from("group_game_participants").select("game_id,user_id,score,status,formation")
      .in("game_id", (games.data ?? []).map((item) => item.id));
    const participantMap = new Map<string, typeof participantRows>();
    for (const row of participantRows ?? []) {
      const current = participantMap.get(row.game_id) ?? [];
      current.push(row);
      participantMap.set(row.game_id, current);
    }
    return {
      games: (games.data ?? []).map((game) => ({
        ...game,
        participants: participantMap.get(game.id) ?? [],
        isCreator: game.created_by_user_id === userId,
      })),
      walletBalance: wallet.data?.balance ?? 0,
      missions: missions.data ?? [],
    };
  });

  app.get<{ Params: { chatId: string; gameId: string } }>("/groups/:chatId/games/:gameId", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
      return reply.code(403).send({ error: "telegram_group_membership_required" });
    }
    const { data: game, error } = await supabase.from("group_games")
      .select("id,telegram_chat_id,game_type,title,created_by_user_id,entry_fee,prize_pool,max_participants,status,settings,state,current_round,deadline_at,winner_user_id,created_at")
      .eq("id", request.params.gameId).eq("telegram_chat_id", chatId).maybeSingle();
    if (error) return reply.code(500).send({ error: "group_game_load_failed" });
    if (!game) return reply.code(404).send({ error: "group_game_not_found" });
    const { data: participants } = await supabase.from("group_game_participants")
      .select("user_id,club_id,formation,score,status,picks,joined_at").eq("game_id", game.id).order("joined_at");
    const me = (participants ?? []).find((p) => p.user_id === userId);
    return {
      game: { ...game, state: safeGameState(game as Record<string, any>, userId) },
      participants: (participants ?? []).map((p) => ({
        ...p,
        picks: game.game_type === "draft" || game.game_type === "cards" ? p.picks : [],
        isMe: p.user_id === userId,
      })),
      isCreator: game.created_by_user_id === userId,
      isParticipant: Boolean(me),
    };
  });

  app.post<{ Params: { chatId: string; gameId: string }; Body: { formation?: string } }>(
    "/groups/:chatId/games/:gameId/join", async (request, reply) => {
      if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
      const userId = readSession(request.headers.authorization);
      if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
      const chatId = parseChatId(request.params.chatId);
      if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
      const formation = request.body?.formation ?? "1-2-1";
      if (!formations.includes(formation)) return reply.code(400).send({ error: "group_formation_invalid" });
      const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
      if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
        return reply.code(403).send({ error: "telegram_group_membership_required" });
      }
      const { data: membership, error: membershipError } = await supabase.from("club_memberships")
        .select("club_id").eq("user_id", userId).eq("role", "owner").maybeSingle();
      if (membershipError) return reply.code(500).send({ error: "club_lookup_failed" });
      if (!membership) return reply.code(409).send({ error: "club_required_before_group_game" });
      const { data, error } = await supabase.rpc("join_group_game", {
        p_game_id: request.params.gameId, p_user_id: userId, p_club_id: membership.club_id, p_formation: formation,
      });
      if (error) {
        const map: Record<string, number> = { P0002: 404, "22023": 409, "23505": 409, "42501": 403 };
        return reply.code(map[error.code] ?? 500).send({ error: error.message });
      }
      return { ...data };
    },
  );

  app.post<{ Params: { chatId: string; gameId: string } }>("/groups/:chatId/games/:gameId/start", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
      return reply.code(403).send({ error: "telegram_group_membership_required" });
    }
    const { data, error } = await supabase.rpc("start_group_game", { p_game_id: request.params.gameId, p_actor_user_id: userId });
    if (error) {
      const map: Record<string, number> = { P0002: 404, "22023": 409, "42501": 403 };
      return reply.code(map[error.code] ?? 500).send({ error: error.message });
    }
    return { started: true, state: safeGameState({ ...data, game_type: "draft" }, userId) };
  });

  app.post<{ Params: { chatId: string; gameId: string }; Body: { cardId?: string } }>(
    "/groups/:chatId/games/:gameId/draft-pick", async (request, reply) => {
      if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
      const userId = readSession(request.headers.authorization);
      if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
      const chatId = parseChatId(request.params.chatId);
      if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
      const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
      if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
        return reply.code(403).send({ error: "telegram_group_membership_required" });
      }
      if (typeof request.body?.cardId !== "string" || request.body.cardId.length > 80) return reply.code(400).send({ error: "draft_card_invalid" });
      const { data, error } = await supabase.rpc("pick_group_draft_player", {
        p_game_id: request.params.gameId, p_user_id: userId, p_card_id: request.body.cardId, p_auto: false,
      });
      if (error) {
        const map: Record<string, number> = { "22023": 409, "42501": 403, P0002: 404 };
        return reply.code(map[error.code] ?? 500).send({ error: error.message });
      }
      return data;
    },
  );

  app.get<{ Params: { chatId: string } }>("/groups/:chatId/missions", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
      return reply.code(403).send({ error: "telegram_group_membership_required" });
    }
    const now = new Date();
    const periods = {
      daily: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(now),
      weekly: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))).toISOString().slice(0, 10),
      monthly: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit" }).format(now),
      collective: "all-time",
    };
    const { data: defs, error: defsError } = await supabase.from("group_mission_definitions")
      .select("id,title,description,cadence,scope,event_type,target_count,reward_coins").eq("active", true);
    if (defsError) return reply.code(500).send({ error: "group_missions_load_failed" });
    const { data: progress, error: progressError } = await supabase.from("group_mission_progress")
      .select("mission_id,period_key,subject_key,progress,claimed_at").eq("telegram_chat_id", chatId);
    if (progressError) return reply.code(500).send({ error: "group_missions_progress_load_failed" });
    const { data: wallet } = await supabase.from("group_wallets").select("balance")
      .eq("telegram_chat_id", chatId).eq("user_id", userId).maybeSingle();
    return {
      walletBalance: wallet?.balance ?? 0,
      missions: (defs ?? []).map((mission) => {
        const periodKey = periods[mission.cadence as keyof typeof periods];
        const subjectKey = mission.scope === "group" ? "group" : userId;
        const row = (progress ?? []).find((item) => item.mission_id === mission.id && item.period_key === periodKey && item.subject_key === subjectKey);
        return { ...mission, progress: row?.progress ?? 0, claimedAt: row?.claimed_at ?? null, periodKey };
      }),
    };
  });

  app.post<{ Params: { chatId: string; missionId: string } }>("/groups/:chatId/missions/:missionId/claim", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
      return reply.code(403).send({ error: "telegram_group_membership_required" });
    }
    const { data, error } = await supabase.rpc("claim_group_mission", {
      p_chat_id: chatId, p_user_id: userId, p_mission_id: request.params.missionId,
    });
    if (error) {
      const map: Record<string, number> = { "22023": 409, "23505": 409, P0002: 404 };
      return reply.code(map[error.code] ?? 500).send({ error: error.message });
    }
    return { claimed: true, walletBalance: data };
  });
}
