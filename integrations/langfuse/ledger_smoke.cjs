'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const ledger=require('../../dist/ledger.js');
const raw=fs.readFileSync(__dirname+'/fixtures/ledger.jsonl','utf8');
const result=ledger.analyze(raw,'[]');
assert.equal(result.summary.attempts,2);assert.equal(result.summary.total_tokens,1020);
assert.equal(result.summary.estimated_cost_usd,null);assert.equal(result.summary.unpriced_attempts,2);
assert.equal(result.summary.errors,1);assert.equal(result.summary.retries,1);
console.log(JSON.stringify({mode:'actual-ledger-engine-roundtrip',attempts:2,tokens:1020,unknown_prices_preserved:true}));
