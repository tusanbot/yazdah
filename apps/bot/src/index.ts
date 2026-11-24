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
    .webApp("🏟 ورود به باشگاه", appSectionUrl())
    .row()
    .webApp("👥 ترکیب و بازیکنان", appSectionUrl("squad-heading"))
    .webApp("⚽ مسابقات", appSectionUrl("matches-heading"))
    .row()
    .webApp("🔄 نقل‌وانتقالات", appSectionUrl("market-heading"))
    .webApp("🎓 آکادمی", appSectionUrl("academy-heading"))
    .row()
    .webApp("🧑‍💼 کادر فنی", appSectionUrl("staff-heading"))
    .webApp("🏆 مأموریت‌ها و گروه", appSectionUrl("community-heading"))
    .row()
    .webApp("🎯 تاکتیک", appSectionUrl("tactics-heading"))
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
  await ctx.reply(
    "به یازده خوش آمدی! از اینجا می‌توانی وارد باشگاهت شوی و بازی را از ربات یا مینی‌اپ ادامه بدهی.",
    { reply_markup: mainMenu() },
  );
});

bot.command("menu", async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply("منوی اصلی یازده", { reply_markup: mainMenu() });
  } else {
    await ctx.reply("برای باز کردن منوی بازی، یازده را در گفت‌وگوی خصوصی ربات باز کن.", {
      reply_markup: await appEntryKeyboard(ctx.chat.type, "باز کردن منوی یازده"),
    });
  }
});

bot.command("club", async (ctx) => {
  await ctx.reply("برای مدیریت باشگاه، ترکیب، تمرین، مسابقات و بازار، مینی‌اپ را باز کن.", {
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
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/health`);
    const body = await response.json() as { status?: string; databaseConfigured?: boolean };
    if (!response.ok || body.status !== "ok") return "ربات فعال است، اما API پاسخ سالم نمی‌دهد.";
    return body.databaseConfigured
      ? "ربات و API فعال‌اند؛ اتصال پایگاه داده برقرار است."
      : "ربات و API فعال‌اند، اما پایگاه داده در API پیکربندی نشده است.";
  } catch {
    return "ربات فعال است، اما ارتباط با API برقرار نشد.";
  }
}

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
🏟️ مدیریت باشگاه و همهٔ بخش‌های بازی در مینی‌اپ در دسترس است.`,
    { reply_markup: ctx.chat?.type === "private" ? mainMenu() : await appEntryKeyboard(ctx.chat?.type ?? "group", "باز کردن یازده") },
  );
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
