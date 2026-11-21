"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type GroupGame = {
  id: string;
  game_type: "draft" | "penalty" | "cards" | "quiz" | "guess" | "survival";
  title: string;
  created_by_user_id: string;
  entry_fee: number;
  prize_pool: number;
  max_participants: number;
  status: "open" | "active" | "completed" | "cancelled";
  current_round: number;
  deadline_at: string | null;
  winner_user_id: string | null;
  participants: { user_id: string; score: number; status: string; formation: string }[];
  isCreator: boolean;
};
type Mission = {
  id: string;
  title: string;
  description: string;
  cadence: string;
  scope: string;
  target_count: number;
  reward_coins: number;
  progress: number;
  claimedAt: string | null;
  periodKey: string;
};
type GameDetail = {
  game: GroupGame & { state: Record<string, any> };
  participants: { user_id: string; club_id: string; formation: string; score: number; status: string; picks: any[]; isMe: boolean }[];
  isCreator: boolean;
  isParticipant: boolean;
  currentUserId: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const gameLabels: Record<GroupGame["game_type"], string> = {
  draft: "درفت اسطوره‌ها",
  penalty: "چالش پنالتی",
  cards: "نبرد کارت‌ها",
  quiz: "اطلاعات فوتبالی",
  guess: "حدس بازیکن",
  survival: "چالش بقا",
};
const formationLabels: Record<string, string> = {
  "1-1-2": "۱-۱-۲ (۱ دفاع، ۱ هافبک، ۲ مهاجم)",
  "1-2-1": "۱-۲-۱ (۱ دفاع، ۲ هافبک، ۱ مهاجم)",
  "2-1-1": "۲-۱-۱ (۲ دفاع، ۱ هافبک، ۱ مهاجم)",
  "2-2": "۲-۲ (۲ دفاع، ۲ هافبک)",
};
const positionLabels: Record<string, string> = {
  goalkeeper: "دروازه‌بان",
  defender: "مدافع",
  midfielder: "هافبک",
  attacker: "مهاجم",
};

export default function GroupGames({ accessToken }: { accessToken: string }) {
  const [chatId, setChatId] = useState("");
  const [games, setGames] = useState<GroupGame[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [formation, setFormation] = useState("1-2-1");
  const [guess, setGuess] = useState("");
  const [choice, setChoice] = useState("center");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const headers = useMemo(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  }), [accessToken]);

  const loadOverview = useCallback(async (selectedChatId = chatId) => {
    if (!selectedChatId || !accessToken || !API_URL) return;
    setBusy(true);
    setStatus("");
    try {
      const [gamesResponse, missionsResponse] = await Promise.all([
        fetch(`${API_URL}/groups/${encodeURIComponent(selectedChatId)}/games`, { headers }),
        fetch(`${API_URL}/groups/${encodeURIComponent(selectedChatId)}/missions`, { headers }),
      ]);
      const gamesBody = await gamesResponse.json();
      const missionsBody = await missionsResponse.json();
      if (!gamesResponse.ok) throw new Error(gamesBody.error ?? "بارگذاری چالش‌های گروه ناموفق بود.");
      if (!missionsResponse.ok) throw new Error(missionsBody.error ?? "بارگذاری مأموریت‌های گروه ناموفق بود.");
      setGames(gamesBody.games ?? []);
      setWalletBalance(Number(gamesBody.walletBalance ?? missionsBody.walletBalance ?? 0));
      setMissions(missionsBody.missions ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ارتباط با گروه برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }, [accessToken, chatId, headers]);

  const openGame = useCallback(async (gameId: string) => {
    if (!chatId) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/groups/${encodeURIComponent(chatId)}/games/${gameId}`, { headers });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "بارگذاری جزئیات چالش ناموفق بود.");
      setDetail(body as GameDetail);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "بارگذاری چالش ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }, [chatId, headers]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialChat = params.get("groupChatId");
    if (initialChat) setChatId(initialChat);
  }, []);

  useEffect(() => {
    if (chatId) void loadOverview(chatId);
  }, [chatId, loadOverview]);

  useEffect(() => {
    if (!detail || detail.game.status !== "active") return;
    const timer = window.setInterval(() => {
      void openGame(detail.game.id);
      void loadOverview();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [detail?.game.id, detail?.game.status, openGame, loadOverview]);

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "عملیات ناموفق بود.");
    return result;
  }

  async function joinGame(game: GroupGame) {
    setBusy(true);
    try {
      await post(`/groups/${encodeURIComponent(chatId)}/games/${game.id}/join`, { formation });
      setStatus("با موفقیت وارد چالش شدی.");
      await loadOverview();
      await openGame(game.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ورود به چالش ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function startGame(gameId: string) {
    setBusy(true);
    try {
      await post(`/groups/${encodeURIComponent(chatId)}/games/${gameId}/start`, {});
      await loadOverview();
      await openGame(gameId);
      setStatus("چالش آغاز شد.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "شروع چالش ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function draftPick(cardId: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await post(`/groups/${encodeURIComponent(chatId)}/games/${detail.game.id}/draft-pick`, { cardId });
      await openGame(detail.game.id);
      await loadOverview();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "انتخاب بازیکن ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAction(action: Record<string, unknown>) {
    if (!detail) return;
    setBusy(true);
    try {
      await post(`/groups/${encodeURIComponent(chatId)}/games/${detail.game.id}/action`, action);
      await openGame(detail.game.id);
      await loadOverview();
      setGuess("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ثبت پاسخ ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function claimMission(missionId: string) {
    setBusy(true);
    try {
      await post(`/groups/${encodeURIComponent(chatId)}/missions/${missionId}/claim`, {});
      await loadOverview();
      setStatus("پاداش مأموریت به کیف پول گروهی اضافه شد.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "دریافت پاداش ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  const myTurn = detail?.game.game_type === "draft" && detail.game.state.currentTurn === detail.currentUserId;
  const deadlineSeconds = detail?.game.deadline_at
    ? Math.max(0, Math.ceil((new Date(detail.game.deadline_at).getTime() - Date.now()) / 1000))
    : null;

  return (
    <section className="group-games" aria-labelledby="group-games-title">
      <div className="group-head">
        <div>
          <h2 id="group-games-title">چالش‌ها و مأموریت‌های گروه</h2>
          <p>چالش‌ها را در تلگرام مدیر گروه ایجاد می‌کند؛ شرکت در آن‌ها از این بخش انجام می‌شود.</p>
        </div>
        <div className="wallet"><small>کیف پول گروه</small><strong>{walletBalance.toLocaleString("fa-IR")} سکه</strong></div>
      </div>

      <div className="group-connect">
        <label>شناسه عددی گروه تلگرام
          <input value={chatId} inputMode="numeric" placeholder="-100..." onChange={(event) => setChatId(event.target.value)} />
        </label>
        <button type="button" disabled={busy || !chatId.trim()} onClick={() => void loadOverview(chatId)}>بارگذاری گروه</button>
      </div>

      {status && <p className="notice" role="status">{status}</p>}

      {detail ? (
        <div className="game-detail">
          <button type="button" className="back" onClick={() => setDetail(null)}>← بازگشت به فهرست</button>
          <h3>{gameLabels[detail.game.game_type]} · {detail.game.title}</h3>
          <p className="game-meta">وضعیت: {detail.game.status === "open" ? "در انتظار شرکت‌کننده" : detail.game.status === "active" ? "در حال اجرا" : "پایان‌یافته"} · دور {detail.game.current_round} · جایزه {Number(detail.game.prize_pool).toLocaleString("fa-IR")} سکه</p>
          {detail.game.deadline_at && <p className="timer">مهلت این مرحله: {deadlineSeconds} ثانیه</p>}
          <div className="participants">
            {detail.participants.map((participant) => (
              <div className="participant" key={participant.user_id}>
                <strong>{participant.isMe ? "باشگاه شما" : `شرکت‌کننده ${detail.participants.findIndex((p) => p.user_id === participant.user_id) + 1}`}</strong>
                <span>{participant.score.toLocaleString("fa-IR")} امتیاز · {formationLabels[participant.formation] ?? participant.formation}</span>
                {participant.picks?.length > 0 && <small>{participant.picks.map((p) => p.full_name).join("، ")}</small>}
              </div>
            ))}
          </div>

          {detail.game.status === "open" && (
            <div className="join-panel">
              {!detail.isParticipant ? (
                <>
                  <label>آرایش چهار بازیکن خطی
                    <select value={formation} onChange={(event) => setFormation(event.target.value)}>
                      {Object.entries(formationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={busy} onClick={() => void joinGame(detail.game)}>ورود به چالش · {Number(detail.game.entry_fee).toLocaleString("fa-IR")} سکه</button>
                </>
              ) : detail.isCreator ? (
                <button type="button" disabled={busy || detail.participants.length < 2} onClick={() => void startGame(detail.game.id)}>شروع چالش</button>
              ) : <p>منتظر شروع چالش توسط سازنده بمان.</p>}
            </div>
          )}

          {detail.game.status === "active" && detail.game.game_type === "draft" && (
            <div className="draft-panel">
              <h4>{myTurn ? "نوبت انتخاب شماست" : "در انتظار انتخاب حریف"}</h4>
              <p>در هر دور هر نفر یک بازیکن انتخاب می‌کند. دور اول فقط دروازه‌بان و چهار دور بعد بازیکن خطی انتخاب می‌شود. انتخاب پس از ۳۰ ثانیه به‌صورت خودکار انجام می‌شود.</p>
              {Object.entries(detail.game.state.availablePools ?? {}).filter(([position]) =>
                detail.game.current_round === 1 ? position === "goalkeeper" : position !== "goalkeeper"
              ).map(([position, cards]) => (
                <div className="card-pool" key={position}>
                  <h5>{positionLabels[position] ?? position} · {(cards as any[]).length} بازیکن باقی‌مانده</h5>
                  <div className="card-grid">
                    {(cards as any[]).map((card) => (
                      <button type="button" className="player-card" key={card.id} disabled={busy || !myTurn} onClick={() => void draftPick(card.id)}>
                        <strong>{card.full_name}</strong><span>{card.overall} قدرت</span><small>{card.rarity === "mythic" ? "افسانه" : "اسطوره"} · {card.nationality}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {detail.game.state.resolvedLineups && <pre className="lineups">{JSON.stringify(detail.game.state.resolvedLineups, null, 2)}</pre>}
            </div>
          )}

          {detail.game.status === "active" && detail.game.game_type === "cards" && (
            <div className="card-grid">
              {(detail.game.state.myHand ?? []).map((card: any) => (
                <button type="button" className="player-card" key={card.id} disabled={busy || detail.game.state.mySelectionSubmitted || detail.participants.find((p) => p.isMe)?.picks.some((p: any) => p.id === card.id)} onClick={() => void submitAction({ cardId: card.id })}>
                  <strong>{card.full_name}</strong><span>{card.overall} قدرت</span><small>{card.rarity === "mythic" ? "افسانه" : "اسطوره"}</small>
                </button>
              ))}
              <p>در هر یک از پنج دور، از دست خود یک کارت انتخاب کن. کارت افسانه‌ای ۵ امتیاز اضافه دارد.</p>
              {detail.game.state.mySelectionSubmitted && <p>انتخاب این دور ثبت شده؛ منتظر حریف بمان.</p>}
            </div>
          )}

          {detail.game.status === "active" && detail.game.game_type === "penalty" && (
            <div className="action-panel">
              <h4>ضربه پنالتی</h4>
              <p>در هر دور یکی پنالتی می‌زند و دیگری جهت شیرجه را انتخاب می‌کند. نقش‌ها در دور بعد جابه‌جا می‌شوند. انتخاب‌ها هم‌زمان ثبت می‌شوند.</p>
              <p>نقش شما در این دور: <strong>{detail.game.state.myRole === "shooter" ? "پنالتی‌زن" : "دروازه‌بان"}</strong></p>
              <div className="choice-row">
                {["left", "center", "right"].map((value) => <button type="button" key={value} disabled={busy || detail.game.state.myActionSubmitted} onClick={() => void submitAction({ choice: value })}>{value === "left" ? "چپ" : value === "center" ? "وسط" : "راست"}</button>)}
              </div>
              {detail.game.state.myActionSubmitted && <p>انتخاب شما ثبت شد؛ منتظر حریف بمان.</p>}
            </div>
          )}

          {(detail.game.status === "active" && (detail.game.game_type === "quiz" || detail.game.game_type === "survival")) && detail.game.state.currentQuestion && (
            <div className="action-panel">
              <h4>{detail.game.state.currentQuestion.category}</h4>
              <p>{detail.game.state.currentQuestion.prompt}</p>
              <div className="answers">
                {detail.game.state.currentQuestion.options.map((option: string, index: number) => <button type="button" key={option} disabled={busy || detail.game.state.myAnswerSubmitted} onClick={() => void submitAction({ answer: index })}>{option}</button>)}
              </div>
            </div>
          )}

          {detail.game.status === "active" && detail.game.game_type === "guess" && detail.game.state.currentPlayer && (
            <div className="action-panel">
              <h4>حدس بازیکن</h4>
              <p>با توجه به سرنخ‌ها نام بازیکن را حدس بزن.</p>
              <ul>{(detail.game.state.currentPlayer.clues ?? []).map((clue: string, index: number) => <li key={index}>{clue}</li>)}</ul>
              {detail.game.state.myAnswerSubmitted && <p>حدس شما ثبت شد؛ منتظر سایر شرکت‌کنندگان بمان.</p>}
              <label>نام بازیکن<input value={guess} onChange={(event) => setGuess(event.target.value)} maxLength={100} /></label>
              <button type="button" disabled={busy || detail.game.state.myAnswerSubmitted || !guess.trim()} onClick={() => void submitAction({ guess, clueLevel: 1 })}>ثبت حدس</button>
            </div>
          )}

          {detail.game.status === "completed" && (
            <div className="result">
              <h4>{detail.game.winner_user_id ? detail.game.winner_user_id === detail.currentUserId ? "تبریک! شما برنده شدید." : "چالش به پایان رسید." : "چالش با تساوی تمام شد."}</h4>
              <p>نتیجه نهایی و امتیازها در فهرست شرکت‌کنندگان ثبت شده‌اند.</p>
              <button type="button" onClick={() => { setDetail(null); void loadOverview(); }}>بازگشت به چالش‌ها</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <h3>چالش‌های گروه</h3>
          {games.length === 0 ? <p className="muted">چالش فعالی وجود ندارد. مدیر گروه می‌تواند با فرمان /game چالش ایجاد کند.</p> : (
            <div className="game-list">
              {games.map((game) => (
                <article className="game-row" key={game.id}>
                  <div>
                    <strong>{gameLabels[game.game_type]}</strong>
                    <p>{game.title}</p>
                    <small>{game.status === "open" ? "در انتظار شرکت‌کننده" : game.status === "active" ? "در حال اجرا" : "پایان‌یافته"} · {game.participants.length}/{game.max_participants} نفر · ورودی {Number(game.entry_fee).toLocaleString("fa-IR")} · جایزه {Number(game.prize_pool).toLocaleString("fa-IR")}</small>
                  </div>
                  <button type="button" disabled={busy} onClick={() => void openGame(game.id)}>مشاهده</button>
                </article>
              ))}
            </div>
          )}

          <h3>مأموریت‌های گروه</h3>
          {missions.length === 0 ? <p className="muted">مأموریتی برای این گروه تعریف نشده است.</p> : (
            <div className="mission-list">
              {missions.map((mission) => {
                const complete = mission.progress >= mission.target_count;
                return (
                  <article className="mission-row" key={mission.id}>
                    <div>
                      <strong>{mission.title}</strong>
                      <p>{mission.description}</p>
                      <small>{mission.cadence === "daily" ? "روزانه" : mission.cadence === "weekly" ? "هفتگی" : mission.cadence === "monthly" ? "ماهانه" : "مشارکتی"} · {mission.progress}/{mission.target_count} · پاداش {Number(mission.reward_coins).toLocaleString("fa-IR")} سکه</small>
                    </div>
                    <button type="button" disabled={busy || !complete || Boolean(mission.claimedAt)} onClick={() => void claimMission(mission.id)}>{mission.claimedAt ? "دریافت‌شده" : complete ? "دریافت پاداش" : "در حال انجام"}</button>
                  </article>
                );
              })}
            </div>
          )}
          <button type="button" className="refresh" disabled={busy || !chatId} onClick={() => void loadOverview()}>به‌روزرسانی</button>
        </>
      )}

      <style jsx>{`
        .group-games { margin-top: 22px; padding: 18px; border: 1px solid #34465f; border-radius: 16px; background: #0e1928; }
        .group-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        h2,h3,h4,h5 { margin: 0 0 10px; }
        p { color:#aebbd0; line-height:1.8; margin:6px 0 12px; }
        .wallet { background:#173c34; padding:10px 12px; border-radius:12px; display:grid; gap:4px; min-width:120px; }
        .wallet small,.game-row small,.mission-row small,.participant span,.participant small { color:#aebbd0; }
        .group-connect { display:flex; gap:10px; align-items:end; margin:14px 0; }
        label { display:grid; gap:6px; flex:1; font-size:13px; }
        input,select { width:100%; padding:11px; border-radius:10px; border:1px solid #34465f; background:#0b1422; color:white; font:inherit; }
        button { border:0; border-radius:10px; padding:10px 13px; background:#3478db; color:white; font:inherit; cursor:pointer; }
        button:disabled { opacity:.5; cursor:not-allowed; }
        .notice { padding:10px; border-radius:10px; background:#28384e; }
        .game-list,.mission-list { display:grid; gap:9px; margin:10px 0 18px; }
        .game-row,.mission-row,.participant { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #34465f; border-radius:12px; background:#111f31; }
        .game-row p,.mission-row p { margin:4px 0; }
        .game-row button,.mission-row button { flex-shrink:0; }
        .game-detail { margin-top:16px; border-top:1px solid #34465f; padding-top:14px; }
        .back { background:#34465f; margin-bottom:12px; }
        .timer { color:#ffd166; font-weight:bold; }
        .participants { display:grid; gap:8px; margin:12px 0; }
        .participant { align-items:flex-start; flex-direction:column; }
        .join-panel,.action-panel,.draft-panel,.result { padding:14px; margin-top:14px; border:1px solid #34465f; border-radius:12px; background:#142238; }
        .join-panel button { width:100%; margin-top:10px; }
        .card-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:12px 0; }
        .player-card { display:grid; text-align:right; gap:5px; background:#1c2c44; border:1px solid #506b91; min-width:0; }
        .player-card span { color:#ffcf70; }
        .player-card small { color:#b9c8dc; }
        .choice-row,.answers { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
        .answers { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .refresh { width:100%; background:#34465f; }
        .lineups { white-space:pre-wrap; overflow-wrap:anywhere; color:#c5d5ea; }
        @media(max-width:520px) { .group-head,.group-connect { flex-direction:column; align-items:stretch; } .wallet { width:100%; } .game-row,.mission-row { align-items:stretch; flex-direction:column; } .card-grid { grid-template-columns:1fr 1fr; } }
      `}</style>
    </section>
  );
}
