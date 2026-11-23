import { describe, expect, it, vi } from "vitest";
import {
  ADD_CARDS_TOOL,
  formatToolResult,
  handleMcpPayload,
  type McpReply,
} from "../../../supabase/functions/add-cards/mcp";

type RpcBody = {
  id: number | null;
  result: {
    protocolVersion: string;
    capabilities: { tools?: unknown };
    serverInfo: { name: string };
    tools: unknown[];
    isError: boolean;
    content: { text: string }[];
  };
  error: { code: number };
};

const body = (reply: McpReply) => reply.body as RpcBody;

const okRun = vi.fn(async () => ({
  status: 200,
  body: { deck_id: "d", added: 2, skipped: ["dup"], errors: [], dry_run: false },
}));

const rpc = (method: string, params?: unknown, id: number | null = 1) => ({
  jsonrpc: "2.0",
  ...(id === null ? {} : { id }),
  method,
  ...(params === undefined ? {} : { params }),
});

describe("handleMcpPayload", () => {
  it("answers initialize and echoes a supported protocol version", async () => {
    const r = await handleMcpPayload(rpc("initialize", { protocolVersion: "2025-03-26" }), okRun);
    expect(r.status).toBe(200);
    const result = body(r).result;
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("think-cards");
  });

  it("falls back to the latest supported version for unknown ones", async () => {
    const r = await handleMcpPayload(rpc("initialize", { protocolVersion: "1999-01-01" }), okRun);
    expect(body(r).result.protocolVersion).toBe("2025-06-18");
  });

  it("returns 202 with no body for notifications", async () => {
    const r = await handleMcpPayload(rpc("notifications/initialized", undefined, null), okRun);
    expect(r).toEqual({ status: 202, body: null });
  });

  it("answers ping and lists exactly one tool", async () => {
    expect((await handleMcpPayload(rpc("ping"), okRun)).body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    const list = await handleMcpPayload(rpc("tools/list"), okRun);
    expect(body(list).result.tools).toEqual([ADD_CARDS_TOOL]);
    expect(ADD_CARDS_TOOL.inputSchema.required).toEqual(["cards"]);
  });

  it("runs the tool and reports added/skipped in text", async () => {
    const args = { cards: [{ front: "a", back: "b" }] };
    const r = await handleMcpPayload(rpc("tools/call", { name: "add_cards", arguments: args }), okRun);
    expect(okRun).toHaveBeenCalledWith(args);
    const result = body(r).result;
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Added 2 card(s), skipped 1 duplicate(s).");
  });

  it("flags tool failures with isError instead of a protocol error", async () => {
    const failing = vi.fn(async () => ({ status: 400, body: { error: "cards must be a non-empty array" } }));
    const r = await handleMcpPayload(rpc("tools/call", { name: "add_cards", arguments: {} }), failing);
    const result = body(r).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cards must be a non-empty array");

    const throwing = vi.fn(async () => {
      throw new Error("db down with secret details");
    });
    const t = await handleMcpPayload(rpc("tools/call", { name: "add_cards", arguments: {} }), throwing);
    expect(body(t).result.isError).toBe(true);
    expect(JSON.stringify(t.body)).not.toContain("secret details");
  });

  it("rejects unknown tools and methods", async () => {
    const tool = await handleMcpPayload(rpc("tools/call", { name: "delete_everything" }), okRun);
    expect(body(tool).error.code).toBe(-32602);
    const method = await handleMcpPayload(rpc("resources/list"), okRun);
    expect(body(method).error.code).toBe(-32601);
  });

  it("rejects malformed payloads", async () => {
    for (const bad of ["x", 5, null, { id: 1, method: "ping" }, []]) {
      const r = await handleMcpPayload(bad, okRun);
      expect(r.status).toBe(400);
    }
  });

  it("handles batches, skipping notifications", async () => {
    const r = await handleMcpPayload(
      [rpc("ping", undefined, 1), rpc("notifications/initialized", undefined, null), rpc("tools/list", undefined, 2)],
      okRun,
    );
    expect(r.status).toBe(200);
    expect((r.body as RpcBody[]).map((x) => x.id)).toEqual([1, 2]);
  });
});

describe("formatToolResult", () => {
  it("describes dry runs, skips and rejected cards", () => {
    const { text, isError } = formatToolResult({
      status: 200,
      body: {
        added: 1,
        skipped: ["x"],
        errors: [{ index: 2, message: "back is empty" }],
        dry_run: true,
      },
    });
    expect(text).toContain("Dry run: 1 card(s) would be added, 1 duplicate(s) skipped.");
    expect(text).toContain("Skipped (already in deck): x");
    expect(text).toContain("#3 back is empty");
    expect(isError).toBe(false);
  });

  it("marks all-invalid input as an error", () => {
    const { isError } = formatToolResult({
      status: 200,
      body: { added: 0, skipped: [], errors: [{ index: 0, message: "front is empty" }] },
    });
    expect(isError).toBe(true);
  });
});
