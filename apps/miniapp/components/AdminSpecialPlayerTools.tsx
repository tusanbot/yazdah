"use client";

import { FormEvent, useEffect, useState } from "react";

type Props = { apiUrl: string; accessToken: string };
type Pack = { pack_key: "epic" | "legendary" | "iconic"; title: string; price: number; active: boolean; updated_at?: string };
type Player = { id: string; full_name: string; position: string; overall: number; special_tier: string | null };
type Competition = { id: string; name: string; competition_type: string; season: number; status: string; champion_club_id: string | null };
type Reward = { competition_id: string; catalog_player_id: string };

const packNames: Record<Pack["pack_key"], string> = { epic: "حماسی", legendary: "افسانه‌ای", iconic: "نمادین" };

export default function AdminSpecialPlayerTools({ apiUrl, accessToken }: Props) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [packDrafts, setPackDrafts] = useState<Record<string, { title: string; price: string; active: boolean }>>({});
  const [competitionId, setCompetitionId] = useState("");
  const [competitionPlayerId, setCompetitionPlayerId] = useState("");
  const [eventClubId, setEventClubId] = useState("");
  const [eventPlayerId, setEventPlayerId] = useState("");
  const [eventReference, setEventReference] = useState("");
  const [eventIdempotency, setEventIdempotency] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "درخواست مدیریتی ناموفق بود.");
    return body;
  }

  async function load() {
    const body = await request("/admin/special-player-tools");
    const nextPacks = body.packs as Pack[];
    setPacks(nextPacks);
    setCompetitions(body.competitions as Competition[]);
    setPlayers(body.players as Player[]);
    setRewards(body.rewards as Reward[]);
    setPackDrafts(Object.fromEntries(nextPacks.map((pack) => [pack.pack_key, {
      title: pack.title, price: String(pack.price), active: pack.active,
    }])));
    if (!competitionId && body.competitions[0]) setCompetitionId(body.competitions[0].id);
    if (!competitionPlayerId && body.players[0]) setCompetitionPlayerId(body.players[0].id);
    if (!eventPlayerId && body.players[0]) setEventPlayerId(body.players[0].id);
  }

  useEffect(() => { load().catch((error) => setStatus(error instanceof Error ? error.message : "بارگذاری ناموفق بود.")); }, []);

  async function savePack(key: Pack["pack_key"]) {
    const draft = packDrafts[key];
    if (!draft || !Number.isSafeInteger(Number(draft.price)) || Number(draft.price) < 1) {
      setStatus("قیمت پک باید عدد صحیح و مثبت باشد."); return;
    }
    setBusy(true); setStatus("");
    try {
      await request(`/admin/special-player-packs/${key}`, {
        method: "PUT", body: JSON.stringify({ title: draft.title, price: Number(draft.price), active: draft.active }),
      });
      await load();
      setStatus(`تنظیمات پک ${packNames[key]} ذخیره شد.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "ذخیره پک ناموفق بود."); }
    finally { setBusy(false); }
  }

  async function saveCompetitionReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus("");
    try {
      await request(`/admin/competitions/${competitionId}/special-player-reward`, {
        method: "PUT", body: JSON.stringify({ catalogPlayerId: competitionPlayerId }),
      });
      await load(); setStatus("جایزهٔ بازیکن ویژه برای رقابت ثبت شد.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "ثبت جایزه ناموفق بود."); }
    finally { setBusy(false); }
  }

  async function issueEventReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus("");
    try {
      const body = await request("/admin/special-event-rewards/issue", {
        method: "POST", body: JSON.stringify({
          clubId: eventClubId.trim(), catalogPlayerId: eventPlayerId,
          referenceId: eventReference.trim(), idempotencyKey: eventIdempotency.trim(),
        }),
      });
      setStatus(`استحقاق جایزه صادر شد: ${body.entitlementId}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "صدور جایزه ناموفق بود."); }
    finally { setBusy(false); }
  }

  const playerLabel = (player: Player) => `${player.full_name} · ${player.position} · قدرت ${player.overall}${player.special_tier ? ` · ${player.special_tier}` : ""}`;

  return <section className="academy" aria-labelledby="special-player-admin-heading">
    <h2 id="special-player-admin-heading">مدیریت بازیکنان ویژه، پک‌ها و جوایز</h2>
    <p className="muted">این ابزار فقط برای مدیران بازی فعال است. قیمت‌ها و جایزه‌ها سمت سرور اعتبارسنجی می‌شوند.</p>

    <h3>تنظیم پک‌ها</h3>
    {(["epic", "legendary", "iconic"] as const).map((key) => {
      const draft = packDrafts[key];
      return <form className="recruit-form" key={key} onSubmit={(event) => { event.preventDefault(); void savePack(key); }}>
        <h4>پک {packNames[key]}</h4>
        <label>عنوان پک<input required minLength={2} maxLength={80} value={draft?.title ?? ""} onChange={(event) => setPackDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { title: "", price: "", active: false }), title: event.target.value } }))} /></label>
        <label>قیمت (سکه)<input required type="number" min={1} step={1} value={draft?.price ?? ""} onChange={(event) => setPackDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { title: "", price: "", active: false }), price: event.target.value } }))} /></label>
        <label><span><input type="checkbox" checked={draft?.active ?? false} onChange={(event) => setPackDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { title: "", price: "", active: false }), active: event.target.checked } }))} /> فعال‌سازی پک</span></label>
        <button type="submit" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره تنظیمات پک"}</button>
      </form>;
    })}

    <h3>جایزهٔ قهرمان رقابت</h3>
    <form className="recruit-form" onSubmit={saveCompetitionReward}>
      <label>رقابت<select required value={competitionId} onChange={(event) => setCompetitionId(event.target.value)}>
        <option value="">انتخاب رقابت</option>
        {competitions.filter((item) => item.status !== "completed" && item.status !== "cancelled").map((item) => <option key={item.id} value={item.id}>{item.name} · فصل {item.season} · {item.status}</option>)}
      </select></label>
      <label>بازیکن ویژه<select required value={competitionPlayerId} onChange={(event) => setCompetitionPlayerId(event.target.value)}>
        {players.map((player) => <option key={player.id} value={player.id}>{playerLabel(player)}</option>)}
      </select></label>
      <button type="submit" disabled={busy || !competitionId || !competitionPlayerId}>ثبت یا جایگزینی جایزه</button>
    </form>
    {rewards.length > 0 && <ul>{rewards.map((reward) => {
      const competition = competitions.find((item) => item.id === reward.competition_id);
      const player = players.find((item) => item.id === reward.catalog_player_id);
      return <li key={reward.competition_id}>{competition?.name ?? reward.competition_id}: {player?.full_name ?? reward.catalog_player_id}</li>;
    })}</ul>}

    <h3>صدور جایزهٔ رویداد ویژه</h3>
    <form className="recruit-form" onSubmit={issueEventReward}>
      <label>شناسهٔ باشگاه دریافت‌کننده<input required value={eventClubId} onChange={(event) => setEventClubId(event.target.value)} placeholder="UUID باشگاه" /></label>
      <label>بازیکن ویژه<select required value={eventPlayerId} onChange={(event) => setEventPlayerId(event.target.value)}>
        {players.map((player) => <option key={player.id} value={player.id}>{playerLabel(player)}</option>)}
      </select></label>
      <label>شناسهٔ رویداد<input required minLength={1} maxLength={160} value={eventReference} onChange={(event) => setEventReference(event.target.value)} /></label>
      <label>کلید یکتای صدور<input required minLength={1} maxLength={160} value={eventIdempotency} onChange={(event) => setEventIdempotency(event.target.value)} /></label>
      <button type="submit" disabled={busy || !eventClubId.trim() || !eventPlayerId || !eventReference.trim() || !eventIdempotency.trim()}>صدور استحقاق جایزه</button>
    </form>
    <button type="button" disabled={busy} onClick={() => { setBusy(true); load().then(() => setStatus("اطلاعات به‌روز شد.")).catch((error) => setStatus(error instanceof Error ? error.message : "بارگذاری ناموفق بود.")).finally(() => setBusy(false)); }}>بارگذاری مجدد</button>
    {status && <p className="notice" role="status">{status}</p>}
  </section>;
}
