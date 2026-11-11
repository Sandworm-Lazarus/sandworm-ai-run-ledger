"""Privacy-minimized Langfuse observations and numeric scores -> local trace report."""
from __future__ import annotations
import argparse, base64, json, math, os, pathlib, stat, sys, urllib.parse, urllib.request
from export import ExportError, fail, parse_json, timestamp, integer, checked_origin, NoRedirect, MAX_BYTES, MAX_RECORDS
TYPES={'SPAN','GENERATION','EVENT','AGENT','TOOL','CHAIN','RETRIEVER','EVALUATOR','EMBEDDING','GUARDRAIL'}

def identifier(value):
    if not isinstance(value,str) or not 1<=len(value)<=256 or any(ord(c)<32 for c in value): fail('INVALID_IDENTIFIER')
    return value

def amount(value):
    if value is None:return None
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not 0<=value<=1_000_000 or not math.isfinite(value):fail('INVALID_COST')
    return value

def read_local(path):
    fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):fail('REGULAR_FILE_REQUIRED')
        with os.fdopen(fd,'rb',closefd=False) as stream:return parse_json(stream.read(MAX_BYTES+1))
    finally:os.close(fd)

def rows_from(obj):return obj.get('data') if isinstance(obj,dict) else obj

def convert_trace(observations,scores=None,source='saved-import'):
    if not isinstance(observations,list) or not 1<=len(observations)<=MAX_RECORDS:fail('RECORD_LIMIT')
    scores=[] if scores is None else scores
    if not isinstance(scores,list) or len(scores)>MAX_RECORDS:fail('SCORE_LIMIT')
    if source not in ('saved-import','live-api','synthetic-fixture'):fail('INVALID_SOURCE')
    by_id={}; trace_start={}; model_names=set()
    for row in observations:
        if not isinstance(row,dict):fail('INVALID_OBSERVATION')
        rid=identifier(row.get('id'));tid=identifier(row.get('traceId'))
        if rid in by_id:fail('DUPLICATE_ID')
        kind=row.get('type')
        if kind not in TYPES:fail('UNSUPPORTED_TYPE')
        start=timestamp(row.get('startTime'));end=timestamp(row.get('endTime'))
        elapsed=(end-start).total_seconds()*1000
        if not 0<=elapsed<=86_400_000:fail('INVALID_LATENCY')
        parent=row.get('parentObservationId')
        if parent is not None:identifier(parent)
        model=row.get('model')
        if model is not None:model_names.add(identifier(model))
        usage=row.get('usageDetails') or {}
        if not isinstance(usage,dict):fail('INVALID_USAGE')
        inp=integer(usage['input'],1_000_000_000) if 'input' in usage else None
        out=integer(usage['output'],1_000_000_000) if 'output' in usage else None
        if (inp is None)!=(out is None):fail('PARTIAL_TOKEN_COUNTS')
        by_id[rid]={'raw':row,'trace':tid,'start':start,'latency':round(elapsed),'parent':parent,'input':inp,'output':out,'cost':amount(row.get('totalCost'))}
        trace_start[tid]=min(start,trace_start.get(tid,start))
    if len(model_names)>100:fail('MODEL_LIMIT')
    for rid,item in by_id.items():
        cursor=rid;seen=set()
        while cursor in by_id:
            if cursor in seen:fail('PARENT_CYCLE')
            seen.add(cursor)
            if len(seen)>32:fail('DEPTH_LIMIT')
            if by_id[cursor]['trace']!=item['trace']:fail('CROSS_TRACE_PARENT')
            cursor=by_id[cursor]['parent']
    ordered=sorted(by_id,key=lambda rid:(by_id[rid]['trace'],by_id[rid]['start'],rid))
    obs_alias={rid:f'obs-{i:05}' for i,rid in enumerate(ordered,1)}
    trace_alias={tid:f'trace-{i:04}' for i,tid in enumerate(sorted(trace_start),1)}
    models={m:f'model-{i:03}' for i,m in enumerate(sorted(model_names),1)}
    converted=[]
    for rid in ordered:
        item=by_id[rid];row=item['raw'];offset=round((item['start']-trace_start[item['trace']]).total_seconds()*1000)
        if not 0<=offset<=86_400_000:fail('TRACE_WINDOW_LIMIT')
        converted.append({'id':obs_alias[rid],'trace_id':trace_alias[item['trace']],'parent_id':obs_alias.get(item['parent']),
            'parent_missing':item['parent'] is not None and item['parent'] not in by_id,'type':row['type'],
            'model_alias':models.get(row.get('model')),'start_offset_ms':offset,'latency_ms':item['latency'],
            'status':'error' if row.get('level')=='ERROR' else 'recorded','input_tokens':item['input'],'output_tokens':item['output'],'reported_cost_usd':item['cost']})
    selected=[];excluded=0;seen_scores=set()
    for score in scores:
        if not isinstance(score,dict):fail('INVALID_SCORE')
        sid=identifier(score.get('id'))
        if sid in seen_scores:fail('DUPLICATE_SCORE')
        seen_scores.add(sid)
        subject=score.get('subject') or {}
        if not isinstance(subject,dict):fail('INVALID_SCORE_SUBJECT')
        # Official v3 discriminated subject; legacy saved score exports also supported.
        kind=subject.get('kind');target=subject.get('id')
        oid=target if kind=='observation' else score.get('observationId')
        tid=(subject.get('traceId') if kind=='observation' else target if kind=='trace' else score.get('traceId'))
        if oid is not None:identifier(oid)
        if tid is not None:identifier(tid)
        if oid in by_id:
            if tid is not None and tid!=by_id[oid]['trace']:fail('SCORE_TRACE_MISMATCH')
            tid=by_id[oid]['trace']
        elif oid is not None:excluded+=1;continue
        if tid not in trace_alias:excluded+=1;continue
        dtype=score.get('dataType');value=score.get('value')
        if dtype not in ('NUMERIC','BOOLEAN'):excluded+=1;continue
        if dtype=='BOOLEAN':
            if not isinstance(value,bool):
                if not subject and isinstance(value,(int,float)) and value in (0,1):value=bool(value)
                else:fail('INVALID_SCORE_VALUE')
        elif isinstance(value,bool) or not isinstance(value,(int,float)) or not -1_000_000<=value<=1_000_000 or not math.isfinite(value):fail('INVALID_SCORE_VALUE')
        selected.append((identifier(score.get('name')),trace_alias[tid],obs_alias.get(oid),dtype,value))
    names={name:f'eval-{i:03}' for i,name in enumerate(sorted(set(s[0] for s in selected)),1)}
    output={'format':'sandworm-langfuse-trace/v1','source':source,'observations':converted,
        'scores':[{'metric_alias':names[n],'trace_id':t,'observation_id':o,'data_type':d,'value':v} for n,t,o,d,v in selected],
        'excluded_scores':excluded,'privacy':'Export-local aliases; no raw IDs, names, prompts, responses, comments or metadata.',
        'cost_method':'Langfuse reported observation totalCost; generation-only subtotal, not provider billing.'}
    if len(json.dumps(output).encode())>MAX_BYTES:fail('OUTPUT_LIMIT')
    return output

def fetch_pages(origin,public_key,secret_key,*,scores=False,allow_local=False):
    origin=checked_origin(origin,allow_local)
    if not all(isinstance(k,str) and 1<=len(k)<=4096 and not any(ord(c)<32 for c in k) for k in [public_key,secret_key]):fail('MISSING_CREDENTIALS')
    auth=base64.b64encode((public_key+':'+secret_key).encode()).decode()
    opener=urllib.request.build_opener(NoRedirect());rows=[];cursor=None;seen=set()
    for _ in range(50):
        params={'limit':100,'fields':'subject' if scores else 'core,basic,model,usage'}
        if scores:params['dataType']='NUMERIC,BOOLEAN'
        if cursor is not None:params['cursor']=cursor
        url=origin+('/api/public/v3/scores' if scores else '/api/public/v2/observations')+'?'+urllib.parse.urlencode(params)
        req=urllib.request.Request(url,headers={'Authorization':'Basic '+auth,'Accept':'application/json'})
        try:
            with opener.open(req,timeout=20) as response:
                if response.status!=200:fail('UPSTREAM_REQUEST_FAILED')
                payload=parse_json(response.read(MAX_BYTES+1))
        except ExportError:raise
        except Exception:fail('UPSTREAM_REQUEST_FAILED')
        if not isinstance(payload,dict) or not isinstance(payload.get('data'),list) or len(payload['data'])>100 or not isinstance(payload.get('meta'),dict):fail('UPSTREAM_SCHEMA')
        rows.extend(payload['data'])
        if len(rows)>MAX_RECORDS:fail('RECORD_LIMIT')
        cursor=payload['meta'].get('cursor')
        if cursor is None:return rows
        if not isinstance(cursor,str) or not 1<=len(cursor)<=4096 or cursor in seen or not payload['data']:fail('PAGINATION_LIMIT')
        seen.add(cursor)
    fail('PAGINATION_LIMIT')

class Parser(argparse.ArgumentParser):
    def error(self,message):raise ExportError('INVALID_ARGUMENTS')

def main(argv=None):
    try:
        p=Parser(description='Create local trace report; no content or original identifiers exported.')
        s=p.add_mutually_exclusive_group(required=True);s.add_argument('--input',type=pathlib.Path);s.add_argument('--host')
        p.add_argument('--scores',type=pathlib.Path);p.add_argument('--include-scores',action='store_true');p.add_argument('--allow-local',action='store_true');p.add_argument('--output',required=True,type=pathlib.Path)
        args=p.parse_args(argv)
        if args.input:
            if args.include_scores:fail('INVALID_ARGUMENTS')
            obs=rows_from(read_local(args.input));scores=rows_from(read_local(args.scores)) if args.scores else []
        else:
            if args.scores:fail('INVALID_ARGUMENTS')
            keys=(os.environ.get('LANGFUSE_PUBLIC_KEY',''),os.environ.get('LANGFUSE_SECRET_KEY',''))
            obs=fetch_pages(args.host,*keys,allow_local=args.allow_local)
            scores=fetch_pages(args.host,*keys,scores=True,allow_local=args.allow_local) if args.include_scores else []
        report=convert_trace(obs,scores,'saved-import' if args.input else 'live-api')
        with os.fdopen(os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=False,indent=2);stream.write('\n')
        print(json.dumps({'status':'exported','observations':len(report['observations']),'scores':len(report['scores'])}));return 0
    except ExportError as exc:print(json.dumps({'error':str(exc)}),file=sys.stderr);return 2
    except (OSError,ValueError,TypeError):print('{"error":"LOCAL_IO_FAILED"}',file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
