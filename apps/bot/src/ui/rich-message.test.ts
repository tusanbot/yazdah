import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clubCard, escapeHtml, richList, richTable, splitRichMessage } from "./rich-message.js";

test("escapes dynamic content for Telegram HTML", () => {
  assert.equal(escapeHtml("<b>&\""), "&lt;b&gt;&amp;&quot;");
});

test("renders a compact numbered list and empty state", () => {
  assert.equal(richList(["آلفا", "بتا"]), "1. آلفا\n2. بتا");
  assert.equal(richList([]), "موردی برای نمایش وجود ندارد.");
});

test("renders club card with explicit missing values", () => {
  const card = clubCard({ name: "یازده", id: "c-1" });
  assert.match(card, /<b>نام:<\/b> یازده/);
  assert.match(card, /ثبت نشده/);
});

test("renders mobile-friendly table rows", () => {
  assert.equal(richTable(["نام", "سطح"], [["بازیکن", 4]]), "<b>نام  |  سطح<\/b>\nبازیکن  |  4");
});

test("splits long messages at line boundaries", () => {
  const parts = splitRichMessage("alpha\nbeta\ngamma", 6);
  assert.deepEqual(parts, ["alpha", "beta", "gamma"]);
  assert.ok(parts.every((part) => part.length <= 6));
});
