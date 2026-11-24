import { bot } from "./index.js";

const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
let initialized: Promise<unknown> | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json({ status: "ok", service: "yazdah-bot", webhook: "/telegram" });
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not Found", { status: 404 });
    }
    if (!webhookSecret || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }
    initialized ??= (async () => {
      await bot.init();
      await bot.api.setMyCommands([
        { command: "start", description: "شروع و ورود به یازده" },
        { command: "menu", description: "نمایش منوی کامل بازی" },
        { command: "club", description: "ورود به مدیریت باشگاه" },
        { command: "squad", description: "ترکیب و بازیکنان" },
        { command: "matches", description: "مسابقات باشگاه" },
        { command: "market", description: "بازار نقل‌وانتقالات" },
        { command: "academy", description: "آکادمی باشگاه" },
        { command: "staff", description: "کادر فنی" },
        { command: "tactics", description: "تاکتیک مسابقه" },
        { command: "missions", description: "مأموریت‌های باشگاه" },
        { command: "union", description: "اتحادیه‌ها" },
        { command: "group", description: "اتصال گروه تلگرام به یازده" },
        { command: "game", description: "ساخت چالش گروهی (مدیران)" },
        { command: "games", description: "چالش‌ها و مأموریت‌های گروه" },
        { command: "league", description: "مدیریت لیگ محلی گروه" },
        { command: "challenge", description: "ساخت یا پذیرش مسابقه گروهی" },
        { command: "status", description: "وضعیت سرویس بازی" },
        { command: "help", description: "راهنمای بازی" },
      ]);
    })();
    await initialized;
    try {
      const update = await request.json();
      await bot.handleUpdate(update);
      return new Response("ok");
    } catch (error) {
      console.error("Telegram webhook update failed", error);
      return new Response("Bad Request", { status: 400 });
    }
  },
};
