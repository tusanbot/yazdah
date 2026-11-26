export type BotCommandId =
  | "start" | "help" | "menu" | "club" | "matches" | "squad"
  | "finance" | "missions" | "academy" | "staff" | "tactics" | "status";

export type BotCommandDefinition = {
  id: BotCommandId;
  command: string;
  description: string;
  menuLabel: string;
  aliases: readonly string[];
  privateOnly?: boolean;
};

export const BOT_COMMANDS: readonly BotCommandDefinition[] = [
  { id: "start", command: "start", description: "شروع و نمایش خانه", menuLabel: "🏠 خانه", aliases: ["شروع", "خانه"] },
  { id: "help", command: "help", description: "راهنما و فهرست فرمان‌ها", menuLabel: "📖 راهنما", aliases: ["راهنما", "کمک"] },
  { id: "menu", command: "menu", description: "نمایش منوی اصلی", menuLabel: "📋 منوی اصلی", aliases: ["منو"] },
  { id: "club", command: "club", description: "وضعیت و مدیریت باشگاه", menuLabel: "🏟 باشگاه من", aliases: ["باشگاه"] },
  { id: "matches", command: "matches", description: "مسابقات و نتایج", menuLabel: "⚽ مسابقات", aliases: ["مسابقات", "بازی‌ها"] },
  { id: "squad", command: "squad", description: "ترکیب و بازیکنان", menuLabel: "👥 ترکیب بازیکنان", aliases: ["ترکیب", "بازیکنان"] },
  { id: "finance", command: "finance", description: "امور مالی و موجودی", menuLabel: "💰 امور مالی", aliases: ["مالی", "موجودی"] },
  { id: "missions", command: "missions", description: "مأموریت‌ها و پاداش‌ها", menuLabel: "🎯 مأموریت‌ها", aliases: ["ماموریت", "مأموریت"] },
  { id: "academy", command: "academy", description: "آکادمی و پرورش بازیکن", menuLabel: "🎓 آکادمی", aliases: ["آکادمی"] },
  { id: "staff", command: "staff", description: "کادر فنی باشگاه", menuLabel: "🧑‍💼 کادر فنی", aliases: ["کادر", "مربی"] },
  { id: "tactics", command: "tactics", description: "تاکتیک و آرایش تیم", menuLabel: "🧠 تاکتیک", aliases: ["تاکتیک", "آرایش"] },
  { id: "status", command: "status", description: "وضعیت سرویس", menuLabel: "🩺 وضعیت سرویس", aliases: ["وضعیت سرویس"] },
] as const;

const COMMAND_LOOKUP = new Map<string, BotCommandDefinition>(
  BOT_COMMANDS.flatMap((definition) => [
    [definition.command, definition] as const,
    ...definition.aliases.map((alias) => [normalize(alias), definition] as const),
  ]),
);

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("fa-IR").replace(/\s+/g, " ");
}

export function resolveTextCommand(text: string): BotCommandDefinition | undefined {
  const normalized = normalize(text);
  const slashCommand = normalized.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i)?.[1];
  if (slashCommand) return COMMAND_LOOKUP.get(slashCommand.toLowerCase());
  return COMMAND_LOOKUP.get(normalized);
}

export function telegramCommandMenu(): { command: string; description: string }[] {
  return BOT_COMMANDS.map(({ command, description }) => ({ command, description }));
}
