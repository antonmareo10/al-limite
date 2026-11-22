/* Al límite — honesty check for answers written by AI agents.
   Deterministic code, no model: it checks an answer against the data the site's tools returned.

   - Every figure in the answer must be traceable to a value in the ledger (tool results, the
     site's published criteria, or the visitor's own message). Rounding a decimal is fine;
     counts must match exactly. A figure the model computed itself (a percentage, a sum) fails.
   - A ratio must come with its 95% interval.
   - An answer about a body's indicator must say that it is not proof of wrongdoing.
   - No accusatory wording outside a negation ("it does not prove fraud" is fine).
   - No company names (the site shows awardees as letters).

   It is a heuristic with known limits (see README): it cannot judge whether each sentence is
   the best explanation, and an invented number that happens to equal a real one passes.
   Same rules as the Python verifier of the precomputed explanations (allimite/explain.py). */

// Accusatory vocabulary and talk of splitting, Spanish and English (allimite/explain.py).
const ACCUSATORY = /fraud|corrup|delit|ilegal|ilícit|ilicit|culpab|malvers|prevaric|amañ|trampa|soborn|estafa|irregular|sospech|crime|criminal|illegal|unlawful|guilt|embezzl|rigg|brib|scam|wrongdoing|misconduct|suspicio/i;
const SPLITTING = /fraccion|troce|\bsplit|carv|broken up/i;
const NEGATION = /\b(?:no|not|ni|nor|never|nunca|sin|without|cannot|can't|can not|doesn't|don't|isn't|aren't|does not|do not|is not|are not|neither|none)\b/i;
// Stating the law is not an accusation: "the Act forbids splitting a contract (art. 99.2)".
const LEGAL = /proh[ií]b|forbid|\bley\b|\blaw\b|\bact\b|art[íi]culo|\barticle|\bart\./i;
// Phrases that state the caveat: a statistical indicator, not proof.
const CAVEAT = /not (?:a |any )?(?:proof|evidence)|(?:does|do|did)(?: not|n't) (?:prove|show|mean|imply|establish)|cannot (?:prove|tell|show)|no (?:es |son |constituye |constituyen )?(?:una |ninguna )?prueba|no (?:demuestra|demuestran|prueba|prueban|implica|implican|significa|significan|acredita)|statistical (?:indicator|signal)|indicador estad[ií]stico|se[ñn]al estad[ií]stica|not an accusation|no es una acusaci[óo]n|reason to (?:look|check|review)|motivo para (?:mirar|revisar)|raz[óo]n para (?:mirar|revisar)/i;
const INTERVAL_WORDS = /interval|intervalo|\bIC\b|\bCI\b|confidence|confianza|uncertain|incertidumbre/i;
const LEVEL_WORDS = /bunching signal|weak hint|se[ñn]al de acumulaci[óo]n|indicio d[ée]bil/i;
// Company forms: "Construcciones Pérez, S.L.", "Acme Ltd".
const COMPANY = /\b[A-ZÁÉÍÓÚÑ][\p{L}&'.-]*(?:\s+[A-ZÁÉÍÓÚÑ&][\p{L}&'.-]*){0,5},?\s+(?:S\.?\s?L\.?(?:\s?U\.?)?|S\.?\s?A\.?(?:\s?U\.?)?|S\.?\s?Coop\.?|S\.?\s?C\.?|Ltd\.?|LLC|Inc\.?|GmbH|PLC)(?=[\s,.;:)]|$)/u;
// A number as written: grouped (14.000, 14,000, 14 000 with a no-break space) or plain, with decimals.
const NUMBER = /(?<![\p{L}\p{N}_/])(\d{1,3}(?:[.,  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\s?(?:k|K|mil millones|mil|thousand|million|millones|mill[oó]n|M|billion|bn)(?![\p{L}]))?(?![\p{N}])/gu;
// Words around a number that make it a ratio, even when rounded to a whole number.
const RATIO_CONTEXT = /times|veces|ratio|raz[óo]n|×|\bx\b/i;
// Words right after a number that make it a count, an amount or a share, not a ratio.
const NOT_RATIO = /^\s*(?:%|€|euro|percent|por ciento|expected|esperad|esperab|contract|contrat|award|adjudic|bod|organ|entit|entidad)/i;
const MULTIPLIER = { k: 1e3, K: 1e3, mil: 1e3, thousand: 1e3, million: 1e6, millones: 1e6, "millón": 1e6, millon: 1e6, M: 1e6, billion: 1e9, bn: 1e9, "mil millones": 1e9 };
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class HonestyCheck {
  /**
   * Build a ledger: every number the answer may use, and the indicators (ratio and interval)
   * found in the given tool results. Visitor texts add only their own numbers.
   */
  static ledger(results = [], visitorTexts = []) {
    const ledger = { values: [], exact: new Set(), indicators: [], strings: [] };
    const seen = new Set();
    const add = v => {
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      const key = String(v);
      if (seen.has(key)) return;
      seen.add(key);
      ledger.values.push(Math.abs(v));
    };
    const addText = s => {
      if (/:\/\//.test(s)) return; // links carry ids, not facts
      ledger.strings.push(s);
      const date = s.match(DATE);
      if (date) {
        add(+date[1]); add(+date[2]); add(+date[3]);
        return;
      }
      for (const m of s.matchAll(/\d+(?:[.,]\d+)?/g)) {
        ledger.exact.add(m[0].replace(/^0+(?=\d)/, ""));
        add(Number(m[0].replace(",", ".")));
      }
    };
    const walk = node => {
      if (node == null) return;
      if (typeof node === "number") return add(node);
      if (typeof node === "string") return addText(node);
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === "object") {
        if (typeof node.ratio_observed_to_expected === "number" && Array.isArray(node.ci95)) {
          ledger.indicators.push({ ratio: node.ratio_observed_to_expected, lo: node.ci95[0], hi: node.ci95[1] });
        }
        Object.values(node).forEach(walk);
      }
    };
    results.forEach(walk);
    for (const text of visitorTexts) {
      for (const tok of HonestyCheck.numbers(String(text || ""))) tok.readings.forEach(r => add(r.value));
    }
    return ledger;
  }

  /** Remove links, code and list numbering: they are not figures the answer states. */
  static prose(text) {
    return String(text || "")
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/<?https?:\/\/[^\s)>\]]+>?/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/^\s*(?:\d+[.)]|[-*•])\s+/gm, "")
      // Legal references are names, not data: "Ley 9/2017", "articles 99.2 and 118".
      .replace(/\b(?:ley|law|act|art(?:[íi]culos?|icles?)?\.?)\s+[\d./]+(?:\s*(?:,|and|y|e)\s*[\d./]+)*/gi, m => m.replace(/\d/g, ""));
  }

  /** The numbers in a text, each with its possible readings (Spanish or English separators). */
  static numbers(text) {
    const out = [];
    for (const m of String(text).matchAll(NUMBER)) {
      const raw = m[1], suffix = (m[2] || "").trim();
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (/^(?:st|nd|rd|th|º|ª|\.º|\.ª)/i.test(after)) continue; // ordinals
      const mult = MULTIPLIER[suffix] || 1;
      const readings = [];
      const push = (s, decimals) => {
        const v = Number(s);
        if (Number.isFinite(v)) readings.push({ value: v * mult, decimals, mult });
      };
      const plain = raw.replace(/[  ]/g, "");
      const dots = (plain.match(/\./g) || []).length, commas = (plain.match(/,/g) || []).length;
      if (dots && commas) {
        const dec = plain.lastIndexOf(".") > plain.lastIndexOf(",") ? "." : ",";
        const grp = dec === "." ? "," : ".";
        const s = plain.split(grp).join("").replace(dec, ".");
        push(s, s.split(".")[1]?.length || 0);
      } else if (dots || commas) {
        const sep = dots ? "." : ",";
        const parts = plain.split(sep);
        if (parts.length === 2) push(parts.join("."), parts[1].length);
        if (parts.slice(1).every(p => p.length === 3)) push(parts.join(""), 0);
      } else {
        push(plain, 0);
      }
      if (readings.length) out.push({ text: m[0].trim(), index: m.index, readings, exactText: plain.replace(/^0+(?=\d)/, "") });
    }
    return out;
  }

  /** Does a reading match a ledger value: exactly, or as a rounding of a decimal value? */
  static matches(reading, v) {
    const eps = 1e-9 * Math.max(1, Math.abs(v));
    if (Math.abs(reading.value - v) <= eps) return true;
    if (Number.isInteger(v) && reading.mult === 1) return false; // counts must be exact
    const half = 0.5 * Math.pow(10, -reading.decimals) * reading.mult;
    return Math.abs(reading.value - v) <= half + eps;
  }

  static traced(tok, ledger) {
    if (ledger.exact.has(tok.exactText)) return true;
    return tok.readings.some(r => ledger.values.some(v => HonestyCheck.matches(r, v)));
  }

  static sentences(text) {
    return String(text).split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  }

  /**
   * Check an answer. Returns plain data: the verdict, what was traced, and each problem.
   */
  static check(answer, ledger) {
    const text = HonestyCheck.prose(answer);
    const toks = HonestyCheck.numbers(text);
    const untraced = toks.filter(t => !HonestyCheck.traced(t, ledger)).map(t => t.text);
    const problems = [];
    if (untraced.length) {
      problems.push(`Figures not found in any tool result: ${[...new Set(untraced)].join(", ")}. Use only figures from tool results, as given or rounded; do not compute new ones.`);
    }
    // A ratio needs its interval. With many indicators in the ledger a number can match several
    // of them, so: first find the indicators stated in full (ratio and both bounds); the numbers
    // they use are accounted for. Any other number that reads as a ratio of some indicator needs
    // one of those indicators to be stated in full.
    const is = (t, v) => v != null && t.readings.some(r => HonestyCheck.matches(r, v));
    const openEnded = /∞|no upper|sin (?:cota|l[ií]mite) superior|at least|al menos|como m[íi]nimo/i.test(text);
    const full = new Set(), covered = new Set();
    for (const ind of ledger.indicators) {
      if (ind.ratio == null) continue;
      const r = toks.find(t => is(t, ind.ratio));
      const lo = r && toks.find(t => t !== r && is(t, ind.lo));
      const hi = lo && (ind.hi == null ? (openEnded ? lo : null) : toks.find(t => t !== r && t !== lo && is(t, ind.hi)));
      if (r && lo && hi) {
        full.add(ind);
        covered.add(r).add(lo).add(hi);
      }
    }
    let ratioMentioned = full.size > 0, intervalMissing = false;
    for (const t of toks) {
      if (covered.has(t)) continue;
      const after = text.slice(t.index + t.text.length, t.index + t.text.length + 16);
      if (NOT_RATIO.test(after) || /[€$]\s*$/.test(text.slice(Math.max(0, t.index - 2), t.index))) continue;
      const asRatio = t.readings.some(r => r.decimals >= 1) || RATIO_CONTEXT.test(text.slice(Math.max(0, t.index - 12), t.index + t.text.length + 10));
      if (!asRatio) continue;
      const cands = ledger.indicators.filter(ind => is(t, ind.ratio));
      if (!cands.length) continue;
      ratioMentioned = true;
      if (!cands.some(ind => full.has(ind))) intervalMissing = true;
    }
    if (intervalMissing) problems.push("A ratio is given without its 95% interval. Give both bounds next to it.");
    const aboutIndicator = ratioMentioned || LEVEL_WORDS.test(text);
    const caveatStated = CAVEAT.test(text);
    if (aboutIndicator && !caveatStated) problems.push("The answer discusses the indicator but does not say it is a statistical signal, not proof of wrongdoing. Add that caveat.");
    const accusatory = HonestyCheck.sentences(text).filter(s =>
      (ACCUSATORY.test(s) && !NEGATION.test(s)) || (SPLITTING.test(s) && !NEGATION.test(s) && !LEGAL.test(s)));
    if (accusatory.length) problems.push(`Accusatory wording: "${accusatory[0].slice(0, 120)}". Never suggest fraud, illegality or splitting; the indicator is only a reason to look at the files.`);
    const names = [];
    for (const s of HonestyCheck.sentences(text)) {
      const m = s.match(COMPANY);
      // A public company can be a contracting body: its name comes from the tools.
      if (m && !ledger.strings.some(x => x.includes(m[0].replace(/,?\s+\S+$/, "")))) names.push(m[0]);
    }
    if (names.length) problems.push(`Names a company (${names[0]}). Refer to awardees only by their letter, such as "Awardee A".`);
    return {
      ok: problems.length === 0,
      verdict: problems.length ? "fail" : "pass",
      figures: { found: toks.length, traced: toks.length - untraced.length, untraced: [...new Set(untraced)] },
      interval_stated: ratioMentioned ? !intervalMissing : null,
      caveat_stated: aboutIndicator ? caveatStated : null,
      accusatory: accusatory.map(s => s.slice(0, 160)),
      company_names: names,
      problems,
    };
  }
}
