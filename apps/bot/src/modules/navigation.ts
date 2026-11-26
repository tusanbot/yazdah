import type { Bot, Context } from "grammy";
import { BOT_COMMANDS, resolveTextCommand } from "../commands/catalog.js";
import { mainReplyKeyboard, navigationKeyboard } from "../ui/keyboards.js";
import { richText } from "../ui/rich-message.js";

type Section = { title: string; summary: string; actions: readonly (readonly [string, string])[] };
const SECTIONS: Record<string, Section> = {
  club: { title: "🏟 باشگاه من", summary: "مدیریت باشگاه، وضعیت و اطلاعات اصلی.", actions: [["➕ ایجاد باشگاه", "club:create"], ["📊 نمای کلی", "club:overview"]] },
  matches: { title: "⚽ مسابقات", summary: "مسابقات پیش‌رو، نتایج و برنامهٔ بازی‌ها.", actions: [["📅 برنامهٔ مسابقات", "matches:schedule"], ["🏆 نتایج", "matches:results"]] },
  squad: { title: "👥 ترکیب بازیکنان", summary: "ترکیب، بازیکنان و وضعیت فهرست تیم.", actions: [["📋 نمایش ترکیب", "squad:show"], ["🔎 جست‌وجوی بازیکن", "squad:search"]] },
  finance: { title: "💰 امور مالی", summary: "موجودی و رویدادهای مالی باشگاه.", actions: [["💳 موجودی", "finance:balance"], ["🧾 تراکنش‌ها", "finance:history"]] },
  missions: { title: "🎯 مأموریت‌ها", summary: "مأموریت‌های فعال و پاداش‌های قابل دریافت.", actions: [["📌 فعال‌ها", "missions:active"], ["🎁 پاداش‌ها", "missions:rewards"]] },
  academy: { title: "🎓 آکادمی", summary: "پرورش استعدادها و مدیریت آکادمی.", actions: [["🌱 استعدادها", "academy:talents"], ["🏋️ تمرین", "academy:training"]] },
  staff: { title: "🧑‍💼 کادر فنی", summary: "اعضای کادر فنی و مسئولیت‌های آن‌ها.", actions: [["👔 اعضا", "staff:list"], ["➕ جذب کادر", "staff:hire"]] },
  tactics: { title: "🧠 تاکتیک", summary: "آرایش و تنظیمات تاکتیکی تیم.", actions: [["📐 آرایش", "tactics:formation"], ["⚙️ تنظیمات", "tactics:settings"]] },
  status: { title: "🩺 وضعیت سرویس", summary: "وضعیت دسترسی ربات و سرویس‌های متصل.", actions: [["🔄 بررسی دوباره", "status:refresh"]] },
};
const LABEL_TO_SECTION = new Map<string, string>(
  BOT_COMMANDS.filter((item) => !["start", "help", "menu"].includes(item.id)).map((item) => [item.menuLabel, item.id]),
);

async function showHome(ctx: Context): Promise<void> {
  await ctx.reply(richText("🏟 یازده | منوی اصلی", "یک بخش را انتخاب کن یا میان‌بر متنی آن را بفرست."), {
    parse_mode: "HTML", reply_markup: mainReplyKeyboard(),
  });
}
async function showSection(ctx: Context, id: string): Promise<void> {
  const section = SECTIONS[id];
  if (!section) return void await ctx.reply("این بخش در نسخهٔ بازطراحی‌شده هنوز آماده نشده است.");
  await ctx.reply(richText(section.title, section.summary), {
    parse_mode: "HTML",
    reply_markup: navigationKeyboard({ actions: section.actions, backCallback: "nav:home", homeCallback: "nav:home" }),
  });
}
export function registerNavigation(bot: Bot): void {
  bot.command(["start", "menu"], showHome);
  bot.command("help", async (ctx) => {
    const list = BOT_COMMANDS.map((item) => `<b>${item.menuLabel}</b> — ${item.description}`).join("\n");
    await ctx.reply(richText("📖 راهنمای یازده", list, "نام بخش‌ها را هم می‌توانی به‌صورت متن بفرستی."), {
      parse_mode: "HTML", reply_markup: mainReplyKeyboard(),
    });
  });
  bot.callbackQuery("nav:home", async (ctx) => { await ctx.answerCallbackQuery(); await showHome(ctx); });
  bot.callbackQuery(/^nav:section:([a-z]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSection(ctx, ctx.match[1] ?? "");
  });
  bot.callbackQuery(/^([a-z]+):([a-z]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "این گزینه هنوز به عملیات بازی متصل نشده است." });
  });
  bot.hears([...LABEL_TO_SECTION.keys()], async (ctx) => {
    const id = LABEL_TO_SECTION.get(ctx.message.text);
    if (id) await showSection(ctx, id);
  });
  bot.on("message:text", async (ctx, next) => {
    const command = resolveTextCommand(ctx.message.text);
    if (!command || ["start", "menu", "help"].includes(command.id)) return next();
    await showSection(ctx, command.id);
  });
}
