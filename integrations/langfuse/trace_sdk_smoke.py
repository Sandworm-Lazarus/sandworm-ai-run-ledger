"""Pinned SDK verifies v2 observation and v3 score API contract with no server."""
import json,pathlib,httpx
from langfuse.api.client import LangfuseAPI
from trace_export import convert_trace
root=pathlib.Path(__file__).parent;calls=[]
def handler(request):
    calls.append((request.method,request.url.path,dict(request.url.params)))
    fixture='scores.json' if request.url.path.endswith('/scores') else 'trace-observations.json'
    return httpx.Response(200,json=json.loads((root/'fixtures'/fixture).read_text()))
client=LangfuseAPI(base_url='https://langfuse.example.invalid',username='inert-public',password='inert-secret',httpx_client=httpx.Client(transport=httpx.MockTransport(handler),trust_env=False))
obs=client.observations.get_many(fields='core,basic,model,usage',limit=100).model_dump(mode='json',by_alias=True)
scores=client.scores.get_many(fields='subject',data_type='NUMERIC,BOOLEAN',limit=100).model_dump(mode='json',by_alias=True)
report=convert_trace(obs['data'],scores['data'])
assert calls==[('GET','/api/public/v2/observations',{'fields':'core,basic,model,usage','limit':'100'}),('GET','/api/public/v3/scores',{'limit':'100','fields':'subject','dataType':'NUMERIC,BOOLEAN'})]
assert report['scores'][0]['observation_id']==report['observations'][2]['id']
assert report['observations'][2]['reported_cost_usd']==.006
print(json.dumps({'sdk':'5.2.0','mode':'mock-transport-contract','observations':3,'scores':1,'network_requests':0}))
