"""Bounded read-only Langfuse Public API -> Sandworm Ledger JSONL adapter."""
from __future__ import annotations
import argparse, base64, datetime as dt, hashlib, ipaddress, json, math, os, pathlib, stat, sys
import urllib.parse, urllib.request

MAX_BYTES=1_048_576
MAX_RECORDS=5000
class ExportError(ValueError): pass

def fail(code): raise ExportError(code)
def integer(value, maximum):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not 0<=value<=maximum or not math.isfinite(value) or value!=int(value): fail('INVALID_NUMERIC_FIELD')
    return int(value)

def timestamp(value):
    if not isinstance(value,str) or len(value)>64: fail('INVALID_TIMESTAMP')
    try:
        v=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
        if v.utcoffset() is None: fail('TIMESTAMP_REQUIRES_ZONE')
        return v
    except (ValueError,OverflowError): fail('INVALID_TIMESTAMP')

def parse_json(raw):
    if len(raw)>MAX_BYTES: fail('INPUT_LIMIT')
    def pairs(items):
        obj={}
        for k,v in items:
            if k in obj: fail('DUPLICATE_JSON_KEY')
            obj[k]=v
        return obj
    try: return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:fail('INVALID_NUMBER'))
    except ExportError: raise
    except (ValueError,UnicodeError,RecursionError): fail('INVALID_JSON')

def convert(observations):
    if not isinstance(observations,list) or not observations or len(observations)>MAX_RECORDS: fail('RECORD_LIMIT')
    ids=set(); models=set(); prepared=[]
    for row in observations:
        if not isinstance(row,dict) or row.get('type')!='GENERATION': fail('EXPECTED_GENERATION')
        rid=row.get('id'); model=row.get('model')
        if not isinstance(rid,str) or not 1<=len(rid)<=256 or rid in ids: fail('INVALID_OR_DUPLICATE_ID')
        if not isinstance(model,str) or not 1<=len(model)<=256: fail('MISSING_MODEL')
        ids.add(rid); models.add(model)
        usage=row.get('usageDetails')
        if usage is None: usage=row.get('usage')
        if not isinstance(usage,dict) or 'input' not in usage or 'output' not in usage: fail('MISSING_TOKEN_COUNTS')
        inp=integer(usage['input'],1_000_000_000); out=integer(usage['output'],1_000_000_000)
        elapsed=(timestamp(row.get('endTime'))-timestamp(row.get('startTime'))).total_seconds()*1000
        if not math.isfinite(elapsed) or not 0<=elapsed<=86_400_000: fail('INVALID_LATENCY')
        metadata=row.get('metadata')
        if metadata is None: metadata={}
        if not isinstance(metadata,dict): fail('INVALID_METADATA')
        retry=metadata.get('retry',False)
        if not isinstance(retry,bool): fail('INVALID_RETRY')
        prepared.append((model,inp,out,round(elapsed),'error' if row.get('level')=='ERROR' else 'success',retry))
    if len(models)>100: fail('MODEL_LIMIT')
    aliases={m:f'model-{i:03}' for i,m in enumerate(sorted(models),1)}
    rows=[dict(id=f'attempt-{i:05}',model=aliases[m],input_tokens=a,output_tokens=b,latency_ms=c,status=s,retry=r) for i,(m,a,b,c,s,r) in enumerate(prepared,1)]
    if len(('\n'.join(json.dumps(r,separators=(',',':')) for r in rows)+'\n').encode())>MAX_BYTES: fail('OUTPUT_LIMIT')
    return rows

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def checked_origin(origin, allow_local=False):
    if not isinstance(origin,str) or len(origin)>2048: fail('INVALID_ORIGIN')
    try:
        p=urllib.parse.urlsplit(origin)
        if p.username or p.password or p.query or p.fragment or p.path not in ('','/') or not p.hostname: fail('ORIGIN_ONLY')
        _=p.port
        local=p.hostname=='localhost'
        try: local=ipaddress.ip_address(p.hostname).is_loopback
        except ValueError: pass
        if p.scheme!='https' and not (allow_local and local and p.scheme=='http'): fail('HTTPS_REQUIRED')
        if any(ord(c)<33 for c in origin): fail('INVALID_ORIGIN')
        return origin.rstrip('/')
    except ValueError: fail('INVALID_ORIGIN')

def fetch_observations(origin, public_key, secret_key, *, allow_local=False, limit=100):
    origin=checked_origin(origin,allow_local)
    if not all(isinstance(k,str) and 1<=len(k)<=4096 and not any(ord(c)<32 for c in k) for k in [public_key,secret_key]): fail('MISSING_CREDENTIALS')
    limit=integer(limit,100)
    if limit<1: fail('PAGE_LIMIT')
    auth=base64.b64encode((public_key+':'+secret_key).encode()).decode()
    opener=urllib.request.build_opener(NoRedirect())
    rows=[]; cursor=None; seen_cursors=set()
    for page in range(1,51):
        params={'type':'GENERATION','limit':limit,'fields':'core,basic,model,usage'}
        if cursor is not None: params['cursor']=cursor
        query=urllib.parse.urlencode(params)
        request=urllib.request.Request(origin+'/api/public/v2/observations?'+query,headers={'Authorization':'Basic '+auth,'Accept':'application/json'})
        try:
            with opener.open(request,timeout=20) as response:
                if response.status!=200: fail('UPSTREAM_REQUEST_FAILED')
                payload=parse_json(response.read(MAX_BYTES+1))
        except ExportError: raise
        except Exception: fail('UPSTREAM_REQUEST_FAILED')
        batch=payload.get('data') if isinstance(payload,dict) else None
        meta=payload.get('meta') if isinstance(payload,dict) else None
        if not isinstance(batch,list) or len(batch)>limit or not isinstance(meta,dict): fail('UPSTREAM_SCHEMA')
        next_cursor=meta.get('cursor')
        if next_cursor is not None and (not isinstance(next_cursor,str) or not 1<=len(next_cursor)<=4096 or next_cursor in seen_cursors): fail('PAGINATION_LIMIT')
        rows.extend(batch)
        if len(rows)>MAX_RECORDS: fail('RECORD_LIMIT')
        if next_cursor is None: return rows
        if not batch: fail('UPSTREAM_SCHEMA')
        seen_cursors.add(next_cursor);cursor=next_cursor
    fail('PAGINATION_LIMIT')

def read_local(path):
    fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):fail('REGULAR_FILE_REQUIRED')
        with os.fdopen(fd,'rb',closefd=False) as stream:return parse_json(stream.read(MAX_BYTES+1))
    finally:os.close(fd)

class Parser(argparse.ArgumentParser):
    def error(self,message):
        print('{"error":"INVALID_ARGUMENTS"}',file=sys.stderr)
        raise SystemExit(2)

def main(argv=None):
    ap=Parser(description='Export GENERATION observations from Langfuse without prompt content.')
    source=ap.add_mutually_exclusive_group(required=True)
    source.add_argument('--input',type=pathlib.Path,help='Saved Public API response JSON or array, at most 1 MiB')
    source.add_argument('--host',help='Explicit Langfuse HTTPS origin; no automatic discovery')
    ap.add_argument('--allow-local',action='store_true',help='Allow explicit localhost HTTP test server')
    ap.add_argument('--output',required=True,type=pathlib.Path)
    args=ap.parse_args(argv)
    try:
        if args.input:
            obj=read_local(args.input)
            observations=obj.get('data') if isinstance(obj,dict) else obj
        else:
            observations=fetch_observations(args.host,os.environ.get('LANGFUSE_PUBLIC_KEY',''),os.environ.get('LANGFUSE_SECRET_KEY',''),allow_local=args.allow_local)
        rows=convert(observations)
        # Exclusive create avoids overwriting an existing report accidentally.
        with os.fdopen(os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w',encoding='utf-8') as f:
            for row in rows: f.write(json.dumps(row,separators=(',',':'))+'\n')
        print(json.dumps({'status':'exported','attempts':len(rows),'models':len(set(r['model'] for r in rows)),'prices':'not_inferred'}))
        return 0
    except ExportError as exc: print(json.dumps({'error':str(exc)}),file=sys.stderr); return 2
    except (OSError,ValueError): print('{"error":"LOCAL_IO_FAILED"}',file=sys.stderr); return 2
if __name__=='__main__': raise SystemExit(main())
