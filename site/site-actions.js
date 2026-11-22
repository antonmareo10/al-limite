// Registers Al límite's operations with the agent runtime (agent-manifest.json → actions.module).
// Only the names in actions.agentTools become model tools, called website_<name>.
// The reads come from agent-tools.js, which the bridge for other agent sites shares too.
// Every result is also kept in SESSION, so site.js can check each answer against what the
// tools really returned in this page (the honesty check under each answer).
import { App } from "./app.js";
import { AgentTools } from "./agent-tools.js";
import { siteData } from "./core.js";

/** What the tools returned in this page, for the honesty check. Never sent anywhere. */
export const SESSION = { results: [] };

class SiteActions {
  static tools = new AgentTools(siteData(), new URL("./", import.meta.url).href);

  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static async registerActions(actions) {
    // The schemas and checks need the index loaded.
    await siteData().load();
    for (const definition of SiteActions.tools.reads()) {
      actions.register(SiteActions.recorded(definition));
    }
    actions.register(SiteActions.openBodyPageAction());
  }

  /** Keep each result of a read in SESSION, unchanged. */
  static recorded(definition) {
    const run = definition.execute;
    return {
      ...definition,
      async execute(args, context) {
        const result = await run(args, context);
        if (definition.name !== "check_answer") SESSION.results.push(result);
        return result;
      },
    };
  }

  /**
   * The only action that changes something: the page behind the chat. The visitor undoes it
   * with the browser's back button, so it is a write and runs without a dialog.
   */
  static openBodyPageAction() {
    return {
      name: "open_body_page",
      description: "Open a body's page on this site behind the chat, with its charts, its contracts and their official links. Call it only when the visitor asks to see or open the page, with the id from website_look_up_body. Returns the page's link.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 40, description: "The body id from website_look_up_body." },
        },
      },
      execute: args => App.page.openBody(args.id),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
