(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SandwormTrace=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const LIMIT=1048576, TYPES=['SPAN','GENERATION','EVENT','AGENT','TOOL','CHAIN','RETRIEVER','EVALUATOR','EMBEDDING','GUARDRAIL'];
function fail(){const e=new Error('Trace report does not match the bounded Sandworm schema.');e.code='TRACE';throw e;}
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x),uint=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
function strictJSON(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>LIMIT)fail();
 // Validate duplicate keys (including escaped forms), depth and trailing data before native decoding.
 let p=0;const ws=()=>{while(/[\t\r\n ]/.test(text[p]||'x'))p++;};
 function str(){const start=p++;for(;p<text.length;p++){if(text[p]==='\\'){p++;continue;}if(text[p]==='"'){p++;try{return JSON.parse(text.slice(start,p));}catch(_){fail();}}}fail();}
 function value(depth){if(depth>40)fail();ws();if(text[p]==='"'){str();return;}if(text[p]==='{'){p++;ws();const keys=new Set();if(text[p]==='}'){p++;return;}while(true){ws();if(text[p]!=='"')fail();const key=str();if(keys.has(key))fail();keys.add(key);ws();if(text[p++]!==':')fail();value(depth+1);ws();const c=text[p++];if(c==='}')return;if(c!==',')fail();}}else if(text[p]==='['){p++;ws();if(text[p]===']'){p++;return;}while(true){value(depth+1);ws();const c=text[p++];if(c===']')return;if(c!==',')fail();}}else{const match=/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(p));if(!match)fail();p+=match[0].length;}}
 try{value(0);ws();if(p!==text.length)fail();return JSON.parse(text);}catch(_){fail();}
}
function parse(text){
 const d=strictJSON(text);if(!obj(d)||d.format!=='sandworm-langfuse-trace/v1'||!['saved-import','live-api','synthetic-fixture'].includes(d.source)||!Array.isArray(d.observations)||!d.observations.length||d.observations.length>5000||!Array.isArray(d.scores)||d.scores.length>5000||!uint(d.excluded_scores,5000))fail();
 const byId=new Map(),aliases=(x,re)=>typeof x==='string'&&re.test(x),obs=/^obs-\d{5}$/,trace=/^trace-\d{4}$/;
 const observations=d.observations.map(r=>{
  if(!obj(r)||!aliases(r.id,obs)||byId.has(r.id)||!aliases(r.trace_id,trace)||(r.parent_id!==null&&!aliases(r.parent_id,obs))||typeof r.parent_missing!=='boolean'||!TYPES.includes(r.type)||!['recorded','error'].includes(r.status)||!uint(r.start_offset_ms,86400000)||!uint(r.latency_ms,86400000)||(r.model_alias!==null&&!aliases(r.model_alias,/^model-\d{3}$/))||!(r.input_tokens===null&&r.output_tokens===null)&&!(uint(r.input_tokens,1e9)&&uint(r.output_tokens,1e9))||(r.reported_cost_usd!==null&&!(typeof r.reported_cost_usd==='number'&&Number.isFinite(r.reported_cost_usd)&&r.reported_cost_usd>=0&&r.reported_cost_usd<=1e6)))fail();
  if(r.parent_missing&&r.parent_id!==null)fail();
  const row={id:r.id,trace_id:r.trace_id,parent_id:r.parent_id,parent_missing:r.parent_missing,type:r.type,model_alias:r.model_alias,start_offset_ms:r.start_offset_ms,latency_ms:r.latency_ms,status:r.status,input_tokens:r.input_tokens,output_tokens:r.output_tokens,reported_cost_usd:r.reported_cost_usd};byId.set(row.id,row);return row;
 });
 const traceIds=new Set(observations.map(r=>r.trace_id));
 for(const row of observations){let p=row;const seen=new Set();while(p){if(seen.has(p.id)||seen.size>=32||p.trace_id!==row.trace_id)fail();seen.add(p.id);if(p.parent_id&&!byId.has(p.parent_id))fail();p=byId.get(p.parent_id);}}
 const scores=d.scores.map(s=>{if(!obj(s)||!aliases(s.metric_alias,/^eval-\d{3,5}$/)||!traceIds.has(s.trace_id)||(s.observation_id!==null&&(!byId.has(s.observation_id)||byId.get(s.observation_id).trace_id!==s.trace_id))||!['NUMERIC','BOOLEAN'].includes(s.data_type))fail();if(s.data_type==='BOOLEAN'?typeof s.value!=='boolean':!(typeof s.value==='number'&&Number.isFinite(s.value)&&Math.abs(s.value)<=1e6))fail();return{metric_alias:s.metric_alias,trace_id:s.trace_id,observation_id:s.observation_id,data_type:s.data_type,value:s.value};});
 return{format:d.format,source:d.source,observations,scores,excluded_scores:d.excluded_scores};
}
function summarize(report,traceId){
 const rows=report.observations.filter(r=>r.trace_id===traceId);if(!rows.length)fail();
 const generation=rows.filter(r=>r.type==='GENERATION'),known=generation.filter(r=>r.reported_cost_usd!==null);
 const subtotal=Number(known.reduce((n,r)=>n+r.reported_cost_usd,0).toFixed(12));
 return{trace_id:traceId,observations:rows.length,generations:generation.length,wall_time_ms:Math.max(...rows.map(r=>r.start_offset_ms+r.latency_ms))-Math.min(...rows.map(r=>r.start_offset_ms)),known_reported_cost_usd:subtotal,reported_cost_usd:known.length===generation.length?subtotal:null,unpriced_generations:generation.length-known.length,errors:rows.filter(r=>r.status==='error').length,missing_parents:rows.filter(r=>r.parent_missing).length,scores:report.scores.filter(s=>s.trace_id===traceId)};
}
function tree(report,traceId){const rows=report.observations.filter(r=>r.trace_id===traceId),byId=new Map(rows.map(r=>[r.id,{...r,children:[]}]));const roots=[];for(const r of rows){const node=byId.get(r.id);if(r.parent_id)byId.get(r.parent_id).children.push(node);else roots.push(node);}return roots;}
function toRuns(report){return report.observations.filter(r=>r.type==='GENERATION'&&r.model_alias!==null&&r.input_tokens!==null).map(r=>({id:r.id,model:r.model_alias,input_tokens:r.input_tokens,output_tokens:r.output_tokens,latency_ms:r.latency_ms,status:r.status==='error'?'error':'success',retry:false}));}
const demo={format:'sandworm-langfuse-trace/v1',source:'synthetic-fixture',excluded_scores:0,observations:[
{id:'obs-00001',trace_id:'trace-0001',parent_id:null,parent_missing:false,type:'AGENT',model_alias:null,start_offset_ms:0,latency_ms:2400,status:'recorded',input_tokens:null,output_tokens:null,reported_cost_usd:0.006},
{id:'obs-00002',trace_id:'trace-0001',parent_id:'obs-00001',parent_missing:false,type:'TOOL',model_alias:null,start_offset_ms:100,latency_ms:400,status:'recorded',input_tokens:null,output_tokens:null,reported_cost_usd:null},
{id:'obs-00003',trace_id:'trace-0001',parent_id:'obs-00001',parent_missing:false,type:'GENERATION',model_alias:'model-001',start_offset_ms:550,latency_ms:1800,status:'recorded',input_tokens:800,output_tokens:120,reported_cost_usd:0.006}],scores:[{metric_alias:'eval-001',trace_id:'trace-0001',observation_id:'obs-00003',data_type:'NUMERIC',value:0.9},{metric_alias:'eval-002',trace_id:'trace-0001',observation_id:null,data_type:'BOOLEAN',value:true}]};
return Object.freeze({LIMIT,parse,summarize,tree,toRuns,demo});
});
