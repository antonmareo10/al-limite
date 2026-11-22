// Al límite's MCP server (site/mcp-server.js): the protocol handshake, the tool list, and calls
// validated by the runtime's own validator. Run: node --test "tests/agentic/*.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";
import { McpServer, PROTOCOL_VERSION } from "../../site/mcp-server.js";
import { diskFetch } from "./support/fake_browser.mjs";

const SITE = new URL("../../site/", import.meta.url).href;
const server = new McpServer(SITE, diskFetch());
const rpc = (method, params, id = 1) => server.handleMessage({ jsonrpc: "2.0", id, method, params });

test("initialize, then the six read tools, all marked read-only", async () => {
  const init = await rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(init.result.protocolVersion, PROTOCOL_VERSION);
  assert.ok(init.result.capabilities.tools);
  assert.match(init.result.instructions, /not proof/);
  assert.equal(await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const list = await rpc("tools/list", {});
  assert.deepEqual(list.result.tools.map(t => t.name), ["look_up_body", "list_contracts_near_limit", "get_ranking", "get_national_overview", "get_method", "check_answer"]);
  assert.ok(list.result.tools.every(t => t.annotations.readOnlyHint && t.inputSchema.type === "object"));
});

test("a call returns the same data as the site's tools, as text and as structured content", async () => {
  const r = await rpc("tools/call", { name: "look_up_body", arguments: { query: "Ayuntamiento de Ourense" } });
  assert.equal(r.result.isError, false);
  assert.equal(r.result.structuredContent.body.id, "30985210142281");
  assert.deepEqual(JSON.parse(r.result.content[0].text), r.result.structuredContent);
  const check = await rpc("tools/call", { name: "check_answer", arguments: { answer: "It is fraud.", body_ids: ["30985210142281"] } });
  assert.equal(check.result.structuredContent.ok, false);
});

test("bad arguments are a readable tool error; unknown tools and methods are protocol errors", async () => {
  const bad = await rpc("tools/call", { name: "get_ranking", arguments: { rule: "everything" } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /^Invalid arguments/);
  const extra = await rpc("tools/call", { name: "get_ranking", arguments: { sql: "drop table" } });
  assert.equal(extra.result.isError, true);
  assert.equal((await rpc("tools/call", { name: "delete_everything", arguments: {} })).error.code, -32602);
  assert.equal((await rpc("resources/list", {})).error.code, -32601);
  assert.equal((await server.handleMessage({ id: 3, method: "tools/list" })).error.code, -32600);
});
