import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseAddCardsRequest } from "./logic.ts";

// Deploy with --no-verify-jwt: callers authenticate with ADD_CARDS_TOKEN
// (a long random secret), not a Supabase JWT.
//
// Secrets (supabase secrets set): ADD_CARDS_TOKEN, OWNER_USER_ID.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.

const jsonResponse = (body: object, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedToken = Deno.env.get("ADD_CARDS_TOKEN");
  const ownerId = Deno.env.get("OWNER_USER_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!expectedToken || !ownerId || !supabaseUrl || !serviceRoleKey) {
    console.error("add-cards: missing server configuration");
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

  const parsed = parseAddCardsRequest(body);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, parsed.status);
  }

  // Nothing valid to write: report the per-card errors without touching the DB.
  if (parsed.cards.length === 0) {
    return jsonResponse(
      { deck_id: null, added: 0, skipped: [], errors: parsed.errors, dry_run: parsed.dryRun },
      200,
    );
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
    return jsonResponse({ error: "Failed to add cards" }, 500);
  }

  console.log(
    `add-cards: added=${data.added} skipped=${data.skipped.length} errors=${parsed.errors.length} dry_run=${parsed.dryRun}`,
  );

  return jsonResponse(
    {
      deck_id: data.deck_id,
      added: data.added,
      skipped: data.skipped,
      errors: parsed.errors,
      dry_run: parsed.dryRun,
    },
    200,
  );
});
