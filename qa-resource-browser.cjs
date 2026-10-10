const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/kenbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
require('tsx/cjs');
const {Classroom,HttpError}=require('./lib/service.ts');
const {MemoryStore}=require('./lib/storage.ts');
const {CONSENT_VERSION}=require('./lib/experiment.ts');
const base='http://127.0.0.1:3108';
const awards=[200,200,200,200,200];
async function fixture(phase){
 const c=new Classroom(new MemoryStore(),'synthetic-test-key');
 const room=await c.action({action:'create',hostKey:'synthetic-test-key',title:'Synthetic resource QA',teamCount:2,demo:true},'');
 const code=room.room.code,host={code,token:room.credential,host:true};
 const joined=await c.action({action:'join',code,team:1,consent:true,consentVersion:CONSENT_VERSION},'');
 const student={code,token:joined.credential,host:false};
 const act=(action,args={})=>c.action({action,code,...args},student.token);
 if(phase>0)await c.action({action:'phase',code,phase:1},host.token);
 if(phase>1){
  await act('baseline',{survey:{}});await act('prepare',{awards,total:1000,self:'included'});
  for(let index=0;index<12;index++){if(index===4)await act('beginB');await act('round',{index,awards});}
  for(const i of [0,1])for(const followup of [false,true])await act('reason',{case:i,followup,text:''});
  await act('finish',{checks:{},needed:''});
  for(let p=2;p<=phase;p++)await c.action({action:'phase',code,phase:p},host.token);
 }
 return{c,host,student};
}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const checks=[],errors=[];
 async function open(f,access){
  const context=await browser.newContext();
  await context.addInitScript(access=>{
   localStorage.setItem('ob-study2-v8-'+(access.host?'host':'student')+'-access',JSON.stringify(access));
   window.__qaIntervals=[];
   const original=window.setInterval;
   window.setInterval=(fn,ms,...args)=>{window.__qaIntervals.push(ms);return original(fn,ms,...args);};
  },access);
  const page=await context.newPage(),requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/classroom**',async route=>{
   const req=route.request(),url=new URL(req.url());
   requests.push({method:req.method(),counts:url.searchParams.get('counts'),body:req.postDataJSON()});
   try{
    const token=req.headers()['x-class-token']||'';
    const data=req.method()==='GET'?await f.c.snapshot(url.searchParams.get('code'),token,{liveCounts:url.searchParams.get('counts')==='1'}):await f.c.action(req.postDataJSON(),token);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   }catch(e){await route.fulfill({status:e instanceof HttpError?e.status:503,contentType:'application/json',body:JSON.stringify({error:e.message,code:e.code})});}
  });
  await page.goto(base+(access.host?'/?teacher=1':'/?code='+access.code));
  await page.getByRole('heading',{name:'Synthetic resource QA',exact:true}).waitFor();
  return{context,page,requests};
 }
 try{
  for(let phase=0;phase<=4;phase++){
   const f=await fixture(phase);
   for(const role of ['student','host']){
    const q=await open(f,f[role]);
    await q.page.waitForTimeout(phase===0&&role==='student'?11000:1000);
    assert.equal(q.requests.length,1,'only the initial restore GET is allowed');
    assert.deepEqual(await q.page.evaluate(()=>window.__qaIntervals),[],'no background intervals scheduled');
    await q.page.getByRole('button',{name:role==='host'?'Refresh counts':'Check activity status',exact:true}).first().click();
    await q.page.waitForTimeout(150);
    assert.equal(q.requests.length,2,'one explicit refresh GET');
    assert.equal(q.requests[1].counts,role==='host'?'1':null);
    if(phase===1&&role==='student'){
     for(let i=0;i<3;i++)await q.page.getByRole('button',{name:'Continue',exact:true}).click();
     await q.page.getByRole('button',{name:'Save pre-activity answers',exact:true}).click();
     await q.page.getByRole('heading',{name:'Try the input first.',exact:true}).waitFor();
     assert.equal(q.requests.filter(x=>x.method==='POST'&&x.body.action==='baseline').length,1);
     assert.equal(q.requests.filter(x=>x.method==='GET').length,2,'saving hydrates its own response without a follow-up GET');
    }
    checks.push({phase,role,idleGetRequests:0,scheduledIntervals:0,manualRefreshGetRequests:1});
    await q.context.close();
   }
  }
  const f=await fixture(0),host=await open(f,f.host),student=await open(f,f.student);
  host.page.once('dialog',dialog=>dialog.accept());
  await host.page.getByRole('button',{name:'End all student sessions',exact:true}).click();
  await host.page.getByText('All student sessions ended',{exact:true}).waitFor();
  assert.equal(host.requests.filter(x=>x.method==='POST'&&x.body.action==='endSessions').length,1);
  await student.page.getByRole('button',{name:'Check activity status',exact:true}).first().click();
  await student.page.getByRole('heading',{name:'Session ended',exact:true}).waitFor();
  await student.page.waitForTimeout(1000);assert.equal(student.requests.length,2);
  checks.push({termination:'host action ends student access; saved record retained',participantRecords:(await f.c.action({action:'export',code:f.host.code},f.host.token)).participants.length});
  await host.context.close();await student.context.close();
  const errorFixture=await fixture(0),errorCase=await open(errorFixture,errorFixture.student);
  let failures=0;
  await errorCase.page.route('**/api/classroom**',async route=>{failures++;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic quota unavailable'})});});
  await errorCase.page.getByRole('button',{name:'Check activity status',exact:true}).first().click();
  await errorCase.page.getByText('Synthetic quota unavailable',{exact:true}).waitFor();
  await errorCase.page.waitForTimeout(1100);assert.equal(failures,1,'no automatic retry on quota error');
  checks.push({quotaError:'503 surfaced without automatic retry',requests:failures});
  await errorCase.context.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',mode:'real built UI + real Classroom service + MemoryStore; no production Blob access',checks,browserErrors:errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
