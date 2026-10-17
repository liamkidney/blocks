const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

function setup(difficulty=2,options={}){
  const urls=[],removed=[],confirmations=[];
  const myId="11111111-1111-4111-8111-111111111111";
  const otherId="22222222-2222-4222-8222-222222222222";
  const sessions=(options.sessions||[]).map(x=>({...x}));
  class Element{
    constructor(){
      this.hidden=false;this.dataset={};this.attrs={};this.listeners={};
      this.children=[];this.style={};this.textContent="";this.disabled=false;
    }
    addEventListener(name,callback){this.listeners[name]=callback;}
    setAttribute(name,value){this.attrs[name]=value;}
    appendChild(child){this.children.push(child);}
    replaceChildren(){this.children=[];}
    focus(){}
  }
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,new Element());
    return elements.get(id);
  };
  const modes=[0,1,2].map(mode=>{
    const button=new Element();
    button.dataset.mode=String(mode);
    return button;
  });
  const overlay=new Element();
  overlay.querySelector=selector=>element(selector);
  overlay.querySelectorAll=selector=>selector==="#scores-mode-tabs button"?modes:[];
  const game={phase:"falling",difficulty};
  const sandbox={
    document:{
      getElementById:element,
      createElement:()=>new Element(),
      body:{appendChild(){}},
      addEventListener(){},
    },
    window:{
      BLOCKS_SCORE_OWNER:{
        ownedScoreIds:async()=>new Set(options.ownedIds||[]),
        removeScore:async id=>{
          removed.push(id);
          if(options.deleteFails)throw Error("Unauthorized");
          const score=sessions.find(s=>s.session_id===id);
          if(!score)return false;
          score.deleted=true;
          return true;
        },
      },
      confirm:message=>{confirmations.push(message);return options.confirmDelete!==false;},
    },
    localStorage:{getItem:key=>key==="blocks:player:v1"?JSON.stringify({player_id:myId}):null},
    game,session:{outcome:null},saveGame(){},
    togglePause(){game.phase=game.phase==="paused"?"falling":"paused";},
    performance:{now:()=>100},
    fetch:async url=>{
      urls.push(url);
      if(url.includes("/players?"))return {ok:true,json:async()=>[
        {player_id:myId,display_name:"Me"},
        {player_id:otherId,display_name:"Other"},
      ]};
      if(url.includes("/sessions?")){
        const mode=Number(new URL(url).searchParams.get("difficulty")?.replace("eq.",""));
        return {ok:true,json:async()=>sessions
          .filter(s=>s.difficulty===mode&&!s.deleted)
          .sort((a,b)=>b.score-a.score)
          .slice(0,10)};
      }
      throw Error("Unexpected URL "+url);
    },
    AbortController,
    setTimeout:()=>1,clearTimeout(){},
    console,
  };
  const context=vm.createContext(sandbox);
  const code=fs.readFileSync(path.join(__dirname,"..","high-scores.js"),"utf8");
  let firstElement=true;
  sandbox.document.createElement=()=>{
    if(firstElement){firstElement=false;return overlay;}
    return new Element();
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,"..","game-modes.js"),"utf8"),context,{filename:"game-modes.js"});
  vm.runInContext(code,context,{filename:"high-scores.js"});
  const tap=button=>{
    assert.equal(typeof button.listeners.touchstart,"function");
    button.listeners.touchstart({preventDefault(){}});
  };
  const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
  const rows=element("#scores-rows");
  const deleteButtons=()=>rows.children.flatMap(row=>row.children.flatMap(td=>td.children))
    .filter(child=>child.className==="score-delete-button");
  return {urls,overlay,modes,element,game,tap,flush,rows,deleteButtons,removed,confirmations,myId,otherId};
}
function entry(session_id,player_id,score,difficulty=2){
  return {session_id,player_id,score,difficulty,lines:3,status:"completed",
    updated_at:"2026-10-17T09:00:00Z"};
}

test("leaderboard opens on current game's difficulty",async()=>{
  const b=setup(2);
  b.tap(b.element("high-scores-button"));
  await b.flush();
  assert.equal(b.modes[2].attrs["aria-pressed"],"true");
  assert.equal(b.modes[0].attrs["aria-pressed"],"false");
  const url=b.urls.find(url=>url.includes("/sessions?"));
  assert.match(url,/difficulty=eq.2/);
  assert.match(url,/select=session_id,player_id/);
  assert.equal(b.element("#scores-status").textContent,"No HARD scores yet");
});

test("one touch switches to separately ranked server-side scoreboard",async()=>{
  const b=setup(1);
  b.tap(b.element("high-scores-button"));
  await b.flush();
  b.tap(b.modes[0]);
  await b.flush();
  const requests=b.urls.filter(url=>url.includes("/sessions?"));
  assert.match(requests[0],/difficulty=eq.1/);
  assert.match(requests[1],/difficulty=eq.0/);
  assert.match(requests[1],/order=score.desc&limit=10/);
  assert.ok(requests.every(url=>!url.includes("score=gte.")));
  assert.equal(b.modes[0].attrs["aria-pressed"],"true");
  assert.equal(b.element("#scores-status").textContent,"No BEGINNER scores yet");
});

test("reopening resets selector to game's difficulty",async()=>{
  const b=setup(2);
  b.tap(b.element("high-scores-button"));
  await b.flush();
  b.tap(b.modes[0]);
  await b.flush();
  b.tap(b.element("#scores-back"));
  b.game.difficulty=1;
  b.tap(b.element("high-scores-button"));
  await b.flush();
  const requests=b.urls.filter(url=>url.includes("/sessions?"));
  assert.match(requests.at(-1),/difficulty=eq.1/);
  assert.equal(b.modes[1].attrs["aria-pressed"],"true");
});

test("Beginner mode queries canonical integer 0",async()=>{
  const b=setup(0);
  b.tap(b.element("high-scores-button"));
  await b.flush();
  assert.match(b.urls.find(url=>url.includes("/sessions?")),/difficulty=eq.0/);
});

test("trash icon needs BOTH matching player ID and verified key; older scores have none",async()=>{
  const mine="33333333-3333-4333-8333-333333333333";
  const spoofed="44444444-4444-4444-8444-444444444444";
  const other="55555555-5555-4555-8555-555555555555";
  const b=setup(2,{sessions:[
    entry(mine,"11111111-1111-4111-8111-111111111111",1000),
    entry(spoofed,"22222222-2222-4222-8222-222222222222",900),
    entry(other,"11111111-1111-4111-8111-111111111111",800)
  ],ownedIds:[mine,spoofed]});
  b.tap(b.element("high-scores-button"));
  await b.flush();
  assert.equal(b.rows.children.length,3);
  const buttons=b.deleteButtons();
  assert.equal(buttons.length,1);
  assert.match(buttons[0].attrs["aria-label"],/Delete your score of 1,000 points/);
});

test("confirmed delete removes owned score and refills leaderboard; declined delete does not",async()=>{
  const id="33333333-3333-4333-8333-333333333333";
  const score=entry(id,"11111111-1111-4111-8111-111111111111",1000);
  const declined=setup(2,{sessions:[score],ownedIds:[id],confirmDelete:false});
  declined.tap(declined.element("high-scores-button"));await declined.flush();
  declined.tap(declined.deleteButtons()[0]);await declined.flush();
  assert.equal(declined.removed.length,0);
  assert.equal(declined.rows.children.length,1);

  const accepted=setup(2,{sessions:[score],ownedIds:[id]});
  accepted.tap(accepted.element("high-scores-button"));await accepted.flush();
  accepted.tap(accepted.deleteButtons()[0]);
  await accepted.flush();await accepted.flush();
  assert.deepEqual(accepted.removed,[id]);
  assert.equal(accepted.rows.children.length,0);
  assert.equal(accepted.element("#scores-status").textContent,"No HARD scores yet");
});

test("failed removal preserves row and allows retry",async()=>{
  const id="33333333-3333-4333-8333-333333333333";
  const b=setup(2,{sessions:[entry(id,"11111111-1111-4111-8111-111111111111",1000)],
    ownedIds:[id],deleteFails:true});
  b.tap(b.element("high-scores-button"));await b.flush();
  b.tap(b.deleteButtons()[0]);await b.flush();
  assert.equal(b.rows.children.length,1);
  assert.equal(b.deleteButtons()[0].disabled,false);
  assert.match(b.element("#scores-status").textContent,/Could not delete/);
});
