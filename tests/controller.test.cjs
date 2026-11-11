'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ledger=require('../dist/ledger.js');
function setup(overrides={}) {
  class Element {
    constructor(tag='div'){this.tag=tag;this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.children=[];this.listeners={};this.files=[];}
    addEventListener(event,fn){this.listeners[event]=fn;}
    replaceChildren(...els){this.children=els;}
    append(...els){this.children.push(...els);}
    click(){this.clicked=true; if(this.tag==='a') downloads++;}
    remove(){this.removed=true;}
  }
  let downloads=0;
  const ids=[...fs.readFileSync(require.resolve('../dist/index.html'),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const document={getElementById:id=>elements[id],createElement:tag=>new Element(tag),body:new Element('body')};
  const context={AIRunLedger:{...ledger,...overrides},document,Intl,Blob,TextDecoder,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},setTimeout:fn=>fn()};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),context);
  return {el:elements,dispatch:(id,event)=>elements[id].listeners[event](),downloads:()=>downloads};
}
function sample(s){s.dispatch('demo-btn','click');s.dispatch('analyze-btn','click');}
test('demo analyzes into visible results and review-gated exports',()=>{
 const s=setup();sample(s);assert.equal(s.el.results.hidden,false);assert.equal(s.el.empty.hidden,true);
 assert.equal(s.el['metric-attempts'].textContent,'12');assert.equal(s.el['metric-tokens'].textContent,'16,452');
 assert.equal(s.el['export-btn'].disabled,true);assert.equal(s.el['review-check'].checked,false);
});
test('editing source invalidates aggregate result and confirmation',()=>{
 const s=setup();sample(s);s.el['review-check'].checked=true;s.dispatch('review-check','change');
 assert.equal(s.el['export-btn'].disabled,false);s.dispatch('run-input','input');
 assert.equal(s.el.results.hidden,true);assert.equal(s.el['review-check'].checked,false);assert.equal(s.el['export-btn'].disabled,true);
});
test('editing rate card also invalidates results',()=>{
 const s=setup();sample(s);s.dispatch('rate-input','input');assert.equal(s.el.results.hidden,true);assert.equal(s.el['export-btn'].disabled,true);
});
test('filter changes summary and require review again',()=>{
 const s=setup();sample(s);s.el['review-check'].checked=true;s.dispatch('review-check','change');
 s.el['model-filter'].value='model-001';s.dispatch('model-filter','change');
 assert.equal(s.el['metric-attempts'].textContent,'6');assert.equal(s.el['review-check'].checked,false);assert.equal(s.el['export-btn'].disabled,true);
});
test('malformed input error does not echo data and hides prior results',()=>{
 const s=setup();sample(s);s.el['run-input'].value='PRIVATE_BAD_DATA';s.dispatch('analyze-btn','click');
 assert.equal(s.el.results.hidden,true);assert.equal(s.el.error.hidden,false);assert.equal(s.el.error.textContent.includes('PRIVATE'),false);
});
test('export without review cannot create a download',async()=>{
 const s=setup();sample(s);await s.dispatch('export-btn','click');assert.equal(s.downloads(),0);
});
test('reviewed current result exports one report',async()=>{
 const s=setup();sample(s);s.el['review-check'].checked=true;s.dispatch('review-check','change');await s.dispatch('export-btn','click');assert.equal(s.downloads(),1);
});
test('pending export cannot download after a source edit',async()=>{
 let resolve;const s=setup({createReport:()=>new Promise(r=>{resolve=r;})});sample(s);
 s.el['review-check'].checked=true;s.dispatch('review-check','change');const p=s.dispatch('export-btn','click');
 s.el['run-input'].value='new data';s.dispatch('run-input','input');resolve({summary:{}});await p;
 assert.equal(s.downloads(),0);assert.equal(s.el['export-btn'].disabled,true);
});
test('stale file read cannot overwrite a newer text edit',async()=>{
 let resolve;const s=setup();s.el['file-input'].files=[{name:'runs.json',size:10,arrayBuffer:()=>new Promise(r=>{resolve=r;})}];
 const p=s.dispatch('file-input','change');s.el['run-input'].value='newer';s.dispatch('run-input','input');resolve(new TextEncoder().encode('older').buffer);await p;
 assert.equal(s.el['run-input'].value,'newer');
});
test('file read rejects invalid UTF-8 and oversized files without echoing filename',async()=>{
 const s=setup();s.el['file-input'].files=[{name:'PRIVATE.json',size:2,arrayBuffer:async()=>new Uint8Array([255,255]).buffer}];
 await s.dispatch('file-input','change');assert.equal(s.el.error.hidden,false);assert(!s.el.error.textContent.includes('PRIVATE'));
 s.el['file-input'].files=[{name:'PRIVATE.json',size:1048577,arrayBuffer:()=>{throw Error('must not read');}}];
 await s.dispatch('file-input','change');assert(s.el.error.textContent.includes('1 MiB'));
});
test('clear removes source, rate and current result',()=>{
 const s=setup();sample(s);s.dispatch('clear-btn','click');assert.equal(s.el['run-input'].value,'');assert.equal(s.el['rate-input'].value,'');assert.equal(s.el.results.hidden,true);
});
