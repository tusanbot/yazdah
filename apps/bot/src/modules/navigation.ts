import type { Bot, Context } from "grammy";
import { BOT_COMMANDS, resolveTextCommand } from "../commands/catalog.js";
import { postInternalApi } from "../api-client.js";
import { mainReplyKeyboard, navigationKeyboard } from "../ui/keyboards.js";
import { escapeHtml, richText } from "../ui/rich-message.js";

type SectionId = "overview" | "squad" | "matches" | "finance" | "missions" | "staff" | "academy" | "tactics";
type Section = { id: SectionId; title: string; summary: string; actions: readonly (readonly [string, string])[] };
const SECTIONS: Record<string, Section> = {
  club: { id: "overview", title: "🏟 باشگاه من", summary: "نمای کلی باشگاه و شاخص‌های اصلی.", actions: [["➕ ایجاد باشگاه", "club:create"], ["📊 نمای کلی", "club:overview"]] },
  matches: { id: "matches", title: "⚽ مسابقات", summary: "مسابقات و نتایج ثبت‌شده.", actions: [["📅 برنامه و نتایج", "matches:show"]] },
  squad: { id: "squad", title: "👥 ترکیب بازیکنان", summary: "بازیکنان و آرایش فعلی تیم.", actions: [["📋 نمایش ترکیب", "squad:show"]] },
  finance: { id: "finance", title: "💰 امور مالی", summary: "موجودی و آخرین تراکنش‌ها.", actions: [["🧾 آخرین تراکنش‌ها", "finance:show"]] },
  missions: { id: "missions", title: "🎯 مأموریت‌ها", summary: "پیشرفت مأموریت‌ها و پاداش‌ها.", actions: [["📌 نمایش مأموریت‌ها", "missions:show"]] },
  academy: { id: "academy", title: "🎓 آکادمی", summary: "استعدادهای آکادمی باشگاه.", actions: [["🌱 نمایش استعدادها", "academy:show"]] },
  staff: { id: "staff", title: "🧑‍💼 کادر فنی", summary: "اعضای فعال کادر فنی.", actions: [["👔 نمایش کادر", "staff:show"]] },
  tactics: { id: "tactics", title: "🧠 تاکتیک", summary: "آرایش و تنظیمات تاکتیکی.", actions: [["📐 نمایش تاکتیک", "tactics:show"]] },
  status: { id: "overview", title: "🩺 وضعیت سرویس", summary: "ربات فعال است و درخواست‌ها را دریافت می‌کند.", actions: [] },
};
const LABEL_TO_SECTION = new Map<string, string>(
  BOT_COMMANDS.filter((item) => !["start", "help", "menu"].includes(item.id)).map((item) => [item.menuLabel, item.id]),
);
const ACTION_SECTION: Record<string, SectionId> = {
  "club:overview": "overview", "matches:show": "matches", "squad:show": "squad",
  "finance:show": "finance", "missions:show": "missions", "academy:show": "academy",
  "staff:show": "staff", "tactics:show": "tactics",
};

type SectionPayload = Record<string, unknown> & { error?: string };
const apiUrl = process.env.YAZDAH_API_URL;
const botSecret = process.env.BOT_INTERNAL_SECRET;

function formatRows(rows: unknown, fields: readonly [string, string][]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "موردی برای نمایش ثبت نشده است.";
  return rows.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const details = fields.map(([label, key]) => `<b>${escapeHtml(label)}:</b> ${escapeHtml(record[key] ?? "—")}`).join(" | ");
    return `${index + 1}. ${details}`;
  }).join("\n");
}

function renderData(section: SectionId, data: Record<string, unknown>): string {
  switch (section) {
    case "overview": {
      const club = data.club && typeof data.club === "object" ? data.club as Record<string, unknown> : {};
      return [
        `<b>🏟 ${escapeHtml(club.name ?? "باشگاه")}</b>`,
        `شناسه: ${escapeHtml(club.slug ?? "—")} | سطح: ${escapeHtml(club.level ?? "—")}`,
        `اعتبار: ${escapeHtml(club.reputation ?? "—")} | شهر: ${escapeHtml(club.city ?? "ثبت نشده")}`,
        `موجودی: ${escapeHtml(data.balance ?? "—")} | بازیکنان: ${escapeHtml(data.playerCount ?? 0)} | مسابقات: ${escapeHtml(data.matchCount ?? 0)}`,
      ].join("\n");
    }
    case "squad":
      return `<b>👥 ترکیب تیم</b>\nآرایش: ${escapeHtml(data.formation ?? "ثبت نشده")}\n${formatRows(data.players, [["بازیکن", "full_name"], ["پست", "position"], ["قدرت", "overall"], ["آمادگی", "fitness"]])}`;
    case "matches":
      return `<b>⚽ مسابقات اخیر</b>\n${formatRows(data.matches, [["وضعیت", "status"], ["شروع", "kickoff_at"], ["نتیجه میزبان", "home_score"], ["نتیجه مهمان", "away_score"]])}`;
    case "finance":
      return `<b>💰 امور مالی</b>\nموجودی: ${escapeHtml(data.balance ?? "—")}\n<b>آخرین تراکنش‌ها</b>\n${formatRows(data.transactions, [["شرح", "reason"], ["زمان", "created_at"]])}`;
    case "missions":
      return `<b>🎯 مأموریت‌ها</b>\n${formatRows(data.missions, [["عنوان", "title"], ["پیشرفت", "progress"], ["هدف", "targetCount"], ["پاداش", "reward"], ["دریافت‌شده", "claimed"]])}`;
    case "staff":
      return `<b>🧑‍💼 کادر فنی</b>\n${formatRows(data.staff, [["نام", "full_name"], ["نقش", "staff_role"], ["سطح", "staff_tier"], ["مهارت", "skill"]])}`;
    case "academy":
      return `<b>🎓 آکادمی</b>\n${formatRows(data.prospects, [["نام", "full_name"], ["پست", "position"], ["استعداد", "potential"], ["پیشرفت", "development"]])}`;
    case "tactics": {
      const tactics = data.tactics && typeof data.tactics === "object" ? data.tactics as Record<string, unknown> : {};
      return `<b>🧠 تاکتیک تیم</b>\n${formatRows([tactics], [["آرایش", "formation"], ["ذهنیت", "mentality"], ["سرعت", "tempo"], ["پرس", "pressing"]])}`;
    }
  }
}

async function showHome(ctx: Context): Promise<void> {
  await ctx.reply(richText("🏟 یازده | منوی اصلی", "یک بخش را انتخاب کن یا میان‌بر متنی آن را بفرست."), {
    parse_mode: "HTML", reply_markup: mainReplyKeyboard(),
  });
}
async function showSection(ctx: Context, sectionKey: string): Promise<void> {
  const section = SECTIONS[sectionKey];
  if (!section) return void await ctx.reply("این بخش در نسخهٔ بازطراحی‌شده هنوز آماده نشده است.");
  if (sectionKey === "status") {
    await ctx.reply(richText(section.title, section.summary), { parse_mode: "HTML", reply_markup: mainReplyKeyboard() });
    return;
  }
  if (!ctx.from) return;
  if (!apiUrl || !botSecret) {
    await ctx.reply("اتصال ربات به API پیکربندی نشده است. لطفاً بعداً دوباره تلاش کن.");
    return;
  }
  await ctx.reply("⏳ در حال دریافت اطلاعات...");
  try {
    const result = await postInternalApi<SectionPayload>(apiUrl, botSecret, "/internal/telegram-clubs/section", {
      telegramUserId: ctx.from.id, section: section.id,
    });
    if (!result.ok || !result.data) {
      const messages: Record<string, string> = {
        telegram_user_not_registered: "ابتدا حساب بازی را ایجاد کن.",
        club_not_found: "هنوز باشگاهی برای حساب تو ثبت نشده است. از گزینهٔ «➕ ایجاد باشگاه» شروع کن.",
        telegram_sections_not_configured: "این بخش فعلاً در سرویس بازی پیکربندی نشده است.",
      };
      await ctx.reply(messages[result.data?.error ?? result.error ?? ""] ?? "دریافت اطلاعات ناموفق بود؛ کمی بعد دوباره تلاش کن.", {
        reply_markup: navigationKeyboard({ backCallback: "nav:home", homeCallback: "nav:home" }),
      });
      return;
    }
    await ctx.reply(renderData(section.id, result.data), {
      parse_mode: "HTML", reply_markup: navigationKeyboard({ backCallback: "nav:home", homeCallback: "nav:home" }),
    });
  } catch (error) {
    console.error("Telegram section request failed", error);
    await ctx.reply("ارتباط با سرویس بازی برقرار نشد؛ کمی بعد دوباره تلاش کن.");
  }
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
  bot.callbackQuery(/^([a-z]+):([a-z]+)$/, async (ctx) => {
    const key = ctx.match[0];
    await ctx.answerCallbackQuery();
    if (key === "club:create") {
      await ctx.reply("برای ایجاد باشگاه، از فرمان /club در گفت‌وگوی خصوصی استفاده کن. ساخت باشگاه در این مرحله به‌صورت فرم دکمه‌ای تکمیل می‌شود.");
      return;
    }
    const target = ACTION_SECTION[key] ?? key.split(":")[0];
    await showSection(ctx, target);
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
