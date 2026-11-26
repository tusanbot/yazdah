import type { Bot } from "grammy";
import { registerNavigation } from "./navigation.js";

export function registerModules(bot: Bot): void {
  registerNavigation(bot);
}
