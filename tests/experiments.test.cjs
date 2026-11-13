'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),api=require('../dist/experiments.js'),fs=require('node:fs');
const copy=()=>JSON.parse(JSON.stringify(api.demo));
const analyze=b=>api.analyze(JSON.stringify(b));
function fails(change,code){const b=copy();change(b);assert.throws(()=>analyze(b),e=>e.code===code&&!e.message.includes('PRIVATE'));}
test('synthetic fixture interoperates with the public v1 bundle and matches expected quality/cost',()=>{
  const b=JSON.parse(fs.readFileSync(require.resolve('../examples/experiment-bundle.json'),'utf8')),a=analyze(b);
  assert.equal(a.comparisons.length,2);
  const saffron=a.comparisons.find(x=>x.model==='demo-saffron');
  assert.equal(saffron.scoreMean,85);assert.equal(saffron.scoreMin,80);assert.equal(saffron.scoreMax,90);
  assert.equal(saffron.knownCostUsd,.001);assert.equal(saffron.totalCostUsd,null);assert.equal(saffron.pricedAttempts,1);
  assert.equal(saffron.p50LatencyMs,600);assert.equal(saffron.p95LatencyMs,1000);
});
test('missing usage, latency and score stay unknown with observed coverage',()=>{
  const b=copy();for(const a of b.attempts){a.input_tokens=null;a.output_tokens=null;a.latency_ms=null;a.cost_usd=null;a.cost_source='unknown';a.rate_date=null;a.rate_source=null;}for(const e of b.evaluations)e.score=null;
  for(const g of analyze(b).comparisons){assert.equal(g.scoreMean,null);assert.equal(g.scoredEvaluations,0);assert.equal(g.totalCostUsd,null);assert.equal(g.pricedAttempts,0);assert.equal(g.knownCostUsd,0);assert.equal(g.usageAttempts,0);assert.equal(g.timedAttempts,0);assert.equal(g.p95LatencyMs,null);}
});
test('failed repeat quality is excluded while its known cost and latency remain counted',()=>{
  const b=copy(),a=b.attempts[0];a.status='error';b.evaluations[0].completedAttempts=0;
  const g=analyze(b).comparisons.find(x=>x.model===a.model);
  assert.equal(g.evaluations,2);assert.equal(g.completeEvaluations,1);assert.equal(g.scoredEvaluations,1);assert.equal(g.scoreMean,90);
  assert.equal(g.knownCostUsd,.001);assert.equal(g.errors,1);assert.equal(g.timedAttempts,2);
});
test('same dataset can combine independent plans with new IDs and separate changed prompt hashes',()=>{
  const b=copy(),c=copy();c.experimentId='second';c.planSha256='e'.repeat(64);
  for(const e of c.evaluations){e.id='second-'+e.id;e.promptSha256='f'.repeat(64);}
  for(const a of c.attempts){a.id='second-'+a.id;a.evaluationId='second-'+a.evaluationId;a.promptSha256='f'.repeat(64);}
  const r=analyze([b,c]);assert.equal(r.experimentCount,2);assert.equal(r.planCount,2);assert.equal(r.comparisons.length,4);
});
test('mixed dataset hashes and duplicate imports fail atomically',()=>{
  const b=copy(),c=copy();c.datasetSha256='e'.repeat(64);assert.throws(()=>analyze([b,c]),e=>e.code==='DATASET');
  assert.throws(()=>analyze([b,b]),e=>e.code==='DUPLICATE');
});
test('duplicate attempt/evaluation IDs and repeat slots are rejected',()=>{
  fails(b=>{b.attempts[1].id=b.attempts[0].id;},'DUPLICATE');
  fails(b=>{b.evaluations[1].id=b.evaluations[0].id;},'DUPLICATE');
  fails(b=>{b.evaluations[1].repeat=1;},'DUPLICATE');
});
test('orphan, mismatched, truncated and duplicate-case evaluation links are rejected',()=>{
  fails(b=>{b.attempts[0].evaluationId='missing';},'LINK');
  fails(b=>{b.attempts[0].model='wrong';},'LINK');
  fails(b=>{b.attempts.pop();},'LINK');
  fails(b=>{b.evaluations[0].expectedAttempts=2;},'LINK');
  fails(b=>{b.evaluations[0].completedAttempts=0;},'LINK');
  fails(b=>{b.attempts[0].caseId='different';},'LINK');
  fails(b=>{const a={...b.attempts[0],id:'duplicate-case'};b.attempts.push(a);b.evaluations[0].expectedAttempts=2;b.evaluations[0].completedAttempts=2;},'LINK');
});
test('negative, nonfinite and malformed amounts, usage and provenance fail closed',()=>{
  for(const field of ['input_tokens','output_tokens','latency_ms','cost_usd'])fails(b=>{b.attempts[0][field]=-1;},'SCHEMA');
  fails(b=>{b.attempts[0].input_tokens=1.5;},'SCHEMA');
  fails(b=>{b.attempts[0].cost_usd=null;},'SCHEMA');
  fails(b=>{b.attempts[0].rate_date='2026-02-30';},'SCHEMA');
  fails(b=>{b.attempts[0].rate_source=null;},'SCHEMA');
  fails(b=>{b.evaluations[0].score=101;},'SCHEMA');
  fails(b=>{b.normalization.nfc=false;},'SCHEMA');
  fails(b=>{b.datasetSha256='PRIVATE';},'SCHEMA');
  const raw=JSON.stringify(copy()).replace('"cost_usd":0.001','"cost_usd":1e999');assert.throws(()=>api.parse(raw),e=>e.code==='SCHEMA');
});
test('bounded UTF-8 JSON and array counts are checked before processing',()=>{
  assert.throws(()=>api.parse('PRIVATE'),e=>e.code==='INPUT'&&!e.message.includes('PRIVATE'));
  assert.throws(()=>api.parse('ก'.repeat(349526)),e=>e.code==='INPUT');
  assert.throws(()=>analyze([]),e=>e.code==='LIMIT');
  assert.throws(()=>analyze(Array.from({length:33},copy)),e=>e.code==='LIMIT');
});
test('unknown payload fields and supplied comparison summaries never control aggregates or exports',()=>{
  const b=copy();b.prompt='PRIVATE';b.answers=['PRIVATE'];b.comparisons=[{scoreMean:999}];b.attempts[0].api_key='PRIVATE';
  const result=analyze(b),out=JSON.stringify(api.exportReport(result));
  assert(!out.includes('PRIVATE'));assert(!out.includes('demo-saffron'));assert(!out.includes('concise'));assert(!out.includes('demo-attempt'));assert(!out.includes('Synthetic arithmetic rates'));
  assert.equal(result.comparisons.find(x=>x.model==='demo-saffron').scoreMean,85);
});
test('complete zero-cost usage differs from missing price',()=>{
  const b=copy();for(const a of b.attempts){a.cost_usd=0;a.cost_source='provider-reported';}
  for(const g of analyze(b).comparisons){assert.equal(g.totalCostUsd,0);assert.equal(g.pricedAttempts,g.attempts);}
});

test('published Thai Eval producer fixture imports without coercing unknown cost',()=>{
 const fixture=fs.readFileSync(require.resolve('../examples/thai-eval-v1.synthetic.json'),'utf8'),a=api.analyze(fixture),g=a.comparisons[0];
 assert.equal(a.experimentCount,1);assert.equal(g.model,'synthetic-model');assert.equal(g.scoreMean,75);assert.equal(g.totalCostUsd,null);assert.equal(g.pricedAttempts,0);assert.equal(g.usageAttempts,1);assert.equal(g.p95LatencyMs,100);
});

test('UTC creation timestamps reject normalized-invalid calendar dates and missing zone',()=>{
 fails(b=>{b.createdAt='2026-02-30T00:00:00Z';},'SCHEMA');
 fails(b=>{b.createdAt='2026-11-13T00:00:00';},'SCHEMA');
 const b=copy();b.createdAt='2026-11-13T00:00:00.1Z';assert.equal(analyze(b).experimentCount,1);
});
