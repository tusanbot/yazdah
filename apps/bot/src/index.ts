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
    .text("وضعیت سرویس", "status");
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

bot.command("help", async (ctx) => {
  await ctx.reply(
    "راهنمای یازده\n/start — شروع و ورود به باشگاه\n/menu — نمایش منوی اصلی\n/help — راهنما\n\nمدیریت باشگاه و سایر بخش‌های بازی از طریق مینی‌اپ در دسترس است.",
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

bot.catch((error) => {
  console.error("Telegram bot update failed", error);
});

await bot.start();
