"""Exercise the pinned official SDK against an in-memory HTTP transport, never a server."""
import json,pathlib,sys
import httpx
from langfuse.api.client import LangfuseAPI
from export import convert
root=pathlib.Path(__file__).parent
fixture=json.loads((root/'fixtures/observations.json').read_text())
calls=[]
def handler(request):
 calls.append((request.method,request.url.path,dict(request.url.params)))
 return httpx.Response(200,json=fixture)
client=LangfuseAPI(base_url='https://langfuse.example.invalid',username='synthetic-public',password='synthetic-secret',httpx_client=httpx.Client(transport=httpx.MockTransport(handler),trust_env=False))
response=client.observations.get_many(type='GENERATION',fields='core,basic,model,usage',limit=100)
payload=response.model_dump(mode='json',by_alias=True)
rows=convert(payload['data'])
assert calls==[('GET','/api/public/v2/observations',{'fields':'core,basic,model,usage','limit':'100','type':'GENERATION'})]
assert rows[0]['input_tokens']==800 and rows[0]['latency_ms']==900
assert 'synthetic private' not in json.dumps(rows) and 'userId' not in json.dumps(rows)
print(json.dumps({'sdk':'langfuse-5.2.0','mode':'mock-transport-contract','attempts':len(rows),'network_requests':0}))
