// The open agentic web spec's interoperability checks (MVP profile, section 6), with the real
// runtime, Al límite and a second site on another origin (companion/pide-el-expediente).
// The sites are served from disk under their public URLs by a stub fetch, the router is
// scripted and the key is fake, so nothing leaves the process.
// Run: node --test "tests/agentic/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installFakeBrowser } from "./support/fake_browser.mjs";

installFakeBrowser();
const { Engine } = await import("../../site/runtime/engine.js");
const { AgentNetwork } = await import("../../site/runtime/kernel.js");
const { MockRouter } = await import("./support/mock_router.mjs");
const { ExampleWeb } = await import("./support/example_web.mjs");

const SITE = fileURLToPath(new URL("../../site/", import.meta.url));
const COMPANION = fileURLToPath(new URL("../../companion/pide-el-expediente/", import.meta.url));
const AL = "https://al-limite-agent.vercel.app";
const PDE = "https://pide-el-expediente.vercel.app";
const PARTNER_URL = `${AL}/al_limite_guide`;
const KEY = "sk-test-not-a-real-key";
const ROUTER = "http://127.0.0.1:8791/v1";
const OTARI = "https://api.otari.ai";
const SECRET = "sly-secret-value-1234";
const READS = ["look_up_body", "list_contracts_near_limit", "get_ranking", "get_national_overview", "get_method", "check_answer"];
const REQUEST = "Contracts just under the limit of the Ayuntamiento de Ourense, newest first, with file numbers and links.";
const MESSAGE = "Draft a request for the files of the Ayuntamiento de Ourense's contracts just under the limit.";

const json = async p => JSON.parse(await readFile(p, "utf8"));

/** Serve both sites, with the caller's served manifest stripped of its page actions. */
async function setUp({ handoffs = 1, read = null, callerManifest = m => m, callerNetwork = n => n, partnerNetwork = null, partnerManifest = null } = {}) {
  const router = new MockRouter(KEY, REQUEST, handoffs, 0);
  if (read) router.read(read.tool, read.args);
  router.aim("al_limite_guide", null);
  const web = new ExampleWeb(router, new URL(ROUTER).origin, KEY);
  web.serve(AL, SITE);
  web.serve(PDE, COMPANION);
  // Node cannot import the caller's action module over HTTP; its own tests cover it.
  const served = callerManifest(structuredClone(await json(`${COMPANION}agent-manifest.json`)));
  delete served.actions;
  web.replace(`${PDE}/agent-manifest.json`, served);
  web.replace(`${PDE}/pide_el_expediente.network.json`, callerNetwork(await json(`${COMPANION}pide_el_expediente.network.json`)));
  if (partnerNetwork) web.replace(`${AL}/al_limite_guide.network.json`, partnerNetwork(await json(`${SITE}al_limite_guide.network.json`)));
  if (partnerManifest) web.replace(`${AL}/agent-manifest.json`, partnerManifest(await json(`${SITE}agent-manifest.json`)));
  return { router, web };
}

/** One visitor turn on the caller's page; every consent card gets `decision`. */
async function run(setup, { decision = "allow", model = "", slyData = undefined, origin = PDE, router = ROUTER, message = MESSAGE } = {}) {
  const out = { cards: [], trace: [], result: null };
  setup.web.setPage(origin);
  setup.web.install();
  try {
    const engine = new Engine({ originUrl: origin, byokKey: KEY, routerOverride: router, modelOverride: model });
    engine.onConsent = async info => {
      out.cards.push({ ...info, before: setup.web.requests.length });
      return decision;
    };
    out.trace = engine.trace.events;
    out.result = await engine.runTurn(message, slyData ? { slyData } : undefined);
  } finally {
    setup.web.restore();
  }
  return out;
}

const to = (web, origin) => web.requests.filter(r => r.origin === origin);
const events = (trace, kind, phase) => trace.filter(e => e.kind === kind && e.phase === phase);

test("§6: Al límite publishes a multi-agent network and a manifest that other sites can read (CORS)", async () => {
  const manifest = await json(`${SITE}agent-manifest.json`);
  const config = await json(`${SITE}al_limite_guide.network.json`);
  const network = new AgentNetwork(config, "al_limite_guide");
  assert.equal(manifest.networks[0].name, "al_limite_guide");
  assert.equal(network.findFrontMan(), manifest.networks[0].front_man);
  assert.ok(config.tools.length >= 2);
  const vercel = await json(`${SITE}vercel.json`);
  for (const file of ["/agent-manifest.json", "/al_limite_guide.network.json", "/links.json", "/agent-mcp.json"]) {
    const rule = vercel.headers.find(h => h.source === file);
    assert.ok(rule, file);
    assert.ok(rule.headers.some(h => h.key === "Access-Control-Allow-Origin" && h.value === "*"), file);
  }
  const worker = vercel.headers.find(h => h.source === "/runtime/sandbox-worker.js");
  assert.ok(worker.headers.some(h => h.key === "Content-Security-Policy" && h.value.startsWith("default-src 'none'")));
});

test("§6: the network runs on the site's published default router and model, and on the visitor's own", async () => {
  // Default: Al límite's manifest names hosted Otari and its network names a model.
  const otari = new MockRouter(KEY, REQUEST, 0, 0);
  const web = new ExampleWeb({ respond: (m, p, h, b) => otari.respond(m, p.replace(/^\/api/, ""), h, b) }, OTARI, KEY);
  web.serve(AL, SITE);
  const bare = await json(`${SITE}agent-manifest.json`);
  delete bare.actions;
  web.replace(`${AL}/agent-manifest.json`, bare);
  web.setPage(AL);
  web.install();
  let result;
  try {
    const engine = new Engine({ originUrl: AL, byokKey: KEY });
    result = await engine.runTurn("How does the method work?");
  } finally {
    web.restore();
  }
  const chats = otari.records.filter(r => r.kind === "chat");
  assert.ok(chats.length >= 1);
  assert.ok(chats.every(c => c.model === "alibaba/qwen3.8-flash" && c.keyOk));
  assert.ok(web.requests.filter(r => r.origin === OTARI).every(r => r.path.startsWith("/api/v1/")));
  assert.match(result.text, /^CALLER_FINAL/);
  // BYOK: the visitor's router and model replace both.
  const setup = await setUp();
  setup.web.serve(AL, SITE);
  setup.web.replace(`${AL}/agent-manifest.json`, bare);
  await run(setup, { origin: AL, model: "gpt-4.1-mini", message: "How does the method work?" });
  const byok = setup.router.records.filter(r => r.kind === "chat");
  assert.ok(byok.length >= 1 && byok.every(c => c.model === "gpt-4.1-mini" && c.keyOk));
  assert.deepEqual(to(setup.web, OTARI), []);
});

test("§6: after the visitor agrees, a second origin loads Al límite's exact network and runs it in its own page, with Al límite's shared reads", async () => {
  const setup = await setUp({ read: { tool: "website_look_up_body", args: { query: "Ayuntamiento de Ourense" } } });
  const out = await run(setup);
  const web = setup.web;
  // One card, before any contact, naming Al límite and the whole request.
  assert.equal(out.cards.length, 1);
  const card = out.cards[0];
  assert.equal(card.peerLabel, "Al límite");
  assert.equal(card.peerOrigin, "al-limite-agent.vercel.app");
  assert.equal(card.requestText, REQUEST);
  assert.deepEqual(web.requests.slice(0, card.before).filter(r => r.origin === AL), []);
  // Then its public files, and its bridge in a sandboxed frame on its own origin.
  assert.deepEqual(to(web, AL).filter(r => r.from === "runtime").map(r => r.path), ["/agent-manifest.json", "/al_limite_guide.network.json", "/links.json"]);
  assert.equal(web.frames.length, 2, "one frame for the catalog, one for the read");
  assert.equal(web.frames[0].src, `${AL}/bridge/action-bridge.html`);
  assert.equal(web.frames[0].sandbox, "allow-scripts allow-same-origin");
  assert.deepEqual(web.frames[0].shared, READS);
  assert.deepEqual(web.frames[1].executed, ["look_up_body"]);
  // Al límite's agents ran here, offered exactly its shared reads, and read real data.
  const partner = setup.router.partnerChats();
  assert.ok(partner.length >= 2);
  assert.deepEqual(partner[0].roles, ["system", "user"]);
  assert.deepEqual([...partner[0].websiteTools].sort(), READS.map(n => `website_${n}`).sort());
  assert.match(partner.at(-1).lastToolResult, /Junta de Gobierno del Ayuntamiento de Ourense/);
  assert.match(out.result.text, /^CALLER_FINAL: PARTNER_ANSWER: website_look_up_body said/);
  assert.deepEqual(web.dialogs, []);
  assert.deepEqual(web.unexpected, []);
});

test("§6: with a key active, the second site never receives it and cannot change the caller's router or model", async () => {
  const setup = await setUp({
    read: { tool: "website_look_up_body", args: { query: "Ourense" } },
    partnerNetwork: n => ({ ...n, llm_config: { model_name: "partner-chosen-model" } }),
    partnerManifest: m => ({ ...m, llm_router: { base_url: "https://evil.example/v1", byok_router: "https://evil.example/v1", mock: false } }),
  });
  await run(setup, { model: "gpt-4.1-mini" });
  for (const r of setup.web.requests) {
    if (r.origin !== new URL(ROUTER).origin) {
      assert.equal(r.keySent, false, `${r.url} got the key`);
      assert.equal(r.authorization, false, `${r.url} got an Authorization header`);
    }
  }
  const chats = setup.router.records.filter(r => r.kind === "chat");
  assert.ok(chats.length >= 3);
  assert.ok(chats.every(c => c.keyOk && c.model === "gpt-4.1-mini"), "every model call, the partner's too, goes to the visitor's router and model");
  assert.deepEqual(setup.web.unexpected, [], "nothing went to the router the partner's manifest names");
  // With no visitor model, the partner runs on the calling site's model, not its own.
  const again = await setUp({ partnerNetwork: n => ({ ...n, llm_config: { model_name: "partner-chosen-model" } }) });
  await run(again);
  assert.ok(again.router.partnerChats().every(c => c.model === "alibaba/qwen3.8-flash"));
});

test("§6: private context (sly_data) is absent at the peer unless the caller names a field", async () => {
  const closed = await setUp();
  const out = await run(closed, { slyData: { backend_token: SECRET } });
  const call = events(out.trace, "remote_call", "start");
  assert.equal(call.length, 1);
  assert.deepEqual(Object.keys(call[0].requestPayload.sly_data || {}), []);
  // A named field passes, and only that one.
  const open = await setUp({
    callerNetwork: n => ({ ...n, tools: n.tools.map(a => (a.name === "request_helper" ? { ...a, allow: { to_downstream: { sly_data: ["case_ref"] } } } : a)) }),
  });
  const out2 = await run(open, { slyData: { backend_token: SECRET, case_ref: "public-case-7" } });
  assert.deepEqual(Object.keys(events(out2.trace, "remote_call", "start")[0].requestPayload.sly_data), ["case_ref"]);
});

test("§6: a declined card contacts nothing, and the answer says so", async t => {
  const setup = await setUp();
  const out = await run(setup, { decision: "decline" });
  assert.equal(out.cards.length, 1);
  assert.deepEqual(to(setup.web, AL), []);
  assert.match(out.result.text, /The user declined to contact al-limite-agent\.vercel\.app/);
  t.diagnostic(out.result.text);
});

test("§6: a denied origin is stopped with a visible error, and nothing reaches it", async t => {
  const setup = await setUp({ callerManifest: m => ({ ...m, allowed_peers: [] }) });
  const out = await run(setup);
  assert.deepEqual(to(setup.web, AL), []);
  assert.match(out.result.text, /^CALLER_FINAL: Error from tool/);
  assert.match(out.result.text, /not allowed|refused|denied|allowed_peers|policy/i);
  t.diagnostic(out.result.text);
});

test("§6: an invalid network is stopped before any model call, with a visible error", async t => {
  const setup = await setUp({ partnerNetwork: n => ({ ...n, tools: n.tools.map(a => (a.name === "al_limite_guide" ? { ...a, tools: ["data_desk", "no_such_agent"] } : a)) }) });
  const out = await run(setup);
  assert.equal(setup.router.partnerChats().length, 0);
  assert.match(out.result.text, /^CALLER_FINAL: Error from tool/);
  t.diagnostic(out.result.text);
});

test("§6: a composition cycle and an over-budget request are stopped with visible errors", async t => {
  // Over budget: a second call to the same network in one message is skipped.
  const twice = await setUp({ handoffs: 2 });
  const out = await run(twice);
  assert.match(out.result.text, /Skipped Al límite: that network was already consulted for this query/);
  assert.equal(events(out.trace, "remote_call", "start").length, 1);
  t.diagnostic(out.result.text);
  // Cycle: Al límite's network, served so that it calls the second site back, is not offered
  // that call (the caller is already in the chain), so the chain stops after one hop.
  const cycle = await setUp({
    partnerNetwork: n => ({
      ...n,
      link_labels: { [`${PDE}/pide_el_expediente`]: "Pide el expediente" },
      tools: n.tools.map(a => (a.name === "al_limite_guide" ? { ...a, tools: [...a.tools, `${PDE}/pide_el_expediente`] } : a)),
    }),
    partnerManifest: m => ({ ...m, allowed_peers: [PDE] }),
  });
  const out2 = await run(cycle);
  assert.equal(out2.cards.length, 1, "no card for the call back");
  const partner = cycle.router.partnerChats();
  assert.ok(partner.length >= 1);
  assert.ok(!partner[0].tools.includes("pide_el_expediente"), "the call back is not offered");
  assert.ok(events(out2.trace, "composition_skip", "note").some(e => e.target === `${PDE}/pide_el_expediente`));
});
