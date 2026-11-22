/* Al límite — the same six read tools as a Model Context Protocol (MCP) server, for agents that
   are not in a browser (desktop assistants, other agent frameworks) and for agent networks that
   name an MCP URL. Stateless JSON-RPC over HTTP POST (MCP Streamable HTTP, protocol 2025-06-18),
   read-only, no authentication: it serves public data the site already shows.
   The arguments are validated with the browser runtime's own validator (runtime/actions.js), so
   a call that the site's agents could not make is refused here too.
   api/mcp.js is the HTTP wrapper on Vercel; tests call handleMessage directly. */
import { ActionRegistry } from "./runtime/actions.js";
import { AgentTools } from "./agent-tools.js";
import { SiteData } from "./core.js";

export const PROTOCOL_VERSION = "2025-06-18";
const SERVER = { name: "al-limite", title: "Al límite: Spanish minor contracts just under the legal limit", version: "1.0.0" };
const INSTRUCTIONS = "Read-only tools over Al límite's published data on Spanish minor public contracts (2023-2025). Every figure comes with its 95% interval and level. It is a statistical indicator, not proof of wrongdoing: never present it as an accusation, and never name awardees. Use check_answer on a draft before you show it.";

export class McpServer {
  /** base: the site's public URL, with a slash at the end; fetchImpl: for tests. */
  constructor(base, fetchImpl = null) {
    this.tools = new AgentTools(new SiteData(base, fetchImpl), base);
    this.registry = new ActionRegistry();
    this.scope = { base: base.replace(/\/$/, ""), network: "al_limite_guide" };
    this.refs = new Map();
    for (const d of this.tools.reads()) this.refs.set(d.name, this.registry.register(this.scope, d));
  }

  list() {
    return this.registry.catalog(this.scope).map(e => ({
      name: e.name,
      title: e.name.replace(/_/g, " "),
      description: e.description,
      inputSchema: e.inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    }));
  }

  async call(name, args) {
    const ref = this.refs.get(name);
    if (!ref) return { error: { code: -32602, message: `Unknown tool: ${name}` } };
    let plan;
    try {
      plan = this.registry.prepare({ kind: "action", action: ref, arguments: args || {} });
    } catch (e) {
      // A schema error is a tool error the model can read and fix, not a protocol error.
      return { result: { content: [{ type: "text", text: `Invalid arguments: ${e.message}` }], isError: true } };
    }
    const [receipt] = await this.registry.execute(plan, async () => true, `mcp-${Date.now()}`);
    if (receipt.status !== "succeeded") {
      return { result: { content: [{ type: "text", text: `The tool failed: ${receipt.error || receipt.status}` }], isError: true } };
    }
    const r = receipt.result;
    return { result: { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r, isError: r && r.ok === false } };
  }

  /**
   * Answer one JSON-RPC message. Returns the response object, or null for a notification.
   */
  async handleMessage(msg) {
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code, message } });
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid request");
    const isNotification = msg.id === undefined;
    switch (msg.method) {
      case "initialize":
        return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: this.list() });
      case "tools/call": {
        const p = msg.params || {};
        const out = await this.call(p.name, p.arguments);
        return out.error ? fail(out.error.code, out.error.message) : reply(out.result);
      }
      default:
        return isNotification ? null : fail(-32601, `Method not found: ${msg.method}`);
    }
  }
}
