/* Pide el expediente — the page: a request for public information (Spain's transparency law,
   Ley 19/2013) asking a public body for the files of specific minor contracts.
   It drafts the letter only. It sends nothing and keeps nothing: the visitor copies the letter,
   adds their own details and files it on the body's own e-office or transparency portal.
   Exports App.page, the operations the assistant can use (site-actions.js). */

const ITEMS = {
  necesidad: { es: "el informe que motiva la necesidad del contrato", en: "the report that justifies the need for the contract" },
  gasto: { es: "la aprobación del gasto", en: "the approval of the expenditure" },
  factura: { es: "la factura", en: "the invoice" },
  completo: { es: "el expediente completo", en: "the complete file" },
};
const ITEM_KEYS = Object.keys(ITEMS);
// The partner agent site this page's assistant asks, after the visitor agrees.
export const PARTNER = { name: "Al límite", page: "https://al-limite-agent.vercel.app/", network: "https://al-limite-agent.vercel.app/al_limite_guide" };

// What the page tells the visitor about filing the request. The assistant reads the same text.
const FACTS = {
  es: [
    "Cualquier persona puede pedir a un organismo público la información que tenga (Ley 19/2013, artículo 12) y no tiene que decir para qué la quiere (artículo 17.3).",
    "La solicitud debe incluir tu identidad, la información que pides, una dirección de contacto (mejor electrónica) y, si quieres, el formato (artículo 17.2).",
    "Dónde presentarla: si es un organismo de la Administración General del Estado, en el Portal de la Transparencia (transparencia.gob.es); si es autonómico o local, en su sede electrónica o su portal de transparencia.",
    "Plazo: deben responder en un mes, ampliable a otro más (artículo 20.1). Si no contestan, se entiende denegada (artículo 20.4) y puedes reclamar ante el Consejo de Transparencia y Buen Gobierno o el órgano equivalente de tu comunidad (artículo 24).",
    "Esta página solo redacta el escrito. No envía nada, no guarda nada y no es asesoramiento jurídico.",
  ],
  en: [
    "Anyone can ask a public body for information it holds (Ley 19/2013, article 12) and does not have to say why (article 17.3).",
    "The request must include your identity, the information you ask for, a contact address (preferably electronic) and, if you wish, the format (article 17.2).",
    "Where to file it: for a central government body, on the Transparency Portal (transparencia.gob.es); for a regional or local body, on its own e-office or transparency portal.",
    "Deadline: they must answer within one month, extendable by one more (article 20.1). If they do not answer, it counts as refused (article 20.4) and you can complain to the Consejo de Transparencia y Buen Gobierno or your region's equivalent body (article 24).",
    "This page only drafts the letter. It sends nothing, keeps nothing and is not legal advice.",
  ],
};

const fmtEur = v => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }).format(v);
const fmtDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || ""); };

/** The letter, in Spanish, as the body will read it. Placeholders in brackets are for the visitor. */
export function composeDraft({ body, files, items }) {
  const what = (items.length ? items : ["completo"]).map(k => ITEMS[k].es);
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} y ${what[what.length - 1]}` : what[0];
  const lines = files.map(f => {
    const bits = [`expediente ${f.file_no}`];
    if (f.awarded) bits.push(`adjudicado el ${fmtDate(f.awarded)}`);
    if (f.amount_eur != null) bits.push(`por ${fmtEur(f.amount_eur)} € sin impuestos`);
    return `- ${bits.join(", ")}${f.official_record ? `\n  ${f.official_record}` : ""}`;
  });
  return [
    `A la atención de: ${body || "[organismo]"}`,
    "",
    "Asunto: solicitud de acceso a información pública sobre contratos menores",
    "",
    "Al amparo de los artículos 12 y 17 de la Ley 19/2013, de 9 de diciembre, de transparencia, acceso a la información pública y buen gobierno, solicito acceso a la siguiente información:",
    "",
    `${list[0].toUpperCase()}${list.slice(1)} de cada uno de estos contratos menores${files.length ? ":" : "."}`,
    ...lines,
    "",
    "Prefiero recibir la información en formato electrónico en la dirección de contacto indicada.",
    "",
    "[Nombre y apellidos]",
    "[DNI o NIE]",
    "[Dirección de contacto, preferentemente electrónica]",
    "[Lugar, fecha y firma]",
  ].join("\n");
}

class RequestPage {
  constructor() {
    this.lang = (() => { try { return localStorage.getItem("pde-lang"); } catch { return null; } })()
      || ((navigator.language || "es").startsWith("es") ? "es" : "en");
    this.state = { body: "", files: [], items: ["necesidad", "gasto", "factura"] };
    this.version = 0;
  }

  facts() {
    return FACTS[this.lang];
  }

  /** The request as the page shows it, and the page's facts about filing it. */
  getState() {
    return {
      body: this.state.body,
      files: this.state.files.map(f => ({ ...f })),
      items: this.state.items.map(k => ITEMS[k].en),
      draft: composeDraft(this.state),
      how_to_file: FACTS.en,
      note: "The letter is a draft. The visitor adds their own name, ID number and contact address on the page; never ask for them.",
    };
  }

  /**
   * Fill the request: the body, the contract files and what to ask for. Checks everything
   * before changing anything; refuses with {ok: false, reason, field}.
   */
  fill({ body, files = [], items }) {
    const name = String(body || "").trim();
    if (!name) return { ok: false, reason: "Give the public body's name.", field: "body" };
    if (name.length > 200) return { ok: false, reason: "The body's name is too long.", field: "body" };
    const clean = [];
    for (const f of files) {
      const fileNo = String(f.file_no || "").trim();
      if (!fileNo || fileNo.length > 60) return { ok: false, reason: "Each contract needs its file number (expediente), up to 60 characters.", field: "files" };
      if (f.official_record && !/^https:\/\/contrataciondelestado\.es\//.test(f.official_record)) {
        return { ok: false, reason: "Official record links must point to contrataciondelestado.es.", field: "files" };
      }
      if (f.awarded && !/^\d{4}-\d{2}-\d{2}$/.test(f.awarded)) return { ok: false, reason: "Award dates must be YYYY-MM-DD.", field: "files" };
      clean.push({
        file_no: fileNo,
        ...(f.awarded ? { awarded: f.awarded } : {}),
        ...(typeof f.amount_eur === "number" ? { amount_eur: f.amount_eur } : {}),
        ...(f.official_record ? { official_record: f.official_record } : {}),
      });
    }
    const chosen = items && items.length ? items : this.state.items;
    if (chosen.some(k => !ITEM_KEYS.includes(k))) return { ok: false, reason: `Items must be among: ${ITEM_KEYS.join(", ")}.`, field: "items" };
    this.state = { body: name, files: clean, items: [...new Set(chosen)] };
    this.version += 1;
    this.render();
    return { ok: true, files: clean.length, draft: composeDraft(this.state) };
  }

  /** Read the visitor's own edits from the form (before the assistant overwrites nothing). */
  readForm() {
    const body = document.getElementById("f-body").value;
    const files = document.getElementById("f-files").value.split("\n").map(l => l.trim()).filter(Boolean).map(l => ({ file_no: l }));
    const items = ITEM_KEYS.filter(k => document.getElementById(`f-${k}`).checked);
    return { body, files, items };
  }

  render() {
    document.getElementById("f-body").value = this.state.body;
    document.getElementById("f-files").value = this.state.files.map(f => f.file_no).join("\n");
    for (const k of ITEM_KEYS) document.getElementById(`f-${k}`).checked = this.state.items.includes(k);
    document.getElementById("draft").value = composeDraft(this.state);
    document.getElementById("form-msg").textContent = "";
  }

  applyLang() {
    document.documentElement.lang = this.lang;
    document.querySelectorAll("[data-es]").forEach(el => { el.textContent = el.dataset[this.lang]; });
    document.getElementById("facts").innerHTML = "";
    for (const f of this.facts()) {
      const li = document.createElement("li");
      li.textContent = f;
      document.getElementById("facts").append(li);
    }
    const b = document.getElementById("lang");
    b.textContent = this.lang === "es" ? "EN" : "ES";
    b.setAttribute("aria-label", this.lang === "es" ? "Switch to English" : "Cambiar a español");
    for (const k of ITEM_KEYS) document.getElementById(`l-${k}`).textContent = ITEMS[k][this.lang];
  }

  start() {
    this.applyLang();
    this.render();
    document.getElementById("lang").addEventListener("click", () => {
      this.lang = this.lang === "es" ? "en" : "es";
      try { localStorage.setItem("pde-lang", this.lang); } catch {}
      this.applyLang();
    });
    document.getElementById("request-form").addEventListener("submit", e => {
      e.preventDefault();
      const r = this.fill(this.readForm());
      document.getElementById("form-msg").textContent = r.ok ? "" : r.reason;
    });
    document.getElementById("copy").addEventListener("click", async () => {
      const text = document.getElementById("draft").value;
      try {
        await navigator.clipboard.writeText(text);
        document.getElementById("copy-msg").textContent = this.lang === "es" ? "Copiado." : "Copied.";
      } catch {
        document.getElementById("draft").select();
      }
    });
  }
}

export const App = { page: new RequestPage() };
if (typeof window !== "undefined") App.page.start();
