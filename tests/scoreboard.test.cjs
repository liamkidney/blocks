const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

function setup(difficulty="hard"){
  const urls=[];
  class Element{
    constructor(){
      this.hidden=false;this.dataset={};this.attrs={};this.listeners={};
      this.children=[];this.style={};this.textContent="";
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
  const modes=["fixed","easy","hard"].map(mode=>{
    const button=new Element();
    button.dataset.mode=mode;
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
    game,session:{outcome:null},saveGame(){},
    togglePause(){game.phase=game.phase==="paused"?"falling":"paused";},
    performance:{now:()=>100},
    fetch:async url=>{
      urls.push(url);
      if(url.includes("/players?"))return {ok:true,json:async()=>[]};
      if(url.includes("/sessions?"))return {ok:true,json:async()=>[]};
      throw Error("Unexpected URL "+url);
    },
    AbortController,
    setTimeout:()=>1,clearTimeout(){},
    console,
  };
  const context=vm.createContext(sandbox);
  const code=fs.readFileSync(path.join(__dirname,"..","high-scores.js"),"utf8");
  // The overlay element needs to be returned from createElement('div').
  sandbox.document.createElement=()=>overlay;
  vm.runInContext(code,context,{filename:"high-scores.js"});
  const tap=button=>button.listeners.touchstart({preventDefault(){}});
  const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
  return {urls,overlay,modes,element,game,tap,flush};
}

test("leaderboard opens on the current game's difficulty",async()=>{
  const b=setup("hard");
  b.tap(b.element("high-scores-button"));
  await b.flush();
  assert.equal(b.modes[2].attrs["aria-pressed"],"true");
  assert.equal(b.modes[0].attrs["aria-pressed"],"false");
  assert.match(b.urls.find(url=>url.includes("/sessions?")),/difficulty=eq.hard/);
  assert.equal(b.element("#scores-status").textContent,"No HARD scores yet");
});
test("one touch switches to a separately ranked server-side scoreboard",async()=>{
  const b=setup("easy");
  b.tap(b.element("high-scores-button"));
  await b.flush();
  b.tap(b.modes[0]);
  await b.flush();
  const requests=b.urls.filter(url=>url.includes("/sessions?"));
  assert.match(requests[0],/difficulty=eq.easy/);
  assert.match(requests[1],/difficulty=eq.fixed/);
  assert.match(requests[1],/order=score.desc&limit=10/);
  assert.equal(b.modes[0].attrs["aria-pressed"],"true");
  assert.equal(b.modes[1].attrs["aria-pressed"],"false");
  assert.equal(b.element("#scores-status").textContent,"No FIXED scores yet");
});
test("reopening leaderboard resets the selector to the game difficulty",async()=>{
  const b=setup("hard");
  b.tap(b.element("high-scores-button"));
  await b.flush();
  b.tap(b.modes[0]);
  await b.flush();
  b.tap(b.element("#scores-back"));
  b.game.difficulty="easy";
  b.tap(b.element("high-scores-button"));
  await b.flush();
  const requests=b.urls.filter(url=>url.includes("/sessions?"));
  assert.match(requests.at(-1),/difficulty=eq.easy/);
  assert.equal(b.modes[1].attrs["aria-pressed"],"true");
  assert.equal(b.modes[0].attrs["aria-pressed"],"false");
});
