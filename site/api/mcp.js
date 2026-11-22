// Vercel function: Al límite's MCP server at /api/mcp (see ../mcp-server.js).
// Stateless and read-only; CORS is open because the data is public.
import { McpServer } from "../mcp-server.js";

let server = null;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    // No server-to-client stream: every answer comes back on its own POST.
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Use POST with a JSON-RPC message (MCP Streamable HTTP)." } });
  }
  let msg = req.body;
  if (typeof msg === "string") {
    try { msg = JSON.parse(msg); } catch { return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  }
  if (Array.isArray(msg)) return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported." } });
  const proto = req.headers["x-forwarded-proto"] || "https";
  const base = `${proto}://${req.headers.host}/`;
  if (!server || server.tools.siteUrl !== base) server = new McpServer(base);
  try {
    const out = await server.handleMessage(msg);
    if (out === null) return res.status(202).end();
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "Internal error" } });
  }
}
