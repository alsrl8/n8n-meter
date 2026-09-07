"""Isolated synthetic smoke test. No existing n8n or DB is accessed."""
import datetime, json, os, subprocess, tempfile, time, urllib.request, urllib.error, uuid
from pathlib import Path
root = Path(__file__).resolve().parents[1]
prefix = 'n8nmeter-check-' + uuid.uuid4().hex[:8]
containers = []
def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()
def run(name, *args):
    docker('run', '-d', '--name', name, *args)
    containers.append(name)
with tempfile.TemporaryDirectory(prefix='n8nmeter-gateway-') as tmp:
    directory = Path(tmp)
    directory.chmod(0o755)
    (directory/'source.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'rows':[{'id':'1','name':'production_success','workflowId':'fixture','workflowName':'Synthetic fixture','count':'7','rootCount':'7'}], 'insights':{'available':True,'total':'7','earliest':None}}))
    docker('network','create',prefix)
    try:
        upstream = "require('http').createServer((q,s)=>{if(q.url==='/rest/login'){if(!q.headers.cookie){s.writeHead(401);return s.end();}s.setHeader('content-type','application/json');return s.end(JSON.stringify({data:{id:'fixture',role:q.headers.cookie==='owner'?'global:owner':'global:member'}}));}s.setHeader('content-type','text/html');s.end('<html><body>n8n fixture</body></html>');}).listen(5678,'0.0.0.0')"
        run(prefix+'-upstream','--network',prefix,os.environ.get('N8N_METER_TEST_IMAGE','n8n-meter:0.1.0'),'node','-e',upstream)
        run(prefix+'-collector','--network',prefix,'-p','127.0.0.1::8080','--tmpfs','/data:uid=1000,gid=1000','-v',f'{directory}:/fixture:ro','-v',f'{root / "server.mjs"}:/app/server.mjs:ro','-e','N8N_METER_SOURCE_ID=gateway-fixture','-e','N8N_METER_N8N_UPSTREAM=http://'+prefix+'-upstream:5678','-e','N8N_METER_SNAPSHOT_FILE=/fixture/source.json',os.environ.get('N8N_METER_TEST_IMAGE','n8n-meter:0.1.0'))
        run(prefix+'-gateway','--network','container:'+prefix+'-collector','--user','1000:1000','--read-only','--cap-drop','ALL','--tmpfs','/etc/nginx/conf.d:uid=1000,gid=1000','--tmpfs','/var/cache/nginx:uid=1000,gid=1000','--tmpfs','/var/run:uid=1000,gid=1000','-e','N8N_METER_UPSTREAM=http://127.0.0.1:7810','-e','N8N_UPSTREAM=http://'+prefix+'-upstream:5678',os.environ.get('N8N_METER_TEST_GATEWAY','n8n-meter-gateway:0.1.0'))
        address = 'http://'+docker('port',prefix+'-collector','8080/tcp')
        def request(path,auth=None):
            req=urllib.request.Request(address+path,headers={'Cookie':auth} if auth else {})
            try:
                with urllib.request.urlopen(req,timeout=3) as r: return r.status,r.read().decode(),r.headers
            except urllib.error.HTTPError as e: return e.code,e.read().decode(),e.headers
        for attempt in range(50):
            try:
                if request('/__n8nmeter/healthz')[0]==200: break
            except OSError: pass
            time.sleep(.2)
        assert request('/')[0]==200
        assert request('/__n8nmeter/workflow-usage.js')[0]==200
        assert request('/__n8nmeter/api/summary')[0]==401
        assert request('/__n8nmeter/api/summary','member')[0]==403
        status,body,_=request('/')
        assert '/__n8nmeter/workflow-usage.js' in body
        status,body,_=request('/__n8nmeter/api/summary','owner')
        assert status==200 and json.loads(body)['last']['totals']['root']=='7'
        status,body,_=request('/__n8nmeter/workflow-usage.js')
        assert status==200 and 'opacity:1;pointer-events:auto' in body
        print(json.dumps({'existingLogin':True,'adminStatisticsOnly':True,'htmlInjection':True,'summary':True,'nonRootReadOnlySidecar':True,'actualN8n':False,'dbCollection':False}))
    finally:
        for name in reversed(containers): subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,check=False)
        subprocess.run(['docker','network','rm',prefix],stdout=subprocess.DEVNULL,check=False)
