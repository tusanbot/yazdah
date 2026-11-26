import { InlineKeyboard, Keyboard } from "grammy";

export const MAIN_MENU_ROWS = [
  ["🏟 باشگاه من", "⚽ مسابقات"],
  ["👥 ترکیب بازیکنان", "💰 امور مالی"],
  ["🎯 مأموریت‌ها", "🎓 آکادمی"],
  ["🧑‍💼 کادر فنی", "🧠 تاکتیک"],
  ["📖 راهنما", "🩺 وضعیت سرویس"],
] as const;

/** Persistent top-level navigation, intended for private chats. */
export function mainReplyKeyboard(): Keyboard {
  const keyboard = new Keyboard();
  for (const row of MAIN_MENU_ROWS) keyboard.text(row[0]).text(row[1]).row();
  return keyboard.resize().persistent().placeholder("یک بخش را انتخاب کن");
}

export function navigationKeyboard(options: {
  backCallback?: string;
  homeCallback?: string;
  actions?: readonly (readonly [label: string, callbackData: string])[];
} = {}): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [label, callbackData] of options.actions ?? []) {
    keyboard.text(label, callbackData).row();
  }
  if (options.backCallback) keyboard.text("⬅️ بازگشت", options.backCallback);
  if (options.homeCallback) keyboard.text("🏠 خانه", options.homeCallback);
  return keyboard;
}

export function confirmKeyboard(
  confirmCallback: string,
  cancelCallback: string,
  confirmLabel = "✅ تأیید",
): InlineKeyboard {
  return new InlineKeyboard()
    .text(confirmLabel, confirmCallback)
    .text("✖️ انصراف", cancelCallback);
}

export function paginatedKeyboard(
  page: number,
  pageCount: number,
  callbackPrefix: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("◀️ قبلی", `${callbackPrefix}:${page - 1}`);
  keyboard.text(`${page + 1}/${Math.max(pageCount, 1)}`, "page:noop");
  if (page + 1 < pageCount) keyboard.text("بعدی ▶️", `${callbackPrefix}:${page + 1}`);
  return keyboard;
}
