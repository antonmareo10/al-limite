// Just enough of a browser for the site's page modules (app.js, site.js) to load under Node.
// The page draws into stand-ins that accept anything, so the tests check what the agent
// actions return and what they change (location.hash), not the page's HTML: the headless
// browser check in tests/agentic/browser_check.py covers the page itself.
// fetch reads the site's files from disk for file:// URLs.
import { readFile } from "node:fs/promises";

/** An object that accepts any property, call or assignment, and is empty when listed. */
function anything() {
  const target = function () {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined;
      if (prop === "querySelectorAll" || prop === "getElementsByTagName") return () => [];
      if (prop === "querySelector" || prop === "closest") return () => null;
      if (prop === "dataset" || prop === "style") return {};
      if (prop === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (prop in t) return t[prop];
      return anything();
    },
    set(t, prop, value) { t[prop] = value; return true; },
    apply() { return anything(); },
  });
}

/** A file:// fetch for the site's own files; any other URL goes to `fallback`. */
export function diskFetch(fallback = null) {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol === "file:") {
      try {
        const body = await readFile(url);
        const type = url.pathname.endsWith(".json") ? "application/json" : url.pathname.endsWith(".html") ? "text/html" : "application/octet-stream";
        return new Response(body, { status: 200, headers: { "Content-Type": type } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    if (fallback) return fallback(input, init);
    throw new Error(`No network in tests: ${url.href}`);
  };
}

/** Install the stand-ins as globals, before the page modules are imported. */
export function installFakeBrowser({ lang = "en", href = "http://localhost:8080/" } = {}) {
  const store = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  };
  const loc = new URL(href);
  const location = {
    get href() { return loc.href; },
    get hash() { return loc.hash; },
    set hash(v) { loc.hash = v; },
    get search() { return loc.search; },
    get origin() { return loc.origin; },
    get pathname() { return loc.pathname; },
  };
  globalThis.document = anything();
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  Object.defineProperty(globalThis, "navigator", { value: { language: lang }, configurable: true });
  globalThis.location = location;
  globalThis.addEventListener = () => {};
  globalThis.scrollTo = () => {};
  globalThis.innerWidth = 1280;
  globalThis.requestAnimationFrame = f => setTimeout(f, 0);
  globalThis.fetch = diskFetch();
  return { location };
}
