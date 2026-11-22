// Mounts the Al límite agents in a side panel of the page. Loaded with
//   <script type="module" src="site.js"></script>
// The runtime (runtime/, nsdeploy's browser runtime as adapted by the agentify-website skill)
// boots the first time the visitor opens the panel, so the site itself stays as fast as before.
// After each answer, code checks it against what the tools returned in this page and shows the
// result under the answer (HonestyCheck in honesty.js). No model is involved in that check.
import { App } from "./app.js";
import { AgentTools } from "./agent-tools.js";
import { siteData } from "./core.js";
import { HonestyCheck } from "./honesty.js";
import { SESSION } from "./site-actions.js";

const TEXT = {
  es: {
    greeting: "Puedo buscar cualquier organismo de los datos, darte sus cifras junto al límite con su intervalo de confianza, listar sus contratos con el enlace oficial, explicar el método y abrir su ficha. Las cifras salen siempre de los datos de Al límite, y un programa revisa cada respuesta antes de que la leas.",
    needs_key: "Para conversar hace falta un modelo de IA: pon tu proveedor y tu clave en «AI model settings», abajo. La clave se queda en tu navegador.",
    ready: "Agentes conectados a esta página.",
    failed: "Los agentes no se han podido cargar. La web sigue funcionando sin ellos.",
    loading: "Cargando los agentes…",
    idle: "Los agentes se cargan al abrir este panel.",
    check: "Revisión por código",
    figures: (t, n) => n ? `${t} de ${n} cifras encontradas en los datos que ha leído esta conversación` : "Sin cifras",
    interval: "intervalo de confianza indicado",
    no_interval: "falta el intervalo de confianza",
    caveat: "aclara que no es una prueba",
    no_caveat: "falta aclarar que no es una prueba",
    tone: "sin lenguaje acusatorio ni nombres",
    untraced: list => `No encontradas en los datos: ${list}. Tómalas con cautela.`,
    accusatory: "Lenguaje acusatorio o nombres de empresas: no lo des por bueno.",
    how: "Cómo se revisa",
    how_text: "El programa compara cada número de la respuesta con los que devolvieron las herramientas de Al límite en esta conversación (y con los de tu pregunta). Comprueba también que cada razón lleve su intervalo del 95 %, que se diga que el indicador no es una prueba y que no haya lenguaje acusatorio ni nombres de empresas. No juzga si la explicación es la mejor posible.",
  },
  en: {
    greeting: "I can look up any body in the data, give you its figures just under the limit with their confidence interval, list its contracts with the official link, explain the method and open its page. Figures always come from Al límite's data, and a program checks every answer before you read it.",
    needs_key: "Chatting needs an AI model: add your provider and key in “AI model settings” below. The key stays in your browser.",
    ready: "Agents connected to this page.",
    failed: "The agents could not load. The site still works without them.",
    loading: "Loading the agents…",
    idle: "The agents load when you open this panel.",
    check: "Checked by code",
    figures: (t, n) => n ? `${t} of ${n} figures found in the data this chat read` : "No figures",
    interval: "confidence interval given",
    no_interval: "confidence interval missing",
    caveat: "says it is not proof",
    no_caveat: "does not say it is not proof",
    tone: "no accusatory wording or names",
    untraced: list => `Not found in the data: ${list}. Treat with care.`,
    accusatory: "Accusatory wording or company names: do not take it at face value.",
    how: "How it is checked",
    how_text: "The program compares every number in the answer with those Al límite's tools returned in this chat (and those in your question). It also checks that each ratio comes with its 95% interval, that the answer says the indicator is not proof, and that there is no accusatory wording or company name. It does not judge whether the explanation is the best possible one.",
  },
};
const tx = () => TEXT[App.page.lang()] || TEXT.en;

export class AssistantMount {
  /** No action on this site is irreversible, so no dialog of its own. Partner actions get the runtime's. */
  static DIALOGS = {};

  static engine = null;
  static booting = null;

  /**
   * Wire the buttons that open the panel (any [data-ask], also those the page draws later)
   * and the close button. The runtime boots on the first open.
   */
  static wire() {
    const panel = document.querySelector("#assistant");
    const close = document.querySelector("#assistant-close");
    let opener = null;
    const setOpen = open => {
      panel.hidden = !open;
      document.body.classList.toggle("asking", open);
      document.querySelectorAll("[data-ask]").forEach(b => b.setAttribute("aria-expanded", String(open)));
      if (open) {
        AssistantMount.start().then(() => { if (!panel.hidden) (document.querySelector("#ns-input") || close).focus(); });
        close.focus();
      } else {
        (opener && opener.isConnected ? opener : document.querySelector(".top [data-ask]"))?.focus();
      }
    };
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-ask]");
      if (!b) return;
      opener = b;
      setOpen(panel.hidden);
    });
    close.addEventListener("click", () => setOpen(false));
    panel.addEventListener("keydown", e => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false); });
    document.querySelector("#assistant-status").textContent = tx().idle;
    if (/[?&]ask(=|&|$)/.test(location.search)) setOpen(true);
  }

  /**
   * Boot the runtime once and report the result in the status line.
   *
   * :return: The runtime engine, or null when boot failed.
   */
  static start() {
    if (!AssistantMount.booting) AssistantMount.booting = AssistantMount.boot();
    return AssistantMount.booting;
  }

  static async boot() {
    const status = document.querySelector("#assistant-status");
    status.textContent = tx().loading;
    const siteBase = new URL("./", import.meta.url).href;
    try {
      // Load the runtime here, so a missing or broken runtime is reported too.
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      const engine = booted.engine;
      AssistantMount.engine = engine;
      AssistantMount.defaultReview = engine.onActionConfirm;
      engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = engine.onConsent;
      engine.onConsent = AssistantMount.consent;
      AssistantMount.checkEveryAnswer(engine, booted.trace);
      const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");
      status.textContent = needsKey ? tx().needs_key : tx().ready;
      if (!needsKey) AssistantMount.greet();
      return engine;
    } catch (error) {
      // The page must keep working without the assistant.
      status.textContent = tx().failed;
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /** Replace the runtime's general first chat message with the greeting. */
  static greet() {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) first.textContent = tx().greeting;
  }

  /**
   * Check each answer with code once the turn ends, and show the result under it. The check
   * uses only what the site's tools returned in this page, so it cannot be talked round.
   */
  static checkEveryAnswer(engine, trace) {
    const run = engine.runTurn.bind(engine);
    engine.runTurn = async (userText, options) => {
      const result = await run(userText, options);
      try {
        const report = AssistantMount.report(result?.text || "", userText);
        if (report) {
          trace?.note("honesty_check", { verdict: report.verdict, figures: report.figures, problems: report.problems });
          AssistantMount.attach(report);
        }
      } catch (error) {
        console.error("Honesty check failed", error);
      }
      return result;
    };
  }

  /** The honesty check of one answer against this page's session ledger. */
  static report(answer, question) {
    if (!answer.trim()) return null;
    const tools = new AgentTools(siteData());
    const ledger = HonestyCheck.ledger([...tools.baseResults(), ...SESSION.results], [question]);
    return HonestyCheck.check(answer, ledger);
  }

  /**
   * Put the check under the answer's bubble once the chat has drawn it: the first answer
   * bubble after the visitor's last message.
   */
  static attach(report, tries = 0) {
    const all = [...document.querySelectorAll("#ns-msgs .ns-msg")];
    const lastUser = all.map(e => e.classList.contains("user")).lastIndexOf(true);
    const bubble = all.slice(lastUser + 1).find(e => e.classList.contains("bot") && !e.dataset.checked
      && !e.matches(".ns-turn-status, .ns-consent, .ns-linker, .ns-action-window"));
    if (!bubble) {
      if (tries < 60) setTimeout(() => AssistantMount.attach(report, tries + 1), 50);
      return;
    }
    bubble.dataset.checked = report.verdict;
    bubble.after(AssistantMount.badge(report));
  }

  static badge(report) {
    const t = tx();
    const el = document.createElement("details");
    el.className = `honesty ${report.ok ? "pass" : "fail"}`;
    const summary = document.createElement("summary");
    const parts = [t.figures(report.figures.traced, report.figures.found)];
    if (report.interval_stated !== null) parts.push(report.interval_stated ? t.interval : t.no_interval);
    if (report.caveat_stated !== null) parts.push(report.caveat_stated ? t.caveat : t.no_caveat);
    if (!report.accusatory.length && !report.company_names.length) parts.push(t.tone);
    summary.innerHTML = `<b>${report.ok ? "✓" : "⚠"} ${t.check}</b> <span></span>`;
    summary.querySelector("span").textContent = parts.join(" · ");
    el.append(summary);
    const body = document.createElement("div");
    if (report.figures.untraced.length) {
      const p = document.createElement("p");
      p.textContent = t.untraced(report.figures.untraced.join(", "));
      body.append(p);
    }
    if (report.accusatory.length || report.company_names.length) {
      const p = document.createElement("p");
      p.textContent = t.accusatory;
      body.append(p);
    }
    const how = document.createElement("p");
    how.className = "honesty-how";
    how.textContent = `${t.how}: ${t.how_text}`;
    body.append(how);
    el.append(body);
    if (!report.ok) el.open = true;
    return el;
  }

  /**
   * Ask the visitor to confirm actions before they run. This site has no irreversible action;
   * anything else, such as a partner site's action, gets the runtime's own dialog.
   */
  static async review(items) {
    const confirmed = await AssistantMount.defaultReview(items);
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /** Show the runtime's consent card for another site, focus it, then give focus back. */
  static async consent(info) {
    const answer = AssistantMount.defaultConsent(info);
    AssistantMount.focusConsentCard();
    const decision = await answer;
    AssistantMount.keepFocusInChat();
    return decision;
  }

  static focusConsentCard() {
    const cards = document.querySelectorAll("#ns-msgs .ns-consent");
    const card = cards[cards.length - 1];
    const title = card ? card.querySelector(".ns-consent-title") : null;
    if (!title) return;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", title.textContent);
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("#agent-app")) return;
    title.tabIndex = -1;
    title.focus();
  }

  static keepFocusInChat() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector("#ns-input")?.focus();
    }
  }
}

// Boot only in a browser. Node tests import this file to check the honesty report.
if (typeof window !== "undefined" && document.querySelector("#assistant")) {
  AssistantMount.wire();
}
