#!/usr/bin/env node
// Turn a backup JSON into SQL you can run in the Supabase SQL Editor to
// restore the data (e.g. into a new project).
//
//   node scripts/backup-to-sql.mjs <backup.json> [--owner <new-user-uuid>] > restore.sql
//
// Prerequisites: run all migrations, and create your user first (Dashboard ->
// Authentication -> Users); that creates the profile row. If the new user has a
// different id than the one in the backup, pass it with --owner so decks,
// revlog and session_log are re-assigned. Rows that already exist are left
// untouched (ON CONFLICT DO NOTHING). updated_at is reset by database
// triggers, so devices simply pull everything again on next sync.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--owner");
const ownerIndex = args.indexOf("--owner");
const owner = ownerIndex >= 0 ? args[ownerIndex + 1] : null;

if (!file) {
  console.error("usage: backup-to-sql.mjs <backup.json> [--owner <uuid>]");
  process.exit(1);
}
if (owner && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) {
  console.error("--owner must be a UUID");
  process.exit(1);
}

const { version, data } = JSON.parse(readFileSync(file, "utf8"));
if (version !== 1 || !data) {
  console.error("unsupported backup file");
  process.exit(1);
}

const literal = (rows) => `'${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb`;
const remap = (rows) => (owner ? rows.map((r) => ({ ...r, user_id: owner })) : rows);

// Parents before children. Cards re-use their deck, card_state its card.
const plan = [
  ["decks", remap(data.decks)],
  ["cards", data.cards],
  ["card_state", data.card_state],
  ["revlog", remap(data.revlog)],
  ["session_log", remap(data.session_log)],
];

const out = ["begin;"];
for (const [table, rows] of plan) {
  if (!rows.length) continue;
  out.push(
    `insert into ${table} select * from jsonb_populate_recordset(null::${table}, ${literal(rows)}) on conflict do nothing;`,
  );
}
out.push("commit;");
console.log(out.join("\n"));
