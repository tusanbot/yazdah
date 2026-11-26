import { bot } from "./bot.js";
import { telegramCommandMenu } from "./commands/catalog.js";

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
      await bot.api.setMyCommands(telegramCommandMenu());
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

export class BotUpdateGuard {
  async fetch(request: Request): Promise<Response> {
    void request;
    return new Response("BotUpdateGuard is retired.", { status: 410 });
  }
}
