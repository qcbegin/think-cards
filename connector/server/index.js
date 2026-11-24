#!/usr/bin/env node
// ThinkCards connector for Claude Desktop (MCP bundle, .mcpb).
//
// Claude Desktop runs this file and talks MCP to it over stdio
// (one JSON-RPC message per line). It forwards every message to the
// ThinkCards server (the add-cards Edge Function, /mcp route) with the
// token as a Bearer header, and writes the replies back.
//
// No dependencies: Node 18+ (fetch), which Claude Desktop provides.
// Config comes from the environment, filled in by Claude Desktop from the
// values the user entered when installing the bundle:
//   THINKCARDS_URL    MCP endpoint, e.g. https://<ref>.supabase.co/functions/v1/add-cards/mcp
//   THINKCARDS_TOKEN  the MCP_TOKEN secret

"use strict";

const URL_ = (process.env.THINKCARDS_URL || "").trim();
const TOKEN = (process.env.THINKCARDS_TOKEN || "").trim();
const TIMEOUT_MS = 60_000;

const log = (...args) => console.error("[thinkcards]", ...args);
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

const replyError = (message, code, text) => {
  if (message && typeof message === "object" && "id" in message && message.method) {
    send({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
  }
};

const forward = async (message) => {
  if (!URL_ || !TOKEN) {
    replyError(message, -32001, "ThinkCards connector is not configured: set the server URL and token in Claude's extension settings.");
    return;
  }

  let response;
  try {
    response = await fetch(URL_, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log("request failed:", error && error.name);
    replyError(message, -32002, "Could not reach the ThinkCards server. Check the internet connection and the server URL.");
    return;
  }

  if (response.status === 202 || response.status === 204) return;

  if (response.status === 401) {
    replyError(message, -32003, "ThinkCards rejected the token. Update it in Claude's extension settings.");
    return;
  }

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    log("non-JSON reply, status", response.status);
    replyError(message, -32004, `ThinkCards server error (HTTP ${response.status}).`);
    return;
  }

  // A JSON-RPC reply (or a batch of them) goes back as is.
  const isRpc = (m) => m && typeof m === "object" && m.jsonrpc === "2.0";
  if (Array.isArray(body) ? body.every(isRpc) : isRpc(body)) {
    send(body);
    return;
  }

  // Plain error bodies such as {"error": "..."}.
  replyError(message, -32004, `ThinkCards server error (HTTP ${response.status}).`);
};

// Handle lines in order so replies never overtake each other.
let queue = Promise.resolve();
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    queue = queue.then(() => forward(message)).catch((error) => log("unexpected:", error && error.message));
  }
});

process.stdin.on("end", () => {
  queue.finally(() => process.exit(0));
});

log("started", URL_ ? "" : "(no server URL configured)");
