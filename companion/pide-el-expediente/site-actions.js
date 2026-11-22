// Registers the page's operations with the agent runtime (agent-manifest.json → actions.module).
// Only the names in actions.agentTools become model tools, called website_<name>.
import { App, PARTNER } from "./request.js";

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.getRequestAction());
    actions.register(SiteActions.fillRequestAction());
  }

  static getRequestAction() {
    return {
      name: "get_request",
      description: "Read the request on this page: the body, the contract files, what it asks for, the letter's draft, how and where to file it, and the link to Al límite. Call it before answering about the request or how to file it, and again in each turn that needs it.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ ...App.page.getState(), al_limite: PARTNER }),
    };
  }

  static fillRequestAction() {
    return {
      name: "fill_request",
      description: "Fill in the request on this page: the body, its contracts (file numbers, award dates, amounts and official links, exactly as Al límite gave them) and what to ask for. It replaces the form and redraws the letter; the visitor can still edit both. Call it only when the visitor asks for a request. Never pass the visitor's personal details. Returns the new draft, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1, maxLength: 200, description: "The public body's name, as Al límite or the visitor gave it." },
          files: {
            type: "array",
            maxItems: 25,
            description: "The contracts to ask about.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["file_no"],
              properties: {
                file_no: { type: "string", minLength: 1, maxLength: 60, description: "The file number (expediente)." },
                awarded: { type: "string", minLength: 10, maxLength: 10, description: "Award date, YYYY-MM-DD." },
                amount_eur: { type: "number", minimum: 0, maximum: 1000000000, description: "Amount in euros, without taxes." },
                official_record: { type: "string", maxLength: 1000, description: "The official record link on contrataciondelestado.es." },
              },
            },
          },
          items: {
            type: "array",
            maxItems: 4,
            items: { type: "string", enum: ["necesidad", "gasto", "factura", "completo"] },
            description: "What to ask for from each contract: necesidad (report justifying the need), gasto (approval of the expenditure), factura (invoice), completo (the complete file). Default: the first three.",
          },
        },
      },
      execute: args => App.page.fill(args),
    };
  }
}

export const registerActions = SiteActions.registerActions;
