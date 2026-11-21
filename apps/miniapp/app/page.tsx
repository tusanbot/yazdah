"use client";

import { FormEvent, useMemo, useState } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

type AuthResult = {
  accessToken: string;
  user: { id: string; first_name: string; username?: string | null };
};
type SquadPlayer = { id: string; full_name: string; position: string; overall: number; potential: number; fitness: number; morale: number; contract_until: string | null; weekly_wage: number; squad_slot: { slot_no: number }[] | null };
type StaffMember = { id: string; full_name: string; staff_role: string; specialty: string | null; skill: number; weekly_wage: number; contract_until: string | null; released_at: string | null };
type AcademyProspect = { id: string; full_name: string; birth_date: string; position: string; potential: number; development: number; status: "training" | "promoted" | "released"; created_at: string };
type ClubProfile = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country_code: string | null;
  level: number;
  reputation: number;
  economy: { balance: number };
  tactics: { formation: string; mentality: string; tempo: string; pressing: string };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function HomePage() {
  const [clubName, setClubName] = useState("");
  const [clubSlug, setClubSlug] = useState("");
  const [city, setCity] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<AuthResult | null>(null);
  const [clubId, setClubId] = useState("");
  const [clubProfile, setClubProfile] = useState<ClubProfile | null>(null);
  const [prospects, setProspects] = useState<AcademyProspect[]>([]);
  const [academyBusy, setAcademyBusy] = useState(false);
  const [academyStatus, setAcademyStatus] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [prospectBirthDate, setProspectBirthDate] = useState("");
  const [prospectPosition, setProspectPosition] = useState("ST");
  const [prospectPotential, setProspectPotential] = useState(60);
  const [players, setPlayers] = useState<SquadPlayer[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [lineupStatus, setLineupStatus] = useState("");
  const [lineupBusy, setLineupBusy] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffStatus, setStaffStatus] = useState("");
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("coach");
  const [staffSkill, setStaffSkill] = useState(50);
  const [staffWage, setStaffWage] = useState(500);
  const [staffContract, setStaffContract] = useState("");

  const slugHint = useMemo(() => clubSlug.trim().toLowerCase(), [clubSlug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setBusy(true);
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error("این صفحه را از داخل ربات تلگرام باز کنید تا ورود امن فعال شود.");
      if (!API_URL) throw new Error("آدرس API تنظیم نشده است.");

      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();

      const authResponse = await fetch(`${API_URL}/auth/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      const authBody = await authResponse.json();
      if (!authResponse.ok) throw new Error(authBody.error ?? "ورود ناموفق بود.");

      const auth = authBody as AuthResult;
      setSession(auth);

      const clubResponse = await fetch(`${API_URL}/clubs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          name: clubName.trim(),
          slug: slugHint,
          city: city.trim() || undefined,
          countryCode: countryCode.trim().toUpperCase() || undefined,
        }),
      });
      const clubBody = await clubResponse.json();
      if (!clubResponse.ok) throw new Error(clubBody.error ?? "ثبت باشگاه ناموفق بود.");
      setClubId(clubBody.clubId);
      const profileResponse = await fetch(`${API_URL}/clubs/me`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const profileBody = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profileBody.error ?? "بارگذاری پروفایل باشگاه ناموفق بود.");
      setClubProfile(profileBody.club as ClubProfile);
      await loadPlayers(auth.accessToken);
      await loadAcademy(auth.accessToken);
      await loadStaff(auth.accessToken);
      setStatus("باشگاه با موفقیت ساخته شد.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "خطای نامشخص رخ داد.");
    } finally {
      setBusy(false);
    }
  }

  async function loadPlayers(accessToken: string) {
    const response = await fetch(`${API_URL}/clubs/me/players`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری فهرست بازیکنان ناموفق بود.");
    const roster = body.players as SquadPlayer[];
    setPlayers(roster);
    setSelectedPlayerIds(roster.filter((player) => player.squad_slot?.[0]).sort((a, b) => (a.squad_slot?.[0]?.slot_no ?? 99) - (b.squad_slot?.[0]?.slot_no ?? 99)).map((player) => player.id));
  }

  async function saveLineup() {
    if (!session || selectedPlayerIds.length !== 11) return;
    setLineupBusy(true);
    setLineupStatus("");
    try {
      const response = await fetch(API_URL + "/clubs/me/lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.accessToken },
        body: JSON.stringify({ playerIds: selectedPlayerIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "ثبت ترکیب ناموفق بود.");
      await loadPlayers(session.accessToken);
      setLineupStatus("ترکیب اصلی با موفقیت ذخیره شد.");
    } catch (error) {
      setLineupStatus(error instanceof Error ? error.message : "ذخیره ترکیب ناموفق بود.");
    } finally {
      setLineupBusy(false);
    }
  }
  async function loadAcademy(accessToken: string) {
    const response = await fetch(`${API_URL}/clubs/me/academy`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری آکادمی ناموفق بود.");
    setProspects(body.prospects as AcademyProspect[]);
  }

  async function loadStaff(accessToken: string) {
    const response = await fetch(`${API_URL}/clubs/me/staff`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری کادر فنی ناموفق بود.");
    setStaff(body.staff as StaffMember[]);
  }

  async function hireStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setStaffBusy(true);
    setStaffStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ fullName: staffName.trim(), staffRole, skill: staffSkill, weeklyWage: staffWage, contractUntil: staffContract, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "insufficient_funds" ? "موجودی باشگاه برای هزینهٔ قرارداد کافی نیست." : body.error ?? "استخدام ناموفق بود.");
      await loadStaff(session.accessToken);
      setStaffName("");
      setStaffStatus("عضو جدید به کادر فنی اضافه شد.");
    } catch (error) {
      setStaffStatus(error instanceof Error ? error.message : "خطای نامشخص در کادر فنی.");
    } finally {
      setStaffBusy(false);
    }
  }

  async function releaseStaff(staffId: string) {
    if (!session) return;
    setStaffBusy(true);
    setStaffStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/staff/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ staffId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "فسخ قرارداد ناموفق بود.");
      await loadStaff(session.accessToken);
      setStaffStatus("قرارداد عضو کادر فنی فسخ شد.");
    } catch (error) {
      setStaffStatus(error instanceof Error ? error.message : "خطای نامشخص در کادر فنی.");
    } finally {
      setStaffBusy(false);
    }
  }

  async function recruitProspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setAcademyBusy(true);
    setAcademyStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/academy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ fullName: prospectName.trim(), birthDate: prospectBirthDate, position: prospectPosition, potential: prospectPotential }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "ثبت استعداد ناموفق بود.");
      await loadAcademy(session.accessToken);
      setProspectName("");
      setProspectBirthDate("");
      setAcademyStatus("استعداد جدید به آکادمی اضافه شد.");
    } catch (error) {
      setAcademyStatus(error instanceof Error ? error.message : "خطای نامشخص در آکادمی.");
    } finally {
      setAcademyBusy(false);
    }
  }

  async function promoteProspect(prospectId: string) {
    if (!session) return;
    setAcademyBusy(true);
    setAcademyStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/academy/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ academyPlayerId: prospectId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "ارتقای بازیکن ناموفق بود.");
      setProspects((items) => items.map((item) => item.id === prospectId ? { ...item, status: "promoted" } : item));
      await loadPlayers(session.accessToken);
      setAcademyStatus("بازیکن با موفقیت به تیم اصلی منتقل شد.");
    } catch (error) {
      setAcademyStatus(error instanceof Error ? error.message : "خطای نامشخص در آکادمی.");
    } finally {
      setAcademyBusy(false);
    }
  }

  return (
    <main dir="rtl" lang="fa" className="page">
      <section className="panel">
        <header>
          <p className="eyebrow">مدیریت باشگاه فوتبال</p>
          <h1>یازده</h1>
          <p className="subtitle">باشگاهت را بساز؛ مسیرت را تا قهرمانی شروع کن.</p>
        </header>

        {clubId ? (
          <div className="success" role="status">
            <h2>باشگاه ثبت شد</h2>
            <p>شناسه باشگاه: <code>{clubId}</code></p>
            {clubProfile && <>
              <p>نام باشگاه: {clubProfile.name}</p>
              <p>سطح: {clubProfile.level} · اعتبار: {clubProfile.reputation}</p>
              <p>موجودی: {clubProfile.economy.balance.toLocaleString("fa-IR")} سکه</p>
              <p>آرایش اولیه: {clubProfile.tactics.formation}</p>
            </>}
            <p>مرحله بعدی: تکمیل پروفایل، لوگو و ترکیب اولیه.</p>
            <section className="academy" aria-labelledby="squad-heading">
              <h2 id="squad-heading">فهرست بازیکنان</h2>
              <p className="muted">بازیکنان تحت قرارداد باشگاه؛ بازیکنانی که از آکادمی ارتقا می‌یابند در این فهرست دیده می‌شوند.</p>
              {players.length === 0 ? <p className="muted">هنوز بازیکنی در تیم اصلی ثبت نشده است. از آکادمی بازیکن جذب و ارتقا بده.</p> : <div className="prospects">
                {players.map((player) => <article className="prospect" key={player.id}>
                  <div><strong>{player.full_name}</strong><p>{player.position} · قدرت {player.overall} · پتانسیل {player.potential}</p><small>آمادگی {player.fitness} · روحیه {player.morale} · {player.squad_slot?.[0] ? `ترکیب اصلی، جایگاه ${player.squad_slot[0].slot_no}` : "ذخیره"}</small></div>
                  <label><input type="checkbox" checked={selectedPlayerIds.includes(player.id)} onChange={(event) => setSelectedPlayerIds((ids) => event.target.checked ? [...ids, player.id] : ids.filter((id) => id !== player.id))} /> انتخاب برای ترکیب</label>
                </article>)}
              </div>
              <p className="muted">انتخاب‌شده: {selectedPlayerIds.length} از ۱۱</p>
              <button type="button" disabled={lineupBusy || selectedPlayerIds.length !== 11} onClick={saveLineup}>{lineupBusy ? "در حال ذخیره…" : "ذخیره ترکیب اصلی"}</button>
              {lineupStatus && <p className="notice" role="status">{lineupStatus}</p>}
            </section>
            <section className="academy" aria-labelledby="staff-heading">
              <h2 id="staff-heading">مدیریت کادر فنی</h2>
              <p className="muted">استخدام و فسخ قرارداد اعضای کادر. هزینهٔ اولیهٔ قرارداد برابر دو هفته حقوق است.</p>
              {staff.length === 0 ? <p className="muted">کادر فنی هنوز عضوی ندارد.</p> : <div className="prospects">
                {staff.map((member) => <article className="prospect" key={member.id}>
                  <div><strong>{member.full_name}</strong><p>{({coach:"مربی",technical:"مدیر فنی",medical:"پزشک",fitness:"مربی بدنساز",transfer_director:"مدیر نقل‌وانتقالات"} as Record<string,string>)[member.staff_role] ?? member.staff_role} · مهارت {member.skill}</p><small>حقوق هفتگی: {Number(member.weekly_wage).toLocaleString("fa-IR")} · {member.released_at ? "فسخ‌شده" : `قرارداد تا ${member.contract_until ?? "نامشخص"}`}</small></div>
                  {!member.released_at && <button type="button" disabled={staffBusy} onClick={() => releaseStaff(member.id)}>فسخ قرارداد</button>}
                </article>)}
              </div>}
              <form className="recruit-form" onSubmit={hireStaff}>
                <h3>استخدام عضو جدید</h3>
                <label>نام<input required minLength={2} maxLength={80} value={staffName} onChange={(event) => setStaffName(event.target.value)} /></label>
                <label>سمت<select value={staffRole} onChange={(event) => setStaffRole(event.target.value)}><option value="coach">مربی</option><option value="technical">مدیر فنی</option><option value="medical">پزشک</option><option value="fitness">مربی بدنساز</option><option value="transfer_director">مدیر نقل‌وانتقالات</option></select></label>
                <label>مهارت<input required type="number" min={1} max={100} value={staffSkill} onChange={(event) => setStaffSkill(Number(event.target.value))} /></label>
                <label>حقوق هفتگی (سکه)<input required type="number" min={0} max={100000000} value={staffWage} onChange={(event) => setStaffWage(Number(event.target.value))} /></label>
                <label>پایان قرارداد<input required type="date" value={staffContract} onChange={(event) => setStaffContract(event.target.value)} /></label>
                <button type="submit" disabled={staffBusy}>{staffBusy ? "در حال ثبت…" : "استخدام و ثبت قرارداد"}</button>
              </form>
              {staffStatus && <p className="notice" role="status">{staffStatus}</p>}
            </section>
            <section className="academy" aria-labelledby="academy-heading">
              <h2 id="academy-heading">آکادمی باشگاه</h2>
              <p className="muted">استعدادهای جوان را بررسی کن و بازیکنان آماده را به تیم اصلی ارتقا بده.</p>
              {prospects.length === 0 ? <p className="muted">هنوز استعدادی در آکادمی ثبت نشده است.</p> : <div className="prospects">
                {prospects.map((prospect) => <article className="prospect" key={prospect.id}>
                  <div><strong>{prospect.full_name}</strong><p>{prospect.position} · پتانسیل {prospect.potential} · پیشرفت {prospect.development}</p><small>وضعیت: {prospect.status === "training" ? "در حال پرورش" : prospect.status === "promoted" ? "ارتقایافته" : "آزادشده"}</small></div>
                  {prospect.status === "training" && <button type="button" disabled={academyBusy} onClick={() => promoteProspect(prospect.id)}>{academyBusy ? "در حال انتقال…" : "ارتقا به تیم اصلی"}</button>}
                </article>)}
              </div>}
              <form className="recruit-form" onSubmit={recruitProspect}>
                <h3>ثبت استعداد جدید</h3>
                <label>نام بازیکن<input required minLength={2} maxLength={80} value={prospectName} onChange={(event) => setProspectName(event.target.value)} /></label>
                <label>تاریخ تولد<input required type="date" value={prospectBirthDate} onChange={(event) => setProspectBirthDate(event.target.value)} /></label>
                <label>پست<select required value={prospectPosition} onChange={(event) => setProspectPosition(event.target.value)}><option value="GK">دروازه‌بان</option><option value="CB">مدافع میانی</option><option value="LB">مدافع چپ</option><option value="RB">مدافع راست</option><option value="DM">هافبک دفاعی</option><option value="CM">هافبک میانی</option><option value="AM">هافبک هجومی</option><option value="LW">وینگر چپ</option><option value="RW">وینگر راست</option><option value="ST">مهاجم</option></select></label>
                <label>پتانسیل (۱ تا ۱۰۰)<input required type="number" min={1} max={100} value={prospectPotential} onChange={(event) => setProspectPotential(Number(event.target.value))} /></label>
                <button type="submit" disabled={academyBusy}>{academyBusy ? "در حال ثبت…" : "افزودن به آکادمی"}</button>
              </form>
              {academyStatus && <p className="notice" role="status">{academyStatus}</p>}
            </section>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              نام باشگاه
              <input required minLength={2} maxLength={60} value={clubName}
                onChange={(event) => setClubName(event.target.value)} placeholder="مثلاً شاهین تهران" />
            </label>
            <label>
              شناسه لاتین باشگاه
              <input required minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9-]{2,39}"
                value={clubSlug} onChange={(event) => setClubSlug(event.target.value)}
                placeholder="مثلاً tehran-shahin" />
            </label>
            <label>
              شهر <span>(اختیاری)</span>
              <input maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} placeholder="تهران" />
            </label>
            <label>
              کد کشور دوحرفی <span>(اختیاری)</span>
              <input maxLength={2} pattern="[A-Za-z]{2}" value={countryCode}
                onChange={(event) => setCountryCode(event.target.value)} placeholder="IR" />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "در حال ثبت…" : "ورود با تلگرام و ساخت باشگاه"}
            </button>
          </form>
        )}
        {status && <p className="notice" role="status">{status}</p>}
        {session && !clubId && <p className="muted">ورود انجام شده؛ ثبت باشگاه در حال تکمیل است.</p>}
        <footer>اطلاعات ورود فقط در سرور اعتبارسنجی می‌شود.</footer>
      </section>
      <style jsx>{`
        :global(*) { box-sizing: border-box; }
        :global(body) { margin: 0; background: #0b1220; color: #edf2f7; font-family: Tahoma, Arial, sans-serif; }
        .page { min-height: 100vh; display: grid; place-items: center; padding: 24px 14px; }
        .panel { width: min(100%, 520px); border: 1px solid #263449; border-radius: 24px; background: #121d2e; padding: 28px; box-shadow: 0 24px 70px #0005; }
        header { margin-bottom: 24px; }
        .eyebrow { color: #82b7ff; font-size: 13px; margin: 0 0 8px; }
        h1 { font-size: 36px; margin: 0; }
        .subtitle, .muted, footer { color: #a6b5c9; line-height: 1.8; }
        form { display: grid; gap: 16px; }
        label { display: grid; gap: 8px; font-size: 14px; }
        label span { color: #9aabc0; font-weight: normal; }
        input { width: 100%; background: #0b1422; border: 1px solid #34465f; border-radius: 12px; padding: 13px 14px; color: #fff; font: inherit; }
        select { width: 100%; background: #0b1422; border: 1px solid #34465f; border-radius: 12px; padding: 10px; color: #fff; font: inherit; }
        input:focus { outline: 2px solid #478ce6; border-color: transparent; }
        button { margin-top: 6px; padding: 14px; border: 0; border-radius: 12px; background: #3478db; color: white; font: inherit; font-weight: bold; cursor: pointer; }
        button:disabled { opacity: .6; cursor: wait; }
        .notice { background: #253247; border-radius: 10px; padding: 12px; line-height: 1.7; }
        .academy { margin-top: 20px; padding-top: 16px; border-top: 1px solid #28634f; }
        .academy h2 { margin: 0 0 8px; }
        .prospects { display: grid; gap: 10px; }
        .recruit-form { display: grid; gap: 10px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #34465f; }
        .recruit-form h3 { margin: 0; }
        .recruit-form label { display: grid; gap: 6px; font-size: 13px; }
        .recruit-form input { padding: 10px; }
        .prospect { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px; border: 1px solid #34465f; border-radius: 12px; background: #101a29; }
        .prospect p { margin: 6px 0; font-size: 13px; }
        .prospect small { color: #a6b5c9; }
        .prospect button { margin: 0; padding: 10px; font-size: 12px; flex-shrink: 0; }
        .academy { margin-top: 20px; padding-top: 16px; border-top: 1px solid #28634f; }
        .academy h2 { margin: 0 0 8px; }
        .prospects { display: grid; gap: 10px; }
        .prospect { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px; border: 1px solid #34465f; border-radius: 12px; background: #101a29; }
        .prospect p { margin: 6px 0; font-size: 13px; }
        .prospect small { color: #a6b5c9; }
        .prospect button { margin: 0; padding: 10px; font-size: 12px; flex-shrink: 0; }
        .success { background: #163b32; border: 1px solid #28634f; border-radius: 14px; padding: 16px; overflow-wrap: anywhere; }
        code { font-size: 12px; }
        footer { border-top: 1px solid #263449; margin-top: 24px; padding-top: 16px; font-size: 12px; }
      `}</style>
    </main>
  );
}
