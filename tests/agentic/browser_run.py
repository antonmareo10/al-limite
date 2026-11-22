"""End-to-end run in headless Chromium with a real model: a local OpenAI-compatible server
(llama.cpp's llama-server with Qwen3-4B, no key, no paid API).

It opens the site, applies the visitor's model setup for the tab (the same settings the
"AI model settings" panel saves), asks each question in the chat and records what happened:
the answer, the honesty check under it, every agent and tool call from the runtime's trace,
and timings. Nothing is faked: if the model fails, the record says so.

Usage:
  python -I tests/agentic/browser_run.py --site http://127.0.0.1:8080/ --router http://127.0.0.1:8089/v1 \
      --model qwen3-4b --out runs/2026-11-22 "question 1" "question 2"
"""
import argparse
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--site", required=True)
ap.add_argument("--router", required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--lang", default="en-GB")
ap.add_argument("--timeout", type=int, default=900)
ap.add_argument("--consent", default="allow", choices=["allow", "decline"])
ap.add_argument("--fresh", action="store_true", help="a new page for each question, as a first message")
ap.add_argument("questions", nargs="+")
a = ap.parse_args()
sys.stdout.reconfigure(encoding="utf-8")
out = pathlib.Path(a.out)
out.mkdir(parents=True, exist_ok=True)

SETUP = """(([router, model]) => {
  // The tab's model setup, as the settings panel applies it (runtime/byok.js). A local
  // llama-server needs no key; the runtime only needs a non-empty one.
  try {
    sessionStorage.setItem("nsweb-byok-tab-key", "local-no-key");
    sessionStorage.setItem("nsweb-byok-router", router);
    sessionStorage.setItem("nsweb-byok-model", model);
  } catch (e) {}
})"""

TRACE = """(from) => {
  const all = window.__nsweb.trace.events;
  const ev = all.slice(from);
  // Which agent made each call: walk up the span tree to the nearest agent span.
  const spans = new Map();
  for (const e of all) if (e.phase === "start") spans.set(e.id, e);
  const agentOf = id => { let s = spans.get(id); while (s && s.kind !== "agent") s = spans.get(s.parent); return s ? s.agent : null; };
  const rows = [];
  for (const e of ev) {
    if (e.phase === "start" && e.kind === "agent") rows.push({ t: e.wall, kind: "agent", agent: e.agent, network: e.network, origin: e.origin });
    if (e.phase === "end" && e.kind === "tool") rows.push({ t: e.wall, kind: "tool", by: agentOf(e.parent), tool: e.tool, args: e.args, ms: Math.round(e.durationMs), result: (e.resultPreview || "").slice(0, 240), status: e.status });
    if (e.phase === "end" && e.kind === "model_call") rows.push({ t: e.wall, kind: "model_call", by: agentOf(e.parent), ms: Math.round(e.durationMs), status: e.status, error: e.error || null });
    if (e.phase === "end" && e.kind === "remote_call") rows.push({ t: e.wall, kind: "remote_call", peer: e.peerOrigin, network: e.network, status: e.status, sly_data_keys: Object.keys((e.requestPayload || {}).sly_data || {}) });
    if (e.phase === "note" && ["consent", "composition_limit", "composition_skip", "honesty_check"].includes(e.kind)) rows.push({ t: e.wall, kind: e.kind, ...Object.fromEntries(Object.entries(e).filter(([k]) => !["phase", "seq", "t", "wall", "parent"].includes(k))) });
  }
  return rows;
}"""

record = {"site": a.site, "router": a.router, "model": a.model, "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "turns": []}
errors = []
ANSWER = """() => {
  // The answer bubble and the honesty check after the visitor's last message, if any.
  const all = [...document.querySelectorAll('#ns-msgs > *')];
  const lastUser = all.map(e => e.matches('.ns-msg.user')).lastIndexOf(true);
  const after = all.slice(lastUser + 1);
  const bubble = after.find(e => e.matches('.ns-msg.bot') && !e.matches('.ns-turn-status, .ns-consent'));
  const badge = after.find(e => e.matches('.honesty'));
  return { answer: bubble ? bubble.innerText : null, badge: badge ? badge.innerText : null };
}"""


def open_page(b):
    ctx = b.new_context(locale=a.lang, viewport={"width": 1440, "height": 1000})
    ctx.add_init_script(f"{SETUP}({json.dumps([a.router, a.model])})")
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"console {m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(a.site + ("&" if "?" in a.site else "?") + "ask")
    # Poll rather than wait_for_function: the site's Content-Security-Policy forbids eval.
    for _ in range(240):
        if page.evaluate("() => window.__nsweb !== undefined"):
            break
        page.wait_for_timeout(250)
    page.wait_for_timeout(1500)
    return ctx, page


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, page = open_page(b)
    for i, q in enumerate(a.questions, 1):
        if a.fresh and i > 1:
            ctx.close()
            ctx, page = open_page(b)
        start = time.time()
        n_before = page.evaluate("window.__nsweb.trace.events.length")
        page.fill("#ns-input", q)
        page.click("#ns-send")
        page.wait_for_selector('.ns-inputbar[data-turn-active="true"]', timeout=20000)
        # Answer each consent card as asked.
        deadline = time.time() + a.timeout
        while time.time() < deadline:
            if page.query_selector('.ns-inputbar[data-turn-active="false"]'):
                break
            if page.query_selector(".ns-consent-actions button"):
                label = "allow" if a.consent == "allow" else "decline"
                for cand in page.query_selector_all(".ns-consent-actions button"):
                    if cand.inner_text().strip().lower().startswith(label):
                        cand.click()
                        break
            page.wait_for_timeout(1000)
        page.wait_for_timeout(1500)
        secs = round(time.time() - start, 1)
        got = page.evaluate(ANSWER)
        trace = page.evaluate(f"({TRACE})({n_before})")
        page.screenshot(path=str(out / f"turn{i}.png"))
        turn = {"question": q, "seconds": secs, "answer": got["answer"], "honesty_badge": got["badge"], "trace": trace}
        record["turns"].append(turn)
        (out / "run.json").write_text(json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"--- Q{i} ({secs}s): {q}", got["answer"], f"[{got['badge']}]", "", sep="\n")
    b.close()
record["console_errors"] = errors
(out / "run.json").write_text(json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8")
print("console errors:", errors or "none")
