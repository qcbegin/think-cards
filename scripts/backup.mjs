#!/usr/bin/env node
// Download a full JSON backup of your ThinkCards data from the add-cards
// Edge Function (/export). Run by hand or from launchd; see .notes.
//
//   node scripts/backup.mjs
//
// Reads VITE_SUPABASE_URL from .env and BACKUP_TOKEN from .env.addcards
// (both git-ignored), or from the same-named environment variables.
// Writes ~/Documents/ThinkCards-backups/thinkcards-<timestamp>.json
// (override with BACKUP_DIR) and keeps the newest KEEP files (default 60).
// Backups hold your card content: keep them outside the repository.

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readEnvFile = (name) => {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
};

const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.addcards") };
const get = (key) => process.env[key] || fileEnv[key];

const fail = (message) => {
  console.error(`backup failed: ${message}`);
  process.exit(1);
};

const base = (get("VITE_SUPABASE_URL") ?? "").replace(/\/$/, "");
const token = get("BACKUP_TOKEN");
if (!base) fail("VITE_SUPABASE_URL is not set");
if (!token) fail("BACKUP_TOKEN is not set");

const dir = process.env.BACKUP_DIR || join(homedir(), "Documents", "ThinkCards-backups");
const keep = Number(process.env.KEEP || 60);

let response;
try {
  response = await fetch(`${base}/functions/v1/add-cards/export`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
} catch (error) {
  fail(`request error (${error.name})`);
}

if (!response.ok) fail(`server answered HTTP ${response.status}`);

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  fail("response was not JSON");
}

const tables = ["profiles", "decks", "cards", "card_state", "revlog", "session_log"];
if (payload.version !== 1 || !tables.every((t) => Array.isArray(payload.data?.[t]))) {
  fail("response has an unexpected shape");
}
for (const t of tables) {
  if (payload.data[t].length !== payload.counts?.[t]) fail(`row count mismatch in ${t}`);
}
if (payload.data.card_state.length > payload.data.cards.length) fail("more card_state rows than cards");

mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = join(dir, `thinkcards-${stamp}.json`);
const tmp = `${target}.tmp`;
writeFileSync(tmp, text, { mode: 0o600 });
renameSync(tmp, target);
chmodSync(target, 0o600);

const old = readdirSync(dir)
  .filter((f) => /^thinkcards-.*\.json$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) unlinkSync(join(dir, f));

const c = payload.counts;
console.log(
  `backup ok: ${target}\n  decks ${c.decks}, cards ${c.cards}, card_state ${c.card_state}, revlog ${c.revlog}, session_log ${c.session_log}` +
    (old.length ? `\n  removed ${old.length} old backup(s)` : ""),
);
