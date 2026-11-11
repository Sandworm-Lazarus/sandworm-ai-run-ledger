import copy,http.server,json,pathlib,sys,threading,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from export import convert,fetch_observations,checked_origin,parse_json,ExportError
FIXTURE=json.loads((ROOT/'fixtures/observations.json').read_text())
class ExportTests(unittest.TestCase):
 def fixture(self): return copy.deepcopy(FIXTURE['data'])
 def test_convert_and_privacy(self):
  rows=convert(self.fixture());self.assertEqual(rows[0]['latency_ms'],900);self.assertEqual(rows[0]['input_tokens'],800)
  raw=json.dumps(rows);self.assertNotIn('synthetic',raw);self.assertNotIn('prompt',raw);self.assertNotIn('userId',raw)
 def test_error_retry(self):
  rows=convert(self.fixture());self.assertEqual(rows[1]['status'],'error');self.assertTrue(rows[1]['retry'])
 def test_tokens_not_inferred(self):
  data=self.fixture();del data[0]['usageDetails']['input']
  with self.assertRaisesRegex(ExportError,'MISSING_TOKEN_COUNTS'): convert(data)
 def test_boolean_token_rejected(self):
  data=self.fixture();data[0]['usageDetails']['input']=True
  with self.assertRaises(ExportError):convert(data)
 def test_duplicate_ids(self):
  data=self.fixture();data.append(data[0])
  with self.assertRaisesRegex(ExportError,'DUPLICATE_ID'):convert(data)
 def test_missing_end_rejected(self):
  data=self.fixture();del data[0]['endTime']
  with self.assertRaises(ExportError):convert(data)
 def test_negative_time(self):
  data=self.fixture();data[0]['endTime']='2025-01-01T00:00:00Z'
  with self.assertRaisesRegex(ExportError,'LATENCY'):convert(data)
 def test_naive_time(self):
  data=self.fixture();data[0]['startTime']='2026-01-01T00:00:00'
  with self.assertRaises(ExportError):convert(data)
 def test_retry_not_inferred(self):
  data=self.fixture();data[0]['metadata']['retry']=1
  with self.assertRaisesRegex(ExportError,'RETRY'):convert(data)
 def test_malformed_metadata(self):
  data=self.fixture();data[0]['metadata']=[]
  with self.assertRaisesRegex(ExportError,'METADATA'):convert(data)
 def test_huge_integer(self):
  data=self.fixture();data[0]['usageDetails']['input']=10**1000
  with self.assertRaises(ExportError):convert(data)
 def test_generation_only(self):
  data=self.fixture();data[0]['type']='SPAN'
  with self.assertRaisesRegex(ExportError,'GENERATION'):convert(data)
 def test_origin_validation(self):
  for u in ['http://example.com','https://name:password@example.com','https://example.com/path','https://example.com?secret=x','https://example.com/#x','https://example.com\n']:
   with self.assertRaises(ExportError):checked_origin(u)
  self.assertEqual(checked_origin('http://127.0.0.1:8080',True),'http://127.0.0.1:8080')
 def test_duplicate_json(self):
  with self.assertRaisesRegex(ExportError,'DUPLICATE_JSON'):parse_json(b'{"x":1,"x":2}')
 def test_local_contract(self):
  calls=[]
  class Handler(http.server.BaseHTTPRequestHandler):
   def do_GET(self):
    calls.append((self.path,self.headers.get('Authorization')))
    payload=json.dumps(FIXTURE).encode();self.send_response(200);self.end_headers();self.wfile.write(payload)
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   rows=fetch_observations(f'http://127.0.0.1:{server.server_port}','synthetic-public','synthetic-secret',allow_local=True)
   self.assertEqual(len(convert(rows)),2);self.assertTrue(calls[0][0].startswith('/api/public/v2/observations?type=GENERATION&'))
   self.assertTrue(calls[0][1].startswith('Basic '))
  finally:server.shutdown();server.server_close();thread.join()
 def test_error_body_not_leaked(self):
  class Handler(http.server.BaseHTTPRequestHandler):
   def do_GET(self):self.send_response(401);self.end_headers();self.wfile.write(b'SECRET_VALUE')
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   with self.assertRaisesRegex(ExportError,'^UPSTREAM_REQUEST_FAILED$'):fetch_observations(f'http://127.0.0.1:{server.server_port}','public','secret',allow_local=True)
  finally:server.shutdown();server.server_close();thread.join()
 def test_fractional_tokens_rejected(self):
  data=self.fixture();data[0]['usageDetails']['input']=0.5
  with self.assertRaises(ExportError):convert(data)
 def test_integral_float_tokens(self):
  data=self.fixture();data[0]['usageDetails']['input']=800.0
  self.assertIsInstance(convert(data)[0]['input_tokens'],int)
 def test_cursor_loop_rejected(self):
  class Response:
   status=200
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,n):return json.dumps({'data':[FIXTURE['data'][0]],'meta':{'cursor':'same-cursor'}}).encode()
  class Opener:
   def open(self,*args,**kwargs):return Response()
  with patch('urllib.request.build_opener',return_value=Opener()):
   with self.assertRaisesRegex(ExportError,'PAGINATION_LIMIT'):fetch_observations('https://example.invalid','public','secret')
 def test_redirects_are_not_followed(self):
  requests=[]
  class Handler(http.server.BaseHTTPRequestHandler):
   def do_GET(self):
    requests.append(self.path);self.send_response(302);self.send_header('Location','/should-not-follow');self.end_headers()
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   with self.assertRaisesRegex(ExportError,'UPSTREAM_REQUEST_FAILED'):fetch_observations(f'http://127.0.0.1:{server.server_port}','public','secret',allow_local=True)
   self.assertEqual(len(requests),1)
  finally:server.shutdown();server.server_close();thread.join()
 def test_limit(self):
  with self.assertRaisesRegex(ExportError,'INPUT_LIMIT'):parse_json(b' '*1_048_577)
if __name__=='__main__':unittest.main()
