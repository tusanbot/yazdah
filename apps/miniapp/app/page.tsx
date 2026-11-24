"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import GroupGames from "../components/GroupGames";
import AdminSpecialPlayerTools from "../components/AdminSpecialPlayerTools";

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
type MarketListing = { id: string; asking_price: number; listed_at: string; player: { id: string; full_name: string; position: string; overall: number; potential: number; nationality_code: string | null }; seller: { id: string; name: string; slug: string } };
type OwnListing = { id: string; player_id: string; asking_price: number; status: string };
type Standing = { club_id: string; points: number; played: number; wins: number; draws: number; losses: number; goals_for: number; goals_against: number; club: { name: string; slug: string } | null };
type ClubMatch = { id: string; competition_id: string | null; home_club_id: string; away_club_id: string; kickoff_at: string; status: string; home_score: number | null; away_score: number | null; competition: { name: string; competition_type: string; season: number } | null };
type SquadPlayer = { id: string; full_name: string; position: string; overall: number; potential: number; fitness: number; morale: number; contract_until: string | null; weekly_wage: number; player_class: "ordinary" | "professional" | "special"; ordinary_tier: "base" | "prospect" | "elite" | null; release_clause: number; acquisition_source: string; squad_slot: { slot_no: number }[] | null };
type StaffMember = { id: string; full_name: string; staff_role: string; staff_tier: "ordinary" | "professional" | "legendary"; specialty: string | null; skill: number; weekly_wage: number; signing_fee: number; generated_source: string; effect_profile: Record<string, number>; contract_until: string | null; released_at: string | null };
type AcademyProspect = { id: string; full_name: string; birth_date: string; position: string; potential: number; development: number; status: "training" | "promoted" | "released"; created_at: string };
type ClubMission = { id: string; title: string; description: string; target_count: number; reward_coins: number; progress: number; claimedAt: string | null };
type ClubUnion = { id: string; name: string; tag: string; leader_club_id: string; members?: { count: number }[] };
type GroupChallenge = { id: string; telegram_chat_id: number; challenger_club_id: string; opponent_club_id: string; match_id: string | null; requested_kickoff_at: string; status: string; created_at: string };
type AdminOverview = {
  role: string;
  stats: { users: number; clubs: number; matches: number; notificationsPending: number; notificationsFailed: number };
  recentAudit: { id: string; action: string; target_type: string; target_id: string | null; created_at: string }[];
  failedNotifications: { id: string; match_id: string; telegram_user_id: number | string; attempts: number; last_error: string | null; created_at: string }[];
};
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
  const [tactics, setTactics] = useState({ formation: "4-3-3", mentality: "balanced", tempo: "normal", pressing: "standard" });
  const [tacticsStatus, setTacticsStatus] = useState("");
  const [prospects, setProspects] = useState<AcademyProspect[]>([]);
  const [academyBusy, setAcademyBusy] = useState(false);
  const [academyStatus, setAcademyStatus] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [prospectBirthDate, setProspectBirthDate] = useState("");
  const [prospectPosition, setProspectPosition] = useState("ST");
  const [prospectPotential, setProspectPotential] = useState(60);
  const [players, setPlayers] = useState<SquadPlayer[]>([]);
  const [trainingPlan, setTrainingPlan] = useState("balanced");
  const [trainingStatus, setTrainingStatus] = useState("");
  const [contractStatus, setContractStatus] = useState("");
  const [matches, setMatches] = useState<ClubMatch[]>([]);
  const [matchBusyId, setMatchBusyId] = useState("");
  const [matchStatus, setMatchStatus] = useState("");
  const [standings, setStandings] = useState<Record<string, Standing[]>>({});
  const [standingsBusyId, setStandingsBusyId] = useState("");
  const [marketListings, setMarketListings] = useState<MarketListing[]>([]);
  const [ownListings, setOwnListings] = useState<OwnListing[]>([]);
  const [marketPrices, setMarketPrices] = useState<Record<string, string>>({});
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketStatus, setMarketStatus] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [lineupStatus, setLineupStatus] = useState("");
  const [lineupBusy, setLineupBusy] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffStatus, setStaffStatus] = useState("");
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("coach");
  const [staffTier, setStaffTier] = useState("ordinary");
  const [staffSkill, setStaffSkill] = useState(50);
  const [staffWage, setStaffWage] = useState(500);
  const [staffContract, setStaffContract] = useState("");
  const [missions, setMissions] = useState<ClubMission[]>([]);
  const [unions, setUnions] = useState<ClubUnion[]>([]);
  const [communityBusy, setCommunityBusy] = useState(false);
  const [communityStatus, setCommunityStatus] = useState("");
  const [unionName, setUnionName] = useState("");
  const [unionTag, setUnionTag] = useState("");
  const [groupChallenges, setGroupChallenges] = useState<GroupChallenge[]>([]);
  const [groupChatId, setGroupChatId] = useState("");
  const [opponentClubId, setOpponentClubId] = useState("");
  const [challengeKickoff, setChallengeKickoff] = useState("");
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeStatus, setChallengeStatus] = useState("");
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminStatus, setAdminStatus] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  const slugHint = useMemo(() => clubSlug.trim().toLowerCase(), [clubSlug]);

  async function authenticateTelegram(): Promise<AuthResult> {
    // The Telegram script is loaded before hydration, but the WebApp bridge can
    // become available a moment later on slower clients. Give it a short grace period.
    let initData = window.Telegram?.WebApp?.initData;
    for (let attempt = 0; !initData && attempt < 20; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      initData = window.Telegram?.WebApp?.initData;
    }
    if (!initData) throw new Error("اطلاعات ورود تلگرام دریافت نشد. لینک مینی‌اپ را از دکمهٔ داخل گفت‌وگوی خصوصی ربات باز کن و مطمئن شو ربات و دامنهٔ مینی‌اپ درست تنظیم شده‌اند.");
    if (!API_URL) throw new Error("آدرس API تنظیم نشده است.");

    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();

    const response = await fetch(`${API_URL}/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "ورود با تلگرام ناموفق بود.");
    return body as AuthResult;
  }

  async function loadClubWorkspace(accessToken: string, club: ClubProfile): Promise<string[]> {
    setClubId(club.id);
    setClubProfile(club);
    setTactics(club.tactics);

    const sections = [
      ["ترکیب و بازیکنان", () => loadPlayers(accessToken)],
      ["تمرین", () => loadTrainingPlan(accessToken)],
      ["مسابقات", () => loadMatches(accessToken)],
      ["بازار نقل‌وانتقالات", () => loadMarket(accessToken)],
      ["آگهی‌های باشگاه", () => loadOwnListings(accessToken)],
      ["آکادمی", () => loadAcademy(accessToken)],
      ["کادر فنی", () => loadStaff(accessToken)],
      ["جامعه و بازی‌های گروهی", () => loadCommunity(accessToken)],
      ["پنل مدیریت", () => loadAdminOverview(accessToken)],
    ] as const;

    const results = await Promise.allSettled(sections.map(([, load]) => load()));
    return results.flatMap((result, index) => result.status === "rejected" ? [sections[index][0]] : []);
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      setBusy(true);
      setStatus("در حال برقراری ورود امن با تلگرام…");
      try {
        const auth = await authenticateTelegram();
        if (!active) return;
        setSession(auth);

        const response = await fetch(`${API_URL}/clubs/me`, {
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "بررسی باشگاه کاربر ناموفق بود.");

        if (body.club) {
          const failedSections = await loadClubWorkspace(auth.accessToken, body.club as ClubProfile);
          if (active) setStatus(failedSections.length
            ? `وارد باشگاه شدی؛ بارگذاری این بخش‌ها ناموفق بود: ${failedSections.join("، ")}. می‌توانی بخش‌های دیگر را استفاده کنی و بعد دوباره تلاش کنی.`
            : "خوش آمدی! اطلاعات باشگاهت بارگذاری شد.");
        } else if (active) {
          setStatus("ورود امن انجام شد؛ برای شروع، باشگاهت را ثبت کن.");
        }
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "ورود با تلگرام ناموفق بود.");
      } finally {
        if (active) setBusy(false);
      }
    }
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const scrollToSection = () => {
      const sectionId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!sectionId || !clubProfile) return;
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    scrollToSection();
    window.addEventListener("hashchange", scrollToSection);
    return () => window.removeEventListener("hashchange", scrollToSection);
  }, [clubProfile]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setBusy(true);
    try {
      const auth = session ?? await authenticateTelegram();
      if (!session) setSession(auth);

      const existingResponse = await fetch(`${API_URL}/clubs/me`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const existingBody = await existingResponse.json();
      if (!existingResponse.ok) throw new Error(existingBody.error ?? "بررسی باشگاه کاربر ناموفق بود.");
      if (existingBody.club) {
        const failedSections = await loadClubWorkspace(auth.accessToken, existingBody.club as ClubProfile);
        setStatus(failedSections.length
          ? `باشگاه قبلی بارگذاری شد؛ بعضی بخش‌ها در دسترس نیستند: ${failedSections.join("، ")}.`
          : "باشگاه قبلی شما بارگذاری شد.");
        return;
      }

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

      const profileResponse = await fetch(`${API_URL}/clubs/me`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const profileBody = await profileResponse.json();
      if (!profileResponse.ok || !profileBody.club) {
        throw new Error(profileBody.error ?? "بارگذاری پروفایل باشگاه ناموفق بود.");
      }
      const failedSections = await loadClubWorkspace(auth.accessToken, profileBody.club as ClubProfile);
      setStatus(failedSections.length
        ? `باشگاه ساخته شد؛ بارگذاری این بخش‌ها ناموفق بود: ${failedSections.join("، ")}.`
        : "باشگاه با موفقیت ساخته شد.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "خطای نامشخص رخ داد.");
    } finally {
      setBusy(false);
    }
  }

  async function loadAdminOverview(accessToken: string) {
    const response = await fetch(`${API_URL}/admin/overview`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 403) { setAdminOverview(null); return; }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری پنل مدیریت ناموفق بود.");
    setAdminOverview(body as AdminOverview);
  }

  async function retryAdminNotification(notificationId: string) {
    if (!session) return;
    setAdminBusy(true); setAdminStatus("");
    try {
      const response = await fetch(`${API_URL}/admin/notifications/${notificationId}/retry`, {
        method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "تلاش مجدد اعلان ناموفق بود.");
      await loadAdminOverview(session.accessToken);
      setAdminStatus("اعلان به صف ارسال بازگردانده شد.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "عملیات ناموفق بود.");
    } finally { setAdminBusy(false); }
  }

  async function loadCommunity(accessToken: string) {
    const [missionResponse, unionResponse] = await Promise.all([
      fetch(`${API_URL}/clubs/me/missions`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/unions`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    const missionBody = await missionResponse.json();
    const unionBody = await unionResponse.json();
    if (!missionResponse.ok) throw new Error(missionBody.error ?? "بارگذاری مأموریت‌ها ناموفق بود.");
    if (!unionResponse.ok) throw new Error(unionBody.error ?? "بارگذاری اتحادیه‌ها ناموفق بود.");
    setMissions(missionBody.missions as ClubMission[]);
    setUnions(unionBody.unions as ClubUnion[]);
    const challengeResponse = await fetch(`${API_URL}/clubs/me/group-challenges`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const challengeBody = await challengeResponse.json();
    if (!challengeResponse.ok) throw new Error(challengeBody.error ?? "بارگذاری چالش‌های گروهی ناموفق بود.");
    setGroupChallenges(challengeBody.challenges as GroupChallenge[]);
  }

  async function claimMission(missionId: string) {
    if (!session) return;
    setCommunityBusy(true); setCommunityStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/missions/claim`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ missionId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "mission_incomplete" ? "برای دریافت پاداش، مأموریت را کامل کن." : body.error ?? "دریافت پاداش ناموفق بود.");
      await loadCommunity(session.accessToken);
      setCommunityStatus("پاداش مأموریت به موجودی باشگاه اضافه شد.");
    } catch (error) { setCommunityStatus(error instanceof Error ? error.message : "دریافت پاداش ناموفق بود."); }
    finally { setCommunityBusy(false); }
  }

  async function createUnion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setCommunityBusy(true); setCommunityStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/unions`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ name: unionName.trim(), tag: unionTag.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "union_name_tag_or_membership_conflict" ? "نام یا نشان تکراری است، یا باشگاهت از قبل عضو اتحادیه‌ای است." : body.error ?? "ساخت اتحادیه ناموفق بود.");
      setUnionName(""); setUnionTag("");
      await loadCommunity(session.accessToken);
      setCommunityStatus("اتحادیه ایجاد شد.");
    } catch (error) { setCommunityStatus(error instanceof Error ? error.message : "ساخت اتحادیه ناموفق بود."); }
    finally { setCommunityBusy(false); }
  }

  async function joinUnion(unionId: string) {
    if (!session) return;
    setCommunityBusy(true); setCommunityStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/unions/join`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ unionId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "club_already_in_union" ? "باشگاهت از قبل عضو یک اتحادیه است." : body.error === "union_full" ? "ظرفیت اتحادیه تکمیل شده است." : body.error ?? "پیوستن به اتحادیه ناموفق بود.");
      await loadCommunity(session.accessToken);
      setCommunityStatus("باشگاه به اتحادیه پیوست.");
    } catch (error) { setCommunityStatus(error instanceof Error ? error.message : "پیوستن به اتحادیه ناموفق بود."); }
    finally { setCommunityBusy(false); }
  }

  async function createGroupChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const chatId = Number(groupChatId);
    if (!Number.isSafeInteger(chatId) || !opponentClubId.trim() || !challengeKickoff) {
      setChallengeStatus("شناسه گروه، شناسه باشگاه حریف و زمان مسابقه را بررسی کن.");
      return;
    }
    const kickoffDate = new Date(challengeKickoff);
    if (!Number.isFinite(kickoffDate.getTime()) || kickoffDate.getTime() <= Date.now()) {
      setChallengeStatus("زمان شروع مسابقه باید معتبر و در آینده باشد.");
      return;
    }
    const kickoffAt = kickoffDate.toISOString();
    setChallengeBusy(true); setChallengeStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/group-challenges`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ telegramChatId: chatId, opponentClubId: opponentClubId.trim(), kickoffAt }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "telegram_group_not_linked" ? "ابتدا گروه تلگرام را با دستور /group به بازی متصل کن." : body.error ?? "ساخت چالش ناموفق بود.");
      setOpponentClubId(""); setChallengeKickoff("");
      await loadCommunity(session.accessToken);
      setChallengeStatus(`چالش ساخته شد؛ شناسه: ${body.challengeId}`);
    } catch (error) {
      setChallengeStatus(error instanceof Error ? error.message : "ساخت چالش ناموفق بود.");
    } finally { setChallengeBusy(false); }
  }

  async function acceptGroupChallenge(challenge: GroupChallenge) {
    if (!session) return;
    setChallengeBusy(true); setChallengeStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/group-challenges/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ challengeId: challenge.id, kickoffAt: challenge.requested_kickoff_at }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "پذیرش چالش ناموفق بود.");
      await loadCommunity(session.accessToken);
      setChallengeStatus(`چالش پذیرفته شد؛ شناسه مسابقه: ${body.matchId}`);
    } catch (error) {
      setChallengeStatus(error instanceof Error ? error.message : "پذیرش چالش ناموفق بود.");
    } finally { setChallengeBusy(false); }
  }

  async function loadMatches(accessToken: string) {
    const response = await fetch(`${API_URL}/clubs/me/matches`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری مسابقات ناموفق بود.");
    setMatches(body.matches as ClubMatch[]);
  }

  async function loadStandings(competitionId: string) {
    if (!session) return;
    setStandingsBusyId(competitionId);
    try {
      const response = await fetch(`${API_URL}/competitions/${competitionId}/standings`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "بارگذاری جدول رقابت ناموفق بود.");
      setStandings((current) => ({ ...current, [competitionId]: body.standings as Standing[] }));
    } catch (error) {
      setMatchStatus(error instanceof Error ? error.message : "بارگذاری جدول رقابت ناموفق بود.");
    } finally {
      setStandingsBusyId("");
    }
  }

  async function resolveMatch(matchId: string) {
    if (!session) return;
    setMatchBusyId(matchId);
    setMatchStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/matches/${matchId}/resolve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "match_not_started" ? "زمان شروع مسابقه نرسیده است." : body.error ?? "ثبت نتیجه ناموفق بود.");
      await loadMatches(session.accessToken);
      setMatchStatus("نتیجهٔ مسابقه ثبت شد.");
    } catch (error) {
      setMatchStatus(error instanceof Error ? error.message : "خطای نامشخص در مسابقات.");
    } finally {
      setMatchBusyId("");
    }
  }

  async function saveTactics() {
    if (!session) return;
    setTacticsStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/tactics`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify(tactics),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "ذخیره تاکتیک ناموفق بود.");
      setTactics(body.tactics);
      setTacticsStatus("تاکتیک‌ها ذخیره شد و در مسابقات بعدی اعمال می‌شود.");
    } catch (error) { setTacticsStatus(error instanceof Error ? error.message : "ذخیره تاکتیک ناموفق بود."); }
  }

  async function loadTrainingPlan(accessToken: string) {
    const response = await fetch(`${API_URL}/clubs/me/training-plan`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری برنامه تمرین ناموفق بود.");
    setTrainingPlan(body.plan as string);
  }

  async function saveTrainingPlan() {
    if (!session) return;
    setTrainingStatus("");
    try {
      const response = await fetch(`${API_URL}/clubs/me/training-plan`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ plan: trainingPlan }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "ثبت برنامه تمرین ناموفق بود.");
      setTrainingStatus("برنامه تمرین ذخیره شد و از چرخه روزانه بعدی اعمال می‌شود.");
    } catch (error) { setTrainingStatus(error instanceof Error ? error.message : "ثبت برنامه تمرین ناموفق بود."); }
  }

  async function renewPlayerContract(event: FormEvent<HTMLFormElement>, playerId: string) {
    event.preventDefault();
    if (!session) return;
    setContractStatus("");
    const form = new FormData(event.currentTarget);
    const contractUntil = String(form.get("contractUntil") ?? "");
    const weeklyWage = Number(form.get("weeklyWage"));
    try {
      const response = await fetch(`${API_URL}/clubs/me/players/renew-contract`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ playerId, contractUntil, weeklyWage }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "تمدید قرارداد ناموفق بود.");
      await loadPlayers(session.accessToken);
      setContractStatus("قرارداد بازیکن به‌روزرسانی شد.");
    } catch (error) { setContractStatus(error instanceof Error ? error.message : "تمدید قرارداد ناموفق بود."); }
  }

  async function loadPlayers(accessToken: string) {
    const response = await fetch(`${API_URL}/clubs/me/players`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری فهرست بازیکنان ناموفق بود.");
    const roster = body.players as SquadPlayer[];
    setPlayers(roster);
    setSelectedPlayerIds(roster.filter((player) => player.squad_slot?.[0]).sort((a, b) => (a.squad_slot?.[0]?.slot_no ?? 99) - (b.squad_slot?.[0]?.slot_no ?? 99)).map((player) => player.id));
  }

  async function loadMarket(accessToken: string) {
    const response = await fetch(API_URL + "/market", { headers: { Authorization: "Bearer " + accessToken } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری بازار ناموفق بود.");
    setMarketListings(body.listings as MarketListing[]);
  }

  async function loadOwnListings(accessToken: string) {
    const response = await fetch(API_URL + "/clubs/me/transfer-listings", { headers: { Authorization: "Bearer " + accessToken } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "بارگذاری آگهی‌های باشگاه ناموفق بود.");
    setOwnListings(body.listings as OwnListing[]);
  }

  async function listPlayer(playerId: string) {
    if (!session) return;
    const askingPrice = Number(marketPrices[playerId]);
    if (!Number.isSafeInteger(askingPrice) || askingPrice < 1) { setMarketStatus("قیمت فروش باید عدد صحیح مثبت باشد."); return; }
    setMarketBusy(true); setMarketStatus("");
    try {
      const response = await fetch(API_URL + "/clubs/me/transfer-listings", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.accessToken },
        body: JSON.stringify({ playerId, askingPrice }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "transfer_already_listed" ? "این بازیکن از قبل در بازار است." : body.error ?? "ثبت آگهی ناموفق بود.");
      await Promise.all([loadPlayers(session.accessToken), loadMarket(session.accessToken), loadOwnListings(session.accessToken)]);
      setMarketPrices((prices) => ({ ...prices, [playerId]: "" }));
      setMarketStatus("بازیکن با موفقیت در بازار قرار گرفت؛ از ترکیب اصلی خارج شد.");
    } catch (error) { setMarketStatus(error instanceof Error ? error.message : "ثبت آگهی ناموفق بود."); }
    finally { setMarketBusy(false); }
  }

  async function buyListing(listingId: string) {
    if (!session) return;
    setMarketBusy(true); setMarketStatus("");
    try {
      const response = await fetch(API_URL + "/market/buy", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.accessToken },
        body: JSON.stringify({ listingId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "insufficient_funds" ? "موجودی باشگاه برای خرید کافی نیست." : body.error ?? "خرید بازیکن ناموفق بود.");
      await Promise.all([loadPlayers(session.accessToken), loadMarket(session.accessToken), loadOwnListings(session.accessToken)]);
      setMarketStatus("خرید بازیکن با موفقیت انجام شد.");
    } catch (error) { setMarketStatus(error instanceof Error ? error.message : "خرید بازیکن ناموفق بود."); }
    finally { setMarketBusy(false); }
  }

  async function withdrawListing(listingId: string) {
    if (!session) return;
    setMarketBusy(true); setMarketStatus("");
    try {
      const response = await fetch(API_URL + "/clubs/me/transfer-listings/withdraw", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.accessToken },
        body: JSON.stringify({ listingId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "برداشتن آگهی ناموفق بود.");
      await Promise.all([loadPlayers(session.accessToken), loadMarket(session.accessToken), loadOwnListings(session.accessToken)]);
      setMarketStatus("آگهی از بازار برداشته شد.");
    } catch (error) { setMarketStatus(error instanceof Error ? error.message : "برداشتن آگهی ناموفق بود."); }
    finally { setMarketBusy(false); }
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
        body: JSON.stringify({ fullName: staffName.trim(), staffRole, staffTier, skill: staffSkill, weeklyWage: staffWage, contractUntil: staffContract, idempotencyKey: crypto.randomUUID() }),
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
            {adminOverview && <><section className="training-plan" aria-labelledby="admin-heading">
              <h2 id="admin-heading">پنل مدیریت یازده</h2>
              <p className="muted">سطح دسترسی: {adminOverview.role === "super_admin" ? "مدیر ارشد" : "مدیر"}</p>
              <div className="prospects">
                <article className="prospect"><strong>کاربران</strong><span>{adminOverview.stats.users.toLocaleString("fa-IR")}</span></article>
                <article className="prospect"><strong>باشگاه‌ها</strong><span>{adminOverview.stats.clubs.toLocaleString("fa-IR")}</span></article>
                <article className="prospect"><strong>مسابقات</strong><span>{adminOverview.stats.matches.toLocaleString("fa-IR")}</span></article>
                <article className="prospect"><strong>اعلان‌های در صف</strong><span>{adminOverview.stats.notificationsPending.toLocaleString("fa-IR")}</span></article>
                <article className="prospect"><strong>اعلان‌های ناموفق</strong><span>{adminOverview.stats.notificationsFailed.toLocaleString("fa-IR")}</span></article>
              </div>
              <h3>اعلان‌های ناموفق تلگرام</h3>
              {adminOverview.failedNotifications.length === 0 ? <p className="muted">اعلان ناموفقی وجود ندارد.</p> : <div className="prospects">
                {adminOverview.failedNotifications.map((item) => <article className="prospect" key={item.id}>
                  <div><strong>مسابقه: {item.match_id}</strong><small>کاربر تلگرام: {item.telegram_user_id} · تلاش‌ها: {item.attempts}</small><small>{item.last_error ?? "بدون جزئیات خطا"}</small></div>
                  <button type="button" disabled={adminBusy} onClick={() => retryAdminNotification(item.id)}>ارسال مجدد</button>
                </article>)}
              </div>}
              <h3>آخرین اقدامات مدیریتی</h3>
              {adminOverview.recentAudit.length === 0 ? <p className="muted">هنوز اقدامی ثبت نشده است.</p> : <ul>
                {adminOverview.recentAudit.map((item) => <li key={item.id}>{item.action} · {item.target_type} · {new Date(item.created_at).toLocaleString("fa-IR")}</li>)}
              </ul>}
              {adminStatus && <p className="notice" role="status">{adminStatus}</p>}
            </section>
            {session && <AdminSpecialPlayerTools apiUrl={API_URL} accessToken={session.accessToken} />}</>}
            <section className="academy" aria-labelledby="community-heading">
              <h2 id="community-heading">مأموریت‌ها و اتحادیه‌ها</h2>
              <h3>مأموریت‌های باشگاه</h3>
              {missions.length === 0 ? <p className="muted">فعلاً مأموریتی در دسترس نیست.</p> : <div className="prospects">
                {missions.map((mission) => {
                  const complete = mission.progress >= mission.target_count;
                  return <article className="prospect" key={mission.id}>
                    <div><strong>{mission.title}</strong><p>{mission.description}</p><small>پیشرفت: {mission.progress} از {mission.target_count} · پاداش: {mission.reward_coins.toLocaleString("fa-IR")} سکه</small></div>
                    <button type="button" disabled={communityBusy || !complete || Boolean(mission.claimedAt)} onClick={() => claimMission(mission.id)}>{mission.claimedAt ? "دریافت‌شده" : complete ? "دریافت پاداش" : "در حال انجام"}</button>
                  </article>;
                })}
              </div>}
              <h3>اتحادیه‌ها</h3>
              {unions.length === 0 ? <p className="muted">هنوز اتحادیه‌ای ثبت نشده است.</p> : <div className="prospects">
                {unions.map((union) => <article className="prospect" key={union.id}>
                  <div><strong>{union.name} [{union.tag}]</strong><p>اعضا: {union.members?.[0]?.count ?? 0}</p><small>شناسه: {union.id}</small></div>
                  <button type="button" disabled={communityBusy || union.leader_club_id === clubId} onClick={() => joinUnion(union.id)}>{union.leader_club_id === clubId ? "اتحادیهٔ شما" : "پیوستن"}</button>
                </article>)}
              </div>}
              <form className="recruit-form" onSubmit={createUnion}>
                <h3>ایجاد اتحادیه</h3>
                <label>نام اتحادیه<input required minLength={3} maxLength={60} value={unionName} onChange={(event) => setUnionName(event.target.value)} /></label>
                <label>نشان لاتین (۲ تا ۶ حرف/عدد)<input required minLength={2} maxLength={6} pattern="[A-Za-z0-9]{2,6}" value={unionTag} onChange={(event) => setUnionTag(event.target.value.toUpperCase())} /></label>
                <button type="submit" disabled={communityBusy}>ایجاد اتحادیه</button>
              </form>
              <section className="training-plan" aria-labelledby="group-challenges-heading">
                <h3 id="group-challenges-heading">چالش‌های گروهی</h3>
                <p className="muted">برای ایجاد چالش، گروه باید قبلاً با دستور /group متصل شده باشد. شناسه گروه تلگرام و شناسه باشگاه حریف را وارد کن.</p>
                <form className="recruit-form" onSubmit={createGroupChallenge}>
                  <label>شناسه عددی گروه تلگرام<input required inputMode="numeric" value={groupChatId} onChange={(event) => setGroupChatId(event.target.value)} /></label>
                  <label>شناسه UUID باشگاه حریف<input required value={opponentClubId} onChange={(event) => setOpponentClubId(event.target.value)} /></label>
                  <label>زمان شروع مسابقه<input required type="datetime-local" value={challengeKickoff} onChange={(event) => setChallengeKickoff(event.target.value)} /></label>
                  <button type="submit" disabled={challengeBusy}>ایجاد چالش</button>
                </form>
                {groupChallenges.length === 0 ? <p className="muted">چالشی برای باشگاهت ثبت نشده است.</p> : <div className="prospects">
                  {groupChallenges.map((challenge) => <article className="prospect" key={challenge.id}>
                    <div>
                      <strong>{challenge.status === "pending" ? "در انتظار پاسخ" : challenge.status === "accepted" ? "پذیرفته‌شده" : challenge.status}</strong>
                      <p>حریف: {challenge.challenger_club_id === clubId ? challenge.opponent_club_id : challenge.challenger_club_id}</p>
                      <small>گروه: {challenge.telegram_chat_id} · زمان: {new Date(challenge.requested_kickoff_at).toLocaleString("fa-IR")}</small>
                      <small>شناسه چالش: {challenge.id}</small>
                    </div>
                    {challenge.status === "pending" && challenge.opponent_club_id === clubId && <button type="button" disabled={challengeBusy} onClick={() => acceptGroupChallenge(challenge)}>پذیرش چالش</button>}
                  </article>)}
                </div>}
                {challengeStatus && <p className="notice" role="status">{challengeStatus}</p>}
              </section>
              {session && <GroupGames accessToken={session.accessToken} />}
              {communityStatus && <p className="notice" role="status">{communityStatus}</p>}
            </section>
            <section className="training-plan" aria-labelledby="tactics-heading">
              <h2 id="tactics-heading">تاکتیک مسابقه</h2>
              <label>آرایش<select value={tactics.formation} onChange={(event) => setTactics((value) => ({ ...value, formation: event.target.value }))}>
                <option value="4-3-3">۴-۳-۳</option><option value="4-4-2">۴-۴-۲</option><option value="4-2-3-1">۴-۲-۳-۱</option><option value="3-5-2">۳-۵-۲</option><option value="5-3-2">۵-۳-۲</option>
              </select></label>
              <label>ذهنیت<select value={tactics.mentality} onChange={(event) => setTactics((value) => ({ ...value, mentality: event.target.value }))}>
                <option value="very_defensive">بسیار دفاعی</option><option value="defensive">دفاعی</option><option value="balanced">متعادل</option><option value="attacking">تهاجمی</option><option value="very_attacking">بسیار تهاجمی</option>
              </select></label>
              <label>سرعت بازی<select value={tactics.tempo} onChange={(event) => setTactics((value) => ({ ...value, tempo: event.target.value }))}>
                <option value="slow">آهسته</option><option value="normal">عادی</option><option value="fast">سریع</option>
              </select></label>
              <label>پرس<select value={tactics.pressing} onChange={(event) => setTactics((value) => ({ ...value, pressing: event.target.value }))}>
                <option value="low">کم</option><option value="standard">معمولی</option><option value="high">فشار بالا</option>
              </select></label>
              <button type="button" onClick={saveTactics}>ذخیره تاکتیک</button>
              {tacticsStatus && <p className="notice" role="status">{tacticsStatus}</p>}
            </section>
            <section className="academy" aria-labelledby="squad-heading">
              <h2 id="squad-heading">فهرست بازیکنان</h2>
              <p className="muted">بازیکنان تحت قرارداد باشگاه؛ بازیکنانی که از آکادمی ارتقا می‌یابند در این فهرست دیده می‌شوند.</p>
              <div className="training-plan">
                <h3>برنامه تمرین روزانه</h3>
                <label>برنامه<select value={trainingPlan} onChange={(event) => setTrainingPlan(event.target.value)}>
                  <option value="balanced">متعادل: پیشرفت +۱، آمادگی −۲</option>
                  <option value="development">پیشرفت: رشد +۱، آمادگی −۴</option>
                  <option value="recovery">بازیابی: آمادگی +۵، بدون رشد</option>
                </select></label>
                <button type="button" onClick={saveTrainingPlan}>ذخیره برنامه</button>
                {trainingStatus && <p className="notice" role="status">{trainingStatus}</p>}
              </div>
              {players.length === 0 ? <p className="muted">هنوز بازیکنی در تیم اصلی ثبت نشده است. از آکادمی بازیکن جذب و ارتقا بده.</p> : <div className="prospects">
                {players.map((player) => <article className="prospect" key={player.id}>
                  <div><strong>{player.full_name}</strong><p>{player.position} · قدرت {player.overall} · پتانسیل {player.potential} · {player.player_class === "special" ? "ویژه" : player.player_class === "professional" ? "حرفه‌ای" : ({base:"پایه",prospect:"مستعد",elite:"نخبه"} as Record<string,string>)[player.ordinary_tier ?? "base"]}</p><small>رضایت‌نامه {Number(player.release_clause).toLocaleString("fa-IR")} سکه · آمادگی {player.fitness} · روحیه {player.morale} · {player.squad_slot?.[0] ? `ترکیب اصلی، جایگاه ${player.squad_slot[0].slot_no}` : "ذخیره"} · قرارداد تا {player.contract_until ?? "نامشخص"} · دستمزد هفتگی {Number(player.weekly_wage).toLocaleString("fa-IR")}</small>
                    <form className="contract-form" onSubmit={(event) => renewPlayerContract(event, player.id)}>
                      <label>تمدید تا<input required name="contractUntil" type="date" defaultValue={player.contract_until ?? ""} /></label>
                      <label>حقوق هفتگی<input required name="weeklyWage" type="number" min={0} max={100000000} defaultValue={player.weekly_wage} /></label>
                      <button type="submit">ثبت قرارداد</button>
                    </form></div>
                  <label><input type="checkbox" checked={selectedPlayerIds.includes(player.id)} onChange={(event) => setSelectedPlayerIds((ids) => event.target.checked ? [...ids, player.id] : ids.filter((id) => id !== player.id))} /> انتخاب برای ترکیب</label>
                </article>)}
              </div>}
              {contractStatus && <p className="notice" role="status">{contractStatus}</p>}
              <p className="muted">انتخاب‌شده: {selectedPlayerIds.length} از ۱۱</p>
              <button type="button" disabled={lineupBusy || selectedPlayerIds.length !== 11} onClick={saveLineup}>{lineupBusy ? "در حال ذخیره…" : "ذخیره ترکیب اصلی"}</button>
              {lineupStatus && <p className="notice" role="status">{lineupStatus}</p>}
            </section>
            <section className="academy" aria-labelledby="matches-heading">
              <h2 id="matches-heading">مسابقات باشگاه</h2>
              <p className="muted">برنامه و نتایج مسابقات باشگاه. نتیجه فقط پس از زمان شروع و در سرور ثبت می‌شود.</p>
              {matches.length === 0 ? <p className="muted">هنوز مسابقه‌ای برای باشگاه برنامه‌ریزی نشده است.</p> : <div className="prospects">
                {matches.map((match) => {
                  const home = match.home_club_id === clubId;
                  const opponentId = home ? match.away_club_id : match.home_club_id;
                  const result = match.home_score === null || match.away_score === null ? "در انتظار برگزاری" : home ? `${match.home_score} - ${match.away_score}` : `${match.away_score} - ${match.home_score}`;
                  const canResolve = match.status === "scheduled" && new Date(match.kickoff_at).getTime() <= Date.now();
                  return <article className="prospect" key={match.id}>
                    <div><strong>{match.competition?.name ?? "مسابقه دوستانه"}</strong><p>{home ? "میزبان" : "میهمان"} · حریف: {opponentId.slice(0, 8)}</p><small>{new Date(match.kickoff_at).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" })} · {result}</small></div>
                    <div className="actions">
                      {match.competition_id && <button type="button" disabled={standingsBusyId === match.competition_id} onClick={() => loadStandings(match.competition_id!)}>{standingsBusyId === match.competition_id ? "در حال بارگذاری…" : "جدول رقابت"}</button>}
                      {canResolve && <button type="button" disabled={matchBusyId === match.id} onClick={() => resolveMatch(match.id)}>{matchBusyId === match.id ? "در حال ثبت…" : "ثبت نتیجه"}</button>}
                    </div>
                    {match.competition_id && standings[match.competition_id] && <div className="standings">
                      <strong>جدول رقابت</strong>
                      <ol>{standings[match.competition_id].map((entry) => <li key={entry.club_id}>
                        <span>{entry.club?.name ?? entry.club_id.slice(0, 8)}</span>
                        <small>{entry.points} امتیاز · {entry.played} بازی · {entry.wins} برد · {entry.draws} مساوی · {entry.losses} باخت · تفاضل {entry.goals_for - entry.goals_against}</small>
                      </li>)}</ol>
                    </div>}
                  </article>;
                })}
              </div>}
              {matchStatus && <p className="notice" role="status">{matchStatus}</p>}
            </section>
            <section className="academy" aria-labelledby="market-heading">
              <h2 id="market-heading">بازار نقل‌وانتقالات</h2>
              <p className="muted">بازیکن بفروش یا با موجودی باشگاه بازیکن بخَر. خریدوفروش و تسویهٔ مالی در یک تراکنش انجام می‌شود.</p>
              <h3>آگهی‌های باشگاه</h3>
              {ownListings.length === 0 ? <p className="muted">آگهی فعالی ندارید.</p> : <div className="prospects">{ownListings.map((listing) => { const player = players.find((item) => item.id === listing.player_id); return <article className="prospect" key={listing.id}><div><strong>{player?.full_name ?? "بازیکن"}</strong><p>قیمت درخواستی: {Number(listing.asking_price).toLocaleString("fa-IR")} سکه</p></div><button type="button" disabled={marketBusy} onClick={() => withdrawListing(listing.id)}>برداشتن آگهی</button></article>; })}</div>}
              <h3>بازیکنان قابل فروش</h3>
              {players.filter((player) => !ownListings.some((listing) => listing.player_id === player.id)).length === 0 ? <p className="muted">بازیکن قابل فروش دیگری ندارید.</p> : <div className="prospects">{players.filter((player) => !ownListings.some((listing) => listing.player_id === player.id)).map((player) => <article className="prospect" key={player.id}><div><strong>{player.full_name}</strong><p>{player.position} · قدرت {player.overall} · پتانسیل {player.potential}</p></div><label>قیمت فروش<input type="number" min={1} step={1} value={marketPrices[player.id] ?? ""} onChange={(event) => setMarketPrices((prices) => ({ ...prices, [player.id]: event.target.value }))} /></label><button type="button" disabled={marketBusy} onClick={() => listPlayer(player.id)}>ثبت آگهی</button></article>)}</div>}
              <h3>آگهی‌های بازار</h3>
              {marketListings.length === 0 ? <p className="muted">در حال حاضر آگهی فعالی وجود ندارد.</p> : <div className="prospects">{marketListings.map((listing) => <article className="prospect" key={listing.id}><div><strong>{listing.player.full_name}</strong><p>{listing.player.position} · قدرت {listing.player.overall} · پتانسیل {listing.player.potential}</p><small>باشگاه فروشنده: {listing.seller.name}</small><p>قیمت: {Number(listing.asking_price).toLocaleString("fa-IR")} سکه</p></div><button type="button" disabled={marketBusy || listing.seller.id === clubId} onClick={() => buyListing(listing.id)}>{listing.seller.id === clubId ? "آگهی شما" : "خرید بازیکن"}</button></article>)}</div>}
              {marketStatus && <p className="notice" role="status">{marketStatus}</p>}
            </section>
            <section className="academy" aria-labelledby="staff-heading">
              <h2 id="staff-heading">مدیریت کادر فنی</h2>
              <p className="muted">استخدام و فسخ قرارداد اعضای کادر. هزینهٔ اولیهٔ قرارداد برابر دو هفته حقوق است.</p>
              {staff.length === 0 ? <p className="muted">کادر فنی هنوز عضوی ندارد.</p> : <div className="prospects">
                {staff.map((member) => <article className="prospect" key={member.id}>
                  <div><strong>{member.full_name}</strong><p>{({head_coach:"سرمربی",coach:"مربی",technical:"مدیر فنی",medical:"پزشک",fitness:"مربی بدنساز",transfer_director:"مدیر نقل‌وانتقالات"} as Record<string,string>)[member.staff_role] ?? member.staff_role} · {({ordinary:"معمولی",professional:"حرفه‌ای",legendary:"افسانه‌ای"} as Record<string,string>)[member.staff_tier]} · مهارت {member.skill}</p><small>هزینه جذب {Number(member.signing_fee).toLocaleString("fa-IR")} سکه · حقوق هفتگی: {Number(member.weekly_wage).toLocaleString("fa-IR")} · {member.released_at ? "فسخ‌شده" : `قرارداد تا ${member.contract_until ?? "نامشخص"}`}</small></div>
                  {!member.released_at && <button type="button" disabled={staffBusy} onClick={() => releaseStaff(member.id)}>فسخ قرارداد</button>}
                </article>)}
              </div>}
              <form className="recruit-form" onSubmit={hireStaff}>
                <h3>استخدام عضو جدید</h3>
                <label>نام<input required minLength={2} maxLength={80} value={staffName} onChange={(event) => setStaffName(event.target.value)} /></label>
                <label>سمت<select value={staffRole} onChange={(event) => setStaffRole(event.target.value)}><option value="coach">مربی</option><option value="technical">مدیر فنی</option><option value="medical">پزشک</option><option value="fitness">مربی بدنساز</option><option value="transfer_director">مدیر نقل‌وانتقالات</option></select></label>
                <label>سطح<select value={staffTier} onChange={(event) => setStaffTier(event.target.value)}><option value="ordinary">معمولی</option><option value="professional">حرفه‌ای</option><option value="legendary">افسانه‌ای</option></select></label>
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
        ) : session ? (
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
              {busy ? "در حال ثبت…" : "ساخت باشگاه و شروع بازی"}
            </button>
          </form>
        ) : (
          <div className="muted">
            {busy ? "در حال ورود امن به یازده…" : "برای شروع، مینی‌اپ را با دکمه ورود به باشگاه در گفت‌وگوی خصوصی ربات باز کن."}
          </div>
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
