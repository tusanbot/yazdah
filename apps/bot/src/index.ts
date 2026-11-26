import { Bot, InlineKeyboard, type Context } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL;
const apiUrl = process.env.YAZDAH_API_URL;
const botInternalSecret = process.env.BOT_INTERNAL_SECRET;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}
if (!miniAppUrl) {
  throw new Error("TELEGRAM_MINI_APP_URL is required");
}
const requiredMiniAppUrl: string = miniAppUrl;

const bot = new Bot(token);

async function replyRich(
  ctx: Context,
  html: string,
  plainText: string,
  replyMarkup?: InlineKeyboard,
) {
  const options = replyMarkup ? { reply_markup: replyMarkup } : {};
  try {
    await ctx.reply(html, { ...options, parse_mode: "HTML" });
  } catch (error) {
    console.warn("Rich Telegram message failed; retrying as plain text", error);
    await ctx.reply(plainText, options);
  }
}

function appSectionUrl(section?: string) {
  const url = new URL(requiredMiniAppUrl);
  if (section) url.hash = section;
  return url.toString();
}

function appUrlWithParams(params: Record<string, string>) {
  const url = new URL(requiredMiniAppUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

const appSections = new Set([
  "home", "squad-heading", "matches-heading", "market-heading",
  "academy-heading", "staff-heading", "community-heading", "tactics-heading",
]);

async function groupStartUrl(chatId: number | string, gameId?: string) {
  const botInfo = await bot.api.getMe();
  const payload = `group_${chatId}${gameId ? `_${gameId}` : ""}`;
  return `https://t.me/${botInfo.username}?start=${encodeURIComponent(payload)}`;
}

async function appEntryKeyboard(chatType: string, label: string, section = "home") {
  const target = appSections.has(section) ? section : "home";
  if (chatType === "private") {
    return new InlineKeyboard().webApp(label, target === "home" ? appSectionUrl() : appSectionUrl(target));
  }
  const botInfo = await bot.api.getMe();
  const privateLink = `https://t.me/${botInfo.username}?start=${encodeURIComponent(`app_${target}`)}`;
  return new InlineKeyboard().url(label, privateLink);
}

function mainMenu() {
  return new InlineKeyboard()
    .text("🏟 وضعیت باشگاه", "club_section:overview")
    .text("➕ ساخت باشگاه", "club_create_help")
    .row()
    .text("👥 ترکیب بازیکنان", "club_section:squad")
    .text("⚽ مسابقات", "club_section:matches")
    .row()
    .text("💰 امور مالی", "club_section:finance")
    .text("🎯 مأموریت‌ها", "club_section:missions")
    .row()
    .text("🎓 آکادمی", "club_section:academy")
    .text("🧑‍💼 کادر فنی", "club_section:staff")
    .row()
    .text("🧠 تاکتیک", "club_section:tactics")
    .webApp("🔄 بازار نقل‌وانتقالات", appSectionUrl("market-heading"))
    .row()
    .webApp("🎮 ورود به مینی‌اپ", appSectionUrl())
    .row()
    .text("📖 راهنما", "help")
    .text("🩺 وضعیت سرویس", "status");
}

bot.command("start", async (ctx) => {
  const payload = ctx.match.trim();
  const appLink = payload.match(/^app_([a-z-]+)$/i);
  const appSection = appLink?.[1];
  if (appSection && appSections.has(appSection)) {
    await ctx.reply("برای ادامه، مینی‌اپ یازده را باز کن.", {
      reply_markup: await appEntryKeyboard("private", "باز کردن یازده", appSection),
    });
    return;
  }
  const groupLink = payload.match(/^group_(-?\d+)(?:_([0-9a-f-]{36}))?$/i);
  if (groupLink) {
    const groupChatId = groupLink[1];
    if (!groupChatId) {
      await ctx.reply("شناسهٔ گروه معتبر نیست.");
      return;
    }
    const gameId = groupLink[2];
    const appUrl = appUrlWithParams({ groupChatId, ...(gameId ? { gameId } : {}) });
    await ctx.reply("برای ورود به فضای گروه و اجرای چالش، مینی‌اپ را باز کن.", {
      reply_markup: new InlineKeyboard().webApp(gameId ? "ورود به چالش" : "چالش‌ها و مأموریت‌های گروه", appUrl),
    });
    return;
  }
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    const botInfo = await bot.api.getMe();
    const privateLink = `https://t.me/${botInfo.username}?start=${encodeURIComponent(`group_${ctx.chat.id}`)}`;
    await ctx.reply("برای باز کردن بازی‌های این گروه، مینی‌اپ را در گفت‌وگوی خصوصی ربات باز کن.", {
      reply_markup: new InlineKeyboard().url("باز کردن بازی‌های گروه", privateLink),
    });
    return;
  }
  if (ctx.chat.type === "private") {
    await showStartMenuOrRegistration(ctx);
    return;
  }
  await ctx.reply(
    "به یازده خوش آمدی! برای ادامه، یازده را در گفت‌وگوی خصوصی ربات باز کن.",
    { reply_markup: await appEntryKeyboard(ctx.chat.type, "باز کردن یازده") },
  );
});

bot.command("menu", async (ctx) => {
  if (ctx.chat.type === "private") {
    await showStartMenuOrRegistration(ctx);
  } else {
    await ctx.reply("برای باز کردن منوی بازی، یازده را در گفت‌وگوی خصوصی ربات باز کن.", {
      reply_markup: await appEntryKeyboard(ctx.chat.type, "باز کردن منوی یازده"),
    });
  }
});

bot.command("club", async (ctx) => {
  const input = ctx.match.trim();
  if (input.toLowerCase().startsWith("create ")) {
    const pieces = input.slice(7).split("|").map((part) => part.trim());
    const name = pieces[0];
    const slug = pieces[1];
    if (!ctx.from || ctx.chat.type !== "private" || !name || !slug) {
      await ctx.reply("ساخت باشگاه در گفت‌وگوی خصوصی: /club create نام باشگاه | slug-english");
      return;
    }
    if (!apiUrl || !botInternalSecret) {
      await ctx.reply("سرویس ساخت باشگاه در حال حاضر پیکربندی نشده است.");
      return;
    }
    try {
      const response = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/telegram-clubs/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
        body: JSON.stringify({ telegramUserId: ctx.from.id, firstName: ctx.from.first_name, lastName: ctx.from.last_name, username: ctx.from.username, name, slug }),
      });
      const body = await response.json() as { error?: string; clubId?: string };
      if (!response.ok) {
        const messages: Record<string, string> = {
          club_conflict_or_already_owned: "این شناسهٔ باشگاه تکراری است یا قبلاً باشگاه ساخته‌ای.",
          club_name_or_slug_invalid: "نام یا شناسهٔ باشگاه معتبر نیست. شناسه باید انگلیسی و شامل حروف، عدد و خط تیره باشد.",
        };
        await ctx.reply(messages[body.error ?? ""] ?? "ساخت باشگاه انجام نشد؛ کمی بعد دوباره تلاش کن.");
        return;
      }
      await ctx.reply(`باشگاهت ساخته شد! شناسه: ${body.clubId}\nاز این پس می‌توانی با /menu به گزینه‌های ربات دسترسی داشته باشی.`, { reply_markup: mainMenu() });
    } catch (error) {
      console.error("Telegram-native club creation failed", error);
      await ctx.reply("ارتباط با سرویس بازی برقرار نشد؛ کمی بعد دوباره تلاش کن.");
    }
    return;
  }
  if (ctx.chat.type === "private") { await beginClubCreation(ctx); return; }
  await ctx.reply("برای ساخت باشگاه، این گزینه را در گفت‌وگوی خصوصی ربات باز کن.", {
    reply_markup: await appEntryKeyboard(ctx.chat.type, "ورود به باشگاه"),
  });
});

bot.command("missions", async (ctx) => {
  await ctx.reply("مأموریت‌ها و پاداش‌های باشگاه از بخش مدیریت باشگاه در مینی‌اپ قابل پیگیری‌اند.", {
    reply_markup: await appEntryKeyboard(ctx.chat.type, "مأموریت‌های باشگاه", "community-heading"),
  });
});

bot.command("union", async (ctx) => {
  await ctx.reply("برای ایجاد یا پیوستن به اتحادیه و دیدن فهرست اتحادیه‌ها، مینی‌اپ را باز کن.", {
    reply_markup: await appEntryKeyboard(ctx.chat.type, "اتحادیه‌ها", "community-heading"),
  });
});

bot.command("challenge", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type === "private") {
    await ctx.reply("برای ساخت یا پذیرش چالش، از بخش رقابت‌های گروه در مینی‌اپ استفاده کن.");
    return;
  }
  const isAdmin = await ctx.getChatMember(ctx.from.id).then((member) =>
    member.status === "creator" || member.status === "administrator",
  ).catch(() => false);
  if (!isAdmin) {
    await ctx.reply("ساخت یا پذیرش چالش فقط توسط مالک یا مدیر گروه مجاز است.");
    return;
  }
  if (!apiUrl || !botInternalSecret) {
    await ctx.reply("اتصال چالش‌ها هنوز در تنظیمات سرویس فعال نشده است.");
    return;
  }
  const args = ctx.match.trim().split(/\s+/).filter(Boolean);
  const action = args[0]?.toLowerCase() === "accept" ? "accept" : "create";
  const payload = action === "accept"
    ? { action, challengeId: args[1] }
    : { action, opponentClubId: args[0], kickoffAt: args[1] };
  if ((action === "accept" && args.length !== 2) || (action === "create" && args.length !== 2)) {
    await ctx.reply("اطلاعات چالش کامل نیست. از بخش رقابت‌های گروه در مینی‌اپ اقدام کن؛ زمان مسابقه باید در آینده باشد.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/telegram-groups/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({ ...payload, telegramUserId: ctx.from.id, telegramChatId: ctx.chat.id }),
    });
    const body = await response.json() as { error?: string; challengeId?: string; matchId?: string; accepted?: boolean };
    if (!response.ok) {
      const messages: Record<string, string> = {
        telegram_user_not_registered: "ابتدا در مینی‌اپ وارد بازی شو و باشگاهت را بساز.",
        telegram_group_not_linked: "ابتدا گروه را از بخش بازی‌های گروه در مینی‌اپ به یازده متصل کن.",
        telegram_group_owner_required: "فقط مدیری که گروه را به بازی متصل کرده می‌تواند چالش ثبت کند.",
        club_required_before_group_challenge: "ابتدا باشگاهت را در مینی‌اپ ایجاد کن.",
        challenge_opponent_club_required: "این باشگاه، حریف تعیین‌شده برای این چالش نیست.",
        challenge_not_found: "چالش در این گروه پیدا نشد.",
        challenge_not_available: "این چالش قبلاً پذیرفته شده یا دیگر در دسترس نیست.",
      };
      await ctx.reply(messages[body.error ?? ""] ?? "عملیات چالش انجام نشد؛ شناسه‌ها و زمان را بررسی کن.");
      return;
    }
    if (action === "create" && body.challengeId) {
      const acceptKeyboard = new InlineKeyboard().text("🤝 پذیرش چالش", `challenge_accept:${body.challengeId}`);
      await replyRich(
        ctx,
        "<b>⚽ چالش ثبت شد</b>\nمدیر باشگاه حریف می‌تواند با دکمهٔ زیر آن را بررسی و بپذیرد.",
        "چالش ثبت شد. مدیر باشگاه حریف می‌تواند آن را با دکمهٔ پذیرش بررسی کند.",
        acceptKeyboard,
      );
    } else {
      await replyRich(ctx, "<b>✅ چالش پذیرفته شد</b>\nمسابقه ساخته شد.", "چالش پذیرفته شد و مسابقه ساخته شد.");
    }
  } catch (error) {
    console.error("Telegram group challenge failed", error);
    await ctx.reply("ارتباط با سرویس بازی برقرار نشد؛ کمی بعد دوباره تلاش کن.");
  }
});

bot.callbackQuery(/^challenge_accept:([0-9a-f-]{36})$/i, async (ctx) => {
  const challengeId = ctx.match[1];
  if (!challengeId) {
    await ctx.answerCallbackQuery({ text: "شناسهٔ چالش معتبر نیست.", show_alert: true });
    return;
  }
  const actor = ctx.callbackQuery.from;
  const message = ctx.callbackQuery.message;
  if (!message || (message.chat.type !== "group" && message.chat.type !== "supergroup")) {
    await ctx.answerCallbackQuery({ text: "این دکمه فقط در گروه مربوطه قابل استفاده است.", show_alert: true });
    return;
  }
  const isAdmin = await bot.api.getChatMember(message.chat.id, actor.id).then((member) =>
    member.status === "creator" || member.status === "administrator",
  ).catch(() => false);
  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: "فقط مدیران گروه می‌توانند چالش را بپذیرند.", show_alert: true });
    return;
  }
  if (!apiUrl || !botInternalSecret) {
    await ctx.answerCallbackQuery({ text: "سرویس چالش‌ها در دسترس نیست.", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({ text: "در حال ثبت پذیرش…" });
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/telegram-groups/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({
        action: "accept", challengeId, telegramUserId: actor.id, telegramChatId: message.chat.id,
      }),
    });
    const body = await response.json() as { error?: string; matchId?: string };
    if (!response.ok) {
      const errors: Record<string, string> = {
        challenge_not_found: "چالش در این گروه پیدا نشد.",
        challenge_not_available: "این چالش قبلاً پذیرفته شده یا دیگر در دسترس نیست.",
        challenge_opponent_club_required: "این چالش برای باشگاه شما ثبت نشده است.",
        telegram_group_not_linked: "این گروه به یازده متصل نیست.",
        telegram_user_not_registered: "ابتدا در مینی‌اپ وارد بازی شو و باشگاهت را بساز.",
      };
      await ctx.api.sendMessage(message.chat.id, errors[body.error ?? ""] ?? "پذیرش چالش انجام نشد؛ کمی بعد دوباره تلاش کن.");
      return;
    }
    await ctx.api.sendMessage(message.chat.id, "✅ چالش پذیرفته شد و مسابقه ساخته شد.");
  } catch (error) {
    console.error("Telegram challenge acceptance failed", error);
    await ctx.api.sendMessage(message.chat.id, "ارتباط با سرویس بازی برقرار نشد؛ کمی بعد دوباره تلاش کن.");
  }
});

bot.command("game", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("برای ساخت چالش گروهی، از بخش بازی‌های گروه در مینی‌اپ نوع بازی و ورودی را انتخاب کن.");
    return;
  }
  const isAdmin = await ctx.getChatMember(ctx.from.id).then((member) =>
    member.status === "creator" || member.status === "administrator",
  ).catch(() => false);
  if (!isAdmin) {
    await ctx.reply("فقط مدیران گروه می‌توانند چالش جدید ایجاد کنند.");
    return;
  }
  if (!apiUrl || !botInternalSecret) {
    await ctx.reply("سرویس چالش‌های گروهی پیکربندی نشده است.");
    return;
  }
  const args = ctx.match.trim().split(/\s+/).filter(Boolean);
  const aliases: Record<string, string> = {
    draft: "draft", درفت: "draft",
    penalty: "penalty", پنالتی: "penalty",
    cards: "cards", کارت: "cards", "کارت-بازی": "cards",
    quiz: "quiz", اطلاعات: "quiz",
    guess: "guess", حدس: "guess",
    survival: "survival", بقا: "survival",
  };
  const gameType = aliases[(args[0] ?? "").toLowerCase()];
  const entryFee = args[1] === undefined ? 0 : Number(args[1]);
  const maxParticipants = args[2] === undefined ? 2 : Number(args[2]);
  if (!gameType || !Number.isSafeInteger(entryFee) || entryFee < 0 || entryFee > 1000000 ||
    !Number.isSafeInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 30 ||
    (["draft", "penalty", "cards"].includes(gameType) && maxParticipants !== 2)) {
    await ctx.reply("تنظیمات چالش معتبر نیست. نوع بازی، ورودی سکه و تعداد شرکت‌کنندگان را در مینی‌اپ بررسی کن. درفت، پنالتی و کارت‌بازی دونفره‌اند.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/telegram-groups/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        gameType,
        entryFee,
        maxParticipants,
      }),
    });
    const body = await response.json() as { error?: string; gameId?: string; maxParticipants?: number; prizePool?: number };
    if (!response.ok) {
      const messages: Record<string, string> = {
        telegram_group_admin_required: "تأیید مدیر بودن در تلگرام انجام نشد.",
        telegram_group_not_linked: "ابتدا مدیر گروه باید گروه را از بخش بازی‌های گروه در مینی‌اپ به یازده متصل کند.",
        telegram_user_not_registered: "ابتدا از طریق مینی‌اپ وارد یازده شو و باشگاهت را بساز.",
        club_required_before_group_game: "برای ساخت چالش باید باشگاه داشته باشی.",
      };
      await ctx.reply(messages[body.error ?? ""] ?? "ایجاد چالش ناموفق بود؛ کمی بعد دوباره تلاش کن.");
      return;
    }
    const privateLink = await groupStartUrl(ctx.chat.id, body.gameId);
    await ctx.reply(
      `⚽ چالش جدید ایجاد شد!\nنوع: ${gameType}\nورودی: ${entryFee.toLocaleString("fa-IR")} سکه گروه\nجایزه فعلی: ${Number(body.prizePool ?? 0).toLocaleString("fa-IR")} سکه گروه\n\nبرای پیوستن، دکمهٔ زیر را بزن و در گفت‌وگوی خصوصی ربات ادامه بده.`,
      { reply_markup: new InlineKeyboard().url("ورود به چالش", privateLink) },
    );
  } catch (error) {
    console.error("Group game creation failed", error);
    await ctx.reply("ارتباط با سرویس چالش‌ها برقرار نشد.");
  }
});

bot.command("league", async (ctx) => {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("برای مشاهده یا فعال‌سازی لیگ محلی، این فرمان را داخل گروه تلگرام اجرا کن.");
    return;
  }
  await ctx.reply("لیگ محلی اختیاری است؛ مدیر گروه می‌تواند ثبت‌نام را فعال کند و پس از ثبت‌نام دو باشگاه یا بیشتر، لیگ را آغاز کند.", {
    reply_markup: new InlineKeyboard().url("مدیریت لیگ محلی", await groupStartUrl(ctx.chat.id)),
  });
});

bot.command("games", async (ctx) => {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("برای دیدن چالش‌های گروه، این فرمان را داخل گروه تلگرام اجرا کن.");
    return;
  }
  const privateLink = await groupStartUrl(ctx.chat.id);
  await ctx.reply("برای مشاهده چالش‌ها، کیف پول و مأموریت‌های گروه، دکمه را بزن و در گفت‌وگوی خصوصی ربات Start را انتخاب کن.", {
    reply_markup: new InlineKeyboard().url("باز کردن چالش‌های گروه", privateLink),
  });
});

bot.command("market", async (ctx) => {
  await ctx.reply("برای خریدوفروش بازیکنان، بازار نقل‌وانتقالات یازده را باز کن.", {
    reply_markup: await appEntryKeyboard(ctx.chat.type, "بازار نقل‌وانتقالات", "market-heading"),
  });
});
for (const [command, label, section] of [
  ["squad", "ترکیب و بازیکنان", "squad-heading"],
  ["matches", "مسابقات باشگاه", "matches-heading"],
  ["academy", "آکادمی", "academy-heading"],
  ["staff", "کادر فنی", "staff-heading"],
  ["tactics", "تاکتیک مسابقه", "tactics-heading"],
] as const) {
  bot.command(command, async (ctx) => {
    await ctx.reply(`برای مشاهدهٔ ${label}، مینی‌اپ یازده را باز کن.`, {
      reply_markup: await appEntryKeyboard(ctx.chat.type, label, section),
    });
  });
}

async function getServiceStatus() {
  if (!apiUrl) return "ربات فعال است؛ آدرس API در تنظیمات ربات ثبت نشده است.";
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => ({})) as { status?: string; database?: string };
    if (!response.ok || body.status !== "ok") {
      return body.database === "unreachable"
        ? "ربات فعال است؛ API پاسخ می‌دهد اما پایگاه داده در دسترس نیست."
        : "ربات فعال است، اما API یا پایگاه داده آماده نیست.";
    }
    return body.database === "ok"
      ? "ربات، API و اتصال پایگاه داده پاسخ سالم می‌دهند."
      : "ربات و API پاسخ سالم می‌دهند؛ وضعیت پایگاه داده تأیید نشده است.";
  } catch {
    return "ربات فعال است، اما ارتباط با API برقرار نشد یا بیش از ۵ ثانیه طول کشید.";
  }
}


const sectionTitles: Record<string, string> = {
  overview: "🏟 وضعیت باشگاه", squad: "👥 ترکیب بازیکنان", matches: "⚽ مسابقات",
  finance: "💰 امور مالی", missions: "🎯 مأموریت‌ها", academy: "🎓 آکادمی",
  staff: "🧑‍💼 کادر فنی", tactics: "🧠 تاکتیک",
};

function formatDate(value: unknown) {
  if (typeof value !== "string") return "زمان نامشخص";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "زمان نامشخص" : date.toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
}

function sectionMessage(section: string, data: Record<string, any>) {
  const title = sectionTitles[section] ?? "باشگاه";
  if (section === "overview") {
    const club = data.club ?? {};
    return `${title}
نام: ${club.name ?? "—"}
سطح: ${club.level ?? "—"} | اعتبار: ${club.reputation ?? "—"}
موجودی: ${Number(data.balance ?? 0).toLocaleString("fa-IR")} سکه
بازیکنان: ${Number(data.playerCount ?? 0).toLocaleString("fa-IR")}
مسابقات ثبت‌شده: ${Number(data.matchCount ?? 0).toLocaleString("fa-IR")}`;
  }
  if (section === "squad") {
    const players = Array.isArray(data.players) ? data.players : [];
    return `${title} | آرایش: ${data.formation ?? "تنظیم نشده"}
${players.length ? players.map((p: any) => `• ${p.full_name} — ${p.position} | قدرت ${p.overall} | آمادگی ${p.fitness ?? "—"}`).join("\n") : "هنوز بازیکنی در ترکیب ثبت نشده است."}`;
  }
  if (section === "matches") {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return `${title}
${matches.length ? matches.map((m: any) => {
      const home = m.home_club_id === data.clubId ? "باشگاه شما" : `حریف ${String(m.home_club_id ?? "").slice(0, 6)}`;
      const away = m.away_club_id === data.clubId ? "باشگاه شما" : `حریف ${String(m.away_club_id ?? "").slice(0, 6)}`;
      const score = m.home_score == null || m.away_score == null ? "—" : `${m.home_score} - ${m.away_score}`;
      return `• ${home} ${score} ${away}\n  ${formatDate(m.kickoff_at)} | ${m.status ?? "—"}`;
    }).join("\n") : "هنوز مسابقه‌ای ثبت نشده است."}`;
  }
  if (section === "finance") {
    const recent = Array.isArray(data.transactions) ? data.transactions : [];
    return `${title}
موجودی فعلی: ${Number(data.balance ?? 0).toLocaleString("fa-IR")} سکه
تراکنش‌های اخیر:
${recent.length ? recent.map((t: any) => {
      const entries = Array.isArray(t.entries) ? t.entries : [];
      const amount = entries.reduce((sum: number, entry: any) => sum + Number(entry.amount ?? 0), 0);
      return `• ${t.reason ?? "تراکنش"}: ${amount.toLocaleString("fa-IR")} سکه`;
    }).join("\n") : "تراکنشی ثبت نشده است."}`;
  }
  if (section === "missions") {
    const missions = Array.isArray(data.missions) ? data.missions : [];
    return `${title}
${missions.length ? missions.map((m: any) => `• ${m.title}: ${m.progress}/${m.targetCount} | پاداش ${Number(m.reward ?? 0).toLocaleString("fa-IR")} سکه ${m.claimed ? "✓ دریافت‌شده" : ""}`).join("\n") : "مأموریتی برای نمایش وجود ندارد."}`;
  }
  if (section === "staff") {
    const staff = Array.isArray(data.staff) ? data.staff : [];
    return `${title}
${staff.length ? staff.map((p: any) => `• ${p.full_name} — ${p.staff_role} | مهارت ${p.skill ?? "—"} | دستمزد ${Number(p.weekly_wage ?? 0).toLocaleString("fa-IR")}`).join("\n") : "کادر فنی فعالی ثبت نشده است."}`;
  }
  if (section === "academy") {
    const prospects = Array.isArray(data.prospects) ? data.prospects : [];
    return `${title}
${prospects.length ? prospects.map((p: any) => `• ${p.full_name} — ${p.position} | استعداد ${p.potential} | ${p.status}`).join("\n") : "استعدادی در آکادمی ثبت نشده است."}`;
  }
  const t = data.tactics;
  return `${title}
آرایش: ${t?.formation ?? "—"}
ذهنیت: ${t?.mentality ?? "—"}
سرعت بازی: ${t?.tempo ?? "—"}
پرس: ${t?.pressing ?? "—"}
برای تغییر تنظیمات تاکتیکی، مینی‌اپ را باز کن.`;
}

bot.callbackQuery(/^club_section:(overview|squad|matches|finance|missions|academy|staff|tactics)$/, async (ctx) => {
  const section = ctx.match[1] ?? "overview";
  await ctx.answerCallbackQuery({ text: "در حال دریافت اطلاعات باشگاه…" });
  if (!ctx.from || !apiUrl || !botInternalSecret) {
    await ctx.reply("اتصال امن به سرویس باشگاه در دسترس نیست.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/telegram-clubs/section`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({ telegramUserId: ctx.from.id, section }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const errors: Record<string, string> = {
        telegram_user_not_registered: "ابتدا با ساخت باشگاه یا ورود از مینی‌اپ، حساب یازده را فعال کن.",
        club_not_found: "هنوز باشگاهی نداری؛ از دکمهٔ «ساخت باشگاه» استفاده کن.",
        database_not_configured: "پایگاه داده در حال حاضر پیکربندی نشده است.",
      };
      await ctx.reply(errors[String(body.error ?? "")] ?? `دریافت اطلاعات ناموفق بود (کد ${response.status}).`, { reply_markup: mainMenu() });
      console.error("Telegram club section request failed", { section, status: response.status, error: body.error ?? "non_json_error" });
      return;
    }
    await ctx.reply(sectionMessage(section, body), { reply_markup: new InlineKeyboard()
      .text("↻ به‌روزرسانی", `club_section:${section}`)
      .text("☰ منوی اصلی", "main_menu") });
  } catch (error) {
    console.error("Telegram club section request failed", { section, error });
    await ctx.reply("ارتباط با سرویس باشگاه برقرار نشد؛ کمی بعد دوباره تلاش کن.");
  }
});

bot.callbackQuery("main_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("منوی اصلی یازده", { reply_markup: mainMenu() });
});

bot.command("status", async (ctx) => {
  await replyRich(ctx, `🩺 <b>وضعیت سرویس</b>
${await getServiceStatus()}`, `وضعیت سرویس
${await getServiceStatus()}`);
});


bot.command("help", async (ctx) => {
  await ctx.reply(
    `📖 <b>راهنمای یازده</b>
از دکمه‌های زیر برای ورود به بخش‌های بازی استفاده کن.

⚽ رقابت‌های گروهی را مدیران گروه از داخل مینی‌اپ ایجاد و مدیریت می‌کنند.
🏟️ وضعیت باشگاه، ترکیب، مسابقات، مالی، مأموریت‌ها، آکادمی، کادر فنی و تاکتیک را می‌توانی مستقیماً از منوی ربات ببینی. بازار نقل‌وانتقالات و عملیات گرافیکی در مینی‌اپ انجام می‌شود.`,
    { reply_markup: ctx.chat?.type === "private" ? mainMenu() : await appEntryKeyboard(ctx.chat?.type ?? "group", "باز کردن یازده") },
  );
});
const clubCreationDrafts = new Map<number, { name?: string }>();

async function showStartMenuOrRegistration(ctx: Context) {
  if (ctx.chat?.type !== "private" || !ctx.from) {
    await beginClubCreation(ctx);
    return;
  }
  if (!apiUrl || !botInternalSecret) {
    await ctx.reply("سرویس باشگاه در دسترس نیست. کمی بعد دوباره /start را بزن.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\\/$/, "")}/internal/telegram-clubs/section`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({ telegramUserId: ctx.from.id, section: "overview" }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      await ctx.reply("به یازده خوش آمدی! از منوی زیر می‌توانی وارد باشگاهت شوی.", {
        reply_markup: mainMenu(),
      });
      return;
    }
    if (body.error === "club_not_found" || body.error === "telegram_user_not_registered") {
      await beginClubCreation(ctx);
      return;
    }
    console.error("Telegram start club check failed", {
      status: response.status,
      error: body.error ?? "non_json_error",
    });
    await ctx.reply("بررسی وضعیت باشگاه انجام نشد. کمی بعد دوباره /start را بزن.");
  } catch (error) {
    console.error("Telegram start club check failed", error);
    await ctx.reply("ارتباط با سرویس باشگاه برقرار نشد. کمی بعد دوباره /start را بزن.");
  }
}

async function beginClubCreation(ctx: Context) {
  if (ctx.chat?.type !== "private" || !ctx.from) {
    await ctx.reply("برای ساخت باشگاه، این گزینه را در گفت‌وگوی خصوصی ربات باز کن.");
    return;
  }
  clubCreationDrafts.set(ctx.from.id, {});
  await ctx.reply("🏟 ساخت باشگاه\n\nنام باشگاهت را بفرست (۲ تا ۶۰ نویسه).", {
    reply_markup: new InlineKeyboard().text("لغو", "club_create_cancel"),
  });
}

bot.callbackQuery("club_create_help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await beginClubCreation(ctx);
});

bot.callbackQuery("club_create_cancel", async (ctx) => {
  if (ctx.from) clubCreationDrafts.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: "فرایند ساخت باشگاه لغو شد." });
  await ctx.reply("ثبت‌نام متوقف شد. هر زمان آماده بودی /start را بزن تا ثبت باشگاه را ادامه بدهی.");
});

bot.on("message:text", async (ctx, next) => {
  if (ctx.chat.type !== "private" || !ctx.from) return next();
  const draft = clubCreationDrafts.get(ctx.from.id);
  if (!draft) return next();
  const value = ctx.message.text.trim();
  if (/^\/cancel$/i.test(value)) {
    clubCreationDrafts.delete(ctx.from.id);
    await ctx.reply("ساخت باشگاه لغو شد.", { reply_markup: mainMenu() });
    return;
  }
  if (!draft.name) {
    if (value.length < 2 || value.length > 60) {
      await ctx.reply("نام باید بین ۲ تا ۶۰ نویسه باشد. دوباره بفرست.");
      return;
    }
    draft.name = value;
    await ctx.reply("حالا شناسهٔ لاتین باشگاه را بفرست؛ فقط حروف انگلیسی، عدد و خط تیره (۳ تا ۴۰ نویسه).\nنمونه: tehran-stars", {
      reply_markup: new InlineKeyboard().text("لغو", "club_create_cancel"),
    });
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/i.test(value)) {
    await ctx.reply("شناسه معتبر نیست. از ۳ تا ۴۰ نویسهٔ انگلیسی، عدد یا خط تیره استفاده کن و دوباره بفرست.");
    return;
  }
  if (!apiUrl || !botInternalSecret) {
    clubCreationDrafts.delete(ctx.from.id);
    await ctx.reply("سرویس ساخت باشگاه در حال حاضر پیکربندی نشده است.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/telegram-clubs/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({ telegramUserId: ctx.from.id, firstName: ctx.from.first_name, lastName: ctx.from.last_name, username: ctx.from.username, name: draft.name, slug: value.toLowerCase() }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; clubId?: string };
    if (!response.ok) {
      console.error("Guided Telegram club creation API rejected request", {
        endpoint: "/internal/telegram-clubs/create",
        apiOrigin: new URL(apiUrl).origin,
        status: response.status,
        error: body.error ?? "non_json_error",
      });
      const messages: Record<string, string> = {
        club_conflict_or_already_owned: "این شناسه تکراری است یا قبلاً باشگاه ساخته‌ای.",
        club_name_or_slug_invalid: "نام یا شناسهٔ باشگاه معتبر نیست.",
        club_creation_not_configured: "سرویس ساخت باشگاه هنوز پیکربندی نشده است.",
      };
      await ctx.reply(messages[body.error ?? ""] ?? `ساخت باشگاه انجام نشد (کد ${response.status}). کمی بعد دوباره تلاش کن.`);
      return;
    }
    clubCreationDrafts.delete(ctx.from.id);
    await ctx.reply(`باشگاه «${draft.name}» ساخته شد!\nشناسه: ${body.clubId ?? value}\nاز منوی زیر ادامه بده.`, { reply_markup: mainMenu() });
  } catch (error) {
    console.error("Guided Telegram club creation failed", error);
    await ctx.reply("ارتباط با API برقرار نشد. اتصال سرویس را بررسی کن و دوباره تلاش کن.");
  }
});

bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "از منوی اصلی وارد باشگاه شو. حساب تلگرام و باشگاهت بین ربات و مینی‌اپ مشترک است.",
    { reply_markup: ctx.chat?.type === "private" ? mainMenu() : await appEntryKeyboard(ctx.chat?.type ?? "group", "باز کردن یازده") },
  );
});

bot.callbackQuery("status", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "در حال بررسی سرویس…" });
  await replyRich(ctx, `🩺 <b>وضعیت سرویس</b>
${await getServiceStatus()}`, `وضعیت سرویس
${await getServiceStatus()}`);
});


bot.on("message:new_chat_members", async (ctx) => {
  const addedBot = ctx.message.new_chat_members.some((member) => member.id === bot.botInfo.id);
  if (addedBot) {
    await ctx.reply("⚽ ربات یازده به گروه اضافه شد. برای شروع رقابت گروهی، دکمهٔ بازی‌های گروه را باز کنید؛ مدیریت باشگاه از مینی‌اپ انجام می‌شود.", {
      reply_markup: new InlineKeyboard().url("باز کردن بازی‌های گروه", await groupStartUrl(ctx.chat.id)),
    });
  }
});

bot.command("group", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type === "private") {
    await ctx.reply("این دستور را داخل گروه تلگرام اجرا کنید تا راهنمای اتصال گروه و رقابت گروهی را ببینید.");
    return;
  }
  const isAdmin = await ctx.getChatMember(ctx.from.id).then((member) =>
    member.status === "creator" || member.status === "administrator",
  ).catch(() => false);
  if (!isAdmin) {
    await ctx.reply("اتصال گروه به بازی باید توسط مالک یا مدیر گروه انجام شود.");
    return;
  }
  if (!apiUrl || !botInternalSecret) {
    await ctx.reply("اتصال گروه هنوز در تنظیمات سرویس فعال نشده است.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/telegram-groups/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        title: ctx.chat.title ?? "گروه تلگرام",
      }),
    });
    const body = await response.json() as { error?: string; linked?: boolean };
    if (!response.ok) {
      const message = body.error === "telegram_group_already_linked"
        ? "این گروه قبلاً به حساب دیگری متصل شده است؛ برای جلوگیری از تغییر مالکیت، اتصال مجدد مجاز نیست."
        : body.error === "telegram_user_not_registered"
        ? "ابتدا در مینی‌اپ وارد بازی شو و باشگاهت را بساز، سپس اتصال گروه را دوباره انجام بده."
        : body.error === "club_required_before_group_link"
          ? "برای اتصال گروه، ابتدا باید باشگاهت را در مینی‌اپ ایجاد کنی."
          : "ثبت اتصال گروه انجام نشد؛ کمی بعد دوباره تلاش کن.";
      await ctx.reply(message);
      return;
    }
    await ctx.reply("گروه با موفقیت به یازده متصل شد. از این پس می‌توان چالش‌های گروهی را برای این گروه ثبت کرد.", {
      reply_markup: new InlineKeyboard().url("باز کردن بازی‌های گروه", await groupStartUrl(ctx.chat.id)),
    });
  } catch (error) {
    console.error("Telegram group linking failed", error);
    await ctx.reply("ارتباط با سرویس بازی برقرار نشد؛ کمی بعد دوباره تلاش کن.");
  }
});

bot.catch((error) => {
  console.error("Telegram bot update failed", error);
});

export { bot };
