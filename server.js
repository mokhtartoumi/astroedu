"use strict";
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto"),{DatabaseSync}=require("node:sqlite");
const PORT=+process.env.PORT||3000,DIR=process.env.DATA_DIR||path.join(__dirname,"data"),PUB=path.join(__dirname,"public"),MAXB=25*1024*1024;
fs.mkdirSync(DIR,{recursive:true});
const db=new DatabaseSync(path.join(DIR,"astroverse.db"));
db.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT,v TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS views(path TEXT PRIMARY KEY,n INTEGER NOT NULL DEFAULT 0);`);
const getK=k=>{const r=db.prepare("SELECT v FROM kv WHERE k=?").get(k);return r?r.v:null};
const setK=(k,v)=>db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=CURRENT_TIMESTAMP").run(k,v);
let SECRET=process.env.SECRET||getK("secret");if(!SECRET){SECRET=crypto.randomBytes(32).toString("hex");setK("secret",SECRET)}
const hashPw=(pw,salt=crypto.randomBytes(16).toString("hex"))=>salt+":"+crypto.scryptSync(pw,salt,64).toString("hex");
const checkPw=(pw,st)=>{if(!st)return false;const[s,h]=st.split(":"),b=crypto.scryptSync(pw,s,64),a=Buffer.from(h,"hex");return a.length===b.length&&crypto.timingSafeEqual(a,b)};
if(!getK("admin")){setK("admin",hashPw(process.env.ADMIN_PASSWORD||"admin123"));if(!process.env.ADMIN_PASSWORD)console.warn("WARNING: default admin password is 'admin123'. Set ADMIN_PASSWORD or change it in the admin panel.")}
const sign=p=>crypto.createHmac("sha256",SECRET).update(p).digest("base64url");
const mkTok=()=>{const p=Buffer.from(JSON.stringify({exp:Date.now()+12*36e5})).toString("base64url");return p+"."+sign(p)};
const okTok=h=>{const [p,s]=(h||"").replace(/^Bearer /,"").split(".");if(!p||!s)return false;const x=sign(p);if(s.length!==x.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(x)))return false;try{return JSON.parse(Buffer.from(p,"base64url")).exp>Date.now()}catch(e){return false}};
const tries=new Map(),limited=ip=>{const n=Date.now(),r=tries.get(ip)||{c:0,t:n};if(n-r.t>9e5){r.c=0;r.t=n}tries.set(ip,r);return r.c>=10},fail=ip=>{const r=tries.get(ip);if(r)r.c++};
const body=req=>new Promise((res,rej)=>{let n=0;const c=[];req.on("data",d=>{n+=d.length;if(n>MAXB){rej(new Error("big"));req.destroy()}else c.push(d)});req.on("end",()=>{try{res(JSON.parse(Buffer.concat(c).toString()||"{}"))}catch(e){rej(e)}});req.on("error",rej)});
const json=(r,c,o)=>{r.writeHead(c,{"Content-Type":"application/json","Cache-Control":"no-store"});r.end(typeof o==="string"?o:JSON.stringify(o))};
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon"};
const SEC={"X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https:; connect-src 'self'; object-src 'none'; base-uri 'self'"};
http.createServer(async(req,res)=>{
for(const k in SEC)res.setHeader(k,SEC[k]);
const p=new URL(req.url,"http://x").pathname,ip=req.socket.remoteAddress,M=req.method;
try{
if(p==="/healthz")return json(res,200,{ok:1});
if(p.startsWith("/api/")){
if(p==="/api/state"&&M==="GET")return json(res,200,getK("state")||"{}");
if(p==="/api/hit"&&M==="POST"){const b=await body(req);db.prepare("INSERT INTO views(path,n) VALUES(?,1) ON CONFLICT(path) DO UPDATE SET n=n+1").run(String(b.path||"#home").slice(0,80));return json(res,200,{ok:1})}
if(p==="/api/login"&&M==="POST"){if(limited(ip))return json(res,429,{error:"Too many attempts"});const b=await body(req);if(checkPw(String(b.password||""),getK("admin")))return json(res,200,{token:mkTok()});fail(ip);return json(res,401,{error:"Wrong password"})}
if(!okTok(req.headers.authorization))return json(res,401,{error:"Unauthorized"});
if(p==="/api/state"&&M==="PUT"){const b=await body(req);if(!b||typeof b!=="object"||Array.isArray(b))return json(res,400,{error:"Bad state"});delete b.pass;const old=getK("state");if(old){db.prepare("INSERT INTO history(v) VALUES(?)").run(old);db.exec("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 30)")}setK("state",JSON.stringify(b));return json(res,200,{ok:1})}
if(p==="/api/password"&&M==="POST"){const b=await body(req);if(String(b.password||"").length<8)return json(res,400,{error:"Min 8 characters"});setK("admin",hashPw(String(b.password)));return json(res,200,{ok:1})}
if(p==="/api/stats")return json(res,200,{views:db.prepare("SELECT path,n FROM views ORDER BY n DESC LIMIT 20").all(),backups:db.prepare("SELECT id,created_at FROM history ORDER BY id DESC").all()});
if(p==="/api/restore"&&M==="POST"){const b=await body(req),r=db.prepare("SELECT v FROM history WHERE id=?").get(+b.id);if(!r)return json(res,404,{error:"Not found"});setK("state",r.v);return json(res,200,{ok:1})}
return json(res,404,{error:"Not found"})}
let f=path.join(PUB,p==="/"?"index.html":decodeURIComponent(p));
if(!(f===PUB||f.startsWith(PUB+path.sep))||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(PUB,"index.html");
res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream","Cache-Control":f.endsWith(".html")?"no-cache":"public, max-age=86400"});fs.createReadStream(f).pipe(res);
}catch(e){json(res,e.message==="big"?413:500,{error:"Server error"})}
}).listen(PORT,()=>console.log("ASTROVERSE running on port "+PORT));
