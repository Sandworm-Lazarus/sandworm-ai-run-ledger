# Development record

## 0.1.0 — 2026-11-11

Original implementation: a dependency-free JSON/JSONL parser, bounded run schema, exact-model rate cards, aggregate accounting, missing-price handling, error/retry counts, nearest-rank quantiles, per-model filtering and SHA-256 report provenance.

The UI follows the Sandworm Lazarus dark navy/coral design used by Privacy Workbench. It bundles the same OFL fonts in its stylesheet and uses original repository SVG artwork. No scripts or telemetry from the reference site are imported.

Synthetic fixtures use twelve fictional runs across `demo-saffron` and `demo-indigo`, with two errors and two retry attempts. Prices are manually assigned examples, not current service prices. The app does not claim to measure model quality or performance.

The exported report deliberately omits raw model labels and IDs; its aliases are local to the model set. Unknown log fields are stripped before aggregation. A review checkbox and input-revision guards protect the export path from stale UI state.

## Reproduce

```sh
npm test
npm run verify
npm run check
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

No dependency installation/build is needed. The automated test suite covers parser failures and limits, schema bounds, duplicate IDs, model limits, missing/zero prices, failed/retried attempt costs, p50/p95 math, filters, export privacy, SHA-256 changes and aggregate integer precision. Browser checks and hosted CI must be reported from observed runs, not inferred from local unit tests.

Examples are in `examples/runs.json` and `examples/rates.json`. Reports can be reproduced with `require('./dist/ledger.js').createReport(runText, rateText, 'all')` in Node.js 20+.
