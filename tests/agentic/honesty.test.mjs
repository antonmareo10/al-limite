// The honesty check (site/honesty.js): what it accepts and what it rejects.
// Run: node --test "tests/agentic/*.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";
import { HonestyCheck } from "../../site/honesty.js";

// A ledger like the one a body look-up gives (figures of the Ourense example body).
const RESULT = {
  period: ["2023-01-01", "2025-12-31"],
  confidence_percent: 95,
  body: { id: "30985210142281", name: "Junta de Gobierno del Ayuntamiento de Ourense" },
  indicators: [{
    legal_limit_eur: 15000, near_limit_band_eur: [14000, 15000], contracts_near_limit: 163,
    expected_near_limit: 21.4, ratio_observed_to_expected: 7.62, ci95: [5.93, 9.81], level: "Bunching signal",
  }],
};
const ledger = () => HonestyCheck.ledger([RESULT], []);
const check = text => HonestyCheck.check(text, ledger());

test("an answer with traced figures, its interval and the caveat passes, in English and Spanish", () => {
  const en = check("Between 2023 and 2025 it awarded 163 contracts just under the €15,000 limit, where about 21.4 were expected: 7.6 times as many (95% interval 5.9 to 9.8), a bunching signal. It is a statistical signal, not proof of wrongdoing.");
  assert.equal(en.ok, true, JSON.stringify(en.problems));
  assert.equal(en.figures.untraced.length, 0);
  assert.equal(en.interval_stated, true);
  assert.equal(en.caveat_stated, true);
  const es = check("Entre 2023 y 2025 adjudicó 163 contratos entre 14.000 y 15.000 €, donde cabía esperar 21,4. La razón es 7,62 (IC 95 %: 5,93–9,81): señal de acumulación. No prueba que se haya fraccionado ningún contrato.");
  assert.equal(es.ok, true, JSON.stringify(es.problems));
});

test("a figure the model computed itself is not traced", () => {
  const r = check("It awarded 163 contracts, 19% of its total, with a ratio of 7.6 (95% interval 5.9–9.8). This is not proof of anything.");
  assert.equal(r.ok, false);
  assert.deepEqual(r.figures.untraced, ["19"]);
});

test("counts must match exactly; decimals may be rounded", () => {
  assert.deepEqual(check("It awarded 164 contracts.").figures.untraced, ["164"]);
  assert.deepEqual(check("About 21 were expected.").figures.untraced, []);
  assert.deepEqual(check("About 22 were expected.").figures.untraced, ["22"]);
});

test("a ratio without its interval fails, also when rounded to a whole number", () => {
  assert.equal(check("The ratio is 7.6. It is not proof.").interval_stated, false);
  assert.equal(check("It has about 8 times the expected number. It is not proof.").interval_stated, false);
  assert.equal(check("It has about 8 times the expected number (95% interval 5.9–9.8). It is not proof.").ok, true);
});

test("talking about the indicator without the caveat fails", () => {
  const r = check("It shows a bunching signal: 7.6 times the expected number (95% interval 5.9 to 9.8).");
  assert.equal(r.caveat_stated, false);
  assert.equal(r.ok, false);
});

test("accusatory wording fails unless negated; stating the law is not an accusation", () => {
  assert.equal(check("This looks like fraud.").ok, false);
  assert.equal(check("Este ayuntamiento ha troceado sus contratos.").ok, false);
  assert.equal(check("It does not prove fraud or that any contract was split.").ok, true);
  assert.equal(check("The Act forbids splitting a contract to stay under the limit (art. 99.2).").ok, true);
});

test("company names fail, but a public body's own name from the data does not", () => {
  assert.equal(check("Most went to Construcciones Pérez, S.L., awardee A.").company_names.length, 1);
  const withBody = HonestyCheck.ledger([{ name: "Empresa Municipal de Aguas de Córdoba, S.A." }], []);
  assert.equal(HonestyCheck.check("Empresa Municipal de Aguas de Córdoba, S.A. is a contracting body.", withBody).ok, true);
});

test("links, list numbers, legal references and the visitor's own numbers are not data claims", () => {
  assert.equal(check("1. See [the record](https://contrataciondelestado.es/x?idEvl=AB12%3D) under Ley 9/2017, articles 99.2 and 118.").ok, true);
  const l = HonestyCheck.ledger([RESULT], ["Are there more than 150 contracts?"]);
  assert.equal(HonestyCheck.check("There are 163, so more than 150.", l).ok, true);
});

test("dates and file numbers in results are traced", () => {
  const l = HonestyCheck.ledger([{ contracts: [{ awarded: "2025-12-23", amount_eur: 14445, file_no: "2025058789" }] }], []);
  assert.equal(HonestyCheck.check("On 23/12/2025 it awarded file 2025058789 for €14,445.", l).ok, true);
  assert.equal(HonestyCheck.check("On 23 December 2025 it awarded €14,445.00.", l).ok, true);
});

test("an amount written with a multiplier must round to a real amount", () => {
  const l = HonestyCheck.ledger([{ amount_near_limit_eur: 2409383.74 }], []);
  assert.equal(HonestyCheck.check("About €2.4 million went to contracts just under the limit.", l).ok, true);
  assert.equal(HonestyCheck.check("About €3.4 million went to contracts just under the limit.", l).ok, false);
});
