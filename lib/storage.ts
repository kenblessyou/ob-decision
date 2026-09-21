import {get,put,list,del,BlobPreconditionFailedError} from "@vercel/blob";
import {randomUUID} from "node:crypto";
export type Stored<T>={value:T;etag:string};
export interface Store {read<T>(key:string):Promise<Stored<T>|null>;write<T>(key:string,value:T,etag?:string):Promise<void>;keys(prefix:string):Promise<string[]>;remove(key:string):Promise<void>}
export class Conflict extends Error{}
export class BlobStore implements Store {
 async read<T>(key:string):Promise<Stored<T>|null>{const r=await get(key,{access:"private",useCache:false});if(!r||!r.stream)return null;return{value:JSON.parse(await new Response(r.stream).text()) as T,etag:r.blob.etag};}
 async write<T>(key:string,value:T,etag?:string){try{await put(key,JSON.stringify(value),{access:"private",addRandomSuffix:false,allowOverwrite:!!etag,ifMatch:etag,contentType:"application/json",cacheControlMaxAge:0});}catch(e){if(e instanceof BlobPreconditionFailedError)throw new Conflict("Please retry; this response changed in another tab.");throw e;}}
 async keys(prefix:string){const found:string[]=[];let cursor:string|undefined;do{const r=await list({prefix,cursor,limit:1000});found.push(...r.blobs.map(x=>x.pathname));cursor=r.hasMore?r.cursor:undefined;}while(cursor);return found;}
 async remove(key:string){await del(key);}
}
// Used only by tests; production never falls back to memory or local disk.
export class MemoryStore implements Store {data=new Map<string,Stored<unknown>>();async read<T>(k:string){const x=this.data.get(k);return x?structuredClone(x) as Stored<T>:null;}async write<T>(k:string,v:T,e?:string){const old=this.data.get(k);if(old?(old.etag!==e):!!e)throw new Conflict();this.data.set(k,{value:structuredClone(v),etag:randomUUID()});}async keys(p:string){return [...this.data.keys()].filter(k=>k.startsWith(p));}async remove(k:string){this.data.delete(k);}}
