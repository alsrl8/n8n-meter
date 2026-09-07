import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {sessionAuthenticator} from '../session-auth.mjs';

test('existing n8n session: owner/admin only, MFA enforced, errors fail closed', async()=>{
  let requests=0, path, received;
  const server=http.createServer((req,res)=>{
    requests++;path=req.url;received=req.headers;
    const token=req.headers.cookie;
    if(token==='redirect'){res.writeHead(302,{location:'http://127.0.0.1:1/leak'});return res.end();}
    if(token==='expired'){res.writeHead(401);return res.end();}
    if(token==='failure'){res.writeHead(500);return res.end();}
    const data={id:'test-user',role:token==='member'?'global:member':token==='admin'?'global:admin':'global:owner',mfaEnabled:token==='mfa-pending'||token==='mfa-ok',mfaAuthenticated:token==='mfa-ok'};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const check=sessionAuthenticator(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await check(),401);assert.equal(requests,0);
    for(const [cookie,status] of [['owner',200],['admin',200],['member',403],['mfa-pending',403],['mfa-ok',200],['expired',401],['failure',503],['redirect',503]])assert.equal(await check(cookie),status,cookie);
    assert.equal(path,'/rest/login');assert.equal(received.authorization,undefined);
    assert.throws(()=>sessionAuthenticator('http://user:password@example.com'));
    assert.throws(()=>sessionAuthenticator('http://example.com/subpath'));
  }finally{server.close();await once(server,'close');}
});
