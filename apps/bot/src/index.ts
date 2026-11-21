import { Bot, InlineKeyboard } from "grammy";

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

const bot = new Bot(token);

function mainMenu() {
  return new InlineKeyboard()
    .webApp("ورود به باشگاه", miniAppUrl)
    .row()
    .text("راهنما", "help")
    .text("وضعیت سرویس", "status")
    .row()
    .webApp("مدیریت باشگاه", miniAppUrl);
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "به یازده خوش آمدی! از اینجا می‌توانی وارد باشگاهت شوی و بازی را از ربات یا مینی‌اپ ادامه بدهی.",
    { reply_markup: mainMenu() },
  );
});

bot.command("menu", async (ctx) => {
  await ctx.reply("منوی اصلی یازده", { reply_markup: mainMenu() });
});

bot.command("club", async (ctx) => {
  await ctx.reply("برای مدیریت باشگاه، ترکیب، تمرین، مسابقات و بازار، مینی‌اپ را باز کن.", {
    reply_markup: new InlineKeyboard().webApp("ورود به باشگاه", miniAppUrl),
  });
});

bot.command("missions", async (ctx) => {
  await ctx.reply("مأموریت‌ها و پاداش‌های باشگاه از بخش مدیریت باشگاه در مینی‌اپ قابل پیگیری‌اند.", {
    reply_markup: new InlineKeyboard().webApp("مدیریت باشگاه", miniAppUrl),
  });
});

bot.command("union", async (ctx) => {
  await ctx.reply("برای ایجاد یا پیوستن به اتحادیه و دیدن فهرست اتحادیه‌ها، مینی‌اپ را باز کن.", {
    reply_markup: new InlineKeyboard().webApp("مدیریت باشگاه", miniAppUrl),
  });
});

bot.command("challenge", async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply("این دستور را داخل گروهِ متصل به یازده اجرا کن. برای ساخت: /challenge <شناسه‌باشگاه‌حریف> <زمان-ISO> و برای پذیرش: /challenge accept <شناسه‌چالش>");
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
    await ctx.reply("ساخت چالش: /challenge <شناسه‌باشگاه‌حریف> <زمان-ISO>\nپذیرش چالش: /challenge accept <شناسه‌چالش>\nزمان باید ISO 8601 و در آینده باشد.");
    return;
  }
  try {
    const response = await fetch(`${apiUrl.replace(/\//$/, "")}/internal/telegram-groups/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": botInternalSecret },
      body: JSON.stringify({ ...payload, telegramUserId: ctx.from.id, telegramChatId: ctx.chat.id }),
    });
    const body = await response.json() as { error?: string; challengeId?: string; matchId?: string; accepted?: boolean };
    if (!response.ok) {
      const messages: Record<string, string> = {
        telegram_user_not_registered: "ابتدا در مینی‌اپ وارد بازی شو و باشگاهت را بساز.",
        telegram_group_not_linked: "ابتدا گروه را با دستور /group به یازده متصل کن.",
        telegram_group_owner_required: "فقط مدیری که گروه را به بازی متصل کرده می‌تواند چالش ثبت کند.",
        club_required_before_group_challenge: "ابتدا باشگاهت را در مینی‌اپ ایجاد کن.",
        challenge_opponent_club_required: "این باشگاه، حریف تعیین‌شده برای این چالش نیست.",
        challenge_not_found: "چالش در این گروه پیدا نشد.",
        challenge_not_available: "این چالش قبلاً پذیرفته شده یا دیگر در دسترس نیست.",
      };
      await ctx.reply(messages[body.error ?? ""] ?? "عملیات چالش انجام نشد؛ شناسه‌ها و زمان را بررسی کن.");
      return;
    }
    await ctx.reply(action === "create"
      ? `چالش ثبت شد. شناسهٔ چالش: ${body.challengeId}\nبرای پذیرش، مدیر باشگاه حریف باید در همین گروه اجرا کند: /challenge accept ${body.challengeId}`
      : `چالش پذیرفته شد و مسابقه ساخته شد. شناسهٔ مسابقه: ${body.matchId}`);
  } catch (error) {
    console.error("Telegram group challenge failed", error);
    await ctx.reply("ارتباط با سرویس بازی برقرار نشد؛ کمی بعد دوباره تلاش کن.");
  }
});

bot.command("game", async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply("این فرمان را داخل گروه متصل اجرا کن. نمونه: /game draft 100 یا /game survival 0 20\nانواع: draft، penalty، cards، quiz، guess، survival");
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
    !Number.isSafeInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 30) {
    await ctx.reply("فرمت: /game <draft|penalty|cards|quiz|guess|survival> <ورودی‌سکه> [تعداد‌شرکت‌کننده]\nبرای چالش رایگان عدد ورودی را ۰ بگذار. درفت، پنالتی و کارت بازی دو نفره‌اند.");
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
        telegram_group_not_linked: "ابتدا مدیر گروه باید با دستور /group گروه را به یازده متصل کند.",
        telegram_user_not_registered: "ابتدا از طریق مینی‌اپ وارد یازده شو و باشگاهت را بساز.",
        club_required_before_group_game: "برای ساخت چالش باید باشگاه داشته باشی.",
      };
      await ctx.reply(messages[body.error ?? ""] ?? "ایجاد چالش ناموفق بود؛ کمی بعد دوباره تلاش کن.");
      return;
    }
    const gameUrl = `${miniAppUrl}${miniAppUrl.includes("?") ? "&" : "?"}groupChatId=${ctx.chat.id}&gameId=${body.gameId}`;
    await ctx.reply(
      `چالش جدید ایجاد شد!\nنوع: ${gameType}\nورودی: ${entryFee.toLocaleString("fa-IR")} سکه گروه\nجایزه فعلی: ${Number(body.prizePool ?? 0).toLocaleString("fa-IR")} سکه گروه\nشناسه: ${body.gameId}\n\nبرای پیوستن و اجرای چالش، مینی‌اپ گروه را باز کنید.`,
      { reply_markup: new InlineKeyboard().webApp("ورود به چالش گروه", gameUrl) },
    );
  } catch (error) {
    console.error("Group game creation failed", error);
    await ctx.reply("ارتباط با سرویس چالش‌ها برقرار نشد.");
  }
});

bot.command("games", async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply("برای دیدن چالش‌های گروه، این فرمان را داخل گروه تلگرام اجرا کن.");
    return;
  }
  const gameUrl = `${miniAppUrl}${miniAppUrl.includes("?") ? "&" : "?"}groupChatId=${ctx.chat.id}`;
  await ctx.reply("چالش‌ها، کیف پول گروه و مأموریت‌های گروهی:", {
    reply_markup: new InlineKeyboard().webApp("باز کردن چالش‌های گروه", gameUrl),
  });
});

bot.command("market", async (ctx) => {
  await ctx.reply("برای خریدوفروش بازیکنان، بازار نقل‌وانتقالات یازده را باز کن.", {
    reply_markup: new InlineKeyboard().webApp("بازار نقل‌وانتقالات", miniAppUrl),
  });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `راهنمای یازده
/start — شروع و ورود به باشگاه
/menu — نمایش منوی اصلی
/market — بازار نقل‌وانتقالات
/game — ساخت چالش گروهی (فقط مدیران گروه)
/games — مشاهده چالش‌ها و مأموریت‌های گروه
/missions — مأموریت‌های باشگاه
/help — راهنما

انواع چالش: draft، penalty، cards، quiz، guess، survival
نمونه: /game draft 100 یا /game survival 0 20
مدیریت باشگاه و سایر بخش‌های بازی از طریق مینی‌اپ در دسترس است.`,
    { reply_markup: mainMenu() },
  );
});
bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "از منوی اصلی وارد باشگاه شو. حساب تلگرام و باشگاهت بین ربات و مینی‌اپ مشترک است.",
    { reply_markup: mainMenu() },
  );
});

bot.callbackQuery("status", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "ربات فعال است." });
});


bot.on("message:new_chat_members", async (ctx) => {
  const addedBot = ctx.message.new_chat_members.some((member) => member.id === bot.botInfo.id);
  if (addedBot) {
    await ctx.reply("ربات یازده به گروه اضافه شد. برای راهنمای چالش‌های گروهی /challenge را بزنید؛ مدیریت باشگاه از مینی‌اپ انجام می‌شود.", {
      reply_markup: new InlineKeyboard().webApp("باز کردن یازده", miniAppUrl),
    });
  }
});

bot.command("group", async (ctx) => {
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
        ? "ابتدا در مینی‌اپ وارد بازی شو و باشگاهت را بساز، سپس دوباره /group را اجرا کن."
        : body.error === "club_required_before_group_link"
          ? "برای اتصال گروه، ابتدا باید باشگاهت را در مینی‌اپ ایجاد کنی."
          : "ثبت اتصال گروه انجام نشد؛ کمی بعد دوباره تلاش کن.";
      await ctx.reply(message);
      return;
    }
    await ctx.reply("گروه با موفقیت به یازده متصل شد. از این پس می‌توان چالش‌های گروهی را برای این گروه ثبت کرد.", {
      reply_markup: new InlineKeyboard().webApp("مدیریت باشگاه", miniAppUrl),
    });
  } catch (error) {
    console.error("Telegram group linking failed", error);
    await ctx.reply("ارتباط با سرویس بازی برقرار نشد؛ کمی بعد دوباره تلاش کن.");
  }
});

bot.catch((error) => {
  console.error("Telegram bot update failed", error);
});

await bot.start();
