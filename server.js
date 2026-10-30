"use strict";
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto"),{DatabaseSync}=require("node:sqlite");
const PORT=+process.env.PORT||3000,DIR=process.env.DATA_DIR||path.join(__dirname,"data"),PUB=path.join(__dirname,"public"),MAXB=25*1024*1024;
const RU=process.env.UPSTASH_REDIS_REST_URL,RT=process.env.UPSTASH_REDIS_REST_TOKEN;
function sqliteStore(){const{DatabaseSync}=require("node:sqlite");fs.mkdirSync(DIR,{recursive:true});const db=new DatabaseSync(path.join(DIR,"astroverse.db"));
db.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT,v TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS views(path TEXT PRIMARY KEY,n INTEGER NOT NULL DEFAULT 0);`);
return{async get(k){const r=db.prepare("SELECT v FROM kv WHERE k=?").get(k);return r?r.v:null},
async del(k){db.prepare("DELETE FROM kv WHERE k=?").run(k)},
async set(k,v){db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=CURRENT_TIMESTAMP").run(k,v)},
async push(v){db.prepare("INSERT INTO history(v) VALUES(?)").run(v);db.exec("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 30)")},
async list(){return db.prepare("SELECT id,created_at FROM history ORDER BY id DESC").all()},
async one(id){const r=db.prepare("SELECT v FROM history WHERE id=?").get(+id);return r?r.v:null},
async hits(m){const s=db.prepare("INSERT INTO views(path,n) VALUES(?,?) ON CONFLICT(path) DO UPDATE SET n=n+excluded.n");for(const p in m)s.run(p,m[p])},
async views(){return db.prepare("SELECT path,n FROM views ORDER BY n DESC LIMIT 20").all()}}}
function redisStore(){const rd=async c=>{const r=await fetch(RU,{method:"POST",headers:{Authorization:"Bearer "+RT},body:JSON.stringify(c)}),j=await r.json();if(j.error)throw new Error(j.error);return j.result};
return{get:k=>rd(["GET","av:"+k]),del:async k=>{await rd(["DEL","av:"+k])},set:async(k,v)=>{await rd(["SET","av:"+k,v])},
async push(v){await rd(["LPUSH","av:history",JSON.stringify({id:Date.now(),v})]);await rd(["LTRIM","av:history",0,29])},
async list(){return(await rd(["LRANGE","av:history",0,29])).map(x=>{const o=JSON.parse(x);return{id:o.id,created_at:new Date(o.id).toISOString()}})},
async one(id){for(const x of await rd(["LRANGE","av:history",0,29])){const o=JSON.parse(x);if(o.id==id)return o.v}return null},
async hits(m){for(const p in m)await rd(["HINCRBY","av:views",p,m[p]])},
async views(){const a=await rd(["HGETALL","av:views"]),o=[];for(let i=0;i<a.length;i+=2)o.push({path:a[i],n:+a[i+1]});return o.sort((x,y)=>y.n-x.n).slice(0,20)}}}
const store=RU&&RT?redisStore():sqliteStore();
let SECRET,ADMIN,STATE;
const hashPw=(pw,salt=crypto.randomBytes(16).toString("hex"))=>salt+":"+crypto.scryptSync(pw,salt,64).toString("hex");
const checkPw=(pw,st)=>{if(!st)return false;const[s,h]=st.split(":"),b=crypto.scryptSync(pw,s,64),a=Buffer.from(h,"hex");return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const sign=p=>crypto.createHmac("sha256",SECRET).update(p).digest("base64url");
const mkTok=()=>{const p=Buffer.from(JSON.stringify({exp:Date.now()+12*36e5})).toString("base64url");return p+"."+sign(p)};
const okTok=h=>{const [p,s]=(h||"").replace(/^Bearer /,"").split(".");if(!p||!s)return false;const x=sign(p);if(s.length!==x.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(x)))return false;try{return JSON.parse(Buffer.from(p,"base64url")).exp>Date.now()}catch(e){return false}};
const tries=new Map(),limited=ip=>{const n=Date.now(),r=tries.get(ip)||{c:0,t:n};if(n-r.t>9e5){r.c=0;r.t=n}tries.set(ip,r);return r.c>=10},fail=ip=>{const r=tries.get(ip);if(r)r.c++};
const body=req=>new Promise((res,rej)=>{let n=0;const c=[];req.on("data",d=>{n+=d.length;if(n>MAXB){rej(new Error("big"));req.destroy()}else c.push(d)});req.on("end",()=>{try{res(JSON.parse(Buffer.concat(c).toString()||"{}"))}catch(e){rej(e)}});req.on("error",rej)});
const json=(r,c,o)=>{r.writeHead(c,{"Content-Type":"application/json","Cache-Control":"no-store"});r.end(typeof o==="string"?o:JSON.stringify(o))};
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon"};
const SEC={"X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src https:; connect-src 'self' https: data: blob:; object-src 'none'; base-uri 'self'"};
let pend={};const flush=async()=>{const m=pend;if(!Object.keys(m).length)return;pend={};try{await store.hits(m)}catch(e){for(const p in m)pend[p]=(pend[p]||0)+m[p]}};
setInterval(flush,6e4).unref();
for(const sg of["SIGTERM","SIGINT"])process.on(sg,async()=>{await flush();process.exit(0)});
const server=http.createServer(async(req,res)=>{
for(const k in SEC)res.setHeader(k,SEC[k]);
const p=new URL(req.url,"http://x").pathname,ip=req.socket.remoteAddress,M=req.method;
try{
if(p==="/healthz")return json(res,200,{ok:1});
if(p.startsWith("/api/")){
if(p==="/api/state"&&M==="GET")return json(res,200,STATE);
if(p==="/api/hit"&&M==="POST"){const b=await body(req),k=String(b.path||"#home").slice(0,80);if(k in pend||Object.keys(pend).length<200)pend[k]=(pend[k]||0)+1;return json(res,200,{ok:1})}
if(p==="/api/login"&&M==="POST"){if(limited(ip))return json(res,429,{error:"Too many attempts"});const b=await body(req);if(checkPw(String(b.password||""),ADMIN))return json(res,200,{token:mkTok()});fail(ip);return json(res,401,{error:"Wrong password"})}
const mm=p.match(/^\/api\/model\/([a-z0-9]{3,40})$/i);
if(mm){const id=mm[1];
if(M==="GET"){const d=await store.get("model:"+id);if(!d)return json(res,404,{error:"Not found"});const buf=Buffer.from(d,"base64");res.writeHead(200,{"Content-Type":"model/gltf-binary","Content-Length":buf.length,"Cache-Control":"public, max-age=3600"});return res.end(buf)}
if(!okTok(req.headers.authorization))return json(res,401,{error:"Unauthorized"});
if(M==="PUT"){const b=await body(req);if(typeof b.data!=="string"||b.data.length>9e6)return json(res,400,{error:"Model too large (max ~6 MB)"});await store.set("model:"+id,b.data);return json(res,200,{ok:1})}
if(M==="DELETE"){await store.del("model:"+id);return json(res,200,{ok:1})}}
if(!okTok(req.headers.authorization))return json(res,401,{error:"Unauthorized"});
if(p==="/api/state"&&M==="PUT"){const b=await body(req);if(!b||typeof b!=="object"||Array.isArray(b))return json(res,400,{error:"Bad state"});delete b.pass;const old=STATE,nw=JSON.stringify(b);await store.set("state",nw);STATE=nw;if(old&&old!=="{}")await store.push(old);return json(res,200,{ok:1})}
if(p==="/api/password"&&M==="POST"){const b=await body(req);if(String(b.password||"").length<8)return json(res,400,{error:"Min 8 characters"});const h=hashPw(String(b.password));await store.set("admin",h);ADMIN=h;return json(res,200,{ok:1})}
if(p==="/api/stats"){await flush();return json(res,200,{views:await store.views(),backups:await store.list()})}
if(p==="/api/restore"&&M==="POST"){const b=await body(req),v=await store.one(b.id);if(!v)return json(res,404,{error:"Not found"});await store.set("state",v);STATE=v;return json(res,200,{ok:1})}
return json(res,404,{error:"Not found"})}
let f=path.join(PUB,p==="/"?"index.html":decodeURIComponent(p));
if(!(f===PUB||f.startsWith(PUB+path.sep))||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(PUB,"index.html");
res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream","Cache-Control":f.endsWith(".html")?"no-cache":"public, max-age=86400"});fs.createReadStream(f).pipe(res);
}catch(e){json(res,e.message==="big"?413:500,{error:"Server error"})}
});
(async()=>{STATE=(await store.get("state"))||"{}";ADMIN=await store.get("admin");SECRET=process.env.SECRET||await store.get("secret");
if(!SECRET){SECRET=crypto.randomBytes(32).toString("hex");await store.set("secret",SECRET)}
if(!ADMIN){ADMIN=hashPw(process.env.ADMIN_PASSWORD||"admin123");await store.set("admin",ADMIN);if(!process.env.ADMIN_PASSWORD)console.warn("WARNING: default admin password is 'admin123'. Set ADMIN_PASSWORD or change it in the admin panel.")}
server.listen(PORT,"0.0.0.0",()=>console.log("ASTROVERSE on port "+PORT+" ("+(RU?"Upstash Redis":"SQLite")+")"))})().catch(e=>{console.error("Startup failed:",e.message);process.exit(1)});
