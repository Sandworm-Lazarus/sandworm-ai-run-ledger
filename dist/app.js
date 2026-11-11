(function () {
  'use strict';
  const api = AIRunLedger;
  const $ = id => document.getElementById(id);
  const runInput = $('run-input'), rateInput = $('rate-input');
  let analysis = null, revision = 0;
  const fmt = new Intl.NumberFormat('en-US', {maximumFractionDigits:0});
  const money = n => n === null ? 'ไม่ครบ' : '$' + n.toLocaleString('en-US', {minimumFractionDigits:4,maximumFractionDigits:8});
  const messages = { INPUT:'ข้อมูลต้องเป็นข้อความ', SIZE:'ข้อมูลเกินขนาด 1 MiB', PARSE:'อ่าน JSON / JSONL ไม่ได้ กรุณาตรวจรูปแบบ', RECORDS:'ต้องมี 1–5,000 รายการ', RECORD:'มีรายการที่ไม่ตรงกับ schema กรุณาตรวจชนิดข้อมูลและช่วงค่า', DUPLICATE:'ID ของแต่ละ attempt ต้องไม่ซ้ำกัน', MODEL_LIMIT:'รองรับสูงสุด 100 โมเดล', RATES:'Rate card ต้องเป็น JSON array ไม่เกิน 200 รายการ และชื่อโมเดลไม่ซ้ำ', RATE:'มีราคาไม่ถูกต้อง ต้องเป็นตัวเลข 0–10,000 USD / ล้าน token', HASH:'เบราว์เซอร์นี้สร้าง SHA-256 ไม่ได้ ลองใช้ localhost หรือ HTTPS', FILTER:'ไม่พบโมเดลที่เลือก' };
  function status(text) { $('status').textContent = text; }
  function invalidate(text) {
    revision++; analysis = null;
    $('results').hidden = true; $('empty').hidden = false;
    $('review-check').checked = false; $('export-btn').disabled = true;
    $('error').hidden = true;
    $('model-rows').replaceChildren();
    status(text || 'ข้อมูลเปลี่ยนแล้ว กรุณาวิเคราะห์ใหม่');
  }
  function showError(error) {
    $('error').textContent = messages[error && error.code] || 'ดำเนินการไม่สำเร็จ กรุณาตรวจไฟล์และลองใหม่';
    $('error').hidden = false;
  }
  function textCell(value) { const td = document.createElement('td'); td.textContent = String(value); return td; }
  function render() {
    const code = $('model-filter').value;
    const selected = code === 'all' ? analysis.models : analysis.models.filter(m=>m.code === code);
    const summary = code === 'all' ? analysis.summary : selected[0].metrics;
    $('metric-cost').textContent = money(summary.estimated_cost_usd);
    $('metric-tokens').textContent = fmt.format(summary.total_tokens);
    $('metric-attempts').textContent = fmt.format(summary.attempts);
    $('metric-error').textContent = (summary.error_rate*100).toFixed(1) + '%';
    $('metric-p50').textContent = fmt.format(summary.p50_latency_ms);
    $('metric-p95').textContent = fmt.format(summary.p95_latency_ms);
    $('cost-note').textContent = summary.unpriced_attempts ? 'ยังไม่มีราคาสำหรับ ' + summary.unpriced_attempts + ' attempts · ยอดที่คำนวณได้ ' + money(summary.known_cost_usd) + ' (ยังไม่ใช่ยอดรวม)' : 'ประมาณจากราคาที่กำหนด · รวม ' + summary.retries + ' retry attempts และ ' + summary.errors + ' error attempts';
    $('model-rows').replaceChildren();
    for (const model of selected) {
      const tr = document.createElement('tr'), m = model.metrics, first = textCell(model.label), alias = document.createElement('span');
      alias.textContent = model.code; first.append(alias); tr.append(first);
      [m.attempts,fmt.format(m.input_tokens)+' / '+fmt.format(m.output_tokens),m.retries,m.errors,m.p95_latency_ms,money(m.estimated_cost_usd)].forEach(value=>tr.append(textCell(value)));
      $('model-rows').append(tr);
    }
    $('review-check').checked = false; $('export-btn').disabled = true;
  }
  $('demo-btn').addEventListener('click', () => {
    invalidate('โหลดข้อมูลสมมติ 12 attempts แล้ว กดวิเคราะห์เพื่อดูผล');
    runInput.value = JSON.stringify(api.demoRuns,null,2); rateInput.value = JSON.stringify(api.demoRates,null,2);
    $('file-input').value = '';
  });
  $('clear-btn').addEventListener('click', () => {
    invalidate('ล้างข้อมูลจากหน้านี้แล้ว'); runInput.value = ''; rateInput.value = ''; $('file-input').value = '';
  });
  runInput.addEventListener('input',()=>invalidate()); rateInput.addEventListener('input',()=>invalidate());
  $('analyze-btn').addEventListener('click', () => {
    invalidate('กำลังวิเคราะห์…');
    try {
      analysis = api.analyze(runInput.value,rateInput.value);
      const options = [document.createElement('option')]; options[0].value = 'all'; options[0].textContent = 'ทุกโมเดล';
      for (const model of analysis.models) { const o = document.createElement('option'); o.value=model.code; o.textContent=model.label+' / '+model.code; options.push(o); }
      $('model-filter').replaceChildren(...options); $('model-filter').value='all';
      render(); $('results').hidden=false; $('empty').hidden=true;
      status('วิเคราะห์แล้ว ' + analysis.summary.attempts + ' attempts · ' + analysis.models.length + ' โมเดล');
    } catch (e) { showError(e); status('ยังไม่มีผลสรุปที่ส่งออกได้'); }
  });
  $('model-filter').addEventListener('change', () => { if (!analysis) return; revision++; render(); status('เปลี่ยนตัวกรองแล้ว กรุณาตรวจทานผลสรุปใหม่'); });
  $('review-check').addEventListener('change', () => { $('export-btn').disabled = !analysis || !$('review-check').checked; });
  $('file-input').addEventListener('change', async () => {
    const file = $('file-input').files[0]; if (!file) return;
    invalidate('กำลังอ่านไฟล์ในเบราว์เซอร์…'); const rev = revision;
    try {
      if (file.size > api.LIMITS.bytes) throw {code:'SIZE'};
      if (!/\.(json|jsonl|log)$/i.test(file.name)) throw new Error('unsupported');
      const bytes = await file.arrayBuffer();
      const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if (rev !== revision) return;
      runInput.value=text; status('นำเข้า log แล้ว กรุณากำหนด rate card และวิเคราะห์');
    } catch (e) { if (rev === revision) { showError(e); status('นำเข้าไม่สำเร็จ'); } }
    finally { if (rev === revision) $('file-input').value=''; }
  });
  $('export-btn').addEventListener('click', async () => {
    if (!analysis || !$('review-check').checked) return;
    const rev = revision; $('export-btn').disabled=true;
    try {
      const report = await api.createReport(runInput.value,rateInput.value,$('model-filter').value);
      if (rev !== revision || !analysis || !$('review-check').checked) return;
      const blob = new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}), url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href=url; link.download='sandworm-ai-run-summary.json'; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      status('ดาวน์โหลดผลสรุปแล้ว · ไม่รวมชื่อโมเดล, ID หรือ prompt ต้นฉบับ');
    } catch (e) { if (rev===revision) showError(e); }
    finally { if (rev===revision) $('export-btn').disabled=!analysis || !$('review-check').checked; }
  });
})();
