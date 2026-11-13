(function(root,factory){
  'use strict'; const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SandwormExperiments=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const LIMITS=Object.freeze({bytes:1048576,bundles:32,attempts:5000,evaluations:1000,groups:200,tokens:1000000000,latency:86400000});
  const MESSAGES=Object.freeze({INPUT:'Expected bounded UTF-8 JSON.',SCHEMA:'Invalid experiment bundle.',DATASET:'Cannot compare different dataset hashes.',DUPLICATE:'Repeated experiment, evaluation or attempt ID.',LINK:'Attempt does not match its evaluation.',LIMIT:'Experiment limit exceeded.'});
  function fail(code){const e=new Error(MESSAGES[code]);e.code=code;throw e;}
  const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
  const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(x);
  const label=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=100&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x);
  const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
  const finite=(x,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max;
  const optionalNumber=(x,max)=>x===null||finite(x,max);
  const token=x=>x===null||(Number.isSafeInteger(x)&&x>=0&&x<=LIMITS.tokens);
  const repeat=x=>Number.isInteger(x)&&x>=1&&x<=100;
  function timestamp(x){
    if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x)||!Number.isFinite(Date.parse(x)))return false;
    const normalized=x.includes('.')?x.replace(/\.(\d{1,3})Z$/,(_,digits)=>'.'+digits.padEnd(3,'0')+'Z'):x.replace(/Z$/,'.000Z');
    return new Date(x).toISOString()===normalized;
  }
  function date(x){return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;}
  function parse(text){
    if(typeof text!=='string'||new TextEncoder().encode(text).length>LIMITS.bytes)fail('INPUT');
    let input;try{input=JSON.parse(text.replace(/^\uFEFF/,''));}catch(_){fail('INPUT');}
    const list=Array.isArray(input)?input:[input];
    if(!list.length||list.length>LIMITS.bundles)fail('LIMIT');
    let totalAttempts=0,totalEvaluations=0;
    const normalized=list.map(b=>{
      if(!obj(b)||b.kind!=='sandworm-experiment/v1'||b.schemaVersion!==1||!id(b.experimentId)||!label(b.datasetId)||!hash(b.datasetSha256)||!hash(b.planSha256)||
         !timestamp(b.createdAt)||
         !obj(b.normalization)||b.normalization.nfc!==true||b.normalization.whitespace!==true||
         !Array.isArray(b.evaluations)||!b.evaluations.length||!Array.isArray(b.attempts)||!b.attempts.length)fail('SCHEMA');
      totalAttempts+=b.attempts.length;totalEvaluations+=b.evaluations.length;
      if(totalAttempts>LIMITS.attempts||totalEvaluations>LIMITS.evaluations)fail('LIMIT');
      const evaluations=b.evaluations.map(e=>{
        if(!obj(e)||!id(e.id)||!label(e.model)||!label(e.variantId)||!hash(e.promptSha256)||!repeat(e.repeat)||!optionalNumber(e.score,100)||!Number.isInteger(e.expectedAttempts)||e.expectedAttempts<1||e.expectedAttempts>1000||!Number.isInteger(e.completedAttempts)||e.completedAttempts<0||e.completedAttempts>e.expectedAttempts)fail('SCHEMA');
        return {id:e.id,model:e.model,variantId:e.variantId,promptSha256:e.promptSha256,repeat:e.repeat,score:e.score,expectedAttempts:e.expectedAttempts,completedAttempts:e.completedAttempts};
      });
      const attempts=b.attempts.map(a=>{
        if(!obj(a)||!id(a.id)||!id(a.evaluationId)||!id(a.caseId)||!label(a.model)||!label(a.variantId)||!hash(a.promptSha256)||!repeat(a.repeat)||
          !token(a.input_tokens)||!token(a.output_tokens)||!optionalNumber(a.latency_ms,LIMITS.latency)||!['success','error'].includes(a.status)||
          !optionalNumber(a.cost_usd,1000000000)||!['unknown','provider-reported','user-rate'].includes(a.cost_source)||
          (a.cost_usd===null)!==(a.cost_source==='unknown')||
          (a.rate_date!==null&&!date(a.rate_date))||(a.rate_source!==null&&(typeof a.rate_source!=='string'||!a.rate_source.trim()||a.rate_source.length>500))||
          (a.cost_source==='user-rate'&&(!date(a.rate_date)||a.rate_source===null||a.input_tokens===null||a.output_tokens===null)))fail('SCHEMA');
        return {id:a.id,evaluationId:a.evaluationId,caseId:a.caseId,model:a.model,variantId:a.variantId,promptSha256:a.promptSha256,repeat:a.repeat,input_tokens:a.input_tokens,output_tokens:a.output_tokens,latency_ms:a.latency_ms,status:a.status,cost_usd:a.cost_usd,cost_source:a.cost_source,rate_date:a.rate_date,rate_source:a.rate_source};
      });
      return {kind:b.kind,schemaVersion:1,experimentId:b.experimentId,createdAt:b.createdAt,datasetId:b.datasetId,datasetSha256:b.datasetSha256,planSha256:b.planSha256,normalization:{nfc:true,whitespace:true},evaluations,attempts};
    });
    const experimentIds=new Set(),evaluationIds=new Set(),attemptIds=new Set(),slots=new Set();
    const dataset=normalized[0].datasetSha256;let expectedCases=null;
    for(const b of normalized){
      if(b.datasetSha256!==dataset)fail('DATASET');
      if(experimentIds.has(b.experimentId))fail('DUPLICATE');experimentIds.add(b.experimentId);
      const evaluations=new Map(),seen=new Set(),linked=new Map();
      for(const e of b.evaluations){
        const slot=JSON.stringify([e.model,e.variantId,e.promptSha256,e.repeat,b.experimentId]);
        if(evaluationIds.has(e.id)||slots.has(slot))fail('DUPLICATE');
        evaluationIds.add(e.id);slots.add(slot);evaluations.set(e.id,e);linked.set(e.id,[]);
      }
      for(const a of b.attempts){
        if(attemptIds.has(a.id))fail('DUPLICATE');attemptIds.add(a.id);
        const e=evaluations.get(a.evaluationId);
        if(!e||['model','variantId','promptSha256','repeat'].some(k=>a[k]!==e[k]))fail('LINK');
        seen.add(e.id);linked.get(e.id).push(a);
      }
      if(seen.size!==evaluations.size)fail('LINK');
      for(const e of b.evaluations){
        const rows=linked.get(e.id),cases=rows.map(a=>a.caseId).sort(),signature=JSON.stringify(cases);
        if(rows.length!==e.expectedAttempts||new Set(cases).size!==cases.length||rows.filter(a=>a.status==='success').length!==e.completedAttempts)fail('LINK');
        if(expectedCases===null)expectedCases=signature;else if(expectedCases!==signature)fail('LINK');
      }
    }
    return normalized;
  }
  function percentile(values,p){if(!values.length)return null;const s=values.slice().sort((a,b)=>a-b);return s[Math.max(0,Math.ceil(p*s.length)-1)];}
  function analyze(text){
    const bundles=parse(text),groups=new Map();
    const key=e=>JSON.stringify([e.model,e.variantId,e.promptSha256]);
    for(const b of bundles){
      for(const e of b.evaluations){
        const k=key(e);if(!groups.has(k))groups.set(k,{model:e.model,variantId:e.variantId,promptSha256:e.promptSha256,evaluations:[],attempts:[]});
        groups.get(k).evaluations.push(e);
      }
      for(const a of b.attempts)groups.get(key(a)).attempts.push(a);
    }
    if(groups.size>LIMITS.groups)fail('LIMIT');
    const comparisons=[...groups.values()].sort((a,b)=>key(a).localeCompare(key(b),'en')).map((g,i)=>{
      const eligible=g.evaluations.filter(e=>e.completedAttempts===e.expectedAttempts),scores=eligible.map(e=>e.score).filter(x=>x!==null),latencies=g.attempts.map(a=>a.latency_ms).filter(x=>x!==null);
      const priced=g.attempts.filter(a=>a.cost_usd!==null),usage=g.attempts.filter(a=>a.input_tokens!==null&&a.output_tokens!==null);
      const known=Number(priced.reduce((s,a)=>s+a.cost_usd,0).toFixed(12));
      return {alias:'comparison-'+String(i+1).padStart(3,'0'),model:g.model,variantId:g.variantId,promptSha256:g.promptSha256,
        evaluations:g.evaluations.length,completeEvaluations:eligible.length,scoredEvaluations:scores.length,scoreMean:scores.length?scores.reduce((s,x)=>s+x,0)/scores.length:null,
        scoreMin:scores.length?Math.min(...scores):null,scoreMax:scores.length?Math.max(...scores):null,
        attempts:g.attempts.length,errors:g.attempts.filter(a=>a.status==='error').length,
        p50LatencyMs:percentile(latencies,.5),p95LatencyMs:percentile(latencies,.95),timedAttempts:latencies.length,
        knownCostUsd:known,totalCostUsd:priced.length===g.attempts.length?known:null,pricedAttempts:priced.length,
        usageAttempts:usage.length,inputTokens:usage.reduce((s,a)=>s+a.input_tokens,0),outputTokens:usage.reduce((s,a)=>s+a.output_tokens,0),
        costSources:[...new Set(priced.map(a=>a.cost_source))].sort(),rateDates:[...new Set(priced.map(a=>a.rate_date).filter(x=>x!==null))].sort()};
    });
    return {kind:'sandworm-experiment-comparison/v1',schemaVersion:1,datasetSha256:bundles[0].datasetSha256,
      experimentCount:bundles.length,planCount:new Set(bundles.map(b=>b.planSha256)).size,
      attemptCount:bundles.reduce((s,b)=>s+b.attempts.length,0),comparisons};
  }
  function exportReport(analysis){
    return {kind:analysis.kind,schemaVersion:1,datasetSha256:analysis.datasetSha256,experimentCount:analysis.experimentCount,planCount:analysis.planCount,attemptCount:analysis.attemptCount,
      comparisons:analysis.comparisons.map(({model,variantId,promptSha256,...metrics})=>metrics),
      methodology:{quality:'Mean/min/max of complete dataset-level repeat evaluations, 0–100; not averaged per HTTP request. Repeats with any error or null score are excluded with explicit coverage.',
      latency:'Nearest-rank p50/p95 over measured HTTP attempt latency, including errors. Missing observations excluded with coverage.',
      cost:'Known attempt cost subtotal; total is null until every attempt is priced. Provider-reported and user-rate are distinct sources, not an invoice.',
      comparability:'Same exact dataset SHA-256 and NFC/whitespace scoring normalization required. Different prompt hashes stay separate. Repetitions are observed ranges, not confidence intervals.',
      privacy:'Export omits experiment/run/evaluation IDs, model and prompt labels, prompts, answers, rate source text and unknown fields. Dataset hashes remain fingerprints, not signatures.'}};
  }
  const demo=(()=>{
    const model='demo-saffron',variantId='concise',promptSha256='c'.repeat(64);
    const evaluations=[1,2].map(repeat=>({id:'demo-eval-'+repeat,model,variantId,promptSha256,repeat,score:repeat===1?80:90,expectedAttempts:1,completedAttempts:1}));
    const attempts=evaluations.map((e,i)=>({id:'demo-attempt-'+(i+1),evaluationId:e.id,caseId:'demo-case-1',model,variantId,promptSha256,repeat:e.repeat,input_tokens:100,output_tokens:30,latency_ms:600+i*400,status:'success',cost_usd:i===0?0.001:null,cost_source:i===0?'user-rate':'unknown',rate_date:i===0?'2026-11-13':null,rate_source:i===0?'Synthetic arithmetic rates':null,score:null}));
    for(const repeat of [1,2]){
      const e={id:'demo-indigo-eval-'+repeat,model:'demo-indigo',variantId:'detailed',promptSha256:'d'.repeat(64),repeat,score:90+repeat*2,expectedAttempts:1,completedAttempts:1};evaluations.push(e);
      attempts.push({id:'demo-indigo-attempt-'+repeat,evaluationId:e.id,caseId:'demo-case-1',model:e.model,variantId:e.variantId,promptSha256:e.promptSha256,repeat,input_tokens:150,output_tokens:60,latency_ms:1000+repeat*300,status:'success',cost_usd:0.003,cost_source:'provider-reported',rate_date:null,rate_source:null,score:null});
    }
    return {kind:'sandworm-experiment/v1',schemaVersion:1,experimentId:'demo-experiment-1',createdAt:'2026-11-13T00:00:00Z',datasetId:'synthetic-demo',datasetSha256:'a'.repeat(64),planSha256:'b'.repeat(64),normalization:{nfc:true,whitespace:true},attempts,evaluations};
  })();
  return Object.freeze({LIMITS,MESSAGES,parse,analyze,exportReport,percentile,demo});
});
