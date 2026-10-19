const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {execFileSync}=require("node:child_process");
const os=require("node:os");

const root=path.join(__dirname,"..");
function bootWorker(){
  const scope="https://example.test/blocks/dev/";
  const handlers={};
  const stored=new Map();
  let networkCalls=0,skipped=0;
  class FakeRequest{
    constructor(url){this.url=new URL(url,scope).href;this.method="GET"}
  }
  const cache={
    async addAll(requests){
      for(const request of requests)stored.set(new URL(request.url).pathname,
        {ok:true,source:"offline",url:request.url});
    },
    async match(request){
      return stored.get(new URL(request.url).pathname);
    }
  };
  const sandbox={
    URL,Request:FakeRequest,Response:{error:()=>({ok:false})},
    caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},
    fetch:async()=>{networkCalls++;throw Error("airplane mode")},
    self:{
      location:new URL(scope+"sw.js"),
      registration:{scope},
      clients:{claim:async()=>{}},
      skipWaiting:async()=>{skipped++},
      addEventListener:(type,callback)=>{handlers[type]=callback}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,"sw.js"),"utf8"),sandbox,{filename:"sw.js"});
  async function fire(type,event={}){
    let pending;
    handlers[type]({...event,waitUntil:p=>{pending=p},respondWith:p=>{pending=p}});
    return pending&&await pending;
  }
  return {fire,handlers,stored,networkCalls:()=>networkCalls,skipped:()=>skipped};
}

test("precache installs a complete offline game without activating mid-session",async()=>{
  const worker=bootWorker();
  await worker.fire("install");
  for(const name of ["/blocks/dev/","/blocks/dev/index.html","/blocks/dev/app.js",
    "/blocks/dev/game-modes.js","/blocks/dev/board-renderer.js","/blocks/dev/score-sync.js"]){
    assert.ok(worker.stored.has(name),"Missing offline asset "+name);
  }
  assert.equal(worker.skipped(),0,"new releases must wait, not interrupt gameplay");
  const response=await worker.fire("fetch",{
    request:{method:"GET",url:"https://example.test/blocks/dev/?players=2"}
  });
  assert.equal(response.source,"offline");
  const script=await worker.fire("fetch",{
    request:{method:"GET",url:"https://example.test/blocks/dev/game.js?v=release123"}
  });
  assert.equal(script.source,"offline");
  assert.equal(worker.networkCalls(),0,"no network requests for cached game assets");
});

test("only an explicit activation message promotes a waiting worker",async()=>{
  const worker=bootWorker();
  await worker.fire("install");
  await worker.fire("message",{data:{type:"NOOP"}});
  assert.equal(worker.skipped(),0);
  await worker.fire("message",{data:{type:"BLOCKS_ACTIVATE_UPDATE"}});
  assert.equal(worker.skipped(),1);
});

test("both release channels receive separate versioned caches and PWA scopes",()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"blocks-offline-"));
  try{
    for(const channel of ["prod","dev"]){
      const dest=path.join(tmp,channel);
      execFileSync(process.execPath,[path.join(root,"scripts/build-pages.mjs"),root,dest,channel,"a1b2c3d4"]);
      const worker=fs.readFileSync(path.join(dest,"sw.js"),"utf8");
      const manifest=JSON.parse(fs.readFileSync(path.join(dest,"manifest.json"),"utf8"));
      assert.ok(worker.includes('const CACHE="blocks-'+channel+'-a1b2c3d4"'));
      assert.ok(worker.includes('key.startsWith("blocks-'+channel+'-")'));
      assert.equal(manifest.scope,channel==="prod"?"./":"./");
      assert.equal(manifest.id,channel==="prod"?"/blocks/":"/blocks/dev/");
    }
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});

async function runRegistration(waitingAtLaunch,hadController=true,isPlaying=false){
  const code=fs.readFileSync(path.join(root,"app.js"),"utf8");
  const start=code.indexOf('if("serviceWorker" in navigator){');
  const end=code.indexOf('document.addEventListener("contextmenu"',start);
  assert.ok(start>=0&&end>start);
  const windowEvents={},workerEvents={},documentEvents={};
  let reloads=0,saves=0,messages=0,checks=0;
  const registration={
    waiting:waitingAtLaunch?{postMessage:()=>{messages++}}:null,
    update:async()=>{checks++}
  };
  const sandbox={
    navigator:{serviceWorker:{
      controller:hadController?{}:null,
      register:async()=>registration,
      addEventListener:(type,cb)=>{workerEvents[type]=cb}
    }},
    window:{addEventListener:(type,cb)=>{windowEvents[type]=cb}},
    document:{addEventListener:(type,cb)=>{documentEvents[type]=cb}},
    location:{reload:()=>{reloads++}},
    saveGame:()=>{saves++},
    game:{phase:isPlaying?"falling":"paused"},awaitingInitialStart:!isPlaying,
    console
  };
  vm.runInNewContext(code.slice(start,end),sandbox);
  await windowEvents.load();
  await Promise.resolve();
  return {workerEvents,registration,
    get:()=>({reloads,saves,messages,checks})};
}
test("an update found while playing never triggers a forced reload",async()=>{
  const r=await runRegistration(false);
  r.registration.waiting={postMessage:()=>{throw Error("unexpected activation")}};
  r.workerEvents.controllerchange();
  assert.equal(r.get().reloads,0);
  assert.equal(r.get().messages,0);
});
test("a previously downloaded update activates on a fresh launch",async()=>{
  const r=await runRegistration(true);
  assert.equal(r.get().messages,1);
  r.workerEvents.controllerchange();
  r.workerEvents.controllerchange();
  assert.equal(r.get().reloads,1);
  assert.ok(r.get().saves>=1);
});

test("a waiting update does not replace the app when gameplay has already started",async()=>{
  const r=await runRegistration(true,true,true);
  assert.equal(r.get().messages,0);
  r.workerEvents.controllerchange();
  assert.equal(r.get().reloads,0);
});
