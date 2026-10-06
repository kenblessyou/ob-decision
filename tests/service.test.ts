import test from 'node:test';
import assert from 'node:assert/strict';
import {Classroom,assignmentCell} from '../lib/service';
import {MemoryStore} from '../lib/storage';
import {CONSENT_VERSION} from '../lib/experiment';
const awards=[200,200,200,200,200];
async function setup(){const store=new MemoryStore(),c=new Classroom(store,'test');const created:any=await c.action({action:'create',hostKey:'test',title:'QA',teamCount:2,demo:true},'');const code=created.room.code,host=created.credential;const joined:any=await c.action({action:'join',code,team:1,consent:true,consentVersion:CONSENT_VERSION},'');const token=joined.credential;const act=(action:string,args:object={})=>c.action({action,code,...args},token) as Promise<any>;return{store,c,code,host,token,joined,act};}
test('18-cell recruitment blocks are balanced',()=>{for(let b=0;b<8;b++)assert.equal(new Set(Array.from({length:18},(_,i)=>assignmentCell(b*18+i,239))).size,18);});
test('server enforces ordered Study 2 flow and hides future conditions',async()=>{
 const {c,code,host,token,joined,act}=await setup();assert.equal(joined.me.department,null);assert.equal(joined.me.currentTrial,null);assert.equal(joined.me.trials,undefined);
 await assert.rejects(act('baseline',{survey:{}}),/not open/);
 await c.action({action:'phase',code,phase:1},host);
 await assert.rejects(act('prepare',{awards,total:1000,self:'included'}),/pre-activity/);
 await act('baseline',{survey:{politics:5,income:2,rewards:9}});
 await assert.rejects(act('baseline',{survey:{}}),/already saved/);
 const bad=await act('prepare',{awards,total:100,self:'excluded'});assert.equal(bad.me.prepared,false);
 let state=await act('prepare',{awards,total:1000,self:'included'});
 assert.equal(state.me.currentTrial.block,'A');assert.equal(state.me.currentTrial.profile,undefined);assert.ok(state.me.currentTrial.recipients.every((r:any)=>r.same===null&&r.role===undefined));
 await assert.rejects(act('round',{index:1,awards}),/in order/);
 await assert.rejects(act('round',{index:0,awards:[250,250,250,250]}),/five whole/);
 state=await act('round',{index:0,awards});const rev=state.me.revision;
 state=await act('round',{index:0,awards});assert.equal(state.me.revision,rev);
 await assert.rejects(act('round',{index:0,awards:[1000,0,0,0,0]}),/cannot be changed/);
 for(let index=1;index<4;index++)state=await act('round',{index,awards});
 assert.equal(state.me.currentTrial,null);assert.equal(state.me.department,null);
 await assert.rejects(act('round',{index:4,awards}),/department instructions/);
 state=await act('beginB');assert.ok(['A','B'].includes(state.me.department));assert.equal(state.me.currentTrial.block,'B');const department=state.me.department;
 for(let index=4;index<12;index++){state=await act('round',{index,awards});assert.equal(state.me.department,department);}
 assert.equal(state.me.reasonCases.length,2);assert.ok(state.me.reasonCases[0].index<4);assert.ok(state.me.reasonCases[1].index>=4);
 await assert.rejects(act('finish'),/explanations/);
 await assert.rejects(act('reason',{case:0,followup:true,text:'later'}),/first explanation/);
 for(const i of [0,1])for(const followup of [false,true])await act('reason',{case:i,followup,text:''});
 state=await act('finish',{checks:{},needed:''});assert.equal(state.me.submitted,true);assert.equal(state.me.answers.length,12);
 await assert.rejects(act('round',{index:0,awards}),/submitted/);
 await c.action({action:'phase',code,phase:2},host);const exportData:any=await c.action({action:'export',code},host);
 assert.equal(exportData.formalStudy2MainSample,false);assert.equal(exportData.allocationUnits,1000);assert.equal(exportData.participants[0].tokenHash,undefined);assert.equal(exportData.participants[0].survey.politics,5);
 const snap:any=await c.snapshot(code,token);assert.equal(snap.stats,null);assert.equal(snap.teamKeys,undefined);
 await act('withdraw');assert.equal((await c.action({action:'export',code},host) as any).participants.length,0);
});
test('simultaneous joins reserve distinct cells without losing participants',async()=>{const {c,code}=await setup();const people=await Promise.all(Array.from({length:17},()=>c.action({action:'join',code,team:1,consent:true,consentVersion:CONSENT_VERSION},'') as Promise<any>));assert.equal(new Set(people.map(x=>x.me.id)).size,17);const room=await c.room(code),all=await c.people(room.value);assert.equal(all.length,18);assert.equal(new Set(all.map(p=>p.assignmentTicket)).size,18);assert.equal(new Set(all.map(p=>p.assignmentCell)).size,18);});

test('host termination closes all access, persists across instances and preserves saved responses',async()=>{
 const {store,c,code,host,token,act}=await setup();
 await assert.rejects(act('endSessions'),/Instructor access/);
 await assert.rejects(c.action({action:'endSessions',code},'wrong-token'),/Instructor access/);
 await c.action({action:'phase',code,phase:1},host);await act('baseline',{survey:{politics:5}});await act('prepare',{awards,total:1000,self:'included'});await act('round',{index:0,awards});
 const keys=await store.keys('ob-study2-v8/'+code+'/people/'),before=structuredClone((await store.read<any>(keys[0]))!.value);
 const ended:any=await c.action({action:'endSessions',code},host);assert.ok(ended.room.sessionsEndedAt);assert.equal(ended.room.phase,2);
 const after=(await store.read<any>(keys[0]))!.value;assert.deepEqual(after,before);
 const resumed=new Classroom(store,'test');const again:any=await resumed.action({action:'endSessions',code},host);assert.equal(again.room.sessionsEndedAt,ended.room.sessionsEndedAt);
 let lists=0;const originalKeys=store.keys.bind(store);store.keys=async prefix=>{lists++;return originalKeys(prefix);};
 const terminal:any=await resumed.snapshot(code,token);assert.equal(lists,0);assert.equal(terminal.sessionEnded,true);assert.equal(terminal.me,null);assert.equal(terminal.stats,null);assert.deepEqual(terminal.teams,[]);assert.equal(terminal.teamKeys,undefined);
 await assert.rejects(resumed.action({action:'join',code,team:1,consent:true,consentVersion:CONSENT_VERSION},''),(e:any)=>e.status===410&&e.code==='SESSION_ENDED');
 for(const action of ['baseline','prepare','round','beginB','reason','finish','team'])await assert.rejects(resumed.action({action,code,index:1,awards},token),(e:any)=>e.status===410);
 await assert.rejects(resumed.action({action:'phase',code,phase:3},host),(e:any)=>e.status===410);
 const exported:any=await resumed.action({action:'export',code},host);assert.deepEqual(exported.participants[0].answers,[awards]);assert.equal(exported.sessionsEndedAt,ended.room.sessionsEndedAt);
 await resumed.action({action:'withdraw',code},token);assert.equal((await resumed.action({action:'export',code},host) as any).participants.length,0);assert.equal((await resumed.room(code)).value.sessionsEndedAt,ended.room.sessionsEndedAt);
});
test('termination is supported in waiting, discussion, presentation and wrap-up stages',async()=>{for(const phase of [0,2,3,4]){const {c,code,host}=await setup();for(let p=1;p<=phase;p++)await c.action({action:'phase',code,phase:p},host);const s:any=await c.action({action:'endSessions',code},host);assert.ok(s.room.sessionsEndedAt);assert.equal(s.room.phase,Math.max(phase,2));}});
