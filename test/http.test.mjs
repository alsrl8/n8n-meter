import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Runs in the built image so the same Node/pg runtime serves real HTTP.
test('HTTP auth, source snapshot, read-only methods and persisted baseline', async () => {
  const directory=mkdtempSync(join(tmpdir(),'n8nmeter-test-'));
  const snapshot=join(directory,'source.json');
  writeFileSync(snapshot,JSON.stringify({at:new Date().toISOString(),rows:[{id:'1',name:'production_error',workflowId:'test',workflowName:'<script>untrusted</script>',count:'9',rootCount:'7'}],insights:{available:true,total:'7',earliest:null}}));
  const token='Basic '+Buffer.from('n8nmeter:test-only-password').toString('base64');
  let child;
  async function start() {
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'17810',N8N_METER_DATA_DIR:directory,N8N_METER_PASSWORD:'test-only-password',N8N_METER_SOURCE_ID:'test',N8N_METER_SNAPSHOT_FILE:snapshot,N8N_VERSION:'2.26.9'},stdio:'pipe'});
    for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:17810/readyz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
    throw new Error('Server did not become ready');
  }
  async function stop(){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  try {
    await start();
    assert.equal((await fetch('http://127.0.0.1:17810/api/summary')).status,401);
    assert.equal((await fetch('http://127.0.0.1:17810/api/summary',{headers:{authorization:'Basic wrong'}})).status,401);
    const response=await fetch('http://127.0.0.1:17810/api/summary',{headers:{authorization:token}});
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const body=await response.json();assert.equal(body.mode,'snapshot');assert.equal(body.last.totals.root,'7');assert.equal(body.last.delta.root,null);assert.equal(body.last.totals.nonRoot,'2');
    assert.equal((await fetch('http://127.0.0.1:17810/api/summary',{method:'POST',headers:{authorization:token}})).status,405);
    assert.equal((await fetch('http://127.0.0.1:17810/unknown',{headers:{authorization:token}})).status,404);
    await stop();await start();
    const persisted=await (await fetch('http://127.0.0.1:17810/api/summary',{headers:{authorization:token}})).json();
    assert.equal(persisted.samples.length,1,'restart must not count an unchanged snapshot as another observation');
    assert.equal(persisted.last.totals.root,'7');
  }finally{if(child?.exitCode===null)await stop();rmSync(directory,{recursive:true,force:true});}
});
