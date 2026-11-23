import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseAddCardsRequest } from "./logic.ts";
import { handleMcpPayload } from "./mcp.ts";

// Deploy with --no-verify-jwt: callers authenticate with their own secrets,
// not a Supabase JWT.
//
//   POST /add-cards                 REST. Authorization: Bearer ADD_CARDS_TOKEN
//   POST /add-cards/mcp/<token>     MCP (Claude custom connector). <token> is
//                                   MCP_URL_TOKEN, since the connector form has
//                                   no auth fields; the secret lives in the URL.
//
// Secrets (supabase secrets set): ADD_CARDS_TOKEN, MCP_URL_TOKEN, OWNER_USER_ID.
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

// Shared by REST and MCP: validate, then write through add_cards_atomic.
const runAddCards = async (body: unknown): Promise<Outcome> => {
  const ownerId = Deno.env.get("OWNER_USER_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!ownerId || !supabaseUrl || !serviceRoleKey) {
    console.error("add-cards: missing server configuration");
    return { status: 500, body: { error: "Server configuration error" } };
  }

  const parsed = parseAddCardsRequest(body);
  if (!parsed.ok) {
    return { status: parsed.status, body: { error: parsed.error } };
  }

  // Nothing valid to write: report the per-card errors without touching the DB.
  if (parsed.cards.length === 0) {
    return {
      status: 200,
      body: { deck_id: null, added: 0, skipped: [], errors: parsed.errors, dry_run: parsed.dryRun },
    };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("add_cards_atomic", {
    p_owner: ownerId,
    p_deck_name: parsed.deckName,
    p_cards: parsed.cards,
    p_dry_run: parsed.dryRun,
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

const handleMcp = async (req: Request, urlToken: string): Promise<Response> => {
  const expected = Deno.env.get("MCP_URL_TOKEN");
  if (!expected) {
    console.error("add-cards: MCP_URL_TOKEN is not set");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }
  if (!urlToken || !(await tokensMatch(urlToken, expected))) {
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

  const reply = await handleMcpPayload(payload, runAddCards);
  return jsonResponse(reply.body as object | null, reply.status);
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

  const given = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
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
  const mcp = pathname.match(/\/mcp(?:\/([^/]*))?\/?$/);
  return mcp ? handleMcp(req, decodeURIComponent(mcp[1] ?? "")) : handleRest(req);
});
