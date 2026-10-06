import {Classroom,HttpError} from "../../../lib/service";
import {BlobStore,Conflict} from "../../../lib/storage";
import {studyInfo} from "../../../lib/consent";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
function service(){if(!process.env.BLOB_READ_WRITE_TOKEN)throw new HttpError("Response storage is not connected yet.",503);return new Classroom(new BlobStore(),process.env.CLASSROOM_HOST_KEY||"",!studyInfo.retention.startsWith("Not yet"));}
export async function GET(req:Request){try{return json(await service().snapshot(new URL(req.url).searchParams.get("code"),req.headers.get("x-class-token")||""));}catch(e){return error(e);}}
export async function POST(req:Request){try{const origin=req.headers.get("origin");if(origin&&origin!==new URL(req.url).origin)throw new HttpError("Request origin not allowed.",403);const raw=await req.text();if(raw.length>24000)throw new HttpError("Request too large.",413);return json(await service().action(JSON.parse(raw),req.headers.get("x-class-token")||""));}catch(e){return error(e);}}
function error(e:unknown){if(e instanceof HttpError)return json({error:e.message,...(e.code?{code:e.code}:{})},e.status);if(e instanceof Conflict)return json({error:"The saved response has changed. Refresh the activity and try again."},409);console.error("Classroom request failed:",e instanceof Error?e.name:"UnknownError");return json({error:"Unable to save or load. Please try again; do not close the page."},503);}
