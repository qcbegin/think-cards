// Minimal stateless MCP server (Streamable HTTP, JSON responses only) for the
// ThinkCards deck: list, add, edit and delete cards, and set deck formats.
// Pure TypeScript so it can be unit tested with vitest.

import { FORMAT_RULES, MAX_LIST_LIMIT } from "./logic.ts";

export const SERVER_INFO = { name: "think-cards", version: "1.1.0" };
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS =
  "Manages the user's ThinkCards flashcards. Use add_cards when the user asks to save " +
  "expressions as cards. To tidy or reformat existing cards: list_decks, then list_cards " +
  "(page with offset), then update_cards (keeps review progress) or delete_cards. " +
  "Show the user the planned changes and get a yes before update_cards or delete_cards " +
  "on more than a few cards. Decks may have a card_format; follow it:\n- " +
  FORMAT_RULES.produce + "\n- " + FORMAT_RULES.recognize;

const FORMAT_HELP =
  "Decks can have a card_format (see list_decks). Cards that break it are rejected: " +
  FORMAT_RULES.produce + " " + FORMAT_RULES.recognize;

const CARD_FORMAT_SCHEMA = {
  type: "string",
  enum: ["produce", "recognize", "none"],
  description: 'Card layout rule for the deck. "none" removes it.',
};

export const ADD_CARDS_TOOL = {
  name: "add_cards",
  description:
    "Save flashcards to the user's ThinkCards deck. Each card needs a `front` and a `back`. " +
    "Allowed HTML in both fields: p, b, strong, em, br, ul, li (everything else is stripped). " +
    "Cards whose `front` already exists in the deck are skipped, so repeating a call is safe. " +
    "Max 100 cards per call. Use dry_run to check for duplicates without saving. " +
    "The result says how many cards were added and which were skipped. " +
    FORMAT_HELP,
  inputSchema: {
    type: "object",
    properties: {
      deck_name: {
        type: "string",
        description: 'Target deck. Created if it does not exist. Defaults to "English expressions".',
      },
      deck_format: {
        ...CARD_FORMAT_SCHEMA,
        description: "card_format for the deck if this call creates it. Ignored for existing decks.",
      },
      cards: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          properties: {
            front: { type: "string", description: "Front of the card (the prompt)." },
            back: { type: "string", description: "Back of the card (the answer). Not needed for cloze." },
            type: {
              type: "string",
              enum: ["basic", "cloze", "typing"],
              description: 'Card type. Defaults to "basic". Cloze fronts need {{c1::...}}.',
            },
          },
          required: ["front"],
        },
      },
      dry_run: { type: "boolean", description: "Only check and deduplicate; do not save." },
    },
    required: ["cards"],
  },
  annotations: {
    title: "Add flashcards",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const LIST_DECKS_TOOL = {
  name: "list_decks",
  description:
    "List the user's decks with card counts, card_format and speech language. " +
    "Call this before reorganising cards.",
  inputSchema: { type: "object", properties: {} },
  annotations: { title: "List decks", readOnlyHint: true, openWorldHint: false },
};

export const LIST_CARDS_TOOL = {
  name: "list_cards",
  description:
    "Read cards (id, deck, type, front, back, reps = times reviewed), oldest first. " +
    `Returns at most ${MAX_LIST_LIMIT} per call; page with offset until next_offset is null. ` +
    "Use the ids with update_cards or delete_cards.",
  inputSchema: {
    type: "object",
    properties: {
      deck_name: { type: "string", description: "Only this deck. Omit for all decks." },
      search: { type: "string", description: "Only cards whose front or back contains this text." },
      offset: { type: "integer", minimum: 0, description: "Skip this many cards. Default 0." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT, description: "Default 100." },
    },
  },
  annotations: { title: "Read flashcards", readOnlyHint: true, openWorldHint: false },
};

export const UPDATE_CARDS_TOOL = {
  name: "update_cards",
  description:
    "Edit existing cards in place: rewrite front/back, change type, or move to another deck " +
    "(the deck must exist; create it with configure_deck). Review progress is kept unless " +
    "reset_progress is true (use it when the card now asks something different, e.g. front and " +
    "back swapped). Only the fields you pass change. Max 100 per call. Same HTML rules as " +
    "add_cards. " + FORMAT_HELP,
  inputSchema: {
    type: "object",
    properties: {
      updates: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Card id from list_cards." },
            front: { type: "string" },
            back: { type: "string" },
            type: { type: "string", enum: ["basic", "cloze", "typing"] },
            deck_name: { type: "string", description: "Move the card to this deck." },
            reset_progress: { type: "boolean", description: "Make the card new again." },
          },
          required: ["id"],
        },
      },
    },
    required: ["updates"],
  },
  annotations: {
    title: "Edit flashcards",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const DELETE_CARDS_TOOL = {
  name: "delete_cards",
  description:
    "Delete cards by id (max 100 per call), e.g. duplicates or cards being replaced by " +
    "add_cards. Prefer update_cards when a card only needs rewriting, since that keeps " +
    "its review history.",
  inputSchema: {
    type: "object",
    properties: {
      ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
    },
    required: ["ids"],
  },
  annotations: {
    title: "Delete flashcards",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const CONFIGURE_DECK_TOOL = {
  name: "configure_deck",
  description:
    "Create a deck, or change an existing deck's card_format or speech language. " +
    "Only the fields you pass change. " + FORMAT_HELP,
  inputSchema: {
    type: "object",
    properties: {
      deck_name: { type: "string" },
      card_format: CARD_FORMAT_SCHEMA,
      language: {
        type: "string",
        description: 'Text-to-speech language code, e.g. "en", "pt-PT". "none" turns it off.',
      },
    },
    required: ["deck_name"],
  },
  annotations: {
    title: "Configure deck",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const TOOLS = [
  LIST_DECKS_TOOL,
  LIST_CARDS_TOOL,
  ADD_CARDS_TOOL,
  UPDATE_CARDS_TOOL,
  DELETE_CARDS_TOOL,
  CONFIGURE_DECK_TOOL,
];
export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export type ToolOutcome = { status: number; body: Record<string, unknown> };
export type ToolText = { text: string; isError: boolean };
// Runs one tool by name and returns the text Claude sees.
export type RunTool = (name: string, args: unknown) => Promise<ToolText>;
export type McpReply = { status: number; body: unknown | null };

type JsonRpcId = string | number | null;

const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Turn the add-cards outcome into a short message Claude can relay.
export const formatToolResult = (outcome: ToolOutcome): { text: string; isError: boolean } => {
  const { status, body } = outcome;

  if (status !== 200) {
    return { text: `Error: ${String(body.error ?? "request failed")}`, isError: true };
  }

  const added = Number(body.added ?? 0);
  const skipped = Array.isArray(body.skipped) ? (body.skipped as string[]) : [];
  const errors = Array.isArray(body.errors)
    ? (body.errors as { index: number; message: string }[])
    : [];
  const dry = body.dry_run === true;

  const lines = [
    dry
      ? `Dry run: ${added} card(s) would be added, ${skipped.length} duplicate(s) skipped.`
      : `Added ${added} card(s), skipped ${skipped.length} duplicate(s).`,
  ];
  if (skipped.length) lines.push(`Skipped (already in deck): ${skipped.join(" | ")}`);
  if (errors.length) {
    lines.push(
      `Rejected ${errors.length} invalid card(s): ` +
        errors.map((e) => `#${e.index + 1} ${e.message}`).join("; "),
    );
  }

  return { text: lines.join("\n"), isError: added === 0 && errors.length > 0 && skipped.length === 0 };
};

const handleOne = async (message: unknown, runTool: RunTool): Promise<unknown | null> => {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return rpcError(null, -32600, "Invalid Request");
  }

  const hasId = "id" in message && message.id !== undefined;
  const id = (hasId ? message.id : null) as JsonRpcId;

  // Notifications and client responses need no reply.
  if (typeof message.method !== "string") return null;
  if (!hasId) return null;

  const params = isRecord(message.params) ? message.params : {};

  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(params.name);
      if (!TOOL_NAMES.has(name)) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const { text, isError } = await runTool(name, params.arguments ?? {});
        return rpcResult(id, { content: [{ type: "text", text }], isError });
      } catch {
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${name} failed` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
};

export const handleMcpPayload = async (payload: unknown, runTool: RunTool): Promise<McpReply> => {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return { status: 400, body: rpcError(null, -32600, "Invalid Request") };
    const replies = (await Promise.all(payload.map((m) => handleOne(m, runTool)))).filter(
      (r) => r !== null,
    );
    return replies.length ? { status: 200, body: replies } : { status: 202, body: null };
  }

  const reply = await handleOne(payload, runTool);
  if (reply === null) return { status: 202, body: null };

  const invalid = isRecord(reply) && isRecord(reply.error) && reply.error.code === -32600;
  return { status: invalid ? 400 : 200, body: reply };
};
