const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const {webcrypto,createHash}=require("node:crypto");

function boot(options={}){
 const state=new Map();
 const requests=[];
 let counter=0;
 const sandbox={
  window:{},
  localStorage:{
   getItem:key=>{if(options.storageFails)throw Error("storage unavailable");return state.get(key)||null;},
   setItem:(key,value)=>{if(options.storageFails)throw Error("storage unavailable");state.set(key,String(value));}
  },
  crypto:{
    randomUUID:()=>{counter++;return "00000000-0000-4000-8000-"+String(counter).padStart(12,"0");},
    subtle:webcrypto.subtle
  },
  TextEncoder,
  fetch:async(url,init)=>{
   requests.push({url,init});
   if(url.endsWith("/owned_score_ids"))return {ok:true,json:async()=>[
     {session_id:"33333333-3333-4333-8333-333333333333"}
   ]};
   if(url.endsWith("/remove_owned_score"))return {ok:true,json:async()=>true};
   throw Error("Unexpected request: "+url);
  }
 };
 const context=vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,"..","score-ownership.js"),"utf8"),context,
   {filename:"score-ownership.js"});
 return {api:sandbox.window.BLOCKS_SCORE_OWNER,state,requests};
}
test("generates persistent random secret and hashes it for session creation",async()=>{
 const {api,state}=boot();
 const a=await api.hash();
 const b=await api.hash();
 const secret=state.get("blocks:score-owner-key:v1");
 assert.match(secret,/^[0-9a-f-]{36}$/);
 assert.equal(a,b);
 assert.equal(a,createHash("sha256").update(secret).digest("hex"));
 assert.match(a,/^[0-9a-f]{64}$/);
 assert.notEqual(a,secret);
});
test("ownership lookup sends key only to protected RPC",async()=>{
 const {api,state,requests}=boot();
 const owned=await api.ownedScoreIds();
 assert.equal(owned.has("33333333-3333-4333-8333-333333333333"),true);
 assert.equal(requests.length,1);
 assert.match(requests[0].url,/\/rpc\/owned_score_ids$/);
 assert.equal(JSON.parse(requests[0].init.body).owner_key,
   state.get("blocks:score-owner-key:v1"));
});
test("deletion supplies score UUID and secret to authorised RPC",async()=>{
 const {api,state,requests}=boot();
 const session="33333333-3333-4333-8333-333333333333";
 assert.equal(await api.removeScore(session),true);
 assert.match(requests[0].url,/\/rpc\/remove_owned_score$/);
 assert.deepEqual(JSON.parse(requests[0].init.body),{
   score_id:session,owner_key:state.get("blocks:score-owner-key:v1")
 });
});
test("missing persistent storage disables deletes safely",async()=>{
 const {api,requests}=boot({storageFails:true});
 assert.equal(await api.hash(),null);
 assert.equal((await api.ownedScoreIds()).size,0);
 await assert.rejects(api.removeScore("33333333-3333-4333-8333-333333333333"));
 assert.equal(requests.length,0);
});
