# Validation record

Date: 2026-11-11 · Application: 0.1.0 · Runtime: Node.js 24.22.1

`npm run check` passes **36 automated tests** (25 engine + 11 controller) and the shared static verification script. The generated [validation report](../reports/validation.json) contains a SHA-256 source/fixture manifest and command outcomes. Re-run the command after modifying source or fixtures.

The controller suite exercises demo rendering, source/rate invalidation, filtered summaries, review gating, sanitized errors, export completion, stale export cancellation, stale file import cancellation, strict UTF-8/size checks and clear behavior. Its DOM is a test double; this is not a claim that a real browser download was inspected.

Synthetic demo golden totals: **12 attempts, 16,452 tokens, 2 errors, 2 retry attempts, USD 0.009894 estimated cost, p50 1,250 ms, p95 4,800 ms**. These are calculations over fabricated input, not provider benchmarks.

Local automated checks do not imply hosted GitHub Actions passed. Browser/device observations, if subsequently performed, should be recorded separately with viewport/runtime and concrete outcomes.
