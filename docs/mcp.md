# Thoughtful as an MCP server

Endpoint: `http://127.0.0.1:4317/mcp` (Streamable HTTP, protocol 2025-11-25, stateless, JSON responses). Started by `npm start` (your Bee) or `npm run sample` (invented household).

| Client | Setup |
|---|---|
| mcp-voice-host (Echo Show / phone / Dot simulator, open source) | `npx github:blanco1er/mcp-voice-host --server http://127.0.0.1:4317/mcp`, then "what's on thoughtful tonight" |
| Claude Code | `claude mcp add --transport http thoughtful http://127.0.0.1:4317/mcp` (+ `skill/thoughtful/SKILL.md`) |
| MCP Inspector | `npx @modelcontextprotocol/inspector@2.11.0 --cli http://127.0.0.1:4317/mcp --transport http --method tools/list` |

Tools: `tonight_card` (MCP Apps card `ui://thoughtful/tonight-<hash>.html`), `answer_note`, `remind_me`, `mark_done`, `person_brief`, `forget_note`, and two app-only tools used by the card (`gift_ideas`, `reveal_card`, `_meta.ui.visibility: ["app"]`).

Each result: `content[0]` is a sentence a voice can say (never an id, never a gift); `content[1]` carries ids for the assistant ("do not read aloud"); `structuredContent` feeds the card.

Security: the server listens on 127.0.0.1; browser requests from another origin are refused (403). On a LAN (`--host 0.0.0.0`) every request needs the pairing token printed at start.

Checked on 19 Oct 2026 with the official MCP Inspector CLI 2.11.0 (tools/list, tools/call `tonight_card`) and in mcp-voice-host (Echo Show 15 and 8, light and dark).
