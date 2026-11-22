# Recorded agent runs

Real runs of the agents in headless Chromium, recorded with `tests/agentic/browser_run.py` on 22 November 2026,
against open models served locally by llama.cpp (Vulkan, laptop integrated GPU) with no paid API. Each `run.json`
holds the question, the answer as the page showed it, the stamp under it, and every agent, model call and tool
call the runtime traced. Nothing was edited. `turn1.png` is the page at the end of the first question.

| Folder | Model | Where | Questions | `caution_check` called | Page check |
|---|---|---|---|---|---|
| `qwen3-4b-site-three-agents` | Qwen3-4B | site, first design with a third `data_desk` agent | 1 | 0 (the guide read the data itself) | 1 pass |
| `qwen3-4b-site-same-chat` | Qwen3-4B | site, three questions in one chat | 3 | 0 | 3 flagged (no caveat; the 2nd and 3rd reused figures from the 1st) |
| `qwen3-4b-site` | Qwen3-4B | site, a new page per question | 3 | 0 | 3 pass |
| `qwen3-8b-site` | Qwen3-8B | site, a new page per question | 2 | 1 | 2 pass |
| `qwen3-8b-site-2` | Qwen3-8B | site, a new page per question | 4 | 0 | 4 pass |
| `qwen3-8b-site-3` | Qwen3-8B | site | 1 | 1 | 1 pass |
| `qwen3-4b-second-site` | Qwen3-4B | Pide el expediente (local copy) calling the live Al límite network | 1 | — | The cross-site call ran; the model passed a poor request and filled no letter |
| `qwen3-8b-second-site` | Qwen3-8B | same | 1 | — | Full flow: consent card, Al límite's network from its live origin, two reads through its bridge, the letter filled with 5 real contracts (212 s) |
| `qwen3-8b-second-site-2` | Qwen3-8B | same, another body | 1 | — | Full flow again, for the Diputación Provincial de Ourense (256 s); `turn1_full.png` is in `docs/agentic/` |

Totals on the site: Qwen3-4B, 7 questions, `caution_check` 0 times, 4 answers passed the page check and 3 were
flagged. Qwen3-8B, 7 questions, `caution_check` 2 times, 7 answers passed.

The `qwen3-4b-site-same-chat` run used an earlier page check that counted every tool result of the chat; after it
the check counts only what the tools returned for each answer, so figures repeated from an earlier answer are
flagged too. The verdicts in that run (missing caveat) do not depend on that change.

To rebuild the five runs shown on the site's Agents page: `powershell -File tests/agentic/make_recorded.ps1`.
