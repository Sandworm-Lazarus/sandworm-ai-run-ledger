'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),api=require('../dist/experiments.js');
function setup(){
 let downloads=0;
 class E{constructor(tag='div'){this.tag=tag;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.children=[];this.listeners={};this.files=[];this.textContent='';}addEventListener(k,v){this.listeners[k]=v;}replaceChildren(...v){this.children=v;}append(...v){this.children.push(...v);}click(){if(this.tag==='a')downloads++;}remove(){}}
 const ids=[...fs.readFileSync(require.resolve('../dist/index.html'),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const el=Object.fromEntries(ids.map(id=>[id,new E()]));
 const document={getElementById:id=>el[id],createElement:t=>new E(t),body:new E('body')};
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/experiment-app.js'),'utf8'),{SandwormExperiments:api,document,Blob,TextDecoder,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},setTimeout:fn=>fn()});
 return{el,go:(id,event='click')=>el[id].listeners[event](),downloads:()=>downloads};
}
function sample(s){s.go('experiment-demo');s.go('experiment-analyze');}
test('compare view renders prompt variants, repeat range and incomplete cost coverage',()=>{
 const s=setup();sample(s);assert.equal(s.el['experiment-results'].hidden,false);assert.equal(s.el['experiment-rows'].children.length,2);
 const rows=s.el['experiment-rows'].children;const text=rows.map(row=>row.children.map(cell=>cell.textContent).join(' ')).join(' ');
 assert(text.includes('85.00 [80.00–90.00]'));assert(text.includes('1/2 attempts มีราคา'));assert(s.el['experiment-provenance'].textContent.includes('a'.repeat(64)));
});
test('export requires review and editing invalidates results and approval',()=>{
 const s=setup();sample(s);s.go('experiment-export');assert.equal(s.downloads(),0);
 s.el['experiment-review'].checked=true;s.go('experiment-review','change');s.go('experiment-export');assert.equal(s.downloads(),1);
 s.go('experiment-input','input');assert.equal(s.el['experiment-results'].hidden,true);assert.equal(s.el['experiment-export'].disabled,true);assert.equal(s.el['experiment-rows'].children.length,0);
});
test('invalid duplicate/mixed dataset input clears stale results without echoing source',()=>{
 const s=setup();sample(s);const a=JSON.parse(JSON.stringify(api.demo)),b=JSON.parse(JSON.stringify(a));b.datasetSha256='e'.repeat(64);b.prompt='PRIVATE';
 s.el['experiment-input'].value=JSON.stringify([a,b]);s.go('experiment-analyze');
 assert.equal(s.el['experiment-results'].hidden,true);assert.equal(s.el['experiment-rows'].children.length,0);assert(s.el['experiment-status'].textContent.includes('SHA-256'));assert(!s.el['experiment-status'].textContent.includes('PRIVATE'));
});
test('late multi-file read cannot overwrite a newer edit',async()=>{
 const s=setup();let resolve;s.el['experiment-files'].files=[{name:'bundle.json',size:10,arrayBuffer:()=>new Promise(r=>resolve=r)}];
 const pending=s.go('experiment-files','change');s.el['experiment-input'].value='newer';s.go('experiment-input','input');
 resolve(new TextEncoder().encode(JSON.stringify(api.demo)).buffer);await pending;assert.equal(s.el['experiment-input'].value,'newer');
});
test('file budgets reject before reading and malformed UTF-8 is concealed',async()=>{
 const s=setup();let reads=0;s.el['experiment-files'].files=[{name:'PRIVATE.json',size:1048577,arrayBuffer:()=>{reads++;}}];await s.go('experiment-files','change');assert.equal(reads,0);assert(!s.el['experiment-status'].textContent.includes('PRIVATE'));
 s.el['experiment-files'].files=[{name:'PRIVATE.json',size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer}];await s.go('experiment-files','change');assert.equal(s.el['experiment-results'].hidden,true);assert(!s.el['experiment-status'].textContent.includes('PRIVATE'));
});
test('clearing an experiment leaves original run and trace input untouched',()=>{
 const s=setup();s.el['run-input'].value='original run';s.el['trace-input'].value='original trace';sample(s);s.go('experiment-clear');
 assert.equal(s.el['experiment-input'].value,'');assert.equal(s.el['run-input'].value,'original run');assert.equal(s.el['trace-input'].value,'original trace');assert.equal(s.el['experiment-results'].hidden,true);
});
