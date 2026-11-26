import type { Bot } from "grammy";
import { registerClubCreation } from "./club-creation.js";
import { registerNavigation } from "./navigation.js";

export function registerModules(bot: Bot): void {
  registerClubCreation(bot);
  registerNavigation(bot);
}
