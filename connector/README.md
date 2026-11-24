# ThinkCards connector bundle (.mcpb)

An MCP bundle for Claude Desktop. `server/index.js` is a dependency-free
stdio proxy: it forwards MCP messages to the `add-cards` Edge Function
(`/functions/v1/add-cards/mcp`) with the token as a Bearer header.

The app's "Generate cards → Claude connector" page builds `thinkcards.mcpb`
in the browser from these files and fills in your server URL. Open the file
(or drag it into Claude Desktop → Settings → Extensions) and enter the token
(`MCP_TOKEN`) when asked; Claude keeps it in the OS keychain.

To pack by hand instead: `npx @anthropic-ai/mcpb pack connector` and enter the
URL at install time.

Claude Desktop only. On claude.ai and the mobile apps, add a custom connector
with the URL and an `Authorization: Bearer <token>` header.
