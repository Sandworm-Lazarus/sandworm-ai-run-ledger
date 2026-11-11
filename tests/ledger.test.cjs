'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ledger = require('../dist/ledger.js');
const row = (overrides={}) => ({id:'r1',model:'m',input_tokens:100,output_tokens:50,latency_ms:20,status:'success',...overrides});
const rates = JSON.stringify([{model:'m',input_usd_per_million:1,output_usd_per_million:2}]);
const data = (rows=[row()])=>JSON.stringify(rows);
const error = (fn,code)=>assert.throws(fn,e=>e.code===code && !e.message.includes('PRIVATE'));
test('parses JSON array and ignores unapproved fields',()=>{
 const parsed=ledger.parseRuns(data([row({prompt:'PRIVATE prompt',api_key:'PRIVATE secret',extra:{a:1}})]));
 assert.deepEqual(Object.keys(parsed[0]).sort(),['input_tokens','latency_ms','model','output_tokens','retry','status']);
 assert.equal(JSON.stringify(parsed).includes('PRIVATE'),false);
});
test('JSONL accepts blank lines and CRLF with BOM',()=>{
 const s='\ufeff'+JSON.stringify(row())+'\r\n\r\n'+JSON.stringify(row({id:'r2'}));
 assert.equal(ledger.parseRuns(s).length,2);
});
test('malformed source returns constant sanitized parse error',()=>error(()=>ledger.parseRuns('{"PRIVATE":oops}'),'PARSE'));
test('rejects empty input, empty arrays and oversized record counts',()=>{
 error(()=>ledger.parseRuns(''),'RECORDS'); error(()=>ledger.parseRuns('[]'),'RECORDS');
 error(()=>ledger.parseRuns(JSON.stringify(Array.from({length:5001},(_,i)=>row({id:String(i)})))),'RECORDS');
});
test('rejects duplicate IDs before aggregating',()=>error(()=>ledger.analyze(data([row(),row()]),rates),'DUPLICATE'));
test('validates record schema and own required keys',()=>{
 for(const value of [null,[],{},row({model:''}),row({status:'pending'}),row({retry:'true'}),row({id:'x\nPRIVATE'})]) error(()=>ledger.parseRuns(JSON.stringify([value])),'RECORD');
});
test('rejects nonfinite negative fractional and oversized token counts',()=>{
 for(const n of [-1,.5,1e30,null,'20']) error(()=>ledger.parseRuns(data([row({input_tokens:n})])),'RECORD');
 error(()=>ledger.parseRuns(data([row({output_tokens:1000000001})])),'RECORD');
});
test('latency is bounded integer milliseconds including zero',()=>{
 assert.equal(ledger.analyze(data([row({latency_ms:0})]),rates).summary.p50_latency_ms,0);
 for(const n of [-1,.1,86400001])error(()=>ledger.parseRuns(data([row({latency_ms:n})])),'RECORD');
});
test('model names are bounded and controls / bidi escapes rejected',()=>{
 for(const m of ['a'.repeat(101),' m','m\u202eSECRET'])error(()=>ledger.parseRuns(data([row({model:m})])),'RECORD');
});
test('model count is bounded independently from record count',()=>error(()=>ledger.parseRuns(data(Array.from({length:101},(_,i)=>row({id:String(i),model:'m'+i})))),'MODEL_LIMIT'));
test('rate card requires an array and unique model labels',()=>{
 error(()=>ledger.parseRates('{}'),'RATES');error(()=>ledger.parseRates('PRIVATE'),'RATES');
 error(()=>ledger.parseRates('[{"model":"m","input_usd_per_million":1,"output_usd_per_million":2},{"model":"m","input_usd_per_million":1,"output_usd_per_million":2}]'),'RATES');
});
test('rate values are numeric, finite, nonnegative and bounded',()=>{
 for(const n of [-1,'0',null,10001])error(()=>ledger.parseRates(JSON.stringify([{model:'m',input_usd_per_million:n,output_usd_per_million:2}])),'RATE');
 error(()=>ledger.parseRates('[{"model":"m","input_usd_per_million":1e999,"output_usd_per_million":2}]'),'RATE');
});
test('known costs include input and output token rates',()=>{
 const s=ledger.analyze(data(),rates).summary;
 assert.equal(s.estimated_cost_usd,.0002);assert.equal(s.total_tokens,150);assert.equal(s.unpriced_attempts,0);
});
test('unknown prices remain null, not a zero estimate',()=>{
 const a=ledger.analyze(data([row(),row({id:'2',model:'unknown'})]),rates);
 assert.equal(a.summary.estimated_cost_usd,null);assert.equal(a.summary.known_cost_usd,.0002);assert.equal(a.summary.unpriced_attempts,1);
 assert.equal(a.models.find(m=>m.label==='unknown').rate,null);
});
test('explicit zero rates are known free rates',()=>{
 const s=ledger.analyze(data(),'[{"model":"m","input_usd_per_million":0,"output_usd_per_million":0}]').summary;
 assert.equal(s.estimated_cost_usd,0);assert.equal(s.unpriced_attempts,0);
});
test('error attempts and retries retain their token costs and denominators',()=>{
 const s=ledger.analyze(data([row({status:'error'}),row({id:'2',retry:true})]),rates).summary;
 assert.equal(s.attempts,2);assert.equal(s.errors,1);assert.equal(s.error_rate,.5);assert.equal(s.retries,1);assert.equal(s.estimated_cost_usd,.0004);
});
test('quantiles use nearest rank and include failed attempts',()=>{
 const rows=Array.from({length:20},(_,i)=>row({id:String(i),latency_ms:i+1,status:i===19?'error':'success'}));
 const s=ledger.analyze(data(rows),rates).summary;assert.equal(s.p50_latency_ms,10);assert.equal(s.p95_latency_ms,19);
 assert.equal(ledger.quantile([], .5),null);
});
test('quantiles handle unsorted samples without changing them',()=>{
 const values=[100,1,50,3];assert.equal(ledger.quantile(values,.5),3);assert.deepEqual(values,[100,1,50,3]);
});
test('model filtering selects correct aggregates',()=>{
 const a=ledger.analyze(data([row(),row({id:'2',model:'z'})]),rates);
 const r=ledger.exportAggregate(a,'model-002');assert.equal(r.summary.attempts,1);assert.equal(r.summary.estimated_cost_usd,null);
 error(()=>ledger.exportAggregate(a,'invalid'),'FILTER');
});
test('safe display labels redact emails and markup characters',()=>{
 const label=ledger.safeLabel('team+private@example.invalid/<script>');assert(!label.includes('@'));assert(!label.includes('<'));assert(label.includes('[EMAIL]'));
});
test('export anonymizes arbitrary model labels and excludes raw IDs / extra fields',async()=>{
 const text=data([row({id:'PRIVATE-ID',model:'PRIVATE-MODEL',prompt:'PRIVATE-PROMPT',api_key:'PRIVATE-SECRET'})]);
 const rate=JSON.stringify([{model:'PRIVATE-MODEL',input_usd_per_million:1,output_usd_per_million:2,extra:'PRIVATE-RATE'}]);
 const r=await ledger.createReport(text,rate,'all');assert(!JSON.stringify(r).includes('PRIVATE'));
 assert.equal(r.models[0].model_alias,'model-001');assert.equal(r.input_sha256,crypto.createHash('sha256').update(text).digest('hex'));
});
test('input and rate card hashes detect byte changes',async()=>{
 const a=await ledger.createReport(data(),rates), b=await ledger.createReport(data()+' ',rates), c=await ledger.createReport(data(),rates+' ');
 assert.notEqual(a.input_sha256,b.input_sha256);assert.equal(a.input_sha256,c.input_sha256);assert.notEqual(a.rate_card_sha256,c.rate_card_sha256);
});
test('UTF-8 size limit counts bytes, not JS characters',()=>{
 error(()=>ledger.parseRuns('ก'.repeat(350000)),'SIZE');error(()=>ledger.parseRates('x'.repeat(1048577)),'SIZE');
});
test('demo contains only synthetic labels and reconciles model totals',()=>{
 const a=ledger.analyze(JSON.stringify(ledger.demoRuns),JSON.stringify(ledger.demoRates));
 assert.equal(a.summary.attempts,12);assert.equal(a.summary.errors,2);assert.equal(a.summary.retries,2);
 assert.equal(a.models.reduce((s,m)=>s+m.metrics.total_tokens,0),a.summary.total_tokens);
});
test('large allowed aggregate token totals remain safe integers',()=>{
 const s=ledger.analyze(data(Array.from({length:1000},(_,i)=>row({id:String(i),input_tokens:1000000000,output_tokens:1000000000}))),rates).summary;
 assert.equal(s.total_tokens,2000000000000);assert(Number.isSafeInteger(s.total_tokens));
});
