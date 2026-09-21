export type Recipient={id:string;score:number;self:boolean;same:boolean|null;role?:string};
export type Trial={id:number;profile:number;block:'A'|'B';recipients:Recipient[];partition:number|null;direction:number|null;aOrder:number;omittedPartition:number;conditionKey:string};
export const PROTOCOL='STUDY2-V8-CLASSROOM-20260921';
export const CONSENT_VERSION='2026-09-21-study2-v8';
export const BUDGET=1000,TRIAL_COUNT=12;
export const profiles=[[18,22,19,21],[18,22,8,32]];
export const aOrders=[[0,0,1,1],[0,1,0,1],[0,1,1,0],[1,0,0,1],[1,0,1,0],[1,1,0,0]];
const roles=['anchor18','anchor22','changing_low','changing_high'];
const partitions=[[[0,1],[2,3]],[[0,2],[1,3]],[[0,3],[1,2]]];
export function random(seed:number){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function shuffle<T>(a:T[],r:()=>number){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
export function assignments(seed:number,cell=0):Trial[]{
 if(!Number.isInteger(cell)||cell<0||cell>=18)throw Error('Invalid assignment cell');
 const rng=random(seed),aOrder=cell%6,omittedPartition=Math.floor(cell/6);
 const b:{profile:number;partition:number;direction:number}[]=[];
 for(let profile=0;profile<2;profile++)for(let partition=0;partition<3;partition++)if(partition!==omittedPartition)for(let direction=0;direction<2;direction++)b.push({profile,partition,direction});
 const cases:{profile:number;partition:number|null;direction:number|null}[]=[...aOrders[aOrder].map(profile=>({profile,partition:null,direction:null})),...shuffle(b,rng)];
 return cases.map((c,id)=>{const block=id<4?'A':'B',same=c.partition===null?[]:partitions[c.partition][c.direction!];const labels=shuffle(Array.from({length:20},(_,i)=>'Member '+String(i+1).padStart(2,'0')),rng);
 const recipients:Recipient[]=[{id:'You',score:20,self:true,same:null,role:'self'},...profiles[c.profile].map((score,j)=>({id:labels[j],score,self:false,same:block==='B'?same.includes(j):null,role:roles[j]}))];
 return{id,profile:c.profile,block,partition:c.partition,direction:c.direction,aOrder,omittedPartition,conditionKey:block+':'+(c.profile?'spread':'close')+(block==='B'?':'+same.map(j=>roles[j]).join(','):''),recipients:shuffle(recipients,rng)};
 });
}
export const practiceCase:Recipient[]=[{id:'Practice 01',score:15,self:false,same:null},{id:'You',score:20,self:true,same:null},{id:'Practice 02',score:25,self:false,same:null},{id:'Practice 03',score:30,self:false,same:null},{id:'Practice 04',score:10,self:false,same:null}];
export const teamCase:Recipient[]=[{id:'Member 01',score:18,self:false,same:true},{id:'Member 02',score:22,self:false,same:false},{id:'You',score:20,self:true,same:null},{id:'Member 03',score:8,self:false,same:true},{id:'Member 04',score:32,self:false,same:false}];
export function validAwards(a:unknown):a is number[]{return Array.isArray(a)&&a.length===5&&a.every(x=>Number.isInteger(x)&&x>=0&&x<=1000)&&a.reduce((s,x)=>s+x,0)===1000;}
export function describe(v:number[]){const n=v.length;if(!n)return{n:0,mean:null,median:null,sd:null,min:null,max:null};const s=[...v].sort((a,b)=>a-b),mean=v.reduce((a,b)=>a+b,0)/n;return{n,mean,median:n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2,sd:n>1?Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/(n-1)):null,min:s[0],max:s[n-1]};}
export function classify(scores:number[],awards:number[]){
 if(!validAwards(awards)||scores.length!==5||new Set(scores).size!==5||scores.reduce((a,b)=>a+b,0)!==100)throw Error('Invalid Study 2 allocation');
 if(awards.every((a,i)=>a===10*scores[i]))return 'exact';
 if(awards.every(a=>a===200))return 'equal';
 if(scores.some((x,i)=>scores.some((y,j)=>x>y&&awards[i]<awards[j])))return 'reversal';
 const hi=scores.indexOf(Math.max(...scores)),lo=scores.indexOf(Math.min(...scores)),gap=awards[hi]-awards[lo],benchmark=10*(scores[hi]-scores[lo]);
 return gap<benchmark?'compression':gap>benchmark?'expansion':'residual';
}
export function departmentMetrics(t:Trial,awards:number[]){if(t.block!=='B'||!validAwards(awards))throw Error('B allocation required');let difference=0,ilr=0;for(let j=0;j<5;j++){const r=t.recipients[j];if(r.self)continue;difference+=(r.same?1:-1)*awards[j];ilr+=(r.same?1:-1)*Math.log(awards[j]+.5);}return{difference: difference/10,ilr:ilr*.5};}
export function aggregate(rows:{trials:Trial[];answers:number[][]}[]){let equal=0,exact=0,zeros=0;const means:number[]=[],ilrs:number[]=[],compression:number[]=[];const scores:Record<string,{n:number;sum:number}>={};
 for(const p of rows){if(p.answers.length!==12||p.trials.length!==12||!p.answers.every(validAwards)||p.trials.filter(t=>t.block==='A').length!==4||p.trials.filter(t=>t.block==='B').length!==8)continue;let d=0,z=0,compressed=0;
 p.trials.forEach((t,i)=>{const a=p.answers[i],cat=classify(t.recipients.map(r=>r.score),a);if(cat==='equal')equal++;if(cat==='exact')exact++;if(a.some(x=>x===0))zeros++;if(t.block==='A'&&cat==='compression')compressed++;if(t.block==='B'){const m=departmentMetrics(t,a);d+=m.difference;z+=m.ilr;}t.recipients.forEach((r,j)=>{const k=String(r.score);scores[k]??={n:0,sum:0};scores[k].n++;scores[k].sum+=a[j];});});
 means.push(d/8);ilrs.push(z/8);compression.push(compressed/4);
 }return{...describe(means),decisions:means.length*12,equal,exact,zeros,scores,bDepartmentILR:describe(ilrs),aCompressionRate:describe(compression),histogram:Array.from({length:10},(_,i)=>({from:-100+i*20,to:-80+i*20,n:means.filter(x=>x>=-100+i*20&&(i===9?x<=100:x< -80+i*20)).length}))};
}
export const scenario="Imagine that you are a member of a project and are responsible for allocating its bonus. The project has a fixed bonus budget of 1,000 allocation units. Allocate all 1,000 units among yourself and four other project members. The contribution scores represent each member's assessed share of the project's total contribution and add up to 100. All four other members have the same formal job level and scope of responsibility. No single formula for converting the scores into awards is prescribed; the allocation is delegated to you. Each decision concerns a separate project case. Member codes do not identify the same people across cases. Enter a whole number for each person. Zero is allowed. The five amounts must add up to 1,000.";
export const teamEvidence="The project members ask how their contribution scores were determined and used in the bonus decision. They also say: ‘I want challenging tasks that I can accomplish’ and ‘I want specific feedback on my results.’ This is additional information for discussion; the original contribution scores have not changed.";
