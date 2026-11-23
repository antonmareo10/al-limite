---
name: al-limite-mcp
description: Read-only MCP server with Al límite's indicator for Spanish minor public contracts (contratos menores, 2023-2025) bunched just under the legal no-tender limits of €15,000 (services and supplies) and €40,000 (works). Use it when someone asks whether a Spanish public body (ayuntamiento, diputación, ministry, university, public company) has many contracts just under the limit, wants those contracts with links to the official records, the national figures, the ranking or the method, or asks about possible contract splitting (fraccionamiento). Also use check_answer to verify, with code, any draft answer about these figures before showing it.
license: MIT
compatibility: Needs HTTPS access to al-limite-agent.vercel.app. Any MCP client with Streamable HTTP transport (protocol 2025-06-18), or plain JSON-RPC over HTTP POST (curl). No account or key.
metadata:
  author: Antonio González Fernández
  version: "1.0"
  endpoint: https://al-limite-agent.vercel.app/api/mcp
  source: https://github.com/antonmareo10/al-limite/tree/agentic-web
---

# Al límite MCP server

Al límite measures, for each of 7,663 Spanish contracting bodies, how many minor contracts sit in the last stretch
before the legal limit compared with how many would be expected, with a 95% interval. This server gives an agent the
same six read tools that the site's own browser agents use, over the Model Context Protocol. It never writes anything.

The figures are a statistical indicator, **not proof of wrongdoing**. Many amounts just under the limit are a reason
to look at the files, not evidence that any contract was split or that anyone did wrong.

## Connect

- **Endpoint:** `https://al-limite-agent.vercel.app/api/mcp`
- **Transport:** MCP Streamable HTTP, protocol `2025-06-18`. One JSON-RPC message per `POST`; the answer comes back
  as plain JSON on the same request (no event stream, no session id). `GET` returns 405. Batches are refused.
- **Auth:** none. CORS is open (`*`), so browser agents can call it too.

Any MCP client that takes a URL works, for example `claude mcp add --transport http al-limite <endpoint>`. Without a
client, use curl:

```bash
curl -s -X POST https://al-limite-agent.vercel.app/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"look_up_body","arguments":{"query":"Ayuntamiento de Ourense"}}}'
```

Each tool result has `structuredContent` (the object) and the same object as JSON text in `content[0].text`.

## Workflow

1. **Find the body** with `look_up_body` (Spanish name, as people say it; a town's name finds its town council
   first). Keep `body.id`.
2. **Read what the question needs:** `list_contracts_near_limit` for the contracts, `get_ranking` for "who else",
   `get_national_overview` for Spain as a whole or "is this just round numbers?", `get_method` for how it works.
3. **Draft the answer using only figures from those results.** Give every ratio with its 95% interval, say it is a
   statistical indicator and not proof, and never name an awardee (they are letters: Awardee A, B…).
4. **Check the draft** with `check_answer`, passing `body_ids` and the user's `question`. If `ok` is false, fix each
   item in `problems` and check again. Show the user only a draft that passes.

## Tools

All six are read-only (`readOnlyHint: true`). The tool descriptions mention `website_look_up_body`: that is the same
tool's name inside the browser runtime. Over MCP, call `look_up_body`.

### `look_up_body`

A body's indicator for each rule. Arguments: `query` (name, 3-120 characters) **or** `id` (from an earlier result).
Returns `body` (`id`, `name`, `kind`, `path`, `minor_contracts_analysed`, `page`, `indicators`) and up to 5
`other_matches`. Each indicator has `rule`, `legal_limit_eur`, `near_limit_band_eur`, `contracts_near_limit`,
`reference_band_eur`, `contracts_in_reference_band`, `expected_near_limit`, `ratio_observed_to_expected`, `ci95`,
`level`, `amount_near_limit_eur`, awardee counts, `december_share_percent`, `by_year` and `notes`.

### `list_contracts_near_limit`

A body's contracts just under the limit, newest first. Arguments: `id` or `query`; `rule` (`services_and_supplies` or
`works`, default the rule with the strongest level); `limit` (1-25, default 10). Each contract has `awarded`,
`amount_eur` (before tax), `file_no`, `awardee` (a letter), sometimes `cpv_family`, and `official_record` (link to
the Spanish procurement platform). Also `repeat_awardees` and `contracts_near_limit_total`.

### `get_ranking`

Bodies with a bunching signal, sorted by the lower bound of the 95% interval (the most cautious reading).
Arguments: `rule` (default `services_and_supplies`), `kind` (`bodies` or `entities`, which groups all bodies that
share a tax id; default `bodies`), `limit` (1-25, default 10). It is a list of where to look, not a list of offenders.

### `get_national_overview`

Spain as a whole, no arguments: contracts analysed, observed vs expected per rule with the interval, bodies with a
signal, the ratio by year, the December check, the check with fake limits (which shows the wall is not just a
taste for round numbers), coverage, source and `data_generated`.

### `get_method`

One section of the method page. Arguments: `topic` (required: `idea_and_legal_basis`, `data`, `calculation`,
`uncertainty`, `levels`, `bodies_and_entities`, `checks`, `ai_use`, `limits`, `reproduce`, `references`) and `lang`
(`en` or `es`, default `en`). Use it instead of answering about the method or the law from memory.

### `check_answer`

Checks a draft with deterministic code, no model. Arguments: `answer` (the draft exactly as it will be shown, up to
6,000 characters, English or Spanish), `body_ids` (up to 10, from `look_up_body`), `question` (the user's question,
whose own numbers the answer may repeat). Returns `ok`, `verdict` (`pass` or `fail`), `figures.untraced`,
`interval_stated`, `caveat_stated`, `accusatory`, `company_names` and `problems` (one sentence per thing to fix).
A failing check comes back with `isError: true`; read `problems` and rewrite.

What it enforces:

- Every figure must be in the published data it rebuilds for that answer: the national figures, the top 25 of each
  ranking, the method sections on calculation, levels and limits, and everything the tools return for each body in
  `body_ids`. Counts must match exactly; decimals may be rounded. A number you computed yourself (a percentage, a
  difference, a sum) is not traced and fails.
- A ratio needs its 95% interval next to it.
- An answer about the indicator must say it is a statistical indicator, not proof.
- No accusatory words (fraud, illegal, corruption, splitting… unless negated) and no company names.
- Links, list numbers, legal references and the user's own numbers are not treated as data claims.

## Examples

Every request below runs against the published data in the repository's tests, and each result excerpt must match
the server's real output (`tests/agentic/skill.test.mjs`).

**"Does the Ayuntamiento de Ourense have many contracts just under the limit?"**

```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "look_up_body", "arguments": {"query": "Ayuntamiento de Ourense"}}}
```

```json
{"ok": true, "body": {"id": "30985210142281", "name": "Junta de Gobierno del Ayuntamiento de Ourense",
  "indicators": [{"rule": "services_and_supplies", "legal_limit_eur": 15000, "near_limit_band_eur": [14000, 15000],
    "contracts_near_limit": 163, "expected_near_limit": 21.4, "ratio_observed_to_expected": 7.62,
    "ci95": [5.93, 9.81], "level": "Bunching signal"}]}}
```

```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "list_contracts_near_limit", "arguments": {"id": "30985210142281", "limit": 2}}}
```

```json
{"ok": true, "rule": "services_and_supplies", "contracts_near_limit_total": 163, "shown": 2,
  "contracts": [{"awarded": "2025-12-23", "amount_eur": 14445, "file_no": "2025058789", "awardee": "Awardee AZ"},
                {"awarded": "2025-12-22", "amount_eur": 14920, "file_no": "2025059469", "awardee": "Awardee AH"}]}
```

Draft, then check it:

```json
{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "check_answer", "arguments": {"answer": "The Ayuntamiento de Ourense has 163 services and supplies contracts just under the €15,000 limit, where about 21.4 would be expected: 7.62 times as many (95% interval 5.93 to 9.81), a bunching signal. It is a statistical indicator, not proof of wrongdoing.", "body_ids": ["30985210142281"], "question": "Does the Ayuntamiento de Ourense have many contracts just under the limit?"}}}
```

```json
{"ok": true, "verdict": "pass", "figures": {"untraced": []}, "interval_stated": true, "caveat_stated": true, "problems": []}
```

**A draft that must not be shown:**

```json
{"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "check_answer", "arguments": {"answer": "The Ayuntamiento de Ourense has 170 contracts just under the limit, 8 times what is expected. This is fraud.", "body_ids": ["30985210142281"]}}}
```

```json
{"ok": false, "verdict": "fail", "figures": {"untraced": ["170"]}, "interval_stated": false, "caveat_stated": false,
  "accusatory": ["This is fraud."],
  "problems": [
    "Figures not found in any tool result: 170. Use only figures from tool results, as given or rounded; do not compute new ones.",
    "A ratio is given without its 95% interval. Give both bounds next to it.",
    "The answer discusses the indicator but does not say it is a statistical signal, not proof of wrongdoing. Add that caveat.",
    "Accusatory wording: \"This is fraud.\". Never suggest fraud, illegality or splitting; the indicator is only a reason to look at the files."]}
```

**"Is this a Spain-wide pattern, or just round numbers?"**

```json
{"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "get_national_overview", "arguments": {}}}
```

```json
{"ok": true, "period": ["2023-01-01", "2025-12-31"], "contracting_bodies": 7663,
  "rules": [{"rule": "services_and_supplies", "minor_contracts": 1374964, "contracts_near_limit": 68251,
    "expected_near_limit": 19008.6, "ratio_observed_to_expected": 3.59, "ci95": [3.56, 3.63], "bodies_with_signal": 684}],
  "data_generated": "2026-11-15"}
```

Then read `fake_limit_check.points` in the same result: the ratio at invented limits from €7,000 to €18,000.

**"Can a university sign bigger minor contracts?"**

```json
{"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "get_method", "arguments": {"topic": "limits", "lang": "en"}}}
```

```json
{"ok": true, "topic": "limits", "lang": "en"}
```

The `text` says that public research bodies can treat contracts of up to €50,000 as minor in some cases, so a wall
at €15,000 is less expected for them.

## Levels

| `level` | Meaning |
|---|---|
| `Bunching signal` | At least 10 contracts just under the limit, q-value below 0.01, and the interval's lower bound is 2 or more |
| `Weak hint` | q-value below 0.05 and lower bound above 1 |
| `No signal` | Everything else that could be assessed |
| `Sample too small` | Fewer than 30 contracts across the two bands; not assessed |

The near-limit band is €14,000-15,000 for services and supplies and €37,500-40,000 for works. The expected count
comes from a reference band five times as wide just below it (€9,000-14,000 and €25,000-37,500).

## Limits

- **Not proof.** The indicator cannot say whether a contract was split or broke the law. That takes reading the
  files. Amounts near the limit can come from market prices, fixed budgets or separate needs. Do not give legal
  advice.
- **No names.** Awardees are letters; their names are only in each contract's official record. Do not look them up
  and name them in the answer.
- **Coverage.** Only bodies that publish on Spain's national procurement platform (Plataforma de Contratación del
  Sector Público). Bodies on regional platforms (for example Catalonia, the Basque Country, Madrid, Andalusia or
  Galicia) are missing. A "no match" for them means "not in the data", not "no contracts".
- **Period and freshness.** Contracts awarded from 2023-01-01 to 2025-12-31; a fixed snapshot (`data_generated`),
  not live data.
- **Amounts.** Award amount before tax (the budget if the award amount is missing). The legal limit refers to the
  estimated value, which is published less reliably.
- **Names are Spanish.** Search with the Spanish name ("Ayuntamiento de…", "Universidad de…"). `get_method` and
  `check_answer` work in English and Spanish.
- **`check_answer` checks numbers, not meaning.** A real figure used for the wrong thing in the same answer (for
  example a town's count presented as a national one, when that town is in `body_ids`) can still pass. Figures from
  method sections other than calculation, levels and limits, or from ranking rows beyond the top 25, are not in its
  ledger.
- **Read-only and small.** Six reads only; the site's `open_body_page` action is browser-only. At most 25 rows per
  call. Every result stays under 64 KB.
- **Errors.** Bad arguments come back as a tool result with `isError: true` and a readable message; an unknown tool
  name is a JSON-RPC error `-32602`, an unknown method `-32601`. A body that is not found returns `ok: false` with a
  `reason` saying what to try.
- **Hosting.** A free serverless function, with no uptime guarantee and no rate promise. Keep calls to what the
  question needs.

## More

- Site with the browser agents: <https://al-limite-agent.vercel.app/?ask>
- Method: <https://al-limite-agent.vercel.app/#/metodo>
- Code (MIT): <https://github.com/antonmareo10/al-limite/tree/agentic-web> (`site/mcp-server.js`, `site/agent-tools.js`,
  `site/honesty.js`)
