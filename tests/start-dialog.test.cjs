// Regression tests for the start/restart selector interaction without a browser dependency.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

function boot(savedMode=null,savedGhost=null,options={}){
  const storage=new Map();
  if(savedMode!==null)storage.set("blocks:difficulty:v1:/blocks/dev/",savedMode);
  if(savedGhost!==null)storage.set("blocks:ghost:v1:/blocks/dev/",String(savedGhost));
  if(options.savedRemote)
    storage.set("blocks:remote-match:/blocks/dev/",JSON.stringify(options.savedRemote));
  const sessionData=new Map(),windowListeners=new Map();
  class Element{
    constructor(id=""){this.id=id;this.hidden=false;this.dataset={};this.style={};this.attrs={};this.listeners={};this.children=[];this.classList={contains:()=>false,add:()=>{},remove:()=>{},toggle:()=>{}};}
    addEventListener(event,callback){this.listeners[event]=callback;}
    append(...children){this.children.push(...children);}
    appendChild(child){this.children.push(child);}
    insertBefore(child,before){
      const index=this.children.indexOf(before);
      if(index<0)this.children.push(child);
      else this.children.splice(index,0,child);
    }
    setAttribute(key,value){this.attrs[key]=value;}
    focus(){}
    querySelectorAll(){return [];}
    querySelector(){return new Element();}
  }
  const elements=new Map();
  const get=id=>{
    if(!elements.has(id))elements.set(id,new Element(id));
    return elements.get(id);
  };
  const document={
    getElementById:get,createElement:()=>new Element(),
    querySelectorAll:()=>[],addEventListener:()=>{},body:new Element("body")
  };
  get("board").parentElement=new Element("board-frame");
  const sandbox={
    document,window:{
      BLOCKS_CONFIG:{},
      addEventListener:(event,fn)=>{
        if(!windowListeners.has(event))windowListeners.set(event,[]);
        windowListeners.get(event).push(fn);
      },
      dispatchEvent:event=>{
        for(const fn of windowListeners.get(event.type)||[])fn(event);
      }
    },
    location:{pathname:"/blocks/dev/",search:options.remote?"?remote=1":"",
      href:"https://example.test/blocks/dev/"},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem:k=>sessionData.get(k)||null,setItem:(k,v)=>sessionData.set(k,String(v)),removeItem:k=>sessionData.delete(k)},
    performance:{now:()=>100},navigator:{},requestAnimationFrame:()=>{},
    URLSearchParams,URL,Event,
  };
  const context=vm.createContext(sandbox);
  for(const file of ["game-modes.js","tetrominoes.js","game.js","session.js","board-renderer.js","app.js"]){
    vm.runInContext(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),context,{filename:file});
  }
  function tap(id){
    const fn=get(id).listeners.touchstart;
    assert.equal(typeof fn,"function",id+" touch handler");
    fn({preventDefault(){}});
  }
  function evaluate(expression){return vm.runInContext(expression,context);}
  function dispatch(type,detail){
    for(const fn of windowListeners.get(type)||[])fn({type,detail});
  }
  return {get,tap,evaluate,storage,dispatch};
}

test("fresh start shows choices without beginning the game",()=>{
  const b=boot();
  assert.equal(b.evaluate("game.phase"),"paused");
  assert.equal(b.evaluate("restartDialog.hidden"),false);
  assert.equal(b.get("restart-cancel").hidden,true);
  assert.equal(b.get("restart-one").attrs["aria-pressed"],"true");
  b.tap("difficulty-2");
  assert.equal(b.get("difficulty-2").attrs["aria-pressed"],"true");
  assert.equal(b.evaluate("game.phase"),"paused"); // Selection alone never starts the game.
  b.tap("restart-start");
  assert.equal(b.evaluate("game.phase"),"falling");
  assert.equal(b.evaluate("game.difficulty"),2);
  assert.equal(b.evaluate("restartDialog.hidden"),true);
});
test("beginner mode and preference persist into a fresh start",()=>{
  const b=boot("hard");
  assert.equal(b.get("difficulty-2").attrs["aria-pressed"],"true");
  b.tap("difficulty-0");
  assert.equal(b.get("difficulty-0").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("game.difficulty"),0);
  assert.equal(b.storage.get("blocks:difficulty:v1:/blocks/dev/"),"0");
});
test("restarting is a separate confirmation, and cancel preserves game",()=>{
  const b=boot();
  b.tap("restart-start");
  const before=b.evaluate("game");
  b.evaluate("restartGame()");
  assert.equal(b.evaluate("restartDialog.hidden"),false);
  b.tap("difficulty-2");
  assert.equal(b.evaluate("game.difficulty"),1);
  b.tap("restart-cancel");
  assert.equal(b.evaluate("game"),before);
  assert.equal(b.evaluate("game.phase"),"falling");
  assert.equal(b.evaluate("restartDialog.hidden"),true);
});

test("ghost selector applies only when starting a game and remembers On",()=>{
  const b=boot();
  assert.equal(b.get("ghost-off").attrs["aria-pressed"],"true");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),false);
  b.tap("ghost-on");
  assert.equal(b.get("ghost-on").attrs["aria-pressed"],"true");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),false);
  b.tap("restart-start");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),true);
  assert.equal(b.storage.get("blocks:ghost:v1:/blocks/dev/"),"true");
});
test("ghost selection persists and cancelling a restart restores active preference",()=>{
  const b=boot(null,true);
  assert.equal(b.get("ghost-on").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),true);
  b.evaluate("restartGame()");
  b.tap("ghost-off");
  assert.equal(b.get("ghost-off").attrs["aria-pressed"],"true");
  b.tap("restart-cancel");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),true);
  assert.equal(b.get("ghost-on").attrs["aria-pressed"],"true");
  assert.equal(b.storage.get("blocks:ghost:v1:/blocks/dev/"),"true");
  b.evaluate("restartGame()");
  b.tap("ghost-off");
  b.tap("restart-start");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),false);
  assert.equal(b.storage.get("blocks:ghost:v1:/blocks/dev/"),"false");
});

test("an old saved fixed difficulty preference opens as Beginner",()=>{
  const b=boot("fixed");
  assert.equal(b.get("difficulty-0").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("game.difficulty"),0);
  assert.equal(b.storage.get("blocks:difficulty:v1:/blocks/dev/"),"0");
});

test("numeric difficulty preferences are restored as numeric IDs",()=>{
  const b=boot("2");
  assert.equal(b.get("difficulty-2").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("game.difficulty"),2);
  assert.equal(b.storage.get("blocks:difficulty:v1:/blocks/dev/"),"2");
});

test("two-phone reconnect starts with the creator's saved Ghost Piece rule",()=>{
  const b=boot(0,false,{
    remote:true,
    savedRemote:{
      id:'room',token:'token',player:2,round:1,difficulty:2,
      piece_set:'IO',ghost_piece:true
    }
  });
  assert.equal(b.evaluate('window.BLOCKS_CONFIG.ghostPiece'),true);
  assert.equal(b.evaluate('session.config.ghostPiece'),true);
  assert.equal(b.evaluate('game.difficulty'),2);
  assert.deepEqual(JSON.parse(JSON.stringify(b.evaluate('session.config.allowedPieces'))),['I','O']);
  assert.equal(b.evaluate('window.BLOCKS_REMOTE_LOCAL_CONFIG.ghost_piece'),false,
    'guest host-config override must not overwrite their own saved preference');
});

test("incoming room Ghost Piece overrides the guest without rewriting local preference",()=>{
  const b=boot(2,true,{remote:true});
  assert.equal(b.evaluate('window.BLOCKS_CONFIG.ghostPiece'),true);
  b.dispatch('blocks:remote-config',{
    difficulty:1,piece_set:'IO',ghost_piece:false
  });
  assert.equal(b.evaluate('window.BLOCKS_CONFIG.ghostPiece'),false);
  assert.equal(b.evaluate('game.difficulty'),1);
  assert.deepEqual(JSON.parse(JSON.stringify(b.evaluate('session.config.allowedPieces'))),['I','O']);
  assert.equal(b.storage.get('blocks:ghost:v1:/blocks/dev/'),'true');
});
