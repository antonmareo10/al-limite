// The agent tools (site/agent-tools.js) against the site's own data files: every figure an
// agent can give must be the figure the page shows. Run: node --test "tests/agentic/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AgentTools } from "../../site/agent-tools.js";
import { SiteData, EVL } from "../../site/core.js";
import { diskFetch } from "./support/fake_browser.mjs";

const SITE = new URL("../../site/", import.meta.url);
const data = new SiteData(SITE.href, diskFetch());
const tools = new AgentTools(data, "https://al-limite.example/");
const raw = async path => JSON.parse(await readFile(new URL(path, SITE), "utf8"));
const OURENSE = "30985210142281";

test("look_up_body finds the town council first and gives the page's figures", async () => {
  const r = await tools.lookUpBody({ query: "Ourense" });
  assert.equal(r.ok, true);
  assert.equal(r.body.id, OURENSE);
  const u = await raw(`data/u/${OURENSE}.json`);
  const ss = r.body.indicators.find(i => i.rule === "services_and_supplies");
  assert.equal(ss.contracts_near_limit, u.reglas.ss.n_cerca);
  assert.equal(ss.contracts_in_reference_band, u.reglas.ss.n_ref);
  assert.equal(ss.expected_near_limit, u.reglas.ss.esperado);
  assert.equal(ss.ratio_observed_to_expected, u.reglas.ss.razon);
  assert.deepEqual(ss.ci95, [u.reglas.ss.ic_inf, u.reglas.ss.ic_sup]);
  assert.equal(ss.level, "Bunching signal");
  assert.deepEqual(ss.near_limit_band_eur, [14000, 15000]);
  assert.equal(r.body.page, `https://al-limite.example/#/u/${OURENSE}`);
  assert.ok(r.other_matches.length >= 1 && r.other_matches.every(m => m.id && m.name));
  assert.match(r.how_to_read, /not proof/);
});

test("look_up_body by id gives the same body, and refuses what it cannot answer without guessing", async () => {
  const byId = await tools.lookUpBody({ id: OURENSE });
  assert.equal(byId.body.name, "Junta de Gobierno del Ayuntamiento de Ourense");
  assert.deepEqual(await tools.lookUpBody({ id: "999" }), { ok: false, reason: "No body has the id 999. Search by name with query.", field: "id" });
  assert.equal((await tools.lookUpBody({ query: "zzzz qqqq" })).ok, false);
  assert.equal((await tools.lookUpBody({ query: "de" })).ok, false);
  assert.equal((await tools.lookUpBody({})).ok, false);
});

test("a body with too small a sample says so and has no level of its own", async () => {
  await data.load();
  const f = data.IDX.filas.find(r => r[5] === "insuficiente" && r[10] == null);
  const r = await tools.lookUpBody({ id: f[0] });
  const ind = r.body.indicators[0];
  assert.equal(ind.level, "Sample too small");
  assert.ok(ind.notes.some(n => n.startsWith("Sample too small")));
});

test("list_contracts_near_limit links each contract to its official record and names no awardee", async () => {
  const r = await tools.listContracts({ id: OURENSE, rule: "services_and_supplies", limit: 5 });
  const u = await raw(`data/u/${OURENSE}.json`);
  assert.equal(r.contracts.length, 5);
  assert.equal(r.contracts_near_limit_total, u.reglas.ss.n_cerca);
  r.contracts.forEach((c, i) => {
    const d = u.reglas.ss.contratos[i];
    assert.equal(c.amount_eur, d.i);
    assert.equal(c.awarded, d.f);
    assert.equal(c.file_no, d.e);
    assert.equal(c.official_record, EVL + d.u);
    assert.ok(c.amount_eur > 14000 && c.amount_eur <= 15000);
    assert.match(c.awardee, /^(Awardee [A-Z]+|Several or unidentified)$/);
  });
  for (const a of r.repeat_awardees) assert.match(a.awardee, /^Awardee [A-Z]+$/);
  assert.equal((await tools.listContracts({ id: "nope" })).ok, false);
});

test("get_ranking is the site's ranking: signal only, sorted by the lower bound", async () => {
  const r = await tools.ranking({ rule: "works", kind: "bodies", limit: 25 });
  await data.load();
  assert.deepEqual(r.rows.map(x => x.id), data.rankRows("obras", 0).slice(0, 25).map(f => f[0]));
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i - 1].ci95[0] >= r.rows[i].ci95[0]);
  assert.match(r.note, /not a list of offenders/);
});

test("get_national_overview gives the national figures of nacional.json", async () => {
  const r = await tools.national();
  const n = await raw("data/nacional.json");
  const ss = r.rules[0];
  assert.equal(ss.contracts_near_limit, n.reglas.ss.n_cerca);
  assert.equal(ss.ratio_observed_to_expected, n.reglas.ss.razon);
  assert.deepEqual(ss.ci95, [n.reglas.ss.ic_inf, n.reglas.ss.ic_sup]);
  assert.equal(r.fake_limit_check.points.length, n.placebo_ss.length);
});

test("get_method reads each section of the method page in both languages, with its figures filled in", async () => {
  for (const lang of ["en", "es"]) {
    for (const topic of ["idea_and_legal_basis", "levels", "limits", "ai_use"]) {
      const r = await tools.method({ topic, lang });
      assert.equal(r.ok, true);
      assert.ok(r.text.length > 80, `${lang} ${topic}`);
      assert.ok(!r.text.includes("{{") && !r.text.includes("<"), `${lang} ${topic}`);
    }
  }
  assert.match((await tools.method({ topic: "levels" })).text, /at least 10 contracts just under the limit/);
});

test("check_answer rebuilds its ledger from the data, so it works the same on any site", async () => {
  const good = await tools.checkAnswer({
    answer: "Between 2023 and 2025 it awarded 163 contracts just under the €15,000 limit; about 21.4 were expected, so 7.6 times as many (95% interval 5.9 to 9.8), a bunching signal. It is a statistical signal, not proof of wrongdoing.",
    body_ids: [OURENSE],
  });
  assert.equal(good.ok, true, JSON.stringify(good.problems));
  const bad = await tools.checkAnswer({ answer: "It awarded 170 contracts and that is fraud.", body_ids: [OURENSE] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.figures.untraced, ["170"]);
  assert.equal((await tools.checkAnswer({ answer: "Fine.", body_ids: ["nope"] })).ok, false);
});

test("every tool result stays under the runtime's 64 KB limit", async () => {
  const results = [
    await tools.lookUpBody({ query: "Ourense" }),
    await tools.listContracts({ id: OURENSE, limit: 25 }),
    await tools.ranking({ limit: 25 }),
    await tools.national(),
    await tools.method({ topic: "data" }),
  ];
  for (const r of results) assert.ok(JSON.stringify(r).length < 64000);
});
