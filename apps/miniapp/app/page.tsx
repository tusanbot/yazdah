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
      setStatus("باشگاه با موفقیت ساخته شد.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "خطای نامشخص رخ داد.");
    } finally {
      setBusy(false);
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
            <p>مرحله بعدی: تکمیل پروفایل، لوگو و ترکیب اولیه.</p>
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
        input:focus { outline: 2px solid #478ce6; border-color: transparent; }
        button { margin-top: 6px; padding: 14px; border: 0; border-radius: 12px; background: #3478db; color: white; font: inherit; font-weight: bold; cursor: pointer; }
        button:disabled { opacity: .6; cursor: wait; }
        .notice { background: #253247; border-radius: 10px; padding: 12px; line-height: 1.7; }
        .success { background: #163b32; border: 1px solid #28634f; border-radius: 14px; padding: 16px; overflow-wrap: anywhere; }
        code { font-size: 12px; }
        footer { border-top: 1px solid #263449; margin-top: 24px; padding-top: 16px; font-size: 12px; }
      `}</style>
    </main>
  );
}
