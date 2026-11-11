# Threat model

AI Run Ledger v0.1.0 is a browser-local analysis tool. It does not execute imported code, call model providers, validate invoices, or certify logs as truthful.

## Assets and boundaries

Untrusted JSON/JSONL logs and rate cards enter through explicitly selected files or textareas. The parser keeps only approved numerical/status fields and model labels for calculations. Record IDs are used for duplicate detection and discarded. Unknown fields are ignored, not echoed. The UI uses `textContent`; sanitized model labels mask ASCII email-like patterns and filter control/markup characters.

The report boundary is `createReport()`: raw model labels become stable aliases within that input set; IDs, prompts, names of unknown keys and filenames are omitted. Numeric rates and aggregates are retained. SHA-256 fingerprints identify the exact original text and rate-card bytes as UTF-8, including unknown fields. Hashes are not anonymous, encrypted, authenticated or tamper-proof evidence; dictionary comparisons can reveal likely content.

## Controls

- Inputs are limited to 1 MiB each, 5,000 attempts, 100 models and 200 rate entries. Typed data is rechecked by the engine.
- Tokens and latency have finite nonnegative integer bounds; rates have finite nonnegative bounds. Totals stay within safe integer token ranges.
- Duplicate IDs reject the analysis; missing rates remain unknown. Model names use exact case-sensitive matching.
- No `eval`, imported scripts, network APIs, remote fonts, analytics or browser persistent storage.
- CSP blocks connections, forms, object embedding and off-origin scripts/styles. Font data URLs are explicitly allowed because bundled font bytes are embedded in the stylesheet.
- Imported UTF-8 is decoded with `fatal: true`. Errors use fixed messages without source excerpts or filenames.
- Input edits invalidate results, filters clear review, exports require confirmation. Revision guards discard stale file reads and report exports after newer edits.

## Limits

Standard JSON parsing accepts duplicate object keys using their last value; it is not a strict duplicate-key validator. Unknown fields can still consume parser resources within the size limit. No protection against a compromised browser, malicious extensions, screenshots, OS swap, clipboard tools or host-level access. Clearing the page is not secure memory erasure. On-screen model labels can contain sensitive words that are not emails; exported aliases avoid copying those words but do not hide counts or patterns. Floating-point cost arithmetic rounded to 12 decimal places is unsuitable for authoritative accounting. No retry-chain reconstruction or provider-specific billing semantics.

The hosting platform can observe normal page visits. Application code sends no log content to it. Source hashing requires WebCrypto and a suitable secure context. File-launch compatibility and physical-device coverage are not claimed without separate observation.
