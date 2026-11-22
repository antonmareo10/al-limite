// Mounts the assistant inside the page. The runtime (runtime/) is nsdeploy's browser runtime as
// adapted by the agentify-website skill, copied unchanged.
import { App } from "./request.js";

const TEXT = {
  es: {
    greeting: "Dime de qué organismo quieres ver contratos. Con tu permiso, pregunto a Al límite cuáles se quedan junto al límite legal y relleno la solicitud con sus números de expediente y enlaces oficiales. Tus datos personales los añades tú en el escrito.",
    needs_key: "Para conversar hace falta un modelo de IA: pon tu proveedor y tu clave en «AI model settings», abajo.",
    ready: "Asistente conectado a esta página.",
    failed: "El asistente no se ha podido cargar. Puedes usar el formulario directamente.",
  },
  en: {
    greeting: "Tell me which body's contracts you want to see. With your permission I ask Al límite which ones sit just under the legal limit, and fill in the request with their file numbers and official links. You add your personal details to the letter yourself.",
    needs_key: "Chatting needs an AI model: add your provider and key in “AI model settings” below.",
    ready: "Assistant connected to this page.",
    failed: "The assistant could not load. You can still use the form directly.",
  },
};
const tx = () => TEXT[App.page.lang] || TEXT.en;

export class AssistantMount {
  static DIALOGS = {};

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", { originUrl: siteBase, sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
      const needsKey = !booted.engine.mockLLM && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey ? tx().needs_key : tx().ready;
      if (!needsKey) {
        const first = document.querySelector("#ns-msgs .ns-msg.bot");
        if (first) first.textContent = tx().greeting;
      }
      return booted.engine;
    } catch (error) {
      status.textContent = tx().failed;
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /** No action here is irreversible; a partner's action gets the runtime's own dialog. */
  static async review(items) {
    const confirmed = await AssistantMount.defaultReview(items);
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /** The runtime's consent card for Al límite: name it for screen readers and focus it. */
  static async consent(info) {
    const answer = AssistantMount.defaultConsent(info);
    const cards = document.querySelectorAll("#ns-msgs .ns-consent");
    const card = cards[cards.length - 1];
    const title = card ? card.querySelector(".ns-consent-title") : null;
    if (title) {
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", title.textContent);
      const active = document.activeElement;
      if (!active || active === document.body || active.closest("#agent-app")) {
        title.tabIndex = -1;
        title.focus();
      }
    }
    const decision = await answer;
    AssistantMount.keepFocusInChat();
    return decision;
  }

  static keepFocusInChat() {
    if (document.activeElement === document.body || document.activeElement === null) document.querySelector("#ns-input")?.focus();
  }
}

if (typeof window !== "undefined") await AssistantMount.start();
