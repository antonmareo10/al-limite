// The actions Al límite shares with other agent sites, through its action bridge.
// The build names this file in bridge/agent-manifest.json. When another site's assistant runs
// Al límite's network, the bridge loads this file in a hidden frame on this site's origin, which
// has no page. Only the names in the manifest's "actions.agentTools" reach the partner's agents.
//
// All of them are reads of public data the site already shows to anyone, so they are shared
// with every site ("*"). The one page action, open_body_page, is not shared: the partner's
// visitor is not on this page.
import { AgentTools } from "../agent-tools.js";
import { siteData } from "../core.js";

class BridgeActions {
  static CALLERS = ["*"];

  /**
   * Register the shared reads.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static async registerActions(actions) {
    await siteData().load();
    const tools = new AgentTools(siteData(), new URL("../", import.meta.url).href);
    for (const definition of tools.reads()) {
      actions.register({ ...definition, availability: "bridge", callerOrigins: BridgeActions.CALLERS });
    }
  }
}

// The bridge calls the module's registerActions export.
export const registerActions = BridgeActions.registerActions;
