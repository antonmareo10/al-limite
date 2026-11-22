"""Turn turns recorded by browser_run.py into site/runs/recorded.json, which the site's
"Agents" page shows as recorded runs. It copies what happened; it never edits an answer.

Usage:
  python -I tests/agentic/make_recorded.py OUT.json \
      "RUN.json|TURN|Title|where it ran|model label" [...]
"""
import json
import sys

AGENT_TOOLS = {"caution_check", "al_limite_guide"}


def steps_of(trace):
    """Agent, tool and timing of each step. The trace lists agent starts and tool ends in
    order; a tool that is itself an agent (a sub-agent or a partner network) ends that agent."""
    stack, out, site = [], [], None
    for row in trace:
        kind = row.get("kind")
        if kind == "agent":
            stack.append((row.get("agent"), row.get("origin")))
            continue
        if kind == "tool" and row.get("tool") in AGENT_TOOLS and len(stack) > 1:
            stack.pop()  # the sub-agent or partner network has ended; its caller made this call
        who, origin = stack[-1] if stack else ("?", None)
        if row.get("by"):
            who = row["by"]
        if kind == "model_call":
            out.append({"agent": who, "ms": row.get("ms", 0), **({"site": origin} if origin and origin != site else {})})
        elif kind == "tool":
            args = row.get("args") or {}
            text = json.dumps(args, ensure_ascii=False)
            if len(text) > 160:
                text = text[:157] + "…"
            out.append({"agent": who, "tool": row.get("tool"), "args": text, "ms": row.get("ms", 0)})
        if site is None and stack:
            site = stack[0][1]
    return out


def main():
    out_path = sys.argv[1]
    runs = []
    for spec in sys.argv[2:]:
        path, turn, title, where, model = spec.split("|")
        # "English // Español" gives both languages.
        two = lambda v: {"en": v.split(" // ")[0], "es": v.split(" // ")[1]} if " // " in v else v
        title, where = two(title), two(where)
        rec = json.load(open(path, encoding="utf-8"))
        t = rec["turns"][int(turn) - 1]
        check = next((r for r in t["trace"] if r.get("kind") == "honesty_check"), None)
        runs.append({
            "title": title,
            "question": t["question"],
            "answer": t["answer"],
            "seconds": t["seconds"],
            "model": model,
            "date": rec["started"][:10],
            "where": where,
            "steps": steps_of(t["trace"]),
            **({"check": {"verdict": check["verdict"], "found": check["figures"]["found"], "traced": check["figures"]["traced"], "problems": check.get("problems") or []}} if check else {}),
        })
    json.dump({"note": "Recorded with tests/agentic/browser_run.py; answers copied as the page showed them.", "runs": runs},
              open(out_path, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(f"{len(runs)} runs -> {out_path}")


main()
