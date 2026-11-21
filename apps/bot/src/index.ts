import { Bot, InlineKeyboard } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL;

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

bot.command("club", async (ctx) => {\n  await ctx.reply("برای مدیریت باشگاه، ترکیب، تمرین، مسابقات و بازار، مینی‌اپ را باز کن.", {\n    reply_markup: new InlineKeyboard().webApp("ورود به باشگاه", miniAppUrl),\n  });\n});\n\nbot.command("missions", async (ctx) => {\n  await ctx.reply("مأموریت‌ها و پاداش‌های باشگاه از بخش مدیریت باشگاه در مینی‌اپ قابل پیگیری‌اند.", {\n    reply_markup: new InlineKeyboard().webApp("مدیریت باشگاه", miniAppUrl),\n  });\n});\n\nbot.command("union", async (ctx) => {\n  await ctx.reply("برای ایجاد یا پیوستن به اتحادیه و دیدن فهرست اتحادیه‌ها، مینی‌اپ را باز کن.", {\n    reply_markup: new InlineKeyboard().webApp("مدیریت باشگاه", miniAppUrl),\n  });\n});\n\nbot.command("challenge", async (ctx) => {\n  if (ctx.chat.type === "private") {\n    await ctx.reply("چالش‌های گروهی از داخل گروه تلگرام و با اتصال گروه به بازی انجام می‌شوند.");\n    return;\n  }\n  await ctx.reply("برای ساخت یا پذیرش چالش گروهی، ابتدا باشگاهتان را در مینی‌اپ مدیریت کنید. اتصال گروه و انتخاب حریف باید توسط مدیر گروه انجام شود.", {\n    reply_markup: new InlineKeyboard().webApp("مدیریت باشگاه", miniAppUrl),\n  });\n});\n\nbot.command("market", async (ctx) => {
  await ctx.reply("برای خریدوفروش بازیکنان، بازار نقل‌وانتقالات یازده را باز کن.", {
    reply_markup: new InlineKeyboard().webApp("بازار نقل‌وانتقالات", miniAppUrl),
  });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "راهنمای یازده\n/start — شروع و ورود به باشگاه\n/menu — نمایش منوی اصلی\n/market — بازار نقل‌وانتقالات\n/help — راهنما\n\nمدیریت باشگاه و سایر بخش‌های بازی از طریق مینی‌اپ در دسترس است.",
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
  await ctx.reply("گروه شناسایی شد. اتصال امن این گروه و مدیریت چالش‌ها از پنل بازی انجام می‌شود؛ این نسخه هنوز اتصال گروه را از داخل تلگرام ثبت نمی‌کند.", {
    reply_markup: new InlineKeyboard().webApp("مدیریت باشگاه", miniAppUrl),
  });
});

bot.catch((error) => {
  console.error("Telegram bot update failed", error);
});

await bot.start();
