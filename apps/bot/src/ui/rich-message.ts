import { InlineKeyboard } from "grammy";

const TELEGRAM_TEXT_LIMIT = 4_096;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function richText(title: string, body: string, footer?: string): string {
  const sections = [
    title ? `<b>${escapeHtml(title)}</b>` : "",
    body,
    footer ? `<i>${escapeHtml(footer)}</i>` : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function richList(items: readonly string[], emptyText = "موردی برای نمایش وجود ندارد."): string {
  if (items.length === 0) return escapeHtml(emptyText);
  return items.map((item, index) => `${index + 1}. ${escapeHtml(item)}`).join("\n");
}

export function richKeyValue(rows: readonly (readonly [string, unknown])[]): string {
  return rows.map(([label, value]) =>
    `<b>${escapeHtml(label)}:</b> ${escapeHtml(value ?? "ثبت نشده")}`,
  ).join("\n");
}

export type ClubCardData = {
  name: string;
  id?: string | number | null;
  level?: string | number | null;
  rank?: string | number | null;
  status?: string | null;
  balance?: string | number | null;
};

export function clubCard(club: ClubCardData): string {
  return richText("🏟 اطلاعات باشگاه", richKeyValue([
    ["نام", club.name],
    ["شناسه", club.id],
    ["سطح", club.level],
    ["رتبه", club.rank],
    ["وضعیت", club.status],
    ["موجودی", club.balance],
  ]));
}

export function richTable(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  emptyText = "داده‌ای برای نمایش وجود ندارد.",
): string {
  if (rows.length === 0) return escapeHtml(emptyText);
  const heading = headers.map(escapeHtml).join("  |  ");
  const body = rows.map((row) => row.map((cell) => escapeHtml(cell ?? "—")).join("  |  "));
  return [`<b>${heading}</b>`, ...body].join("\n");
}

/** Splits long HTML at line boundaries when possible; callers send chunks in order. */
export function splitRichMessage(message: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (message.length <= limit) return [message];
  const chunks: string[] = [];
  let current = "";
  for (const line of message.split("\n")) {
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0; offset < line.length; offset += limit) {
        chunks.push(line.slice(offset, offset + limit));
      }
      continue;
    }
    if (current && current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export type RichReplyMarkup = InlineKeyboard;
