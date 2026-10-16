// Regression tests for the start/restart selector interaction without a browser dependency.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

function boot(savedMode=null){
  const storage=new Map(savedMode?[["blocks:difficulty:v1:/blocks/dev/",savedMode]]:[]);
  const sessionData=new Map();
  class Element{
    constructor(id=""){this.id=id;this.hidden=false;this.dataset={};this.style={};this.attrs={};this.listeners={};this.children=[];this.classList={contains:()=>false,add:()=>{},remove:()=>{},toggle:()=>{}};}
    addEventListener(event,callback){this.listeners[event]=callback;}
    append(...children){this.children.push(...children);}
    appendChild(child){this.children.push(child);}
    setAttribute(key,value){this.attrs[key]=value;}
    focus(){}
    querySelectorAll(){return [];}
    querySelector(){return null;}
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
    document,window:{BLOCKS_CONFIG:{},addEventListener:()=>{},dispatchEvent:()=>{}},
    location:{pathname:"/blocks/dev/",search:"",href:"https://example.test/blocks/dev/"},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem:k=>sessionData.get(k)||null,setItem:(k,v)=>sessionData.set(k,String(v)),removeItem:k=>sessionData.delete(k)},
    performance:{now:()=>100},navigator:{},requestAnimationFrame:()=>{},
    URLSearchParams,URL,Event,
  };
  const context=vm.createContext(sandbox);
  for(const file of ["tetrominoes.js","game.js","session.js","app.js"]){
    vm.runInContext(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),context,{filename:file});
  }
  function tap(id){
    const fn=get(id).listeners.touchstart;
    assert.equal(typeof fn,"function",id+" touch handler");
    fn({preventDefault(){}});
  }
  function evaluate(expression){return vm.runInContext(expression,context);}
  return {get,tap,evaluate,storage};
}

test("fresh start shows choices without beginning the game",()=>{
  const b=boot();
  assert.equal(b.evaluate("game.phase"),"paused");
  assert.equal(b.evaluate("restartDialog.hidden"),false);
  assert.equal(b.get("restart-cancel").hidden,true);
  assert.equal(b.get("restart-one").attrs["aria-pressed"],"true");
  b.tap("difficulty-hard");
  assert.equal(b.get("difficulty-hard").attrs["aria-pressed"],"true");
  assert.equal(b.evaluate("game.phase"),"paused"); // Selection alone never starts the game.
  b.tap("restart-start");
  assert.equal(b.evaluate("game.phase"),"falling");
  assert.equal(b.evaluate("game.difficulty"),"hard");
  assert.equal(b.evaluate("restartDialog.hidden"),true);
});
test("fixed mode and preference persist into a fresh start",()=>{
  const b=boot("hard");
  assert.equal(b.get("difficulty-hard").attrs["aria-pressed"],"true");
  b.tap("difficulty-fixed");
  assert.equal(b.get("difficulty-fixed").attrs["aria-pressed"],"true");
  b.tap("restart-start");
  assert.equal(b.evaluate("game.difficulty"),"fixed");
  assert.equal(b.storage.get("blocks:difficulty:v1:/blocks/dev/"),"fixed");
});
test("restarting is a separate confirmation, and cancel preserves game",()=>{
  const b=boot();
  b.tap("restart-start");
  const before=b.evaluate("game");
  b.evaluate("restartGame()");
  assert.equal(b.evaluate("restartDialog.hidden"),false);
  b.tap("difficulty-hard");
  assert.equal(b.evaluate("game.difficulty"),"easy");
  b.tap("restart-cancel");
  assert.equal(b.evaluate("game"),before);
  assert.equal(b.evaluate("game.phase"),"falling");
  assert.equal(b.evaluate("restartDialog.hidden"),true);
});
