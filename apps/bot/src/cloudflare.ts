import { bot } from "./index.js";

const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
let initialized: Promise<void> | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "yazdah-bot" });
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not Found", { status: 404 });
    }
    if (!webhookSecret || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }
    initialized ??= bot.init();
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
