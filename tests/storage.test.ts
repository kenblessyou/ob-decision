import test from "node:test";
import assert from "node:assert/strict";
import {BlobPreconditionFailedError} from "@vercel/blob";
import {BlobStore,Conflict} from "../lib/storage";
import {Classroom} from "../lib/service";
import {CONSENT_VERSION} from "../lib/experiment";

// Models the observed origin behavior: Brotli content gets a weak HTTP
// validator, while conditional writes require the stored strong validator.
// Persist serialized bodies so separate reads cannot share mutable references.
function origin() {
 const data=new Map<string,{body:string;etag:string}>();
 const reads:{key:string;identity:boolean}[]=[];
 const writes:{key:string;options:Record<string,any>}[]=[];
 let revision=0;
 const client={
  async get(key:string,options:Record<string,any>) {
   const identity=new Headers(options.headers).get("accept-encoding")==="identity";
   reads.push({key,identity});
   const row=data.get(key);if(!row)return null;
   const compressed=!identity&&row.body.length>1000;
   const etag=compressed?"W/"+row.etag:row.etag;
   return {statusCode:200,stream:new Response(row.body).body!,
    headers:new Headers({etag,...(compressed?{"content-encoding":"br"}:{})}),
    blob:{etag}};
  },
  async put(key:string,body:string,options:Record<string,any>) {
   writes.push({key,options:{...options}});
   const old=data.get(key);
   if(old?(!options.allowOverwrite||options.ifMatch!==old.etag):!!options.ifMatch)
    throw new BlobPreconditionFailedError();
   const etag='"revision-'+(++revision)+'"';
   data.set(key,{body,etag});return {etag};
  },
  async list(options:{prefix:string}) {
   return {blobs:[...data.keys()].filter(k=>k.startsWith(options.prefix)).map(pathname=>({pathname})),hasMore:false};
  },
  async del(key:string) {data.delete(key);}
 };
 const store=new BlobStore(client as unknown as NonNullable<ConstructorParameters<typeof BlobStore>[0]>);
 return {store,client,data,reads,writes};
}

test("student-sized compressed reads reproduce weak-validator conflict; identity reads preserve strong validator",async()=>{
 const x=origin(),body={notes:"classroom ".repeat(200)};
 await x.store.write("student.json",body);
 const compressed=await x.client.get("student.json",{access:"private",useCache:false});
 assert.equal(compressed!.headers.get("content-encoding"),"br");
 assert.match(compressed!.blob.etag,/^W\//);
 await assert.rejects(x.client.put("student.json",JSON.stringify(body),{allowOverwrite:true,ifMatch:compressed!.blob.etag}),BlobPreconditionFailedError);
 const stored=await x.store.read<typeof body>("student.json");
 assert.equal(stored!.etag,x.data.get("student.json")!.etag);
 assert.doesNotMatch(stored!.etag,/^W\//);
 await x.store.write("student.json",{notes:"updated"},stored!.etag);
 assert.deepEqual((await x.store.read("student.json"))!.value,{notes:"updated"});
});

test("full classroom flow persists practice, all twelve decisions, and final submission",async()=>{
 const x=origin(),classroom=new Classroom(x.store,"test-instructor-key");
 const created=await classroom.action({action:"create",hostKey:"test-instructor-key",title:"Regression",teamCount:2},"") as any;
 const code=created.room.code,host=created.credential;
 await classroom.action({action:"phase",code,phase:1},host);
 const joined=await classroom.action({action:"join",code,team:1,consent:true,consentVersion:CONSENT_VERSION},"") as any;
 const student=joined.credential;
 const personKey=[...x.data.keys()].find(k=>k.includes("/people/"))!;
 assert.ok(x.data.get(personKey)!.body.length>1000,"participant record exercises compression-sized response");
 await classroom.action({action:"baseline",code,survey:{}},student);
 const prepared=await classroom.action({action:"prepare",code,awards:[200,200,200,200,200],total:1000,self:"included"},student) as any;
 assert.equal(prepared.me.prepared,true);
 for(let index=0;index<12;index++) {
  if(index===4)await classroom.action({action:"beginB",code},student);
  const saved=await classroom.action({action:"round",code,index,awards:[200,200,200,200,200],elapsedMs:1000},student) as any;
  assert.equal(saved.me.answers.length,index+1);
 }
 for(const i of [0,1])for(const followup of [false,true])await classroom.action({action:"reason",code,case:i,followup,text:""},student);
 const finished=await classroom.action({action:"finish",code,reason:"Contributions considered",needed:"More information",survey:{}},student) as any;
 assert.equal(finished.me.submitted,true);
 const persisted=JSON.parse(x.data.get(personKey)!.body);
 assert.equal(persisted.quizAttempts,1);
 assert.equal(persisted.answers.length,12);
 assert.equal(persisted.timings.length,12);
 assert.equal(persisted.submitted,true);
 assert.ok(persisted.finished);
 assert.ok(x.reads.length>0&&x.reads.every(r=>r.identity));
 await classroom.action({action:"phase",code,phase:2},host);
 const exported=await classroom.action({action:"export",code},host) as any;
 assert.equal(exported.participants.length,1);
 assert.equal(exported.participants[0].inClassSummary,true);
});

test("independent readers reject stale validators without retry or overwriting the winning value",async()=>{
 const x=origin();await x.store.write("shared.json",{nested:{count:1}});
 const first=(await x.store.read<{nested:{count:number}}>("shared.json"))!;
 const second=(await x.store.read<{nested:{count:number}}>("shared.json"))!;
 assert.notStrictEqual(first.value,second.value);
 assert.notStrictEqual(first.value.nested,second.value.nested);
 first.value.nested.count=2;
 assert.equal(second.value.nested.count,1);
 await x.store.write("shared.json",first.value,first.etag);
 const before=x.writes.length;
 await assert.rejects(x.store.write("shared.json",{nested:{count:99}},second.etag),Conflict);
 assert.equal(x.writes.length,before+1,"conflict must not trigger unconditional retry");
 assert.equal(x.writes.at(-1)!.options.ifMatch,second.etag);
 assert.deepEqual((await x.store.read("shared.json"))!.value,{nested:{count:2}});
});

test("new records disallow overwrites and preserve an existing record on duplicate creation",async()=>{
 const x=origin();await x.store.write("new.json",{count:1});
 assert.equal(x.writes[0].options.allowOverwrite,false);
 assert.equal(x.writes[0].options.ifMatch,undefined);
 assert.equal(x.writes[0].options.addRandomSuffix,false);
 const before=x.writes.length;
 await assert.rejects(x.store.write("new.json",{count:99}),Conflict);
 assert.equal(x.writes.length,before+1);
 assert.equal(x.writes.at(-1)!.options.allowOverwrite,false);
 assert.deepEqual((await x.store.read("new.json"))!.value,{count:1});
});
