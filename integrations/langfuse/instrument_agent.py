"""Explicit opt-in sample: record structure and numbers, never task contents."""
import json,os,sys,logging
from export import checked_origin,ExportError

def run_example(client):
    # Replace these synthetic operations with your own agent/tool/model boundaries.
    with client.start_as_current_observation(as_type='agent',name='agent-run'):
        with client.start_as_current_observation(as_type='tool',name='local-retrieval'):
            retrieved_count=2  # Do not record retrieved documents or user inputs.
        with client.start_as_current_observation(as_type='generation',name='draft-answer',model='synthetic-model') as generation:
            generation.update(usage_details={'input':800,'output':120},cost_details={'input':0.002,'output':0.004})
            generation.score(name='fixture-quality',value=0.9,data_type='NUMERIC')
        return retrieved_count

def main():
    if sys.argv[1:]!=['--send-synthetic-example']:
        print('Explicit --send-synthetic-example is required; no model is called.',file=sys.stderr);return 2
    try:
        host=checked_origin(os.environ.get('LANGFUSE_HOST',''))
        if not os.environ.get('LANGFUSE_PUBLIC_KEY') or not os.environ.get('LANGFUSE_SECRET_KEY'):raise ExportError('MISSING_CREDENTIALS')
        from langfuse import Langfuse
        logging.getLogger('langfuse').disabled=True
        logging.getLogger('httpx').setLevel(logging.CRITICAL)
        client=Langfuse(base_url=host,public_key=os.environ['LANGFUSE_PUBLIC_KEY'],secret_key=os.environ['LANGFUSE_SECRET_KEY'],mask=lambda data:'[CONTENT OMITTED]')
        run_example(client);client.flush();client.shutdown()
        print(json.dumps({'status':'flush_completed_not_server_verified','model_api_calls':0}));return 0
    except Exception:
        print('{"error":"INSTRUMENTATION_FAILED"}',file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
