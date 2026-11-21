import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply(
    "به یازده خوش آمدی! برای آغاز ساخت باشگاه، نسخهٔ مینی‌اپ را باز کن.",
  );
});

await bot.start();
