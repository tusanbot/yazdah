#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/validate-player-catalog.mjs <dataset.json>");
  process.exit(2);
}

const positions = new Set(["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"]);
const tiers = new Set(["star", "legend", "icon"]);
const classes = new Set(["professional", "special"]);
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isInt = (value) => Number.isSafeInteger(value);

let dataset;
try {
  dataset = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  console.error(`Cannot read/parse ${file}: ${error.message}`);
  process.exit(2);
}

const meta = dataset?.dataset;
if (!meta || !isText(meta.source_name) || !isText(meta.source_url) ||
    !isText(meta.retrieved_at) || Number.isNaN(Date.parse(meta.retrieved_at)) ||
    !isText(meta.license) || !isText(meta.dataset_version) || !isText(meta.reviewed_by)) {
  fail("dataset", "source_name, source_url, valid retrieved_at, license, dataset_version and reviewed_by are required");
}
if (!Array.isArray(dataset?.players) || dataset.players.length === 0) {
  fail("players", "must be a non-empty array");
  dataset.players = [];
}

const identities = new Set();
for (const [index, player] of dataset.players.entries()) {
  const where = `players[${index}]`;
  if (!player || typeof player !== "object" || Array.isArray(player)) {
    fail(where, "must be an object");
    continue;
  }

  for (const field of ["full_name", "birth_date", "position", "player_class"]) {
    if (!isText(player[field])) fail(where, `${field} is required`);
  }
  if (isText(player.full_name) && player.full_name.trim().length > 120) fail(where, "full_name exceeds 120 characters");
  if (isText(player.birth_date) && (!/^\d{4}-\d{2}-\d{2}$/.test(player.birth_date) || Number.isNaN(Date.parse(player.birth_date)))) {
    fail(where, "birth_date must use YYYY-MM-DD");
  }
  if (player.nationality_code != null && !/^[A-Z]{2}$/.test(player.nationality_code)) fail(where, "nationality_code must be a two-letter uppercase code or null");
  if (!positions.has(player.position)) fail(where, "position is not supported by player_catalog");
  if (!classes.has(player.player_class)) fail(where, "player_class must be professional or special");
  if (player.player_class === "professional" && player.special_tier != null) fail(where, "professional players must have special_tier null");
  if (player.player_class === "special" && !tiers.has(player.special_tier)) fail(where, "special players require special_tier star, legend or icon");

  for (const field of ["overall", "potential"]) {
    if (!isInt(player[field]) || player[field] < 1 || player[field] > 100) fail(where, `${field} must be an integer from 1 to 100`);
  }
  if (isInt(player.overall) && isInt(player.potential) && player.potential < player.overall) {
    fail(where, "potential cannot be lower than overall");
  }
  if (!isInt(player.release_clause) || player.release_clause <= 0) fail(where, "release_clause must be a positive safe integer");
  if (!isInt(player.weekly_wage) || player.weekly_wage < 0) fail(where, "weekly_wage must be a non-negative safe integer");
  if (typeof player.active !== "boolean") fail(where, "active must be boolean");
  if (player.rating_basis !== "source" && player.rating_basis !== "game_balance") {
    fail(where, "rating_basis must explicitly be source or game_balance");
  }
  if (player.rating_basis === "source" && !isText(player.rating_source_url)) {
    fail(where, "source-derived ratings require rating_source_url");
  }

  const identity = [player.full_name?.trim().toLocaleLowerCase(), player.birth_date, player.player_class].join("|");
  if (identities.has(identity)) fail(where, "duplicate identity (full_name + birth_date + player_class)");
  identities.add(identity);
}

if (errors.length) {
  console.error(`Catalog validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({
  valid: true,
  dataset: meta.dataset_version,
  player_count: dataset.players.length,
  professional_count: dataset.players.filter((player) => player.player_class === "professional").length,
  special_count: dataset.players.filter((player) => player.player_class === "special").length,
  inactive_count: dataset.players.filter((player) => !player.active).length,
  note: "Validation only. This command does not write to Supabase."
}, null, 2));
