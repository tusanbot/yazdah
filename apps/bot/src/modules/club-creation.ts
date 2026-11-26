import type { Bot } from "grammy";
import { postInternalApi } from "../api-client.js";
import { mainReplyKeyboard, navigationKeyboard } from "../ui/keyboards.js";
import { escapeHtml, richText } from "../ui/rich-message.js";

const pending = new Set<number>();
const apiUrl = process.env.YAZDAH_API_URL;
const secret = process.env.BOT_INTERNAL_SECRET;

export function registerClubCreation(bot: Bot): void {
  bot.callbackQuery("club:create", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || ctx.chat?.type !== "private") {
      await ctx.reply("برای ساخت باشگاه، ربات را در گفت‌وگوی خصوصی باز کن.");
      return;
    }
    pending.add(ctx.from.id);
    await ctx.reply("نام و شناسهٔ انگلیسی باشگاه را در یک پیام بفرست، با این قالب:\nنام باشگاه | club-slug\nشناسه باید ۳ تا ۴۰ نویسه و شامل حروف انگلیسی، عدد یا خط تیره باشد.", {
      reply_markup: navigationKeyboard({ actions: [["✖️ انصراف از ساخت", "club:create:cancel"]] }),
    });
  });

  bot.callbackQuery("club:create:cancel", async (ctx) => {
    await ctx.answerCallbackQuery("فرایند ساخت باشگاه لغو شد.");
    if (ctx.from) pending.delete(ctx.from.id);
    await ctx.reply("ساخت باشگاه لغو شد.", { reply_markup: mainReplyKeyboard() });
  });

  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || !pending.has(ctx.from.id)) return next();
    if (ctx.chat.type !== "private") {
      pending.delete(ctx.from.id);
      await ctx.reply("ساخت باشگاه فقط در گفت‌وگوی خصوصی انجام می‌شود.");
      return;
    }
    const parts = ctx.message.text.split("|").map((part) => part.trim());
    const name = parts[0];
    const slug = parts[1];
    if (!name || !slug || parts.length !== 2 || name.length < 2 || name.length > 60 || !/^[a-z0-9][a-z0-9-]{2,39}$/i.test(slug)) {
      await ctx.reply("قالب نامعتبر است. دوباره با این قالب بفرست: نام باشگاه | club-slug");
      return;
    }
    if (!apiUrl || !secret) {
      pending.delete(ctx.from.id);
      await ctx.reply("اتصال ساخت باشگاه پیکربندی نشده است.");
      return;
    }
    try {
      const result = await postInternalApi<{ clubId?: string; error?: string }>(apiUrl, secret, "/internal/telegram-clubs/create", {
        telegramUserId: ctx.from.id, firstName: ctx.from.first_name, lastName: ctx.from.last_name,
        username: ctx.from.username, name, slug,
      });
      if (!result.ok || !result.data?.clubId) {
        await ctx.reply(result.data?.error === "club_conflict_or_already_owned"
          ? "این شناسه تکراری است یا قبلاً باشگاه ساخته‌ای."
          : "ساخت باشگاه انجام نشد؛ نام و شناسه را بررسی کن و دوباره تلاش کن.");
        return;
      }
      pending.delete(ctx.from.id);
      await ctx.reply(richText("✅ باشگاه ساخته شد", "شناسه: " + escapeHtml(result.data.clubId) + "\nبرای دیدن اطلاعات باشگاه، «🏟 باشگاه من» را انتخاب کن."), {
        parse_mode: "HTML", reply_markup: mainReplyKeyboard(),
      });
    } catch (error) {
      console.error("Telegram club creation failed", error);
      await ctx.reply("ارتباط با سرویس بازی برقرار نشد؛ دوباره تلاش کن.");
    }
  });
}
