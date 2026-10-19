const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const code=fs.readFileSync(path.join(__dirname,"..","score-sync.js"),"utf8");
const key="blocks:score-outbox:v1:/blocks/dev/";
const playerKey="blocks:player:v1";
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve))};

function boot(storage,{online=false,initialStart=false,fetch=async()=>{throw Error("offline")}}={}){
  const events={},docEvents={},navigator={onLine:online};
  let counter=0,tick;
  const game={phase:"falling",score:30,lines:2,difficulty:1};
  const window={
    BLOCKS_CONFIG:{ghostPiece:false},BLOCKS_AWAITING_START:initialStart,
    addEventListener:(type,fn)=>{events[type]=fn}
  };
  const localStorage={
    getItem:k=>storage.get(k)??null,
    setItem:(k,v)=>storage.set(k,String(v)),
    removeItem:k=>storage.delete(k)
  };
  const context=vm.createContext({
    TWO_PLAYER:false,storedSessionId:null,
    game,window,localStorage,location:{pathname:"/blocks/dev/",search:""},
    navigator,crypto:{randomUUID:()=>String(++counter)+"-session"},
    URLSearchParams,fetch,setInterval:fn=>{tick=fn},
    document:{addEventListener:(type,fn)=>{docEvents[type]=fn}},
    console,Date
  });
  vm.runInContext(code,context,{filename:"score-sync.js"});
  return {game,window,navigator,events,docEvents,tick,
    outbox:()=>JSON.parse(storage.get(key)||"[]")};
}

test("a game completed in airplane mode survives app termination",async()=>{
  const storage=new Map([[playerKey,JSON.stringify({player_id:"player-one"})]]);
  const offline=boot(storage);
  assert.equal(offline.outbox().length,1);
  offline.game.score=900;offline.game.lines=9;offline.game.phase="game_over";
  offline.window.BLOCKS_QUEUE_SCORE("completed",true);
  const persisted=offline.outbox();
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].status,"completed");
  assert.equal(persisted[0].score,900);
  assert.equal(persisted[0].lines,9);

  const uploaded=[];
  const online=boot(storage,{online:true,initialStart:true,fetch:async(url,options={})=>{
    if(!options.method)return {ok:true,json:async()=>[]};
    if(options.method==="POST"){uploaded.push(JSON.parse(options.body));return {ok:true}}
    return {ok:true};
  }});
  online.window.BLOCKS_AWAITING_START=false;
  online.events.online();
  await flush();
  assert.equal(uploaded.length,1);
  assert.equal(uploaded[0].status,"completed");
  assert.equal(uploaded[0].score,900);
  assert.equal(online.outbox().length,0);
});

test("restarting offline retains the abandoned session separately",()=>{
  const storage=new Map([[playerKey,JSON.stringify({player_id:"player-one"})]]);
  const instance=boot(storage);
  const oldId=instance.window.BLOCKS_SESSION_ID;
  instance.events["blocks:restart"]();
  const abandoned=instance.outbox().find(item=>item.session_id===oldId);
  assert.equal(abandoned.status,"abandoned");
  assert.notEqual(instance.window.BLOCKS_SESSION_ID,oldId);
  instance.window.BLOCKS_QUEUE_SCORE("active");
  const records=instance.outbox();
  assert.equal(records.length,2);
  assert.equal(records.find(item=>item.session_id===oldId).status,"abandoned");
});

test("failed uploads remain durable and can be retried later",async()=>{
  const storage=new Map([[playerKey,JSON.stringify({player_id:"player-one"})]]);
  const instance=boot(storage);
  instance.game.score=125;
  instance.window.BLOCKS_QUEUE_SCORE("completed");
  instance.navigator.onLine=true;
  instance.events.online();
  await flush();
  assert.equal(instance.outbox()[0].score,125);
  assert.equal(instance.outbox()[0].status,"completed");
});


test("restarting a completed game preserves its completed result",()=>{
  const storage=new Map([[playerKey,JSON.stringify({player_id:"player-one"})]]);
  const instance=boot(storage);
  const oldId=instance.window.BLOCKS_SESSION_ID;
  instance.game.phase="game_over";
  instance.game.score=725;
  instance.window.BLOCKS_QUEUE_SCORE("completed",true);
  instance.events["blocks:restart"]();
  const completed=instance.outbox().find(item=>item.session_id===oldId);
  assert.equal(completed.status,"completed");
  assert.equal(completed.score,725);
});
