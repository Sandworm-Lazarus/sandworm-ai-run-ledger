"""Run local contracts; optional installed SDK smoke is recorded separately."""
import datetime,hashlib,json,pathlib,subprocess,sys,unittest
ROOT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
suite=unittest.defaultTestLoader.discover(str(ROOT/'tests'));result=unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():raise SystemExit(2)
from export import convert
rows=convert(json.loads((ROOT/'fixtures/observations.json').read_text())['data'])
(ROOT/'fixtures/ledger.jsonl').write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows))
roundtrip=subprocess.run(['node',str(ROOT/'ledger_smoke.cjs')],capture_output=True,text=True,timeout=15)
if roundtrip.returncode:print('LEDGER_ROUNDTRIP_FAILED',file=sys.stderr);raise SystemExit(2)
python=ROOT/'.venv/bin/python';sdk={'version':'5.2.0','status':'not_installed','mode':'mock-transport-contract','authenticated_live_server':False}
if python.exists():
 p=subprocess.run([str(python),str(ROOT/'sdk_smoke.py')],capture_output=True,text=True,timeout=30)
 if p.returncode:print('SDK_CONTRACT_FAILED',file=sys.stderr);raise SystemExit(2)
 sdk['status']='passed';sdk['network_requests']=0
 for smoke in ['trace_sdk_smoke.py','instrument_smoke.py']:
  p=subprocess.run([str(python),str(ROOT/smoke)],capture_output=True,text=True,timeout=30)
  if p.returncode:print('TRACE_SDK_CONTRACT_FAILED',file=sys.stderr);raise SystemExit(2)
 sdk['trace_and_score_api_contract']='passed';sdk['otel_instrumentation']='passed';sdk['socket_connections']=0
excluded={'.venv','__pycache__','reports','.runtime','.git'}
hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.rglob('*')) if p.is_file() and not any(x in excluded for x in p.relative_to(ROOT).parts)}
record={'schema_version':1,'project':'sandworm-ai-run-ledger-langfuse','validated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','passed':result.testsRun,'sdk_smoke':sdk,'ledger_roundtrip':'passed','source_sha256':hashes,'browser_qa':'not_run_runtime_unavailable','ledger_engine_sha256':hashlib.sha256((ROOT/'../../dist/ledger.js').read_bytes()).hexdigest()}
(ROOT/'reports').mkdir(exist_ok=True);(ROOT/'reports/validation.json').write_text(json.dumps(record,indent=2)+'\n')
