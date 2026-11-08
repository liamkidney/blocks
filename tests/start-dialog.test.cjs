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
  for(const file of ["game-modes.js","tetrominoes.js","game.js","session.js","board-renderer.js","control-layout.js","app.js"]){
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

test("New Game uses a Back arrow for rules and an X to close active-game setup",()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  assert.match(source,/id="restart-back"[^>]*>←<\/button>/);
  assert.match(source,/id="restart-cancel"[^>]*>×<\/button>/);
  assert.match(css,/#restart-dialog \.restart-panel \.restart-back\{left:8px\}/);
  assert.match(css,/#restart-dialog \.restart-panel \.restart-cancel\{right:8px\}/);
});

test("fresh start shows choices without beginning the game",()=>{
  const b=boot();
  assert.equal(b.evaluate("game.phase"),"paused");
  assert.equal(b.evaluate("restartDialog.hidden"),false);
  assert.equal(b.get("restart-cancel").hidden,true);
  assert.equal(b.get("restart-mode-screen").hidden,false);
  assert.equal(b.get("restart-rules-screen").hidden,true);
  b.tap("restart-one");
  assert.equal(b.get("restart-rules-screen").hidden,false);
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
  b.tap("restart-one");
  assert.equal(b.get("difficulty-2").attrs["aria-pressed"],"true");
  b.tap("difficulty-0");
  assert.equal(b.get("difficulty-0").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("game.difficulty"),0);
  assert.equal(b.storage.get("blocks:difficulty:v1:/blocks/dev/"),"0");
});
test("restarting is a separate confirmation, and cancel preserves game",()=>{
  const b=boot();
  b.tap("restart-one");
  b.tap("restart-start");
  const before=b.evaluate("game");
  b.evaluate("restartGame()");
  assert.equal(b.get("restart-mode-screen").hidden,false);
  b.tap("restart-one");
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
  b.tap("restart-one");
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
  b.tap("restart-one");
  assert.equal(b.get("ghost-on").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),true);
  b.evaluate("restartGame()");
  b.tap("restart-one");
  b.tap("ghost-off");
  assert.equal(b.get("ghost-off").attrs["aria-pressed"],"true");
  b.tap("restart-cancel");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),true);
  assert.equal(b.get("ghost-on").attrs["aria-pressed"],"true");
  assert.equal(b.storage.get("blocks:ghost:v1:/blocks/dev/"),"true");
  b.evaluate("restartGame()");
  b.tap("restart-one");
  b.tap("ghost-off");
  b.tap("restart-start");
  assert.equal(b.evaluate("window.BLOCKS_CONFIG.ghostPiece"),false);
  assert.equal(b.storage.get("blocks:ghost:v1:/blocks/dev/"),"false");
});

test("an old saved fixed difficulty preference opens as Beginner",()=>{
  const b=boot("fixed");
  b.tap("restart-one");
  assert.equal(b.get("difficulty-0").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("game.difficulty"),0);
  assert.equal(b.storage.get("blocks:difficulty:v1:/blocks/dev/"),"0");
});

test("numeric difficulty preferences are restored as numeric IDs",()=>{
  const b=boot("2");
  b.tap("restart-one");
  assert.equal(b.get("difficulty-2").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("game.difficulty"),2);
  assert.equal(b.storage.get("blocks:difficulty:v1:/blocks/dev/"),"2");
});

test("Play Together opens multiplayer directly without asking a guest for rules",()=>{
  const b=boot("hard",true);
  assert.equal(b.get('restart-mode-screen').hidden,false);
  b.tap('restart-remote');
  assert.equal(b.evaluate('location.href'),
    'https://example.test/blocks/dev/?remote=1');
  assert.equal(b.get('restart-rules-screen').hidden,true);
  assert.equal(b.storage.get('blocks:difficulty:v1:/blocks/dev/'),'hard',
    'joining route must not persist a new difficulty');
  assert.equal(b.storage.get('blocks:ghost:v1:/blocks/dev/'),'true');
});

test("solo and one-phone game modes both show shared rules before starting",()=>{
  const solo=boot();
  solo.tap('restart-one');
  assert.equal(solo.get('restart-rules-screen').hidden,false);
  assert.equal(solo.get('restart-mode-screen').hidden,true);
  solo.tap('restart-back');
  assert.equal(solo.get('restart-mode-screen').hidden,false);
  const local=boot();
  local.tap('restart-two');
  assert.equal(local.get('restart-rules-screen').hidden,false);
  assert.equal(local.get('restart-mode-screen').hidden,true);
});

test("New Game Settings entry is callable without starting gameplay",()=>{
  const b=boot();
  let calls=0;
  b.evaluate('window.BLOCKS_OPEN_SETTINGS=()=>{window.__settingsCalls=(window.__settingsCalls||0)+1}');
  b.tap('restart-settings');
  assert.equal(b.evaluate('window.__settingsCalls'),1);
  assert.equal(b.evaluate('game.phase'),'paused');
});

test("High Scores is accessible from New Game and returns to the mode menu",()=>{
  const b=boot();
  b.evaluate('window.BLOCKS_OPEN_HIGH_SCORES=back=>{window.__backFromScores=back}');
  b.tap('restart-high-scores');
  assert.equal(b.evaluate('restartDialog.hidden'),true);
  b.evaluate('window.__backFromScores()');
  assert.equal(b.evaluate('restartDialog.hidden'),false);
  assert.equal(b.get('restart-mode-screen').hidden,false);
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
  assert.equal(b.evaluate('session.config.ghostPiece'),false);
  assert.equal(b.evaluate('game.difficulty'),1);
  assert.deepEqual(JSON.parse(JSON.stringify(b.evaluate('session.config.allowedPieces'))),['I','O']);
  assert.equal(b.storage.get('blocks:ghost:v1:/blocks/dev/'),'true');
});
