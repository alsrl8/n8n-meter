import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const profile=mkdtempSync(join(tmpdir(),'n8nmeter-rows-'));
let context;
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${resolve('extension')}`,`--load-extension=${resolve('extension')}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();
 await page.route('**/__n8nmeter/*.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:''}));
 await page.goto('http://127.0.0.1:7811');
 const data=await(await page.request.get('http://127.0.0.1:7810/api/summary')).json();const source=data.workflows[0];assert.ok(source);
 // Explicit DOM fixture derived from installed WorkflowCard.vue, not an authenticated n8n session.
 await page.setContent(`<style>body{background:#181818;color:#eee;font:14px system-ui;padding:40px;--color--background--light-2:#252525;--color--text:#eee;--color--text--tint-1:#aaa;--color--foreground--tint-1:#444}header{color:#e5b783;margin-bottom:35px}article{display:flex;align-items:center;justify-content:space-between;background:#262626;border:1px solid #444;border-radius:8px;padding:18px;margin:10px 0}h2{font-size:14px}small{color:#999}aside{display:flex;gap:8px;align-items:center}aside span{font-size:12px;color:#ccc;border:1px solid #444;padding:5px;border-radius:4px}button{background:transparent;color:#ccc;border:0;font-size:18px}</style><header>n8n Meter · 로컬 카드 DOM 검증 화면 (실제 로그인 화면 아님)</header><article data-test-id="workflow-card" id="known"><div><h2 data-test-id="workflow-card-name">로컬 검증 워크플로</h2><small>Last updated · local n8n 2.26.9</small></div><aside><span>Personal</span><span>Published</span><button data-test-id="workflow-card-actions">⋮</button></aside></article><article data-test-id="workflow-card" id="unknown"><div><h2 data-test-id="workflow-card-name">로컬 검증 워크플로</h2><small>동일한 이름 · 다른 ID</small></div><aside><span>Personal</span><button data-test-id="workflow-card-actions">⋮</button></aside></article>`);
 await page.evaluate(async id=>{
   const module=await import('/assets/vue.runtime.esm-bundler-DKU_6bn-.js');
   const vue=Object.values(module).find(v=>v&&typeof v==='object'&&v.createApp&&v.h);
   document.querySelectorAll('article').forEach(e=>e.remove());
   const mount=document.createElement('div');mount.id='app';document.body.append(mount);
   window.cardClicks=0;
   const Card=vue.defineComponent({name:'WorkflowCard',props:{data:Object},setup(props){return()=>vue.h('article',{'data-test-id':'resource-card',class:'card',id:props.data.testId,onClick:()=>window.cardClicks++},[
     vue.h('div',[vue.h('h2',{'data-test-id':'workflow-card-name'},'로컬 검증 워크플로'),vue.h('small','실제 n8n Vue 프로덕션 런타임')]),
     vue.h('aside',[vue.h('span','Personal'),vue.h('button',{'data-test-id':'workflow-card-actions'},'⋮')])
   ]);}});
   vue.createApp({render:()=>vue.h('div',[vue.h(Card,{data:{id,testId:'known'}}),vue.h(Card,{data:{id:'unknown-fixture',testId:'unknown'}})])}).mount(mount);
 },source.id);
 assert.equal(await page.evaluate(()=>Boolean(document.querySelector('#known').__vueParentComponent)),false,'production build must not expose dev-only DOM component link');
 assert.equal(await page.evaluate(()=>Boolean(document.querySelector('#app')._vnode)),true);

 await worker.evaluate(async()=>{const tab=(await chrome.tabs.query({})).find(t=>t.url?.startsWith('http://127.0.0.1:7811'));await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['workflow-bridge.js']});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['workflow-usage.js']});});
 await page.waitForSelector('#known .n8nmeter-usage-button');
 await page.mouse.move(0,0);
 assert.equal(await page.locator('#known').evaluate(e=>e.matches(':hover')),false);
 assert.equal(await page.locator('#known .n8nmeter-usage-button').evaluate(e=>getComputedStyle(e).opacity),'1');
 await page.screenshot({path:'/tmp/n8nmeter-always-visible-fixture.png'});
 await page.locator('#known .n8nmeter-usage-button').click();await page.waitForFunction(root=>document.querySelector('#n8nmeter-row-ui').shadowRoot.getElementById('root').textContent===BigInt(root).toLocaleString('ko-KR'),source.root);
 assert.equal(await page.evaluate(()=>window.cardClicks),0);
 await page.locator('#n8nmeter-row-ui summary').click();assert.equal(await page.locator('#n8nmeter-row-ui details').getAttribute('open'),'');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#n8nmeter-row-ui #popover').isVisible(),false);
 await page.locator('#unknown').hover();await page.locator('#unknown .n8nmeter-usage-button').click();await page.waitForFunction(()=>document.querySelector('#n8nmeter-row-ui').shadowRoot.getElementById('status').textContent.includes('통계가 없습니다'));
 assert.equal(await page.locator('#n8nmeter-row-ui #root').innerText(),'—');
 await page.keyboard.press('Escape');await page.locator('#known').hover();await page.locator('#known .n8nmeter-usage-button').click();await page.waitForTimeout(300);await page.setViewportSize({width:1440,height:850});await page.screenshot({path:'/tmp/n8nmeter-workflow-row-fixture.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);const rect=await page.locator('#n8nmeter-row-ui #popover').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390);
 await page.setViewportSize({width:1440,height:850});
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{const card=document.createElement('article');card.id='unbound';card.setAttribute('data-test-id','workflow-card');card.innerHTML='<h2 data-test-id="workflow-card-name">ID unavailable</h2><aside><button data-test-id="workflow-card-actions">⋮</button></aside>';document.body.append(card);});
 await page.locator('#unbound').hover();await page.locator('#unbound .n8nmeter-usage-button').click();
 await page.waitForFunction(()=>document.querySelector('#n8nmeter-row-ui').shadowRoot.getElementById('status').textContent.includes('ID 연결'));
 assert.equal(await page.locator('#n8nmeter-row-ui #root').innerText(),'—');
 await page.keyboard.press('Escape');await page.locator('#known').hover();await page.locator('#known .n8nmeter-usage-button').click();
 await page.evaluate(()=>document.querySelector('#known').remove());await page.waitForTimeout(100);assert.equal(await page.locator('#n8nmeter-row-ui #popover').isVisible(),false);
 console.log(JSON.stringify({source:'real n8n Vue 3.5.26 production runtime, card fixture',extension:true,alwaysVisibleWithoutHover:true,idBinding:true,sameNameDifferentId:true,clickIsolation:true,help:true,escape:true,mobileBounds:true,removedRowCloses:true,unboundCardButton:true,authenticatedN8n:false}));
}catch(error){if(context){const p=context.pages().at(-1);await p.screenshot({path:'/tmp/n8nmeter-row-failure.png'});console.log(await p.locator('#known').evaluate(e=>({hover:e.matches(':hover'),rect:e.getBoundingClientRect().toJSON(),button:e.querySelector('button.n8nmeter-usage-button')?.outerHTML})));}throw error;}finally{await context?.close();rmSync(profile,{recursive:true,force:true});}
