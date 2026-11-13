(function(){
  'use strict';
  const api=SandwormExperiments,$=id=>document.getElementById(id);
  let analysis=null,revision=0;
  const status=t=>{$('experiment-status').textContent=t;};
  const decimal=x=>x===null?'ไม่ทราบ':x.toFixed(2);
  const money=x=>x===null?'ไม่ครบ':'$'+x.toFixed(6);
  const messages={INPUT:'อ่าน JSON ไม่สำเร็จ หรือข้อมูลเกิน 1 MiB',SCHEMA:'รูปแบบชุดทดลองไม่ตรง sandworm-experiment/v1 กรุณาส่งออกใหม่จาก Thai Eval',DATASET:'เปรียบเทียบไม่ได้: dataset SHA-256 ต่างกัน กรุณาใช้ชุดทดสอบเดียวกัน',DUPLICATE:'นำเข้าไม่ได้: experiment, evaluation หรือ attempt ID ซ้ำกัน',LINK:'attempt เชื่อมกับ evaluation ไม่ถูกต้อง',LIMIT:'ข้อมูลเกินขอบเขต 32 ชุด / 5,000 attempts / 1,000 evaluations / 200 กลุ่ม'};
  function invalidate(){
    revision++;analysis=null;$('experiment-results').hidden=true;$('experiment-rows').replaceChildren();
    $('experiment-summary').textContent='';$('experiment-provenance').textContent='';
    $('experiment-review').checked=false;$('experiment-export').disabled=true;
  }
  function error(e){status(messages[e&&e.code]||'นำเข้าไม่สำเร็จ กรุณาตรวจชนิดไฟล์และรูปแบบข้อมูล');}
  function cell(text){const e=document.createElement('td');e.textContent=String(text);return e;}
  function render(){
    $('experiment-summary').textContent=analysis.experimentCount+' ชุดทดลอง · '+analysis.planCount+' แผน · '+analysis.attemptCount+' HTTP attempts · '+analysis.comparisons.length+' คู่โมเดล/พรอมป์ต์';
    $('experiment-provenance').textContent='Dataset SHA-256: '+analysis.datasetSha256+' · คะแนน 0–100 จาก evaluation ทั้ง dataset ต่อ repeat; ช่วง min–max ไม่ใช่ confidence interval';
    for(const g of analysis.comparisons){
      const tr=document.createElement('tr'),name=cell(g.model),variant=document.createElement('span');
      variant.textContent=g.variantId+' / prompt '+g.promptSha256.slice(0,12);name.append(variant);
      const score=decimal(g.scoreMean)+' ['+decimal(g.scoreMin)+'–'+decimal(g.scoreMax)+'] · '+g.scoredEvaluations+'/'+g.evaluations+' repeats มีคะแนน · '+g.completeEvaluations+' repeats สำเร็จครบ';
      const cost=money(g.totalCostUsd)+' · ยอดทราบ '+money(g.knownCostUsd)+' · '+g.pricedAttempts+'/'+g.attempts+' attempts มีราคา';
      const latency=decimal(g.p50LatencyMs)+' / '+decimal(g.p95LatencyMs)+' · '+g.timedAttempts+'/'+g.attempts+' attempts มีเวลา';
      const source=(g.costSources.length?g.costSources.join(', '):'unknown')+(g.rateDates.length?' · '+g.rateDates.join(', '):'');
      tr.append(name,cell(score),cell(cost),cell(latency),cell(g.errors+'/'+g.attempts),cell(g.usageAttempts+'/'+g.attempts),cell(source));
      $('experiment-rows').append(tr);
    }
    $('experiment-results').hidden=false;
  }
  $('experiment-input').addEventListener('input',()=>{invalidate();status('ข้อมูลเปลี่ยนแล้ว กรุณาเปรียบเทียบใหม่');});
  $('experiment-demo').addEventListener('click',()=>{invalidate();$('experiment-input').value=JSON.stringify(api.demo,null,2);status('โหลดตัวอย่างสมมติแล้ว กดเปรียบเทียบ');});
  $('experiment-clear').addEventListener('click',()=>{invalidate();$('experiment-input').value='';$('experiment-files').value='';status('ล้างชุดทดลองจากหน้านี้แล้ว');});
  $('experiment-analyze').addEventListener('click',()=>{
    invalidate();
    try{analysis=api.analyze($('experiment-input').value);render();status('เปรียบเทียบแล้ว · ข้อมูลไม่ครบแสดง coverage โดยไม่แทนด้วยศูนย์');}
    catch(e){invalidate();error(e);}
  });
  $('experiment-files').addEventListener('change',async()=>{
    const files=Array.from($('experiment-files').files);if(!files.length)return;
    invalidate();const rev=revision;status('กำลังอ่านชุดทดลองที่เลือก…');
    try{
      if(files.length>api.LIMITS.bundles||files.reduce((s,f)=>s+f.size,0)>api.LIMITS.bytes)throw {code:'LIMIT'};
      const bundles=[];
      for(const f of files){
        if(!/\.json$/i.test(f.name))throw {code:'INPUT'};
        const text=new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer());
        if(rev!==revision)return;
        let parsed;try{parsed=JSON.parse(text.replace(/^\uFEFF/,''));}catch(_){throw {code:'INPUT'};}
        bundles.push(...(Array.isArray(parsed)?parsed:[parsed]));
      }
      const text=JSON.stringify(bundles,null,2);api.parse(text);
      if(rev!==revision)return;
      $('experiment-input').value=text;status('อ่าน '+files.length+' ไฟล์แล้ว กดเปรียบเทียบ · การเลือกไฟล์ใหม่แทนชุดเดิม');
    }catch(e){if(rev===revision)error(e);}
    finally{if(rev===revision)$('experiment-files').value='';}
  });
  $('experiment-review').addEventListener('change',()=>{$('experiment-export').disabled=!analysis||!$('experiment-review').checked;});
  $('experiment-export').addEventListener('click',()=>{
    if(!analysis||!$('experiment-review').checked)return;
    const report=api.exportReport(analysis),blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='sandworm-experiment-comparison.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('ดาวน์โหลดผลรวมแบบ alias แล้ว · ไม่มีชื่อโมเดล/พรอมป์ต์ ID หรือเนื้อหาคำตอบ');
  });
})();
