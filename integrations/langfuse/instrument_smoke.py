"""Run real Langfuse SDK with in-memory OTel spans and HTTP MockTransport."""
import json,socket,os
from unittest.mock import patch
import httpx
from langfuse import Langfuse
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from instrument_agent import run_example
exporter=InMemorySpanExporter();provider=TracerProvider(sampler=ALWAYS_ON);requests=[]
def handler(request):
    requests.append((request.url.path,json.loads(request.content)))
    return httpx.Response(200,json={'successes':[],'errors':[]})
with patch.dict(os.environ,{k:'' for k in ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']}), patch.object(socket.socket,'connect',side_effect=AssertionError('NETWORK_FORBIDDEN')):
    client=Langfuse(public_key='inert-fixture-public',secret_key='inert-fixture-secret',base_url='https://langfuse.example.invalid',httpx_client=httpx.Client(transport=httpx.MockTransport(handler),trust_env=False),tracer_provider=provider,span_exporter=exporter,mask=lambda data:'[CONTENT OMITTED]',flush_at=1)
    assert run_example(client)==2
    client.flush();client.shutdown()
spans=exporter.get_finished_spans();named={s.name:s for s in spans}
assert len(spans)==3
assert json.loads(named['draft-answer'].attributes['langfuse.observation.usage_details'])=={'input':800,'output':120}
assert json.loads(named['draft-answer'].attributes['langfuse.observation.cost_details'])=={'input':0.002,'output':0.004}
assert set(named)=={'agent-run','local-retrieval','draft-answer'}
assert named['draft-answer'].parent.span_id==named['agent-run'].context.span_id
assert named['local-retrieval'].parent.span_id==named['agent-run'].context.span_id
assert len(set(s.context.trace_id for s in spans))==1
assert all('input' not in k and 'output' not in k for s in spans for k in s.attributes if k.startswith('langfuse.observation.input') or k.startswith('langfuse.observation.output'))
assert any('fixture-quality' in json.dumps(body) for path,body in requests)
print(json.dumps({'sdk':'5.2.0','mode':'in-memory-otel-and-mock-http','spans':len(named),'parent_child_edges':2,'score_submission':'passed','network_connections':0}))
