import {createHash,randomBytes,randomInt,timingSafeEqual} from "node:crypto";
import {assignments,aggregate,validAwards,PROTOCOL,CONSENT_VERSION,type Trial} from "./experiment";
import type {Store,Stored} from "./storage";
import {Conflict} from "./storage";
export class HttpError extends Error{constructor(message:string,public status=400){super(message);}}
function fail(message:string,status=400):never{throw new HttpError(message,status);}
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const secret=()=>randomBytes(32).toString("hex");
const now=()=>new Date().toISOString();
function text(v:unknown,max=1200){if(typeof v!=="string"||v.length>max)fail("Please check the length of your response.");return v.trim();}
type Room={code:string;title:string;hostHash:string;phase:number;teamCount:number;teamKeys:string[];created:string;protocol:string;includedIds:string[];stats:ReturnType<typeof aggregate>|null;counts:{joined:number;completed:number};closedAt:string|null;demo:boolean};
export type Person={id:string;tokenHash:string;team:number;department:string;trials:Trial[];answers:number[][];timings:number[];prepared:boolean;quizAttempts:number;submitted:boolean;created:string;finished:string|null;consent:{version:string;at:string};reflection:{reason:string;needed:string};survey:{income:number|null;rewards:number|null;politics:number|null;gender:string|null};surveyPosition:string;withdrawn:boolean};
const roomPath=(c:string)=>"ob-v3/"+c+"/room.json";
const personPath=(c:string,h:string)=>"ob-v3/"+c+"/people/"+h+".json";
const teamPath=(c:string,n:number)=>"ob-v3/"+c+"/teams/"+n+".json";
export class Classroom {
 constructor(public store:Store,public hostKey:string,public ready=true){}
 async room(code:unknown){const c=text(code,16).toUpperCase();if(!/^[A-F0-9]{8}$/.test(c))fail("Enter a valid class code.",404);const r=await this.store.read<Room>(roomPath(c));if(!r)fail("Class not found.",404);return r;}
 async person(r:Room,token:string){if(!token)fail("Join the class first.",401);const p=await this.store.read<Person>(personPath(r.code,hash(token)));if(!p||p.value.withdrawn)fail("This access is not active. Please join or contact the instructor.",401);return p;}
 isHost(r:Room,t:string){return !!t&&hash(t)===r.hostHash;}
 async people(r:Room){const keys=await this.store.keys("ob-v3/"+r.code+"/people/");const found:Person[]=[];for(let i=0;i<keys.length;i+=12){const xs=await Promise.all(keys.slice(i,i+12).map(k=>this.store.read<Person>(k)));found.push(...xs.filter((x):x is Stored<Person>=>!!x).map(x=>x.value).filter(p=>!p.withdrawn));}return found;}
 async teams(r:Room){const keys=await this.store.keys("ob-v3/"+r.code+"/teams/");return (await Promise.all(keys.map(k=>this.store.read<{team:number;payload:Record<string,unknown>}>(k)))).filter(x=>!!x).map(x=>x!.value).sort((a,b)=>a.team-b.team);}
 async snapshot(code:unknown,t:string){const r=(await this.room(code)).value,host=this.isHost(r,t);const p=host?null:(await this.person(r,t)).value;
 const teams=await this.teams(r);let counts=r.counts;if(host&&r.phase<=1){const ps=await this.people(r);counts={joined:ps.length,completed:ps.filter(x=>x.submitted).length};}
 const stats=r.phase>=2&&r.stats&&r.stats.n>=5?r.stats:null;
 return{room:{code:r.code,title:r.title,phase:r.phase,teamCount:r.teamCount,protocol:r.protocol,demo:r.demo},isHost:host,counts,stats,suppressed:r.phase>=2&&(!r.stats||r.stats.n<5),teamKeys:host?r.teamKeys:undefined,
 me:p?{id:p.id,team:p.team,department:p.department,trials:p.trials,answers:p.answers,prepared:p.prepared,submitted:p.submitted,reflection:p.reflection,survey:p.survey,consent:p.consent}:null,
 teams:r.phase>=3?teams:teams.filter(x=>host||x.team===p?.team).map(x=>host?{team:x.team}:x)};
 }
 async action(b:Record<string,any>,t:string){
 if(b.action==="create"){const key=typeof b.hostKey==="string"?b.hostKey:"";if(!this.hostKey||key.length!==this.hostKey.length||!timingSafeEqual(Buffer.from(key),Buffer.from(this.hostKey)))fail("Enter the instructor key.",401);
 if(!Number.isInteger(b.teamCount)||b.teamCount<1||b.teamCount>22)fail("Choose 1 to 22 teams.");
 const code=randomBytes(4).toString("hex").toUpperCase(),credential=secret();const r:Room={code,title:text(b.title,80)||"Motivation & Allocation",hostHash:hash(credential),phase:0,teamCount:b.teamCount,teamKeys:Array.from({length:b.teamCount},()=>randomBytes(4).toString("hex")),created:now(),protocol:PROTOCOL,includedIds:[],stats:null,counts:{joined:0,completed:0},closedAt:null,demo:b.demo===true};
 await this.store.write(roomPath(code),r);return{credential,...await this.snapshot(code,credential)};}
 let row=await this.room(b.code),r=row.value;
 if(b.action==="join"){if(!this.ready&&!r.demo)fail("The participation information is not yet complete. Please wait for your instructor.",409);if(r.phase>1)fail("Individual responses have closed.",409);
 if(b.consent!==true||b.consentVersion!==CONSENT_VERSION)fail("Voluntary consent is required to join. You may choose the no-record activity instead.",403);
 if(!Number.isInteger(b.team)||b.team<1||b.team>r.teamCount)fail("Check your team number.");
 const credential=secret(),h=hash(credential),p:Person={id:randomBytes(8).toString("hex"),tokenHash:h,team:b.team,department:randomInt(2)?"A":"B",trials:assignments(randomInt(0x100000000)),answers:[],timings:[],prepared:false,quizAttempts:0,submitted:false,created:now(),finished:null,consent:{version:CONSENT_VERSION,at:now()},reflection:{reason:"",needed:""},survey:{income:null,rewards:null,politics:null,gender:null},surveyPosition:"after_allocation_after_instruction",withdrawn:false};
 await this.store.write(personPath(r.code,h),p);return{credential,...await this.snapshot(r.code,credential)};}
 const host=this.isHost(r,t);
 if(b.action==="phase"){if(!host)fail("Instructor access required.",403);if(b.phase!==r.phase+1||b.phase>4)fail("Advance one stage at a time.",409);
 if(r.phase===1){const ps=await this.people(r),done=ps.filter(p=>p.submitted);r={...r,closedAt:now(),includedIds:done.map(p=>p.id),stats:aggregate(done),counts:{joined:ps.length,completed:done.length}};}
 r.phase=b.phase;await this.store.write(roomPath(r.code),r,row.etag);return this.snapshot(r.code,t);}
 if(b.action==="export"){if(!host)fail("Instructor access required.",403);if(r.phase<2)fail("Close individual responses before exporting.",409);
 const ps=await this.people(r);return{protocol:PROTOCOL,consentVersion:CONSENT_VERSION,exportedAt:now(),classCode:r.code,measurementTiming:"After instruction and allocation; not a prospective T0 measurement.",participants:ps.map(({tokenHash,...p})=>({...p,inClassSummary:r.includedIds.includes(p.id)})),teams:await this.teams(r),summary:r.stats};}
 if(b.action==="demoFill"){if(!host||!r.demo||r.phase>1)fail("Synthetic data can only be added to a demo class before discussion.",403);const existing=await this.people(r);if(existing.length)fail("Use an empty demo class.",409);for(let i=0;i<66;i++){const h=hash("demo-"+r.code+"-"+i),trials=assignments(i+10),p:Person={id:"SYNTHETIC-"+i,tokenHash:h,team:i%r.teamCount+1,department:i%2?"A":"B",trials,answers:trials.map(tr=>tr.recipients.map(x=>i%3===0?25:x.score+(i%3===1?(x.same?3:-3):0))),timings:Array(8).fill(8000),prepared:true,quizAttempts:1,submitted:true,created:now(),finished:now(),consent:{version:"SYNTHETIC-NOT-CONSENT",at:now()},reflection:{reason:"Synthetic example",needed:"Synthetic example"},survey:{income:null,rewards:null,politics:null,gender:null},surveyPosition:"synthetic",withdrawn:false};await this.store.write(personPath(r.code,h),p);}return this.snapshot(r.code,t);}
 const pr=await this.person(r,t),p=pr.value,key=personPath(r.code,p.tokenHash);
 if(b.action==="withdraw"){const withdrawn:Person={...p,withdrawn:true,answers:[],trials:[],timings:[],reflection:{reason:"",needed:""},survey:{income:null,rewards:null,politics:null,gender:null}};await this.store.write(key,withdrawn,pr.etag);
 for(let attempt=0;attempt<8;attempt++){const rr=await this.room(r.code);if(rr.value.phase<2)break;const ps=(await this.people(rr.value)).filter(x=>rr.value.includedIds.includes(x.id));try{await this.store.write(roomPath(r.code),{...rr.value,includedIds:ps.map(x=>x.id),stats:aggregate(ps),counts:{...rr.value.counts,completed:ps.length}},rr.etag);break;}catch(e){if(!(e instanceof Conflict)||attempt===7)throw e;}}return{withdrawn:true};}
 if(b.action==="team"){if(r.phase!==2)fail("Team responses are open only during discussion.",409);if(!p.submitted)fail("A participant who finished the individual task must submit for the team.");if(b.teamKey!==r.teamKeys[p.team-1])fail("Check the representative code.",403);const x=b.payload;if(!x||!validAwards(x.awards))fail("The team allocation must total 100.");const payload={awards:x.awards,pattern:text(x.pattern),explanation:text(x.explanation),need:text(x.need),actions:text(x.actions),principle:text(x.principle)};if(Object.entries(payload).some(([k,v])=>k!=="awards"&&!v))fail("Complete the team discussion fields.");const tk=teamPath(r.code,p.team),prior=await this.store.read(tk);await this.store.write(tk,{team:p.team,payload,updated:now()},prior?.etag);return this.snapshot(r.code,t);}
 if(r.phase!==1||p.submitted)fail("Individual responses are closed or already submitted.",409);
 if(b.action==="prepare"){if(!validAwards(b.awards))fail("The practice allocation must total 100.");p.quizAttempts++;p.prepared=b.department===p.department&&b.total===100&&b.self==="none";await this.store.write(key,p,pr.etag);return{...await this.snapshot(r.code,t),feedback:p.prepared?"Practice complete.":"Check your department, the 100-point total, and that you receive no share."};}
 if(b.action==="round"){if(!p.prepared)fail("Complete the practice first.");if(b.index!==p.answers.length||b.index>=8)fail("This case has already been saved. Refresh to continue.",409);if(!validAwards(b.awards))fail("Enter four whole numbers totaling 100.");p.answers.push(b.awards);p.timings.push(typeof b.elapsedMs==="number"&&Number.isFinite(b.elapsedMs)?Math.max(0,Math.min(86400000,b.elapsedMs)):0);await this.store.write(key,p,pr.etag);return this.snapshot(r.code,t);}
 if(b.action==="finish"){if(p.answers.length!==8||!p.answers.every(validAwards))fail("Complete all eight decisions first.");
 const survey=b.survey||{};for(const k of ["income","rewards","politics"] as const){const v=survey[k];if(v!==null&&v!==undefined&&(!Number.isInteger(v)||v<1||v>10))fail("Optional scales must be 1–10 or left unanswered.");p.survey[k]=v??null;}
 if(![null,undefined,"male","female","another","prefer_not"].includes(survey.gender))fail("Choose a valid gender option or skip.");p.survey.gender=survey.gender==="prefer_not"?null:survey.gender??null;
 p.reflection={reason:text(b.reason??"",1500),needed:text(b.needed??"",1000)};p.submitted=true;p.finished=now();await this.store.write(key,p,pr.etag);
 const after=(await this.room(r.code)).value;if(after.phase>=2&&!after.includedIds.includes(p.id))fail("The class closed before this submission was included. Please tell your instructor.",409);return this.snapshot(r.code,t);}
 fail("Unsupported action.");
 }
}
