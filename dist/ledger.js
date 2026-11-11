(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AIRunLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '0.1.0';
  const LIMITS = Object.freeze({ bytes: 1048576, records: 5000, models: 100, rates: 200, tokens: 1000000000, latency: 86400000 });
  const ERRORS = Object.freeze({
    INPUT: 'Input must be text.', SIZE: 'Input exceeds the 1 MiB limit.', PARSE: 'Invalid JSON or JSONL input.',
    RECORDS: 'Provide 1–5000 run records.', RECORD: 'A run record does not match the documented schema.',
    DUPLICATE: 'Run IDs must be unique.', MODEL_LIMIT: 'Too many distinct models.',
    RATES: 'Rate card must be a JSON array with at most 200 unique model entries.', RATE: 'A rate entry is invalid.',
    FILTER: 'The selected model is unavailable.', HASH: 'SHA-256 is unavailable in this environment.'
  });
  function fail(code) { const e = new Error(ERRORS[code]); e.code = code; throw e; }
  function boundedText(text) {
    if (typeof text !== 'string') fail('INPUT');
    if (new TextEncoder().encode(text).length > LIMITS.bytes) fail('SIZE');
    return text.replace(/^\uFEFF/, '').trim();
  }
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const name = s => typeof s === 'string' && s.length > 0 && s.length <= 100 && s.trim() === s && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(s);
  const uint = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  function parseRuns(text) {
    const clean = boundedText(text);
    if (!clean) fail('RECORDS');
    let data;
    try {
      if (clean.startsWith('[')) data = JSON.parse(clean);
      else data = clean.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    } catch (_) { fail('PARSE'); }
    if (!Array.isArray(data) || data.length < 1 || data.length > LIMITS.records) fail('RECORDS');
    const ids = new Set(), models = new Set();
    return data.map(row => {
      if (!object(row) || !['id','model','input_tokens','output_tokens','latency_ms','status'].every(k => own(row,k)) ||
        !name(row.id) || !name(row.model) || !uint(row.input_tokens, LIMITS.tokens) || !uint(row.output_tokens, LIMITS.tokens) ||
        !uint(row.latency_ms, LIMITS.latency) || !['success','error'].includes(row.status) ||
        (own(row,'retry') && typeof row.retry !== 'boolean')) fail('RECORD');
      if (ids.has(row.id)) fail('DUPLICATE');
      ids.add(row.id); models.add(row.model);
      if (models.size > LIMITS.models) fail('MODEL_LIMIT');
      // Explicit allowlist: unknown fields, including prompts and keys, are discarded.
      return { model: row.model, input_tokens: row.input_tokens, output_tokens: row.output_tokens,
        latency_ms: row.latency_ms, status: row.status, retry: row.retry === true };
    });
  }
  function parseRates(text) {
    let data;
    try { data = JSON.parse(boundedText(text)); } catch (e) { if (e.code) throw e; fail('RATES'); }
    if (!Array.isArray(data) || data.length > LIMITS.rates) fail('RATES');
    const rates = new Map();
    for (const row of data) {
      if (!object(row) || !['model','input_usd_per_million','output_usd_per_million'].every(k=>own(row,k)) || !name(row.model) ||
        !['input_usd_per_million','output_usd_per_million'].every(k => typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] >= 0 && row[k] <= 10000)) fail('RATE');
      if (rates.has(row.model)) fail('RATES');
      rates.set(row.model, { input_usd_per_million: row.input_usd_per_million, output_usd_per_million: row.output_usd_per_million });
    }
    return rates;
  }
  function safeLabel(value) {
    return value.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?/gi, '[EMAIL]')
      .replace(/[^\p{L}\p{N} ._:/\[\]-]/gu, '_').slice(0, 80);
  }
  function quantile(values, p) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b)=>a-b);
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  }
  function summarize(rows, rates) {
    let input = 0, output = 0, known = 0, unknown = 0, errors = 0, retries = 0;
    for (const row of rows) {
      input += row.input_tokens; output += row.output_tokens;
      errors += row.status === 'error' ? 1 : 0; retries += row.retry ? 1 : 0;
      const rate = rates.get(row.model);
      if (!rate) unknown++;
      else known += (row.input_tokens * rate.input_usd_per_million + row.output_tokens * rate.output_usd_per_million) / 1000000;
    }
    const knownCost = Number(known.toFixed(12));
    return { attempts: rows.length, input_tokens: input, output_tokens: output, total_tokens: input + output,
      errors, error_rate: rows.length ? errors / rows.length : 0, retries,
      p50_latency_ms: quantile(rows.map(r=>r.latency_ms), .5), p95_latency_ms: quantile(rows.map(r=>r.latency_ms), .95),
      known_cost_usd: knownCost, estimated_cost_usd: unknown ? null : knownCost, unpriced_attempts: unknown };
  }
  function analyze(runText, rateText) {
    const rows = parseRuns(runText), rates = parseRates(rateText);
    const names = [...new Set(rows.map(r=>r.model))].sort();
    const models = names.map((model, index) => ({ code: 'model-' + String(index+1).padStart(3,'0'),
      label: safeLabel(model), metrics: summarize(rows.filter(r=>r.model === model), rates),
      rate: rates.get(model) || null }));
    return { summary: summarize(rows,rates), models };
  }
  function exportAggregate(analysis, filter) {
    const chosen = filter && filter !== 'all' ? analysis.models.filter(m=>m.code === filter) : analysis.models;
    if (!chosen.length) fail('FILTER');
    const single = filter && filter !== 'all';
    return { scope: single ? filter : 'all', summary: single ? chosen[0].metrics : analysis.summary,
      models: chosen.map(m=>({ model_alias: m.code, rate: m.rate, ...m.metrics })) };
  }
  async function sha256(text) {
    try {
      const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle :
        (typeof module === 'object' && module.exports ? require('node:crypto').webcrypto.subtle : null);
      if (!subtle) fail('HASH');
      const hash = await subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,'0')).join('');
    } catch (_) { fail('HASH'); }
  }
  async function createReport(runText, rateText, filter) {
    const result = analyze(runText,rateText);
    const aggregate = exportAggregate(result,filter);
    return { format: 'sandworm-ai-run-ledger/v1', engine_version: VERSION,
      input_sha256: await sha256(runText), rate_card_sha256: await sha256(rateText),
      ...aggregate,
      methodology: { cost: 'Manual USD per million tokens; every recorded attempt, including errors and retries, is counted. Missing rates yield null total estimate and a known subtotal.',
        latency: 'Nearest-rank p50/p95 over all attempts, including errors. Zero latency is a valid observation.',
        error_rate: 'error attempts / all recorded attempts', retries: 'Count of records explicitly marked retry=true; request chains are not inferred.',
        privacy: 'Export uses model aliases and omits record IDs, model labels, prompts and unknown fields. SHA-256 is a fingerprint, not encryption or proof of authenticity.' } };
  }
  const demoRates = [
    {model:'demo-saffron',input_usd_per_million:0.25,output_usd_per_million:1.25},
    {model:'demo-indigo',input_usd_per_million:0.5,output_usd_per_million:2}
  ];
  const demoRuns = Array.from({length:12}, (_,i)=>({id:'demo-'+(i+1),model:i<6?'demo-saffron':'demo-indigo',input_tokens:800+i*65,
    output_tokens:120+i*17,latency_ms:[620,780,910,1250,3100,850,730,1400,1700,2200,4800,1350][i],status:i===4||i===10?'error':'success',retry:i===5||i===11}));
  return Object.freeze({ VERSION, LIMITS, ERRORS, parseRuns, parseRates, safeLabel, quantile, analyze, exportAggregate, sha256, createReport, demoRuns, demoRates });
});
