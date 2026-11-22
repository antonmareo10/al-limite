/* Al límite — the site's data as tools for AI agents (site actions in the open agentic web spec).
   One definition per tool, shared by the page (site-actions.js) and by the bridge that other
   agent sites load (bridge/bridge-actions.js). Every figure an agent can give comes from here:
   the precomputed JSON the page itself shows (core.js). Nothing here computes a new statistic. */
import { EVL, RULE_OFFSET, bestLevel, siteData } from "./core.js";
import { HonestyCheck } from "./honesty.js";

const RULE_NAME = { ss: "services_and_supplies", obras: "works" };
const RULE_KEY = { services_and_supplies: "ss", works: "obras" };
const LEVEL = {
  senal: { en: "Bunching signal", es: "Señal de acumulación" },
  indicio: { en: "Weak hint", es: "Indicio débil" },
  sin_senal: { en: "No signal", es: "Sin señal" },
  insuficiente: { en: "Sample too small", es: "Muestra insuficiente" },
};
const KIND = { organo: "contracting body", entidad: "entity (all the contracting bodies that share its tax id)" };
const HOW_TO_READ = "A statistical indicator, not proof: many amounts just under the limit are a reason to look at the files, not evidence that any contract was split or that anyone did wrong. It can reflect market prices, fixed budgets or separate needs.";
const NO_NAMES = "Awardees are shown as letters (Awardee A, B…). Their names are only in each contract's official record; do not name them.";
const METHOD_TOPICS = ["idea_and_legal_basis", "data", "calculation", "uncertainty", "levels", "bodies_and_entities", "checks", "ai_use", "limits", "reproduce", "references"];

const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? round((100 * a) / b, 1) : null);

/**
 * Builds the action definitions. `data` is a SiteData; `siteUrl` is where the site's pages are
 * (the folder of index.html), for links the agent can give the visitor.
 */
export class AgentTools {
  constructor(data = siteData(), siteUrl = data.base) {
    this.data = data;
    this.siteUrl = siteUrl;
  }

  /** The read actions, in the order the model sees them. */
  reads() {
    return [this.lookUpBodyAction(), this.listContractsAction(), this.rankingAction(), this.nationalAction(), this.methodAction(), this.checkAnswerAction()];
  }

  // ------------------------------------------------------------------ shared pieces

  get criteria() {
    const C = this.data.NAC.criterios;
    return {
      period: this.data.NAC.periodo,
      confidence_percent: 95,
      signal_needs: { contracts_in_both_bands: C.min_ventana, contracts_near_limit: C.min_cerca, q_value_below: C.q_max, interval_lower_bound_at_least: C.ic_inf_min },
      weak_hint_needs: { q_value_below: 0.05, interval_lower_bound_above: 1 },
      ratio_meaning: "observed ÷ expected; 1 means as many as expected",
      reference_band_width_times_near_band: 5,
    };
  }

  pageUrl(id) {
    return new URL(`#/u/${encodeURIComponent(id)}`, this.siteUrl).href;
  }

  level(code) {
    return { level: LEVEL[code || "insuficiente"].en, level_es: LEVEL[code || "insuficiente"].es };
  }

  indicator(u, rule) {
    const d = u.reglas[rule];
    if (!d) return null;
    const C = this.data.NAC.criterios, R = C.reglas[rule], win = d.n_cerca + d.n_ref;
    const notes = [];
    if (d.nivel === "insuficiente") notes.push(`Sample too small: only ${win} contracts in the two bands (${C.min_ventana} needed), so no level is assigned. The figures are for reference only.`);
    if (d.razon == null && win > 0) notes.push(`No contracts in the reference band, so the ratio cannot be computed; the interval starts at ${d.ic_inf}.`);
    if (d.nivel !== "insuficiente" && d.ic_sup != null && d.ic_sup / Math.max(d.ic_inf, 0.1) > 4) notes.push("Wide interval: with few contracts the ratio is very uncertain. Look at the interval, not the central value.");
    if (d.sobre_umbral) notes.push(`${d.sobre_umbral} contracts are recorded above the €${R.umbral} limit (possibly data-entry errors or other regimes); they are left out.`);
    const tn = d.meses_cerca.reduce((a, b) => a + b, 0), ta = d.meses_todos.reduce((a, b) => a + b, 0);
    return {
      rule: RULE_NAME[rule],
      legal_limit_eur: R.umbral,
      minor_contracts: d.n,
      near_limit_band_eur: [R.cerca_desde, R.umbral],
      contracts_near_limit: d.n_cerca,
      reference_band_eur: [R.ref_desde, R.cerca_desde],
      contracts_in_reference_band: d.n_ref,
      expected_near_limit: d.esperado,
      ratio_observed_to_expected: d.razon,
      ci95: [d.ic_inf, d.ic_sup],
      ...this.level(d.nivel),
      amount_near_limit_eur: d.importe_cerca,
      distinct_awardees_near_limit: d.n_adj_cerca,
      awardees_with_3_or_more_near_limit: d.repetidos.length,
      december_share_percent: { near_limit: pct(d.meses_cerca[11], tn), all_contracts: pct(d.meses_todos[11], ta) },
      by_year: Object.fromEntries(Object.entries(d.anios).map(([y, a]) => [y, { contracts: a.n, near_limit: a.n_cerca, reference_band: a.n_ref }])),
      notes,
    };
  }

  matchSummary(f) {
    return { id: f[0], name: f[2], kind: f[1] ? KIND.entidad : KIND.organo, minor_contracts: f[4], best_level: LEVEL[bestLevel(f)].en };
  }

  async body(id) {
    const u = await this.data.unit(id);
    const rules = ["ss", "obras"].filter(r => u.reglas[r]);
    return {
      id: u.id,
      name: u.nombre,
      kind: KIND[u.clase] || u.clase,
      path: u.ruta,
      ...(u.entidad ? { part_of: { id: u.entidad.id, name: u.entidad.nombre } } : {}),
      minor_contracts_analysed: u.n,
      period: this.data.NAC.periodo,
      page: this.pageUrl(u.id),
      indicators: rules.map(r => this.indicator(u, r)),
      ...(u.organos ? { contracting_bodies: u.organos.length } : {}),
      plain_language_explanation_on_page: Boolean(u.ia),
    };
  }

  // ------------------------------------------------------------------ look_up_body

  lookUpBodyAction() {
    return {
      name: "look_up_body",
      description: "Find a Spanish public body (town council, regional ministry, university, public company…) by name or id, and read its indicator for each rule: contracts just under the legal limit, how many would be expected, the ratio with its 95% interval, and its level. Names are in Spanish; a town's name finds its town council first. Returns the best match, its page link and up to 5 other matches. Call it before giving any figure about a body, in each turn that needs one.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", minLength: 3, maxLength: 120, description: "The body's name as the visitor gave it, such as \"Ayuntamiento de Ourense\" or \"Universidad de Murcia\"." },
          id: { type: "string", minLength: 1, maxLength: 40, description: "A body id from an earlier result. Use it instead of query when you have it." },
        },
      },
      execute: args => this.lookUpBody(args),
    };
  }

  async lookUpBody({ query, id } = {}) {
    await this.data.load();
    let rows;
    if (id) {
      const f = this.data.row(id);
      if (!f) return { ok: false, reason: `No body has the id ${id}. Search by name with query.`, field: "id" };
      rows = [f];
    } else if (query) {
      rows = this.data.search(query, 6);
      if (rows == null) return { ok: false, reason: "Give at least 3 letters of the body's name.", field: "query" };
      if (!rows.length) return { ok: false, reason: `No body matches "${query}". Try fewer words, or the Spanish name (Ayuntamiento de…, Diputación de…, Universidad de…). Bodies on regional platforms (Catalonia, Basque Country, Madrid, Andalusia, Galicia…) are not in the data.`, field: "query" };
    } else {
      return { ok: false, reason: "Give the body's name in query, or its id.", field: "query" };
    }
    return {
      ok: true,
      body: await this.body(rows[0][0]),
      other_matches: rows.slice(1).map(f => this.matchSummary(f)),
      criteria: this.criteria,
      how_to_read: HOW_TO_READ,
    };
  }

  // ------------------------------------------------------------------ list_contracts_near_limit

  listContractsAction() {
    return {
      name: "list_contracts_near_limit",
      description: "List a body's contracts just under the legal limit, newest first, each with its date, amount, file number, awardee letter and the link to its official record; plus the awardees that repeat just under the limit (as letters). Needs a body id from website_look_up_body.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 40, description: "The body id from website_look_up_body." },
          rule: { type: "string", enum: ["services_and_supplies", "works"], description: "Which limit. Default: the rule with the strongest level." },
          limit: { type: "integer", minimum: 1, maximum: 25, description: "How many contracts to list. Default 10." },
        },
      },
      execute: args => this.listContracts(args),
    };
  }

  async listContracts({ id, rule, limit = 10 }) {
    await this.data.load();
    if (!this.data.row(id)) return { ok: false, reason: `No body has the id ${id}. Find it first with website_look_up_body.`, field: "id" };
    const u = await this.data.unit(id);
    const order = ["insuficiente", "sin_senal", "indicio", "senal"];
    const rules = ["ss", "obras"].filter(r => u.reglas[r]);
    const r = rule ? RULE_KEY[rule] : rules.slice().sort((a, b) => order.indexOf(u.reglas[b].nivel) - order.indexOf(u.reglas[a].nivel) || u.reglas[b].n - u.reglas[a].n)[0];
    const d = u.reglas[r];
    if (!d) return { ok: false, reason: `This body has no ${RULE_NAME[r] || rule} contracts in the period.`, field: "rule" };
    const CPV = this.data.CPV;
    return {
      ok: true,
      body: { id: u.id, name: u.nombre, page: this.pageUrl(u.id) },
      rule: RULE_NAME[r],
      near_limit_band_eur: [this.data.NAC.criterios.reglas[r].cerca_desde, this.data.NAC.criterios.reglas[r].umbral],
      contracts_near_limit_total: d.n_cerca,
      shown: Math.min(limit, d.contratos.length),
      contracts: d.contratos.slice(0, limit).map(c => ({
        awarded: c.f,
        amount_eur: c.i,
        file_no: c.e,
        awardee: c.a ? `Awardee ${c.a}` : "Several or unidentified",
        ...(c.c ? { cpv_family: `${c.c} ${(CPV[c.c] || {}).en || ""}`.trim() } : {}),
        official_record: c.u ? EVL + c.u : null,
      })),
      repeat_awardees: d.repetidos.slice(0, 5).map(a => ({ awardee: `Awardee ${a.alias}`, near_limit: a.n_cerca, amount_near_limit_eur: a.importe_cerca, years: a.anios, most_in_one_year: a.max_en_un_anio, contracts_with_this_body: a.n_total })),
      awardees_with_3_or_more_near_limit: d.repetidos.length,
      note: `${NO_NAMES} Amounts exclude taxes. ${HOW_TO_READ}`,
    };
  }

  // ------------------------------------------------------------------ get_ranking

  rankingAction() {
    return {
      name: "get_ranking",
      description: "Read the ranking of bodies with a bunching signal for one rule, sorted by the lower bound of the 95% interval (the most cautious reading). It is a list of where to look, not a list of offenders.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          rule: { type: "string", enum: ["services_and_supplies", "works"], description: "Which limit. Default services_and_supplies." },
          kind: { type: "string", enum: ["bodies", "entities"], description: "Contracting bodies, or entities (all bodies that share a tax id). Default bodies." },
          limit: { type: "integer", minimum: 1, maximum: 25, description: "How many rows. Default 10." },
        },
      },
      execute: args => this.ranking(args),
    };
  }

  async ranking({ rule = "services_and_supplies", kind = "bodies", limit = 10 } = {}) {
    await this.data.load();
    const r = RULE_KEY[rule], cls = kind === "entities" ? 1 : 0, o = RULE_OFFSET[r];
    const rows = this.data.rankRows(r, cls);
    return {
      ok: true,
      rule,
      kind,
      bodies_with_signal: rows.length,
      bodies_assessable: this.data.assessable(r, cls),
      sorted_by: "lower bound of the 95% interval",
      rows: rows.slice(0, limit).map((f, i) => ({
        rank: i + 1, id: f[0], name: f[2], contracts_near_limit: f[o + 4],
        ratio_observed_to_expected: f[o + 1], ci95: [f[o + 2], f[o + 3]],
      })),
      criteria: this.criteria,
      note: `A list of where to look, not a list of offenders. ${HOW_TO_READ}`,
    };
  }

  // ------------------------------------------------------------------ get_national_overview

  nationalAction() {
    return {
      name: "get_national_overview",
      description: "Read the national figures for Spain: contracts analysed, the wall just under each limit, observed vs expected with the 95% interval, bodies with a signal, the check with fake limits (is it just round numbers?), by year, and the December check. Also the data's coverage and source.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => this.national(),
    };
  }

  async national() {
    await this.data.load();
    const N = this.data.NAC, C = N.criterios;
    const rule = r => {
      const d = N.reglas[r], R = C.reglas[r];
      return {
        rule: RULE_NAME[r], legal_limit_eur: R.umbral, minor_contracts: d.n,
        near_limit_band_eur: [R.cerca_desde, R.umbral], contracts_near_limit: d.n_cerca,
        reference_band_eur: [R.ref_desde, R.cerca_desde], contracts_in_reference_band: d.n_ref,
        expected_near_limit: d.esperado, ratio_observed_to_expected: d.razon, ci95: [d.ic_inf, d.ic_sup],
        bodies_with_signal: (d.niveles_organo || {}).senal || 0, entities_with_signal: (d.niveles_entidad || {}).senal || 0,
      };
    };
    return {
      ok: true,
      period: N.periodo,
      contracting_bodies: N.n_organos,
      entities: N.n_entidades,
      rules: [rule("ss"), rule("obras")],
      services_and_supplies_by_year: Object.fromEntries(Object.entries(N.reglas.ss.anios).map(([y, a]) => [y, { ratio_observed_to_expected: a.razon, ci95: [a.ic_inf, a.ic_sup] }])),
      december_share_percent: { near_limit: N.reglas.ss.pct_dic_cerca, all_contracts: N.reglas.ss.pct_dic_todos },
      fake_limit_check: {
        what: "The same ratio with an invented limit every €500 from €7,000 to €18,000. Round numbers alone would also give peaks at €10,000 or €12,000.",
        points: N.placebo_ss.map(p => ({ fake_limit_eur: p.umbral, ratio_observed_to_expected: p.razon, ci95: [p.ic_inf, p.ic_sup] })),
      },
      coverage: "Only bodies that publish on Spain's national procurement platform. Bodies on regional platforms (for example Catalonia, the Basque Country, Madrid, Andalusia or Galicia) are missing.",
      source: "Plataforma de Contratación del Sector Público (Ministry of Finance), open dataset of minor contracts in buyer profiles.",
      data_generated: N.generado,
      criteria: this.criteria,
      how_to_read: HOW_TO_READ,
    };
  }

  // ------------------------------------------------------------------ get_method

  methodAction() {
    return {
      name: "get_method",
      description: "Read one section of the site's method page: how the indicator is computed, the levels, the uncertainty, the checks, how AI is used, and what the indicator cannot tell you. Call it for questions about the method or the law, rather than answering from memory.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["topic"],
        properties: {
          topic: { type: "string", enum: METHOD_TOPICS, description: "The section to read." },
          lang: { type: "string", enum: ["en", "es"], description: "Language of the text. Default en." },
        },
      },
      execute: args => this.method(args),
    };
  }

  async method({ topic, lang = "en" }) {
    await this.data.load();
    const html = await this.data.fetchText(`metodo.${lang}.html`);
    const loc = lang === "es" ? "es-ES" : "en-GB";
    const fmt = (v, d = 0) => (v == null ? "–" : new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" }).format(v));
    const vars = this.data.methodVars({ fmt, fmtDate: s => s, esc: s => String(s ?? "") });
    vars.fuentes = this.data.NAC.fuente.map(f => `${f.periodo}: ${f.bytes} bytes, SHA-256 ${f.sha256.slice(0, 16)}…`).join("; ");
    const parts = html.split(/(?=<h[23][^>]*>)/).slice(1);
    const i = METHOD_TOPICS.indexOf(topic);
    if (i < 0 || !parts[i]) return { ok: false, reason: `Unknown topic ${topic}.`, field: "topic" };
    const text = parts[i]
      .replace(/\{\{(\w+)\}\}/g, (m0, k) => vars[k] ?? m0)
      .replace(/<\/(?:p|li|h2|h3|tr)>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    return { ok: true, topic, lang, text, page: new URL("#/metodo", this.siteUrl).href };
  }

  // ------------------------------------------------------------------ check_answer

  checkAnswerAction() {
    return {
      name: "check_answer",
      description: "Check a draft answer before it is shown, with code, not a model: every figure must be in Al límite's published data for the bodies named (or the national figures, the ranking and the method), each ratio needs its 95% interval, an answer about the indicator must say it is not proof, and there must be no accusatory wording or company names. Returns ok, and the problems to fix.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["answer"],
        properties: {
          answer: { type: "string", minLength: 1, maxLength: 6000, description: "The draft answer, exactly as it would be shown." },
          body_ids: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 40 }, description: "Ids of the bodies the answer is about, from website_look_up_body." },
          question: { type: "string", maxLength: 1000, description: "The visitor's question, whose own numbers the answer may repeat." },
        },
      },
      execute: args => this.checkAnswer(args),
    };
  }

  /**
   * The ledger is rebuilt from the published data, not from what an agent says it read: the
   * national figures, both rankings, the method page, and everything the tools return for each
   * named body. So the check gives the same answer on this site and inside another agent site.
   */
  async checkAnswer({ answer, body_ids = [], question = "" }) {
    await this.data.load();
    const results = [await this.national()];
    for (const rule of ["services_and_supplies", "works"]) {
      for (const kind of ["bodies", "entities"]) results.push(await this.ranking({ rule, kind, limit: 25 }));
    }
    for (const topic of ["calculation", "levels", "limits"]) results.push(await this.method({ topic }));
    const unknown = [];
    for (const id of body_ids) {
      if (!this.data.row(id)) { unknown.push(id); continue; }
      results.push(await this.lookUpBody({ id }));
      for (const rule of ["services_and_supplies", "works"]) results.push(await this.listContracts({ id, rule, limit: 150 }));
    }
    const out = HonestyCheck.check(answer, HonestyCheck.ledger(results, [question]));
    if (unknown.length) {
      out.problems.push(`Unknown body ids: ${unknown.join(", ")}. Use ids from website_look_up_body.`);
      out.ok = false;
      out.verdict = "fail";
    }
    return out;
  }

  /** The ledger of a whole session: every result the tools returned, plus the site's criteria. */
  baseResults() {
    return [{ criteria: this.criteria, legal_limits_eur: Object.values(this.data.NAC.criterios.reglas).map(R => R.umbral) }];
  }
}
