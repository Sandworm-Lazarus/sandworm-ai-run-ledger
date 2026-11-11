# Langfuse read-only exporter / นำเข้า trace เป็น Ledger

Convert completed Langfuse **GENERATION observations** into the browser ledger's JSONL attempt schema. Live fetching uses the documented Public API v2 with cursor pagination and Basic API-key authentication. It never ingests, updates or deletes observations. The official **Langfuse Python SDK 5.2.0** is pinned for the optional transport contract smoke; the exporter itself uses Python's standard library.

```sh
cd integrations/langfuse
python3 -m unittest discover -s tests -v
python3 export.py --input fixtures/observations.json --output ledger.local.jsonl
python3 validate.py
```

Import the JSONL in AI Run Ledger and supply manual rates matching its `model-001`, `model-002` aliases. Missing rates stay unknown in the original ledger. No current prices, billed costs, cache pricing or discounts are inferred.

For your own Langfuse instance, set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` in your process environment, then run:

```sh
python3 export.py --host https://your-langfuse-host.example --output ledger.local.jsonl
```

The host must be an explicit HTTPS origin without a path, query or embedded credentials. HTTP is permitted only for an explicitly selected loopback test server with `--allow-local`. Requests do not follow redirects. Credentials never appear in output or failure messages. Use project-scoped credentials and protect the environment on your host; this tool does not provision or rotate credentials.

## Mapping and privacy

The live request selects `core,basic,model,usage` field groups and excludes `io`, `prompt`, `metadata` and trace-context groups. The exporter allowlists output fields; raw prompts, responses, user/session/trace/observation IDs, model labels and arbitrary metadata are not copied to JSONL. Models become deterministic sorted aliases within one export; attempts receive sequential IDs, so IDs are not stable across reordered exports. Do not merge separate exports without assigning new IDs.

`usageDetails.input/output` (or explicit legacy `usage.input/output` on saved imports) must both be recorded nonnegative integer-valued counts. Missing counts or unfinished/invalid timestamps reject the export instead of becoming zeros. Latency comes from `endTime - startTime`, rounded to milliseconds, bounded to 24 hours. `level == ERROR` maps to ledger `error`; other levels map to `success`, which cannot prove that a provider call succeeded. Retry is taken only from an explicit boolean `metadata.retry` on **saved imports**; live exports exclude metadata and default retry to false. No retry chain is inferred. Only GENERATION records are accepted, so model/tool spans using another type require an explicit future mapping.

Maximum: 1 MiB per upstream page or saved import, 100 records/page, 50 pages, 5,000 records and 100 model aliases. Repeated cursors, duplicate observation IDs, fractional/bool/negative token counts and duplicate JSON keys are rejected. Empty datasets are rejected. Local output uses exclusive creation and never overwrites an existing file.

## SDK and API contract smoke

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-sdk.lock
.venv/bin/python sdk_smoke.py
```

This uses the actual official SDK and an `httpx.MockTransport` response to verify endpoint/query/response compatibility. Unit tests also use a loopback HTTP fixture server. **No authenticated live Langfuse server was available or contacted during validation**; these are contract tests, not an end-to-end server deployment claim. `validate.py` records this distinction and exact source/fixture hashes.

ภาษาไทย: ตัวส่งออกนี้อ่านข้อมูลอย่างเดียวและแปลงเป็น JSONL ที่ Ledger เปิดได้ ไม่ส่ง prompt หรือคำตอบออกมาในไฟล์ ไม่เดา token ที่หายเป็นศูนย์ และไม่ดึงราคาปัจจุบันอัตโนมัติ ตัวอย่างทั้งหมดเป็นข้อมูลสมมติ

Original exporter: repository MIT license. [Langfuse SDK](https://github.com/langfuse/langfuse-python) is MIT licensed. Langfuse server core is MIT, with separate Enterprise-licensed `ee` areas; this integration does not copy or enable Enterprise code and does not deploy a Langfuse server.

## Agent trace explorer (new)

The **AGENT TRACE** panel now shows expandable parent–child observations, start offsets, elapsed time, generation cost and evaluations on the same step. Try the synthetic trace, or run this separate Python worker and import its JSON:

```sh
python3 trace_export.py --input fixtures/trace-observations.json --scores fixtures/scores.json --output trace.local.json
# Existing Langfuse server; keys belong in process environment, never this page:
python3 trace_export.py --host https://your-langfuse-host.example --include-scores --output trace.local.json
```

The live reader requests `/api/public/v2/observations` with `fields=core,basic,model,usage`. In SDK 5.2.0, **`usage` includes `totalCost`**; there is no separate `cost` field group. It does not restrict the observation type to GENERATION. With `--include-scores`, it also reads `/api/public/v3/scores` with `fields=subject&dataType=NUMERIC,BOOLEAN`. Scores are joined through the v3 `subject` (`kind`, `id`, optional `traceId`). Session/experiment scores, scores outside the observation snapshot, and text/categorical/correction scores are excluded and counted. Legacy saved scores using `traceId`/`observationId` are accepted; legacy BOOLEAN 0/1 is normalized, while v3 requires true/false. No score scale or pass threshold is inferred and unlike metrics are never averaged.

Raw `traceId`, observation `id` and `parentObservationId` become export-local `trace-0001`/`obs-00001` aliases while preserving their relationships. Original IDs, observation names, model names, input/output, score comments and metadata are omitted. Aliases are not stable across exports. Missing parents are explicitly marked; cycles, cross-trace parents, mismatched score subjects and more than 32 levels are rejected. Accepted types: SPAN, GENERATION, EVENT, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING and GUARDRAIL. Completed timestamps are required; unfinished observations reject the snapshot so an incomplete trace is not disguised as zero duration. Trace start offsets and each duration must fit within 24 hours.

Costs use recorded `totalCost` in USD. The trace subtotal adds **GENERATION observations only**, preventing a parent span's rolled-up cost being counted again. Missing generation costs make the total unknown; the known subtotal remains visible. Non-generation costs can be inspected but are not summed. These values may be calculated by Langfuse from its model pricing; they are not verified provider invoices. Wall time is `latest end − earliest start`, not the sum of overlapping spans. Tokens remain unknown when absent. The bridge button copies only complete GENERATION token records for the selected trace into the original ledger, where manual rate-card estimates remain a separate calculation; retry is false because it is not inferred.

Limits: 1 MiB per input/API page and final report, 5,000 observations and 5,000 scores, at most 50 pages per endpoint. The two live API reads are **not an atomic snapshot**; delayed ingestion can leave parent/score records missing. Score exclusion counts and missing-parent markers expose those gaps. HTTP redirects are disabled and loopback HTTP requires `--allow-local`. Both exporters reject symlinks, FIFOs and devices, create output exclusively with mode 0600, and suppress raw input/upstream errors. The browser additionally rejects duplicate JSON keys (including escaped duplicates), invalid graph references and nonfinite values; it exports only an allowlisted schema after review.

## Add tracing to your agent

[`instrument_agent.py`](instrument_agent.py) shows the official SDK context-manager API: agent → tool → generation, numeric usage/cost updates, and a score attached to that generation. It does not capture task input/output and adds a content mask. Replace the synthetic operation bodies and fixed operation names with your actual agent boundaries; do not put personal identifiers in observation names.

```sh
# Only after configuring your own host and keys; explicitly submits a synthetic trace:
.venv/bin/python instrument_agent.py --send-synthetic-example
```

This sends telemetry to the chosen Langfuse server, calls no model API, and makes no paid provider request. The SDK's flush completion is not proof the server stored the trace; verify it in your instance and then export it. Run the transport-only checks without a server:

```sh
.venv/bin/python trace_sdk_smoke.py
.venv/bin/python instrument_smoke.py
```

The first uses actual SDK 5.2.0 parsing for observations v2 and scores v3. The second uses real SDK/OTel spans and HTTP MockTransport, verifies two parent–child edges plus the score submission, and blocks all socket connections. Authenticated server ingestion, permissions, eventual consistency and production self-host configuration remain unverified here.

### Verified upstream references

- [Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation): context managers and explicit capture controls.
- [SDK 5.2.0 source](https://github.com/langfuse/langfuse-python/tree/v5.2.0): installed generated observation/score clients were checked against the actual mock-transport calls.
- [Server license](https://github.com/langfuse/langfuse/blob/main/LICENSE): `ee/`, `web/src/ee/`, `worker/src/ee/`, and `packages/shared/src/server/ee/` use `ee/LICENSE`; remaining applicable server code is MIT Expat and third-party components retain their licenses. No Enterprise source is copied or enabled by this integration.

ภาษาไทย: เปิดส่วน **AGENT TRACE** แล้วนำ JSON จาก worker เข้ามา จะกางแต่ละขั้นตอนดู parent, เวลาเริ่ม, ระยะเวลา, token, ต้นทุนที่ Langfuse รายงาน และคะแนนของขั้นตอนนั้นได้ ชื่อและ ID ต้นฉบับถูกแทนด้วย alias แต่สายความสัมพันธ์ยังอยู่ การกดส่งไป Ledger จะนำเฉพาะ generation ที่มี token ครบของ trace ที่เลือกไปคำนวณตามราคาของคุณ ไม่มี API key อยู่ในหน้าเว็บ
