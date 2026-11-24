import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyFormat,
  parseAddCardsRequest,
  parseConfigureDeckRequest,
  parseDeleteCardsRequest,
  parseListCardsRequest,
  parseUpdateCardsRequest,
  resolveEdit,
  type CardFormat,
  type EditError,
  type ExistingCard,
  type ResolvedEdit,
} from "./logic.ts";
import { formatToolResult, handleMcpPayload, type ToolText } from "./mcp.ts";

// Deploy with --no-verify-jwt: callers authenticate with their own secrets,
// not a Supabase JWT.
//
//   POST /add-cards       REST.  Authorization: Bearer ADD_CARDS_TOKEN
//   POST /add-cards/mcp   MCP (Claude custom connector, "Request headers").
//                         Authorization: Bearer MCP_TOKEN
//   GET  /add-cards/export  Read-only JSON backup of the owner's data.
//                         Authorization: Bearer BACKUP_TOKEN
//
// Separate tokens so each can be rotated on its own and the write tokens
// never grant read access to everything.
// Secrets (supabase secrets set): ADD_CARDS_TOKEN, MCP_TOKEN, BACKUP_TOKEN,
// OWNER_USER_ID.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.

const jsonResponse = (body: object | null, status: number) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? undefined : { "Content-Type": "application/json" },
  });

const sha256 = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

// Compare digests so the check takes the same time wherever the strings differ.
const tokensMatch = async (given: string, expected: string): Promise<boolean> => {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

type Outcome = { status: number; body: Record<string, unknown> };

const makeAdmin = (url: string, key: string) =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
type Admin = ReturnType<typeof makeAdmin>;
type Ctx = { admin: Admin; ownerId: string };

const serverContext = (): Ctx | null => {
  const ownerId = Deno.env.get("OWNER_USER_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!ownerId || !supabaseUrl || !serviceRoleKey) {
    console.error("add-cards: missing server configuration");
    return null;
  }
  return { admin: makeAdmin(supabaseUrl, serviceRoleKey), ownerId };
};

type DeckRow = {
  id: string;
  name: string;
  parent_id: string | null;
  card_format: CardFormat | null;
  language: string | null;
  created_at: string;
};

const liveDecks = async ({ admin, ownerId }: Ctx): Promise<DeckRow[]> => {
  const { data, error } = await admin
    .from("decks")
    .select("id, name, parent_id, card_format, language, created_at")
    .eq("user_id", ownerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`decks: ${error.code}`);
  return data as DeckRow[];
};

// Same rule as add_cards_atomic: the oldest live deck with that name.
const deckByName = (decks: DeckRow[], name: string): DeckRow | undefined =>
  decks.find((d) => d.name === name);

// Shared by REST and MCP: validate, then write through add_cards_atomic.
const runAddCards = async (body: unknown): Promise<Outcome> => {
  const ctx = serverContext();
  if (!ctx) return { status: 500, body: { error: "Server configuration error" } };

  const raw = parseAddCardsRequest(body);
  if (!raw.ok) {
    return { status: raw.status, body: { error: raw.error } };
  }

  let format: CardFormat | null;
  try {
    const existing = deckByName(await liveDecks(ctx), raw.deckName);
    format = existing ? existing.card_format : raw.deckFormat;
  } catch (error) {
    console.error("add-cards: deck lookup failed", (error as Error).message);
    return { status: 500, body: { error: "Failed to add cards" } };
  }
  const parsed = { ...raw, ...applyFormat(raw, format) };

  // Nothing valid to write: report the per-card errors without touching the DB.
  if (parsed.cards.length === 0) {
    return {
      status: 200,
      body: { deck_id: null, added: 0, skipped: [], errors: parsed.errors, dry_run: parsed.dryRun },
    };
  }

  const { data, error } = await ctx.admin.rpc("add_cards_atomic", {
    p_owner: ctx.ownerId,
    p_deck_name: parsed.deckName,
    p_cards: parsed.cards,
    p_dry_run: parsed.dryRun,
    p_card_format: parsed.deckFormat,
  });

  if (error) {
    // Log the code only: messages may echo card content.
    console.error("add-cards: rpc failed", error.code);
    return { status: 500, body: { error: "Failed to add cards" } };
  }

  console.log(
    `add-cards: added=${data.added} skipped=${data.skipped.length} errors=${parsed.errors.length} dry_run=${parsed.dryRun}`,
  );

  return {
    status: 200,
    body: {
      deck_id: data.deck_id,
      added: data.added,
      skipped: data.skipped,
      errors: parsed.errors,
      dry_run: parsed.dryRun,
    },
  };
};


// ---------------------------------------------------------------------------
// MCP-only tools. Each returns the text Claude sees. Logs carry counts and
// error codes only, never card content.
// ---------------------------------------------------------------------------

const textResult = (value: unknown): ToolText => ({
  text: typeof value === "string" ? value : JSON.stringify(value, null, 1),
  isError: false,
});
const toolError = (message: string): ToolText => ({ text: `Error: ${message}`, isError: true });

const runListDecks = async (ctx: Ctx): Promise<ToolText> => {
  const decks = await liveDecks(ctx);
  const counts = await Promise.all(
    decks.map(async (d) => {
      const { count, error } = await ctx.admin
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("deck_id", d.id)
        .is("deleted_at", null);
      if (error) throw new Error(`cards: ${error.code}`);
      return count ?? 0;
    }),
  );
  const byId = new Map(decks.map((d) => [d.id, d.name]));
  return textResult({
    decks: decks.map((d, i) => ({
      name: d.name,
      parent: d.parent_id ? (byId.get(d.parent_id) ?? null) : null,
      cards: counts[i],
      card_format: d.card_format,
      language: d.language,
    })),
  });
};

// PostgREST `or` filter values: quote and escape so commas etc. are literal.
const ilikeValue = (text: string): string =>
  `"*${text.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[%_*]/g, "")}*"`;

const runListCards = async (ctx: Ctx, args: unknown): Promise<ToolText> => {
  const req = parseListCardsRequest(args);
  if (!req.ok) return toolError(req.error);

  const decks = await liveDecks(ctx);
  let deckIds = decks.map((d) => d.id);
  if (req.deckName) {
    const deck = deckByName(decks, req.deckName);
    if (!deck) return toolError(`deck not found: ${req.deckName}`);
    deckIds = [deck.id];
  }
  if (!deckIds.length) return textResult({ total: 0, offset: 0, next_offset: null, cards: [] });

  let query = ctx.admin
    .from("cards")
    .select("id, deck_id, type, front, back, created_at, card_state(reps)", { count: "exact" })
    .in("deck_id", deckIds)
    .is("deleted_at", null);
  if (req.search) {
    const v = ilikeValue(req.search);
    query = query.or(`front.ilike.${v},back.ilike.${v}`);
  }
  const { data, count, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(req.offset, req.offset + req.limit - 1);
  if (error) throw new Error(`cards: ${error.code}`);

  const names = new Map(decks.map((d) => [d.id, d.name]));
  const rows = (data ?? []) as (ExistingCard & { card_state: { reps: number }[] | { reps: number } | null })[];
  const total = count ?? rows.length;
  const next = req.offset + rows.length;

  return textResult({
    total,
    offset: req.offset,
    next_offset: next < total ? next : null,
    cards: rows.map((c) => {
      const state = Array.isArray(c.card_state) ? c.card_state[0] : c.card_state;
      return {
        id: c.id,
        deck: names.get(c.deck_id),
        type: c.type,
        front: c.front,
        back: c.back,
        reps: state?.reps ?? 0,
      };
    }),
  });
};

const runUpdateCards = async (ctx: Ctx, args: unknown): Promise<ToolText> => {
  const req = parseUpdateCardsRequest(args);
  if (!req.ok) return toolError(req.error);

  const errors: EditError[] = [...req.errors];
  const rows: ResolvedEdit[] = [];

  if (req.edits.length) {
    const decks = await liveDecks(ctx);
    const deckById = new Map(decks.map((d) => [d.id, d]));
    const { data, error } = await ctx.admin
      .from("cards")
      .select("id, deck_id, type, front, back")
      .in("id", req.edits.map((e) => e.id))
      .in("deck_id", decks.map((d) => d.id))
      .is("deleted_at", null);
    if (error) throw new Error(`cards: ${error.code}`);
    const current = new Map((data as ExistingCard[]).map((c) => [c.id, c]));

    for (const edit of req.edits) {
      const card = current.get(edit.id);
      if (!card) {
        errors.push({ id: edit.id, message: "card not found" });
        continue;
      }
      const target = edit.deckName ? deckByName(decks, edit.deckName) : deckById.get(card.deck_id);
      if (!target) {
        errors.push({ id: edit.id, message: `deck not found: ${edit.deckName} (create it with configure_deck)` });
        continue;
      }
      const resolved = resolveEdit(edit, card, target);
      if (resolved.ok) rows.push(resolved.row);
      else errors.push({ id: edit.id, message: resolved.message });
    }
  }

  let updated = 0;
  if (rows.length) {
    const { data, error } = await ctx.admin.rpc("update_cards_atomic", {
      p_owner: ctx.ownerId,
      p_updates: rows,
    });
    if (error) throw new Error(`update_cards_atomic: ${error.code}`);
    updated = data.updated;
    errors.push(...(data.errors as EditError[]));
  }

  console.log(`add-cards: update_cards updated=${updated} errors=${errors.length}`);
  const lines = [`Updated ${updated} card(s).`];
  if (errors.length) {
    lines.push(`Not updated (${errors.length}): ` + errors.map((e) => `${e.id} ${e.message}`).join("; "));
  }
  return { text: lines.join("\n"), isError: updated === 0 && errors.length > 0 };
};

const runDeleteCards = async (ctx: Ctx, args: unknown): Promise<ToolText> => {
  const req = parseDeleteCardsRequest(args);
  if (!req.ok) return toolError(req.error);

  const { data, error } = await ctx.admin.rpc("delete_cards_atomic", {
    p_owner: ctx.ownerId,
    p_ids: req.ids,
  });
  if (error) throw new Error(`delete_cards_atomic: ${error.code}`);

  const notFound = (data.not_found ?? []) as string[];
  console.log(`add-cards: delete_cards deleted=${data.deleted} not_found=${notFound.length}`);
  const lines = [`Deleted ${data.deleted} card(s).`];
  if (notFound.length) lines.push(`Not found (already deleted or not yours): ${notFound.join(", ")}`);
  return { text: lines.join("\n"), isError: data.deleted === 0 };
};

const runConfigureDeck = async (ctx: Ctx, args: unknown): Promise<ToolText> => {
  const req = parseConfigureDeckRequest(args);
  if (!req.ok) return toolError(req.error);

  const { data, error } = await ctx.admin.rpc("configure_deck_atomic", {
    p_owner: ctx.ownerId,
    p_deck_name: req.deckName,
    p_changes: req.changes,
  });
  if (error) throw new Error(`configure_deck_atomic: ${error.code}`);

  console.log(`add-cards: configure_deck created=${data.created}`);
  return textResult({
    deck: data.name,
    created: data.created,
    card_format: data.card_format,
    language: data.language,
  });
};

const runTool = async (name: string, args: unknown): Promise<ToolText> => {
  if (name === "add_cards") return formatToolResult(await runAddCards(args));

  const ctx = serverContext();
  if (!ctx) return toolError("Server configuration error");

  try {
    switch (name) {
      case "list_decks":
        return await runListDecks(ctx);
      case "list_cards":
        return await runListCards(ctx, args);
      case "update_cards":
        return await runUpdateCards(ctx, args);
      case "delete_cards":
        return await runDeleteCards(ctx, args);
      case "configure_deck":
        return await runConfigureDeck(ctx, args);
      default:
        return toolError(`unknown tool ${name}`);
    }
  } catch (error) {
    console.error(`add-cards: ${name} failed`, (error as Error).message);
    return toolError(`${name} failed`);
  }
};

const bearer = (req: Request): string =>
  (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

const handleMcp = async (req: Request): Promise<Response> => {
  const expected = Deno.env.get("MCP_TOKEN");
  if (!expected) {
    console.error("add-cards: MCP_TOKEN is not set");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }
  const given = bearer(req);
  if (!given || !(await tokensMatch(given, expected))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Stateless server: no SSE stream to open.
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }

  const reply = await handleMcpPayload(payload, runTool);
  return jsonResponse(reply.body as object | null, reply.status);
};


const PAGE = 1000;
const ID_CHUNK = 200;

type Row = Record<string, unknown>;

type Where = { column: string; eq: string } | { column: string; in: string[] };

// PostgREST caps responses (1000 rows by default), so page through.
const fetchAll = async (admin: Admin, table: string, where: Where): Promise<Row[]> => {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const base = admin.from(table).select("*");
    const filtered = "eq" in where ? base.eq(where.column, where.eq) : base.in(where.column, where.in);
    const { data, error } = await filtered
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.code}`);
    rows.push(...(data as Row[]));
    if (!data || data.length < PAGE) return rows;
  }
};

const fetchByIds = async (
  admin: Admin,
  table: string,
  column: string,
  ids: string[],
): Promise<Row[]> => {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    rows.push(...(await fetchAll(admin, table, { column, in: ids.slice(i, i + ID_CHUNK) })));
  }
  return rows;
};

const handleExport = async (req: Request): Promise<Response> => {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expected = Deno.env.get("BACKUP_TOKEN");
  const ownerId = Deno.env.get("OWNER_USER_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!expected || !ownerId || !supabaseUrl || !serviceRoleKey) {
    console.error("add-cards: export is not configured");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const given = bearer(req);
  if (!given || !(await tokensMatch(given, expected))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const admin = makeAdmin(supabaseUrl, serviceRoleKey);

  try {
    const profiles = await fetchAll(admin, "profiles", { column: "id", eq: ownerId });
    const decks = await fetchAll(admin, "decks", { column: "user_id", eq: ownerId });
    const cards = await fetchByIds(admin, "cards", "deck_id", decks.map((d) => d.id as string));
    const card_state = await fetchByIds(admin, "card_state", "card_id", cards.map((c) => c.id as string));
    const revlog = await fetchAll(admin, "revlog", { column: "user_id", eq: ownerId });
    const session_log = await fetchAll(admin, "session_log", { column: "user_id", eq: ownerId });

    const data = { profiles, decks, cards, card_state, revlog, session_log };
    const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
    console.log(`add-cards: export ${JSON.stringify(counts)}`);

    return jsonResponse({ version: 1, exported_at: new Date().toISOString(), counts, data }, 200);
  } catch (error) {
    // Log table and code only: never row content.
    console.error("add-cards: export failed", (error as Error).message);
    return jsonResponse({ error: "Export failed" }, 500);
  }
};

const handleRest = async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedToken = Deno.env.get("ADD_CARDS_TOKEN");
  if (!expectedToken) {
    console.error("add-cards: ADD_CARDS_TOKEN is not set");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const given = bearer(req);
  if (!given || !(await tokensMatch(given, expectedToken))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const outcome = await runAddCards(body);
  return jsonResponse(outcome.body, outcome.status);
};

Deno.serve((req) => {
  const { pathname } = new URL(req.url);
  if (/\/mcp\/?$/.test(pathname)) return handleMcp(req);
  if (/\/export\/?$/.test(pathname)) return handleExport(req);
  return handleRest(req);
});
