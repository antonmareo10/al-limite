// The second site (companion/pide-el-expediente): its page operations, its network, and the
// runtime copies of both sites. Run: node --test "tests/agentic/*.test.mjs"
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { installFakeBrowser } from "./support/fake_browser.mjs";

installFakeBrowser({ lang: "en" });
const { ActionRegistry } = await import("../../site/runtime/actions.js");
const { AgentNetwork, validateNetwork } = await import("../../site/runtime/kernel.js");
const { App, composeDraft, PARTNER } = await import("../../companion/pide-el-expediente/request.js");
const { registerActions } = await import("../../companion/pide-el-expediente/site-actions.js");

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const DIR = new URL("../../companion/pide-el-expediente/", import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, DIR), "utf8"));

test("fill_request writes the letter from Al límite's facts and refuses bad input without changing anything", async () => {
  const r = new ActionRegistry();
  const scope = { base: "https://pide-el-expediente.vercel.app", network: "pide_el_expediente" };
  registerActions({ register: r.register.bind(r, scope) });
  const names = r.catalog(scope).map(e => [e.name, e.effect]);
  assert.deepEqual(names, [["get_request", "read"], ["fill_request", "write"]]);
  const ok = App.page.fill({
    body: "  Junta de Gobierno del Ayuntamiento de Ourense ",
    files: [{ file_no: "2025058789", awarded: "2025-12-23", amount_eur: 14445, official_record: "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=abc" }],
    items: ["necesidad", "factura"],
  });
  assert.equal(ok.ok, true);
  assert.match(ok.draft, /^A la atención de: Junta de Gobierno del Ayuntamiento de Ourense$/m);
  assert.match(ok.draft, /El informe que motiva la necesidad del contrato y la factura de cada uno/);
  assert.match(ok.draft, /- expediente 2025058789, adjudicado el 23\/12\/2025, por 14\.445,00 € sin impuestos/);
  assert.match(ok.draft, /Ley 19\/2013, de 9 de diciembre/);
  assert.match(ok.draft, /\[Nombre y apellidos\]/);
  const before = App.page.getState();
  for (const bad of [
    { body: " " },
    { body: "X", files: [{ file_no: "" }] },
    { body: "X", files: [{ file_no: "1", official_record: "https://evil.example/x" }] },
    { body: "X", files: [{ file_no: "1", awarded: "23/12/2025" }] },
    { body: "X", items: ["todo"] },
  ]) {
    assert.equal(App.page.fill(bad).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(App.page.getState(), before);
  assert.equal(before.files.length, 1);
  assert.ok(before.how_to_file.some(f => f.includes("article 20.1")));
});

test("the letter never contains personal details: only placeholders for the visitor", () => {
  const text = composeDraft({ body: "Ayuntamiento de X", files: [], items: [] });
  assert.match(text, /El expediente completo de cada uno de estos contratos menores\./);
  assert.ok(!/@|\d{8}[A-Z]/.test(text));
});

test("the companion network is valid, calls only Al límite, and builds with only the intended warning", async () => {
  const config = await json("pide_el_expediente.network.json");
  const manifest = await json("agent-manifest.json");
  const network = new AgentNetwork(config, "pide_el_expediente");
  assert.deepEqual(validateNetwork(network).errors, []);
  const front = network.getAgentSpec(network.findFrontMan());
  assert.deepEqual(front.tools, [PARTNER.network]);
  assert.equal(config.link_labels[PARTNER.network], "Al límite");
  assert.deepEqual(manifest.allowed_peers, [new URL(PARTNER.network).origin]);
  assert.equal(manifest.peer_policy.mode, "closed");
  assert.ok(front.instructions.includes("Never put names, emails, phone numbers or booking codes in a request."));
  assert.ok(front.instructions.includes("Never ask for the visitor's name, ID number, address or email"));
  const { stdout } = await promisify(execFile)(process.execPath, [
    "tools/agentify/scripts/build_network.mjs", "companion/pide-el-expediente/pide_el_expediente.hocon",
    "--manifest", "companion/pide-el-expediente/agent-manifest.json", "--check",
  ], { cwd: REPO });
  assert.deepEqual(stdout.split("\n").filter(l => l.startsWith("WARNING")), ['WARNING: No "cruse" block. The render_cruse tool and generative UI context will be off.']);
});

test("both sites keep the runtime byte for byte as the agentify-website skill ships it", async () => {
  const lines = (await readFile(new URL("../../tools/agentify/runtime.sha256", import.meta.url), "utf8")).split("\n").filter(l => l && !l.startsWith("#"));
  assert.ok(lines.length > 30);
  for (const dir of ["site/runtime/", "companion/pide-el-expediente/runtime/"]) {
    for (const line of lines) {
      const [hash, rel] = line.split(/\s+/);
      const body = (await readFile(new URL(`../../${dir}${rel}`, import.meta.url))).toString("utf8").replace(/\r\n/g, "\n");
      assert.equal(createHash("sha256").update(body).digest("hex"), hash, `${dir}${rel}`);
    }
  }
});
