import test from "node:test";
import assert from "node:assert/strict";
import {Classroom,HttpError} from "../lib/service";
import {MemoryStore} from "../lib/storage";
import {CONSENT_VERSION} from "../lib/experiment";

class CountingStore extends MemoryStore {
 reads:string[]=[]; lists:string[]=[]; writes:string[]=[];
 async read<T>(key:string){this.reads.push(key);return super.read<T>(key);}
 async keys(prefix:string){this.lists.push(prefix);return super.keys(prefix);}
 async write<T>(key:string,value:T,etag?:string){this.writes.push(key);return super.write(key,value,etag);}
 reset(){this.reads=[];this.lists=[];this.writes=[];}
}
const awards=[200,200,200,200,200];
async function setup(){
 const store=new CountingStore(),c=new Classroom(store,"test");
 const created:any=await c.action({action:"create",hostKey:"test",title:"Synthetic QA",teamCount:2,demo:true},"");
 const code=created.room.code,host=created.credential;
 const join=async(team=1)=>c.action({action:"join",code,team,consent:true,consentVersion:CONSENT_VERSION},"") as Promise<any>;
 const first=await join(),token=first.credential;
 const act=(action:string,args:object={},credential=token)=>c.action({action,code,...args},credential) as Promise<any>;
 return{store,c,code,host,token,join,act};
}
async function complete(act:(action:string,args?:object,credential?:string)=>Promise<any>,token?:string){
 await act("baseline",{survey:{}},token);
 await act("prepare",{awards,total:1000,self:"included"},token);
 for(let index=0;index<12;index++){if(index===4)await act("beginB",{},token);await act("round",{index,awards},token);}
 for(const i of [0,1])for(const followup of [false,true])await act("reason",{case:i,followup,text:""},token);
 return act("finish",{checks:{},needed:""},token);
}

test("waiting and individual student snapshots have no lists or team reads",async()=>{
 const {store,c,code,host,token,act}=await setup();
 for(const phase of [0,1]){
  if(phase)await act("phase",{phase},host);
  store.reset();
  const state:any=await c.snapshot(code,token);
  assert.equal(state.room.phase,phase);assert.deepEqual(state.teams,[]);
  assert.equal(store.reads.length,2);assert.deepEqual(store.lists,[]);assert.deepEqual(store.writes,[]);
  assert.ok(store.reads.every(key=>!key.includes("/teams/")));
 }
});
test("legacy host refreshes are cheap; explicit live counts remain authoritative",async()=>{
 const {store,c,code,host,token,act}=await setup();
 await act("phase",{phase:1},host);
 store.reset();
 const cheap:any=await c.snapshot(code,host);
 assert.equal(cheap.countsFresh,false);assert.equal(store.reads.length,1);assert.deepEqual(store.lists,[]);
 store.reset();
 const live:any=await c.snapshot(code,host,{liveCounts:true});
 assert.equal(live.countsFresh,true);assert.deepEqual(live.counts,{joined:1,completed:0});
 assert.equal(store.reads.length,2);assert.equal(store.lists.length,1);
 await complete(act,token);
 const updated:any=await c.snapshot(code,host,{liveCounts:true});
 assert.deepEqual(updated.counts,{joined:1,completed:1});
});
test("unauthenticated snapshots and participant mutations make zero storage calls",async()=>{
 const {store,c,code}=await setup();store.reset();
 await assert.rejects(c.snapshot(code,""),(e:unknown)=>e instanceof HttpError&&e.status===401);
 await assert.rejects(c.action({action:"round",code,index:0,awards},""),(e:unknown)=>e instanceof HttpError&&e.status===401);
 assert.deepEqual(store.reads,[]);assert.deepEqual(store.lists,[]);assert.deepEqual(store.writes,[]);
});
test("discussion reads only the student's team and only host submission indicators",async()=>{
 const {store,c,code,host,token,join,act}=await setup();const second=await join(2);
 await act("phase",{phase:1},host);await complete(act,token);await complete(act,second.credential);
 await act("phase",{phase:2},host);
 const hostState:any=await c.snapshot(code,host),payload={awards,pattern:"synthetic pattern",explanation:"synthetic explanation",need:"synthetic theory",actions:"synthetic actions",principle:"synthetic principle"};
 await assert.rejects(act("team",{teamKey:hostState.teamKeys[1],payload}),/representative code/);
 await act("team",{teamKey:hostState.teamKeys[0],payload});
 await act("team",{teamKey:hostState.teamKeys[1],payload},second.credential);
 store.reset();const student:any=await c.snapshot(code,token);
 assert.deepEqual(student.teams.map((x:any)=>x.team),[1]);assert.deepEqual(student.teams[0].payload,payload);
 assert.equal(student.teamKeys,undefined);assert.deepEqual(store.lists,[]);assert.equal(store.reads.length,3);
 store.reset();const hostView:any=await c.snapshot(code,host);
 assert.deepEqual(hostView.teams,[{team:1},{team:2}]);assert.equal(store.reads.length,1);assert.equal(store.lists.length,1);
 await act("phase",{phase:3},host);const presented:any=await c.snapshot(code,token);
 assert.deepEqual(presented.teams.map((x:any)=>x.team),[1,2]);assert.deepEqual(presented.teams[1].payload,payload);
});
test("ending student sessions is host-only, retains records, and closes individual and team writes",async()=>{
 const {store,c,code,host,token,act}=await setup();
 await act("phase",{phase:1},host);await complete(act,token);
 store.reset();await assert.rejects(act("endSessions"),(e:unknown)=>e instanceof HttpError&&e.status===403);
 assert.deepEqual(store.writes,[]);
 const ended:any=await act("endSessions",{},host);
 assert.equal(ended.room.phase,2);assert.ok(ended.room.sessionsEndedAt);assert.deepEqual(ended.counts,{joined:1,completed:1});
 const room=await c.room(code);assert.equal(room.value.includedIds.length,1);assert.ok(room.value.closedAt);
 const exported:any=await act("export",{},host);assert.equal(exported.participants.length,1);assert.equal(exported.participants[0].answers.length,12);
 await assert.rejects(act("round",{index:0,awards}),/ended/);
 await assert.rejects(act("team",{teamKey:ended.teamKeys[0],payload:{}}),/ended/);
 store.reset();const student:any=await c.snapshot(code,token);assert.equal(student.sessionEnded,true);assert.equal(student.me,null);assert.deepEqual(store.lists,[]);
 store.reset();await act("endSessions",{},host);assert.deepEqual(store.writes,[]);
 await act("withdraw");await assert.rejects(c.snapshot(code,token),/not active/);
 assert.equal((await act("export",{},host)).participants.length,0);
});
test("ending the waiting room preserves unfinished records without including them",async()=>{
 const {c,code,host,token,join,act}=await setup();const ended:any=await act("endSessions",{},host);
 assert.equal(ended.room.phase,2);assert.deepEqual(ended.counts,{joined:1,completed:0});assert.equal(ended.stats,null);
 assert.equal((await act("export",{},host)).participants[0].inClassSummary,false);
 await assert.rejects(join(),/ended/);await assert.rejects(act("baseline",{survey:{}}),/ended/);
 const student:any=await c.snapshot(code,token);assert.equal(student.sessionEnded,true);assert.equal(student.me,null);
 assert.equal((await act("export",{},host)).participants[0].answers.length,0);
});
test("withdrawal after closure recomputes the summary and suppresses fewer than five responses",async()=>{
 const {c,code,host,token,join,act}=await setup();const tokens=[token];
 for(let i=1;i<5;i++)tokens.push((await join()).credential);
 await act("phase",{phase:1},host);for(const credential of tokens)await complete(act,credential);
 await act("phase",{phase:2},host);
 assert.equal((await c.snapshot(code,host) as any).stats.n,5);
 await act("endSessions",{},host);await act("withdraw");
 const snapshot:any=await c.snapshot(code,host);assert.equal(snapshot.stats,null);assert.equal(snapshot.suppressed,true);assert.equal(snapshot.counts.completed,4);
 assert.equal((await act("export",{},host)).participants.length,4);
});
