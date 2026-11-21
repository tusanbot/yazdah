import { timingSafeEqual } from "node:crypto";
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
    const body = await response.json() as { ok?: boolean; result?: { status?: string; is_member?: boolean } };
    const status = body.result?.status;
    const isMember = status === "creator" || status === "administrator" || status === "member" ||
      (status === "restricted" && body.result?.is_member === true);
    return {
      ok: Boolean(response.ok && body.ok && isMember),
      admin: status === "creator" || status === "administrator",
    };
  } catch {
    return { ok: false, admin: false };
  }
}

type JsonRecord = Record<string, unknown>;
type CardRecord = { id: string };

function safeGameState(game: JsonRecord, userId: string): JsonRecord {
  const state = structuredClone((game.state as JsonRecord | null) ?? {});
  const gameType = String(game.game_type ?? "");
  const round = Number(state.round ?? 1);

  if (gameType === "quiz" || gameType === "survival") {
    const questions = state.questions as JsonRecord[] | undefined;
    const question = questions?.[round - 1];
    const options = Array.isArray(question?.options) ? question.options as string[] : [];
    state.currentQuestion = question ? {
      id: String(question.id ?? ""),
      category: String(question.category ?? ""),
      prompt: String(question.prompt ?? ""),
      options,
    } : null;
    const answers = state.answers as Record<string, unknown> | undefined;
    state.myAnswerSubmitted = Boolean(answers?.[userId]);
    delete state.questions;
    delete state.answers;
  } else if (gameType === "guess") {
    const players = state.players as JsonRecord[] | undefined;
    const player = players?.[round - 1];
    const hints = state.hintLevels as Record<string, unknown> | undefined;
    const clueLevel = Number(hints?.[userId] ?? 1);
    const allClues = Array.isArray(player?.clues) ? player.clues as string[] : [];
    state.currentPlayer = player ? {
      clues: allClues.slice(0, clueLevel),
      clueLevel,
      totalClues: allClues.length,
      round,
    } : null;
    const answers = state.answers as Record<string, unknown> | undefined;
    state.myAnswerSubmitted = Boolean(answers?.[userId]);
    delete state.hintLevels;
    delete state.players;
    delete state.answers;
  } else if (gameType === "cards") {
    const hands = state.hands as Record<string, unknown[]> | undefined;
    const used = state.used as Record<string, string[]> | undefined;
    const selected = state.selected as Record<string, unknown> | undefined;
    state.myHand = hands?.[userId] ?? [];
    state.myUsedCardIds = used?.[userId] ?? [];
    state.mySelectionSubmitted = Boolean(selected?.[userId]);
    delete state.hands;
    delete state.deck;
    delete state.selected;
    delete state.used;
  } else if (gameType === "penalty") {
    const actions = state.actions as Record<string, unknown> | undefined;
    const users = state.users as string[] | undefined;
    state.myActionSubmitted = Boolean(actions?.[userId]);
    const first = users?.[0] === userId;
    state.myRole = first === (round % 2 === 1) ? "shooter" : "keeper";
    delete state.actions;
  } else if (gameType === "draft") {
    const used = new Set(Array.isArray(state.used) ? state.used as string[] : []);
    const pools = state.pools as Record<string, CardRecord[]> | undefined;
    state.availablePools = Object.fromEntries(
      Object.entries(pools ?? {}).map(([key, cards]) => [
        key,
        cards.filter((card) => !used.has(card.id)),
      ]),
    );
    delete state.pools;
  }
  return state;
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
    if (typeof supplied !== "string") return reply.code(401).send({ error: "bot_auth_invalid" });
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(botInternalSecret);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
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
    const { data: createdGame } = await supabase.from("group_games").select("prize_pool").eq("id", data).single();
    return reply.code(201).send({ gameId: data, gameType, entryFee, prizePool: createdGame?.prize_pool ?? 0,
      maxParticipants: gameType === "draft" || gameType === "penalty" || gameType === "cards" ? 2 : maxParticipants });
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
    const gameIds = (games.data ?? []).map((item) => item.id);
    let participantRows: Array<{ game_id: string; user_id: string; score: number; status: string; formation: string }> = [];
    if (gameIds.length > 0) {
      const { data, error } = await supabase.from("group_game_participants").select("game_id,user_id,score,status,formation")
        .in("game_id", gameIds);
      if (error) return reply.code(500).send({ error: "group_game_participants_load_failed" });
      participantRows = data ?? [];
    }
    const participantMap = new Map<string, typeof participantRows>();
    for (const row of participantRows ?? []) {
      const current = participantMap.get(row.game_id) ?? [];
      current.push(row);
      participantMap.set(row.game_id, current);
    }
    return {
      games: (games.data ?? []).map((game) => ({
        ...game,
        participants: (participantMap.get(game.id) ?? []).map((participant) =>
          game.game_type === "cards" && game.status === "active" && participant.user_id !== userId
            ? { ...participant, score: 0 }
            : participant
        ),
        isCreator: game.created_by_user_id === userId,
      })),
      walletBalance: wallet.data?.balance ?? 0,
      missions: missions.data ?? [],
    };
  });

  app.get<{ Params: { chatId: string } }>("/groups/:chatId/wallet", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
      return reply.code(403).send({ error: "telegram_group_membership_required" });
    }
    const [wallet, transactions] = await Promise.all([
      supabase.from("group_wallets").select("balance").eq("telegram_chat_id", chatId).eq("user_id", userId).maybeSingle(),
      supabase.from("group_currency_transactions").select("id,amount,balance_after,reason,created_at")
        .eq("telegram_chat_id", chatId).eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    ]);
    if (wallet.error || transactions.error) return reply.code(500).send({ error: "group_wallet_load_failed" });
    return { balance: wallet.data?.balance ?? 0, transactions: transactions.data ?? [] };
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
    const { data: participants, error: participantsError } = await supabase.from("group_game_participants")
      .select("user_id,club_id,formation,score,status,picks,joined_at").eq("game_id", game.id).order("joined_at");
    if (participantsError) return reply.code(500).send({ error: "group_game_participants_load_failed" });
    const me = (participants ?? []).find((p) => p.user_id === userId);
    return {
      game: { ...game, state: safeGameState(game as Record<string, unknown>, userId) },
      participants: (participants ?? []).map((p) => ({
        ...p,
        score: game.game_type === "cards" && game.status === "active" && p.user_id !== userId ? 0 : p.score,
        picks: game.game_type === "draft" || (game.game_type === "cards" && game.status === "completed") ? p.picks : [],
        isMe: p.user_id === userId,
      })),
      isCreator: game.created_by_user_id === userId,
      isParticipant: Boolean(me),
      currentUserId: userId,
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

  app.post<{ Params: { chatId: string; gameId: string } }>("/groups/:chatId/games/:gameId/cancel", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
      return reply.code(403).send({ error: "telegram_group_membership_required" });
    }
    const { data, error } = await supabase.rpc("cancel_group_game", {
      p_game_id: request.params.gameId, p_actor_user_id: userId,
    });
    if (error) {
      const map: Record<string, number> = { P0002: 404, "22023": 409, "42501": 403 };
      return reply.code(map[error.code] ?? 500).send({ error: error.message });
    }
    return data;
  });

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
    const { error } = await supabase.rpc("start_group_game", { p_game_id: request.params.gameId, p_actor_user_id: userId });
    if (error) {
      const map: Record<string, number> = { P0002: 404, "22023": 409, "42501": 403 };
      return reply.code(map[error.code] ?? 500).send({ error: error.message });
    }
    return { started: true };
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

  app.post<{ Params: { chatId: string; gameId: string }; Body: { choice?: string; answer?: number; guess?: string; clueLevel?: number; cardId?: string } }>(
    "/groups/:chatId/games/:gameId/action", async (request, reply) => {
      if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
      const userId = readSession(request.headers.authorization);
      if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
      const chatId = parseChatId(request.params.chatId);
      if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
      const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
      if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
        return reply.code(403).send({ error: "telegram_group_membership_required" });
      }
      const action = request.body ?? {};
      const { data, error } = await supabase.rpc("submit_group_game_action", {
        p_game_id: request.params.gameId,
        p_user_id: userId,
        p_action: action,
        p_auto: false,
      });
      if (error) {
        const map: Record<string, number> = {
          P0002: 404, "22023": 409, "23505": 409, "42501": 403,
        };
        return reply.code(map[error.code] ?? 500).send({ error: error.message });
      }
      return data;
    },
  );

  app.post<{ Params: { chatId: string; gameId: string } }>("/groups/:chatId/games/:gameId/hint", async (request, reply) => {
    if (!supabase) return reply.code(503).send({ error: "database_not_configured" });
    const userId = readSession(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "session_invalid_or_expired" });
    const chatId = parseChatId(request.params.chatId);
    if (chatId === null) return reply.code(400).send({ error: "telegram_chat_id_invalid" });
    const { data: user } = await supabase.from("game_users").select("telegram_user_id").eq("id", userId).maybeSingle();
    if (!user || !(await telegramMember(botToken, chatId, Number(user.telegram_user_id))).ok) {
      return reply.code(403).send({ error: "telegram_group_membership_required" });
    }
    const { data, error } = await supabase.rpc("reveal_group_guess_hint", {
      p_game_id: request.params.gameId, p_user_id: userId,
    });
    if (error) {
      const map: Record<string, number> = { "22023": 409, "23505": 409, "42501": 403, P0002: 404 };
      return reply.code(map[error.code] ?? 500).send({ error: error.message });
    }
    return { clueLevel: data };
  });

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
    const tehranParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).map((part) => [part.type, part.value]));
    const localDate = new Date(Date.UTC(Number(tehranParts.year), Number(tehranParts.month) - 1, Number(tehranParts.day)));
    const localDay = localDate.getUTCDay();
    localDate.setUTCDate(localDate.getUTCDate() - ((localDay + 6) % 7));
    const periods = {
      daily: `${tehranParts.year}-${tehranParts.month}-${tehranParts.day}`,
      weekly: localDate.toISOString().slice(0, 10),
      monthly: `${tehranParts.year}-${tehranParts.month}`,
      collective: "all-time",
    };
    const { data: defs, error: defsError } = await supabase.from("group_mission_definitions")
      .select("id,title,description,cadence,scope,event_type,target_count,reward_coins").eq("active", true);
    if (defsError) return reply.code(500).send({ error: "group_missions_load_failed" });
    const [progressResult, claimsResult, walletResult] = await Promise.all([
      supabase.from("group_mission_progress")
        .select("mission_id,period_key,subject_key,progress,claimed_at").eq("telegram_chat_id", chatId),
      supabase.from("group_mission_claims")
        .select("mission_id,period_key,claimed_at").eq("telegram_chat_id", chatId).eq("user_id", userId),
      supabase.from("group_wallets").select("balance")
        .eq("telegram_chat_id", chatId).eq("user_id", userId).maybeSingle(),
    ]);
    if (progressResult.error || claimsResult.error || walletResult.error) return reply.code(500).send({ error: "group_missions_progress_load_failed" });
    return {
      walletBalance: walletResult.data?.balance ?? 0,
      missions: (defs ?? []).map((mission) => {
        const periodKey = periods[mission.cadence as keyof typeof periods];
        const subjectKey = mission.scope === "group" ? "group" : userId;
        const row = (progressResult.data ?? []).find((item) => item.mission_id === mission.id && item.period_key === periodKey && item.subject_key === subjectKey);
        const claim = (claimsResult.data ?? []).find((item) => item.mission_id === mission.id && item.period_key === periodKey);
        return { ...mission, progress: row?.progress ?? 0, claimedAt: claim?.claimed_at ?? row?.claimed_at ?? null, periodKey };
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
