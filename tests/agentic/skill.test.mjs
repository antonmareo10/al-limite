// The Agent Skill for the MCP server (site/skills/al-limite-mcp/SKILL.md): its frontmatter follows the
// Agent Skills specification (https://agentskills.io/specification), it documents exactly the tools the
// server lists, and every example in it is real: each request runs against the published data and each
// result excerpt must match the server's output. Run: node --test "tests/agentic/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { McpServer } from "../../site/mcp-server.js";
import { diskFetch } from "./support/fake_browser.mjs";

const SITE = new URL("../../site/", import.meta.url);
const DIR = "al-limite-mcp";
const skill = (await readFile(new URL(`skills/${DIR}/SKILL.md`, SITE), "utf8")).replace(/\r\n/g, "\n");
const server = new McpServer(SITE.href, diskFetch());

/** The frontmatter as { key: value, metadata: { key: value } } (the subset of YAML the spec uses). */
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md must start with YAML frontmatter");
  const out = {};
  let map = null;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\s*)([A-Za-z][\w-]*):(?: (.*))?$/);
    assert.ok(kv, `frontmatter line not understood: ${line}`);
    const [, indent, key, raw = ""] = kv;
    const value = raw.replace(/^"(.*)"$/, "$1");
    if (indent) { assert.ok(map, `indented key outside a map: ${key}`); map[key] = value; continue; }
    if (raw === "") { map = out[key] = {}; continue; }
    map = null;
    out[key] = value;
  }
  return out;
}

const jsonBlocks = text => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map(b => JSON.parse(b[1]));

/** True when every key and array element in `want` is equal in `got` (extra fields in `got` are fine). */
function contains(got, want, path = "result") {
  if (Array.isArray(want)) {
    assert.ok(Array.isArray(got) && got.length >= want.length, `${path}: expected at least ${want.length} items`);
    want.forEach((w, i) => contains(got[i], w, `${path}[${i}]`));
  } else if (want && typeof want === "object") {
    assert.ok(got && typeof got === "object", `${path}: expected an object`);
    for (const k of Object.keys(want)) contains(got[k], want[k], `${path}.${k}`);
  } else {
    assert.deepEqual(got, want, `${path} differs from the server's output`);
  }
}

test("the frontmatter follows the Agent Skills specification", () => {
  const fm = frontmatter(skill);
  assert.deepEqual(Object.keys(fm).filter(k => !["name", "description", "license", "compatibility", "metadata", "allowed-tools"].includes(k)), []);
  assert.match(fm.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(fm.name.length <= 64);
  assert.equal(fm.name, DIR, "name must match the skill's directory");
  assert.ok(fm.description.length >= 1 && fm.description.length <= 1024, `description is ${fm.description.length} characters`);
  assert.ok(!fm.compatibility || fm.compatibility.length <= 500);
  assert.ok(Object.values(fm.metadata).every(v => typeof v === "string" && v.length));
  assert.equal(fm.metadata.endpoint, "https://al-limite-agent.vercel.app/api/mcp");
  assert.ok(skill.split("\n").length < 500, "keep SKILL.md under 500 lines");
});

test("it documents exactly the tools the server lists, with every allowed value", async () => {
  const { result } = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const documented = [...skill.matchAll(/^### `([a-z_]+)`$/gm)].map(m => m[1]);
  assert.deepEqual(documented, result.tools.map(t => t.name));
  for (const t of result.tools) {
    for (const [arg, schema] of Object.entries(t.inputSchema.properties)) {
      assert.ok(skill.includes(`\`${arg}\``), `${t.name}.${arg} is not documented`);
      for (const v of schema.enum || []) assert.ok(skill.includes(`\`${v}\``), `${t.name}.${arg} value ${v} is not documented`);
    }
  }
});

test("every example request runs, and every result excerpt matches the server's output", async () => {
  const blocks = jsonBlocks(skill);
  let requests = 0, excerpts = 0;
  for (let i = 0; i < blocks.length; i++) {
    const req = blocks[i];
    if (req.jsonrpc !== "2.0") continue;
    requests++;
    const res = await server.handleMessage(req);
    assert.equal(res.error, undefined, `example ${req.id} is a protocol error`);
    const next = blocks[i + 1];
    if (next && next.jsonrpc === undefined) {
      contains(res.result.structuredContent, next, `example ${req.id}`);
      assert.equal(res.result.isError, next.ok === false, `example ${req.id}: isError`);
      excerpts++;
    }
  }
  assert.ok(requests >= 6 && excerpts === requests, `${requests} requests, ${excerpts} excerpts`);
  const curl = skill.match(/-d '(\{.*\})'/);
  assert.ok(curl, "the curl example is missing");
  assert.equal((await server.handleMessage(JSON.parse(curl[1]))).result.isError, false);
});

test("the published skill is readable from other origins", async () => {
  const vercel = JSON.parse(await readFile(new URL("vercel.json", SITE), "utf8"));
  const rule = vercel.headers.find(h => h.source === "/skills/(.*)");
  assert.ok(rule && rule.headers.some(h => h.key === "Access-Control-Allow-Origin" && h.value === "*"));
});
