import { Bot } from "grammy";
import { registerModules } from "./modules/index.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

export const bot = new Bot(token);
registerModules(bot);
