export function normalizeClassCode(input:string):string {
 const value=input.trim();
 try { const url=new URL(value); return (url.searchParams.get("code")||value).trim().toUpperCase(); } catch { return value.toUpperCase(); }
}
