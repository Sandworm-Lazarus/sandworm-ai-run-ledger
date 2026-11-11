import copy,json,pathlib,sys,unittest,tempfile,os,subprocess,http.server,threading
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from trace_export import convert_trace,fetch_pages,read_local
from export import ExportError
OBS=json.loads((ROOT/'fixtures/trace-observations.json').read_text())['data']
SCORES=json.loads((ROOT/'fixtures/scores.json').read_text())['data']
class TraceTests(unittest.TestCase):
 def test_relationships_cost_and_scores(self):
  r=convert_trace(OBS,SCORES);self.assertEqual(r['observations'][2]['parent_id'],r['observations'][0]['id']);self.assertEqual(r['scores'][0]['observation_id'],r['observations'][2]['id']);self.assertEqual(r['observations'][2]['reported_cost_usd'],.006)
 def test_raw_content_ids_names_excluded(self):
  raw=json.dumps(convert_trace(OBS,SCORES));self.assertNotIn('synthetic-',raw);self.assertNotIn('private content',raw);self.assertNotIn('quality',raw)
 def test_missing_parent_marked(self):
  d=copy.deepcopy(OBS);d[1]['parentObservationId']='missing';r=convert_trace(d);self.assertTrue(r['observations'][1]['parent_missing']);self.assertIsNone(r['observations'][1]['parent_id'])
 def test_cycle(self):
  d=copy.deepcopy(OBS);d[0]['parentObservationId']=d[1]['id']
  with self.assertRaisesRegex(ExportError,'CYCLE'):convert_trace(d)
 def test_cross_trace(self):
  d=copy.deepcopy(OBS);d[1]['traceId']='other'
  with self.assertRaisesRegex(ExportError,'CROSS_TRACE'):convert_trace(d)
 def test_unknown_tokens_remain_null(self):
  d=copy.deepcopy(OBS);del d[2]['usageDetails'];r=convert_trace(d);self.assertIsNone(r['observations'][2]['input_tokens'])
 def test_partial_tokens_rejected(self):
  d=copy.deepcopy(OBS);del d[2]['usageDetails']['output']
  with self.assertRaisesRegex(ExportError,'PARTIAL'):convert_trace(d)
 def test_invalid_cost(self):
  for value in [True,-1,float('inf')]:
   d=copy.deepcopy(OBS);d[2]['totalCost']=value
   with self.assertRaisesRegex(ExportError,'COST'):convert_trace(d)
 def test_score_trace_mismatch(self):
  s=copy.deepcopy(SCORES);s[0]['subject']['traceId']='wrong'
  with self.assertRaisesRegex(ExportError,'MISMATCH'):convert_trace(OBS,s)
 def test_text_score_and_unrelated_counted_excluded(self):
  s=copy.deepcopy(SCORES);s[0]['dataType']='TEXT';s[0]['value']='private';r=convert_trace(OBS,s);self.assertEqual(r['scores'],[]);self.assertEqual(r['excluded_scores'],1)
 def test_legacy_boolean_normalized_without_changing_v3_contract(self):
  s={'id':'legacy-score','name':'pass','dataType':'BOOLEAN','value':1,'traceId':'synthetic-trace'}
  self.assertIs(convert_trace(OBS,[s])['scores'][0]['value'],True)
  s['subject']={'kind':'trace','id':'synthetic-trace'}
  with self.assertRaisesRegex(ExportError,'VALUE'):convert_trace(OBS,[s])
 def test_invalid_numeric_bool(self):
  s=copy.deepcopy(SCORES);s[0]['value']=True
  with self.assertRaisesRegex(ExportError,'VALUE'):convert_trace(OBS,s)
 def test_timestamp_and_duplicate(self):
  for d in [OBS+[OBS[0]],[{**OBS[0],'endTime':None}]]:
   with self.assertRaises(ExportError):convert_trace(d)
 def test_live_contract_both_endpoints(self):
  calls=[]
  class H(http.server.BaseHTTPRequestHandler):
   def do_GET(self):
    calls.append(self.path);payload={'data':SCORES if '/scores?' in self.path else OBS,'meta':{'cursor':None}};self.send_response(200);self.end_headers();self.wfile.write(json.dumps(payload).encode())
   def log_message(self,*a):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),H);t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
  try:
   origin=f'http://127.0.0.1:{server.server_port}';o=fetch_pages(origin,'inert-public','inert-secret',allow_local=True);s=fetch_pages(origin,'inert-public','inert-secret',scores=True,allow_local=True)
   self.assertEqual(len(convert_trace(o,s)['scores']),1);self.assertIn('fields=core%2Cbasic%2Cmodel%2Cusage',calls[0]);self.assertIn('/api/public/v3/scores?',calls[1]);self.assertIn('dataType=NUMERIC%2CBOOLEAN',calls[1]);self.assertNotIn('io',calls[0].split('fields=')[1])
  finally:server.shutdown();server.server_close();t.join()
 def test_both_clis_fifo_and_safe_errors(self):
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory);os.mkfifo(p/'fifo')
   for script in ['export.py','trace_export.py']:
    result=subprocess.run([sys.executable,str(ROOT/script),'--input',str(p/'fifo'),'--output',str(p/'out')],capture_output=True,text=True,timeout=3);self.assertEqual(result.returncode,2);self.assertIn('REGULAR_FILE_REQUIRED',result.stderr)
    result=subprocess.run([sys.executable,str(ROOT/script),'--PRIVATE_VALUE'],capture_output=True,text=True,timeout=3);self.assertEqual(result.returncode,2);self.assertNotIn('PRIVATE_VALUE',result.stderr)
 def test_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory);(p/'link').symlink_to(ROOT/'fixtures/trace-observations.json')
   with self.assertRaises(OSError):read_local(p/'link')
 def test_output_exclusive_private_mode_and_same_input(self):
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory)/'report';cmd=[sys.executable,str(ROOT/'trace_export.py'),'--input',str(ROOT/'fixtures/trace-observations.json'),'--output',str(p)]
   self.assertEqual(subprocess.run(cmd,capture_output=True).returncode,0);self.assertEqual(p.stat().st_mode&0o777,0o600);before=p.read_bytes();self.assertEqual(subprocess.run(cmd,capture_output=True).returncode,2);self.assertEqual(p.read_bytes(),before)
if __name__=='__main__':unittest.main()
