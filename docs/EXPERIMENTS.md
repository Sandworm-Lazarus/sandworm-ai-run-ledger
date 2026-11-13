# Thai Eval experiment comparison

The **Experiment Compare** panel imports `sandworm-experiment/v1` JSON from Thai Eval's experiment worker. Choose one or more JSON files, or paste one bundle / an array of bundles. File selection replaces the current input; **Compare** validates the whole input atomically. Run Analysis and Agent Trace keep their existing input and behavior.

No model/API key is accepted here. Imported experiment data is handled only in page memory. There is no network request or persistent browser history.

## Shared v1 contract

Top level:

- `kind: "sandworm-experiment/v1"`, `schemaVersion: 1`.
- `experimentId`: unique ASCII ID, 1–128 characters.
- `createdAt`: ISO timestamp; `datasetId`: nonempty label, at most 100 characters.
- `datasetSha256`, `planSha256`: 64 lowercase hexadecimal characters. Dataset hash identifies the exact dataset bytes. Hashes are fingerprints, not signatures.
- `normalization: {nfc: true, whitespace: true}`: scoring normalization used by the producer.
- `evaluations`: one dataset-level evaluation per model × variant × prompt hash × repeat.
- `attempts`: one record per actual HTTP request, including errors.

Evaluation fields:

```json
{
  "id": "experiment-1-eval-1",
  "model": "example-model",
  "variantId": "concise",
  "promptSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "repeat": 1,
  "expectedAttempts": 2,
  "completedAttempts": 2,
  "score": 85
}
```

`score` is null or a finite number in 0–100. `expectedAttempts` is 1–1,000 and equals the linked request count. `completedAttempts` equals linked requests with `status: "success"`. Every evaluation must contain the same distinct `caseId` set, preventing a truncated export from appearing as a complete evaluation. A failure retains its cost/latency observation, but excludes that entire repeat from quality aggregation.

Attempt fields:

```json
{
  "id": "experiment-1-attempt-1",
  "evaluationId": "experiment-1-eval-1",
  "caseId": "synthetic-case-1",
  "model": "example-model",
  "variantId": "concise",
  "promptSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "repeat": 1,
  "input_tokens": 100,
  "output_tokens": 30,
  "latency_ms": 900,
  "status": "success",
  "cost_usd": null,
  "cost_source": "unknown",
  "rate_date": null,
  "rate_source": null,
  "score": null
}
```

Attempt IDs, evaluation IDs and case IDs are bounded ASCII identifiers. Model/variant labels are at most 100 characters and reject control/bidirectional formatting characters. Repeat is 1–100.

Usage fields are null or safe nonnegative integer tokens (maximum 1 billion each). Latency is null or finite nonnegative milliseconds up to one day. Cost is null or finite nonnegative USD up to 1 billion per attempt. Missing usage/cost/time remains unknown rather than zero.

Cost source is `unknown` exactly when cost is null, otherwise `provider-reported` or `user-rate`. User-rate requires complete input/output usage, a valid calendar `rate_date` (YYYY-MM-DD), and nonempty `rate_source`. Provider-reported values must already be explicitly denominated in USD by the producer. This importer does not infer billing units or call pricing APIs.

## Comparability and statistics

The importer refuses mixed dataset SHA-256 hashes, duplicate experiment/evaluation/attempt IDs, duplicate repeat slots within one experiment, orphan attempts, mismatched model/variant/prompt/repeat links, duplicate cases and incomplete case sets.

Different plan hashes are allowed for one dataset and counted visibly. Grouping uses model + variant label + exact prompt hash, so an edited prompt under the same label cannot silently pool with an earlier prompt.

- Quality: unweighted mean, minimum and maximum of **complete dataset-level repeat scores**, not individual requests. Null scores and repeats containing errors are excluded, with scored/complete/total repeat counts.
- Latency: nearest-rank P50/P95 of measured HTTP attempt times, including errors, with timed/total coverage. These values are not complete experiment wall time.
- Cost: known attempt subtotal and priced/total coverage. The total remains null until every attempt in the group is priced. A zero known subtotal with 0/N priced is not a free run.
- Usage coverage: requests with both input and output token counts present. No inference of missing tokens.
- The min–max repeat range is not a confidence interval. Results are comparable only for the imported dataset and scoring rules; this is not a universal model ranking.

## Limits, exports and fixtures

Aggregate limits: **1 MiB serialized UTF-8**, **32 bundles**, **5,000 attempts**, **1,000 evaluations**, **200 comparison groups**. File sizes are checked before reading, then serialized input is checked again. Unknown fields and producer-supplied comparison summaries are discarded. Errors use fixed messages without source values.

After review, export `sandworm-experiment-comparison/v1` uses comparison aliases and aggregate metrics. It omits raw model/variant labels, prompt hashes, experiment/evaluation/request IDs, case IDs, raw prompts/answers, rate-source text and unknown fields. The dataset hash and cost-source labels/rate dates remain visible.

[experiment-bundle.json](../examples/experiment-bundle.json) is synthetic, with two models/variants and two repeats. The saffron group has quality 85 (80–90), one priced request of two, a known USD 0.001 subtotal and a null total.

Automated checks are in [engine tests](../tests/experiments.test.cjs) and [controller tests](../tests/experiment-controller.test.cjs). The repository's existing push workflow runs `npm run check` on feature branches, including this implementation. Hosted execution must be verified from the actual commit's Actions run; no successful hosted result is claimed by this document. Real provider calls and visual browser QA are separate from these contract/controller checks.
