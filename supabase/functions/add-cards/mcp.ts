// Minimal stateless MCP server (Streamable HTTP, JSON responses only) exposing
// one tool: add_cards. Pure TypeScript so it can be unit tested with vitest.

export const SERVER_INFO = { name: "think-cards", version: "1.0.0" };
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS =
  "Adds English-expression flashcards to the user's ThinkCards deck. " +
  "Use add_cards only when the user asks to save expressions as cards.";

export const ADD_CARDS_TOOL = {
  name: "add_cards",
  description:
    "Save flashcards to the user's ThinkCards deck. Each card needs a `front` and a `back`. " +
    "Allowed HTML in both fields: p, b, strong, em, br, ul, li (everything else is stripped). " +
    "Cards whose `front` already exists in the deck are skipped, so repeating a call is safe. " +
    "Max 100 cards per call. Use dry_run to check for duplicates without saving. " +
    "The result says how many cards were added and which were skipped.",
  inputSchema: {
    type: "object",
    properties: {
      deck_name: {
        type: "string",
        description: 'Target deck. Created if it does not exist. Defaults to "English expressions".',
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

export type ToolOutcome = { status: number; body: Record<string, unknown> };
export type RunTool = (args: unknown) => Promise<ToolOutcome>;
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
      return rpcResult(id, { tools: [ADD_CARDS_TOOL] });
    case "tools/call": {
      if (params.name !== ADD_CARDS_TOOL.name) {
        return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      }
      try {
        const { text, isError } = formatToolResult(await runTool(params.arguments ?? {}));
        return rpcResult(id, { content: [{ type: "text", text }], isError });
      } catch {
        return rpcResult(id, {
          content: [{ type: "text", text: "Error: failed to add cards" }],
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
