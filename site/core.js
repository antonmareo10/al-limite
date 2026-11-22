/* Al límite — los datos publicados y las reglas del sitio, sin la página.
   Lo usan la web (app.js), las acciones de los agentes (agent-tools.js, site-actions.js),
   el puente para otros sitios con agentes (bridge/bridge-actions.js) y las pruebas.
   No toca el DOM: funciona en la página, en el marco oculto del puente y en Node. */

export const EVL = "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=";
export const LEVEL_ORDER = ["insuficiente", "sin_senal", "indicio", "senal"];
// Columnas de data/indice.json (allimite/analyze.py): desplazamiento de cada regla en la fila.
export const RULE_OFFSET = { ss: 5, obras: 10 };

export const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ");
const SYN = { ayto: "ayuntamiento", aytos: "ayuntamiento", ajuntament: "ayuntamiento", dipu: "diputacion", uni: "universidad", univ: "universidad", council: "ayuntamiento", university: "universidad", ministry: "ministerio", hospital: "hospital" };
const STOP = new Set(["de", "del", "la", "el", "los", "las", "mi", "my", "the", "of", "y", "en"]);

/** El mejor nivel de una fila del índice entre sus dos reglas. */
export function bestLevel(f) {
  const a = f[5] || "insuficiente", b = f[10] || "insuficiente";
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

/**
 * Los datos precalculados del sitio (data/), cargados una vez por contexto.
 * base: la carpeta del sitio, con barra final. fetchImpl: para las pruebas.
 */
export class SiteData {
  constructor(base = new URL("./", import.meta.url).href, fetchImpl = null) {
    this.base = base;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
    this.ready = null;
    this.NAC = null;
    this.IDX = null;
    this.CPV = null;
    this.SEARCH = null;
    this.byId = null;
  }

  url(path) {
    return new URL(path, this.base).href;
  }

  async fetchText(path) {
    const f = this.fetchImpl || globalThis.fetch;
    const r = await f(this.url(path));
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.text();
  }

  async json(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    const p = this.fetchText(path).then(JSON.parse);
    this.cache.set(path, p);
    try {
      return await p;
    } catch (e) {
      this.cache.delete(path);
      throw e;
    }
  }

  /** Carga los datos nacionales y el índice de organismos. */
  load() {
    if (!this.ready) {
      this.ready = Promise.all([this.json("data/nacional.json"), this.json("data/indice.json")]).then(([nac, idx]) => {
        this.NAC = nac;
        this.IDX = idx;
        this.CPV = Object.fromEntries(nac.cpv_nombres.map(c => [c[0], { es: c[1], en: c[2] }]));
        this.SEARCH = idx.filas.map((f, i) => ({ i, name: norm(f[2]), all: norm(f[2] + " " + f[3]) }));
        this.byId = new Map(idx.filas.map(f => [f[0], f]));
        return this;
      });
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }

  /** La ficha completa de un organismo (data/u/<id>.json). */
  unit(id) {
    return this.json(`data/u/${encodeURIComponent(id)}.json`);
  }

  row(id) {
    return this.byId ? this.byId.get(String(id)) || null : null;
  }

  /** El buscador de la portada: hasta `limit` filas del índice, de más a menos relevante. */
  search(q, limit = 12) {
    const toks = norm(q).split(/\s+/).filter(x => x && !STOP.has(x)).map(x => SYN[x] || x);
    if (!toks.length || toks.join("").length < 3) return null;
    const out = [];
    for (const s of this.SEARCH) {
      let score = 0, ok = true;
      for (const k of toks) {
        const inName = s.name.includes(k);
        if (!inName && !s.all.includes(k)) { ok = false; break; }
        score += inName ? 3 : 1;
        if (inName && (s.name.startsWith(k) || s.name.includes(" " + k))) score += 1;
      }
      if (!ok) continue;
      const f = this.IDX.filas[s.i];
      score += Math.min(3, Math.log10(1 + f[4]) / 1.5) + (f[1] === 1 ? 1.5 : 0) - s.name.length / 400;
      // Quien escribe el nombre de un municipio suele buscar su ayuntamiento, no la diputación de la provincia.
      if (/(^| )(ayuntamiento|ajuntament|concello|udala|ayto) /.test(s.name) && toks.some(k => s.name.includes(" de " + k) || s.name.endsWith(" " + k))) score += 1.5;
      out.push([score, s.i]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, limit).map(x => this.IDX.filas[x[1]]);
  }

  /** Filas con señal para una regla y una clase (0 órganos, 1 entidades), por la cota inferior del intervalo. */
  rankRows(rule, cls) {
    const o = RULE_OFFSET[rule];
    return this.IDX.filas.filter(f => f[1] === cls && f[o] === "senal").sort((a, b) => b[o + 2] - a[o + 2]);
  }

  /** Cuántos organismos de una clase tienen nivel calculado (no «muestra insuficiente») para una regla. */
  assessable(rule, cls) {
    const o = RULE_OFFSET[rule];
    return this.IDX.filas.filter(f => f[1] === cls && f[o] && f[o] !== "insuficiente").length;
  }

  /** Los valores que la página del método inserta en su texto ({{clave}}). */
  methodVars({ fmt, fmtDate, esc }) {
    const NAC = this.NAC, C = NAC.criterios, d = NAC.reglas.ss, o = NAC.reglas.obras, e = NAC.embudo, ia = NAC.ia || {};
    return {
      n_ss: fmt(e.servicios_suministros), n_obras: fmt(e.obras), n_otros: fmt(e.otros_tipos_excluidos), n_org: fmt(NAC.n_organos), n_ent: fmt(NAC.n_entidades),
      leidas: fmt(e.entradas_leidas), distintos: fmt(e.contratos_distintos), periodo: NAC.periodo.map(fmtDate).join(" – "),
      min_ventana: C.min_ventana, min_cerca: C.min_cerca, q_max: fmt(C.q_max, 2), ic_inf_min: fmt(C.ic_inf_min),
      ss_cerca: fmt(d.n_cerca), ss_esp: fmt(d.esperado), ss_razon: fmt(d.razon, 1), ss_ic: `${fmt(d.ic_inf, 2)}–${fmt(d.ic_sup, 2)}`,
      ob_cerca: fmt(o.n_cerca), ob_esp: fmt(o.esperado), ob_razon: fmt(o.razon, 1), ob_ic: `${fmt(o.ic_inf, 2)}–${fmt(o.ic_sup, 2)}`,
      cpv_pct: fmt(NAC.cpv_cobertura_pct), ss_sobre: fmt(d.sobre_umbral), dic_todos: fmt(d.pct_dic_todos, 1), dic_cerca: fmt(d.pct_dic_cerca, 1),
      senal_org_ss: fmt((d.niveles_organo || {}).senal || 0), senal_ent_ss: fmt((d.niveles_entidad || {}).senal || 0),
      senal_org_ob: fmt((o.niveles_organo || {}).senal || 0), senal_ent_ob: fmt((o.niveles_entidad || {}).senal || 0),
      ia_modelo: ia.modelo || "–", ia_fichas: fmt(ia.fichas_con_explicacion || 0), ia_senal: fmt(ia.fichas_con_senal || 0), ia_modelo_n: fmt(ia.textos_del_modelo || 0),
      ia_plantilla: fmt(ia.textos_de_plantilla || 0), ia_rech: fmt(ia.borradores_rechazados || 0), generado: NAC.generado,
      fuentes: NAC.fuente.map(f => `<tr><td class="num">${esc(f.periodo)}</td><td class="n">${fmt(f.bytes)}</td><td class="num">${esc(f.sha256.slice(0, 16))}…</td><td class="num">${esc(f.descargado.slice(0, 10))}</td></tr>`).join(""),
    };
  }
}

let shared = null;
/** Los datos del sitio para este contexto (la página o el marco del puente), compartidos por todos sus módulos. */
export function siteData() {
  if (!shared) shared = new SiteData();
  return shared;
}
