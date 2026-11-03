const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'..','settings.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
const ACTIONS=['left','right','down','rotate_cw'];
const KEY='blocks:control-order:v1:/blocks/dev/';

function boot(saved=null){
  const storage=new Map();
  if(saved!==null)storage.set(KEY,saved);
  const byId=new Map();
  const listeners=new Map();
  const document={activeElement:null};
  class Element{
    constructor(){
      this.children=[];this.parentElement=null;this.dataset={};this.listeners={};
      this.className='';this.hidden=false;this.value='';this.disabled=false;
      this.attrs={};this._styleVars={};
      this.style={setProperty:(name,value)=>{this._styleVars[name]=String(value)}};
      this.classList={
        add:name=>{this.className+=' '+name},
        remove:name=>{this.className=this.className.split(' ').filter(x=>x!==name).join(' ')}
      };
    }
    setAttribute(key,value){this.attrs[key]=value}
    addEventListener(key,fn){this.listeners[key]=fn}
    appendChild(child){child.remove();this.children.push(child);child.parentElement=this}
    replaceChildren(...children){for(const child of this.children)child.parentElement=null;
      this.children=[];for(const child of children)this.appendChild(child)}
    remove(){if(!this.parentElement)return;const p=this.parentElement;
      p.children=p.children.filter(child=>child!==this);this.parentElement=null}
    querySelector(selector){return get(selector.slice(1))}
    getBoundingClientRect(){
      if(this===byId.get('settings-control-row'))return {left:0,top:0,width:300,height:66};
      const slot=this.parentElement?.className?.includes('settings-control-slot')
        ?this.parentElement:this;
      const i=slot.parentElement?.children.indexOf(slot)??0;
      return {left:i*77,top:0,width:69,height:66}
    }
    cloneNode(){const c=new Element();c.className=this.className;c.dataset={...this.dataset};return c}
    focus(){document.activeElement=this}
  }
  function get(id){if(!byId.has(id))byId.set(id,new Element());return byId.get(id)}
  document.body=new Element();
  document.createElement=()=>new Element();
  const buttons=ACTIONS.map(command=>{const b=new Element();b.dataset.command=command;return b});
  document.querySelectorAll=selector=>selector==='#controls button.control'?buttons:[];
  document.addEventListener=(key,fn)=>listeners.set('document:'+key,fn);
  const window={
    BLOCKS_CONFIG:{ghostPiece:false},BLOCKS_PLAYER_NAME:()=>'',BLOCKS_SAVE_PLAYER_NAME:async()=>{},
    dispatchEvent:()=>{},addEventListener:(key,fn)=>listeners.set('window:'+key,fn),
    getComputedStyle:()=>({columnGap:'9px'}),matchMedia:()=>({matches:false})
  };
  const sandbox={
    document,window,location:{pathname:'/blocks/dev/'},GAME_MODE_IDS:[0,1,2],
    GAME_MODES:{0:{label:'Beginner'},1:{label:'Easy'},2:{label:'Hard'}},
    DEFAULT_GAME_MODE:1,Notification:{permission:'default'},console,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,v)=>storage.set(key,String(v))},
    CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail}}
  };
  vm.runInNewContext(script,sandbox,{filename:'settings.js'});
  return {get,buttons,storage,window,listeners};
}
function order(b){return b.get('settings-control-row').children.map(slot=>slot.dataset.command)}
test('saved solo portrait order applies to existing game buttons without moving them',()=>{
  const b=boot(JSON.stringify(['rotate_cw','down','left','right']));
  assert.deepEqual(order(b),['rotate_cw','down','left','right']);
  assert.deepEqual(b.buttons.map(x=>x._styleVars['--portrait-control-order']),['2','3','1','0']);
});
test('invalid and duplicated control orders revert safely to defaults',()=>{
  for(const bad of ['not json','["left","left","down","rotate_cw"]','["left","right"]']){
    const b=boot(bad);assert.deepEqual(order(b),ACTIONS);
  }
});
test('keyboard arrows shift neighbours, save order and reset to default',()=>{
  const b=boot();
  const key=b.get('settings-control-row').children[0].children[0];
  let prevented=false;
  key.listeners.keydown({key:'ArrowRight',preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  assert.deepEqual(order(b),['right','left','down','rotate_cw']);
  assert.deepEqual(JSON.parse(b.storage.get(KEY)),order(b));
  assert.deepEqual(b.buttons.map(x=>x._styleVars['--portrait-control-order']),['1','0','2','3']);
  b.get('settings-control-reset').onclick();
  assert.deepEqual(order(b),ACTIONS);
  assert.equal(b.get('settings-control-reset').disabled,true);
});
test('touch dragging into fourth slot shifts neighbours and persists on release',()=>{
  const b=boot();
  b.window.BLOCKS_OPEN_SETTINGS();
  const key=b.get('settings-control-row').children[0].children[0];
  key.listeners.pointerdown({pointerId:7,pointerType:'touch',clientX:15,clientY:30,preventDefault(){}});
  b.listeners.get('window:pointermove')({pointerId:7,clientX:275,clientY:30,preventDefault(){}});
  b.listeners.get('window:pointerup')({pointerId:7});
  assert.deepEqual(order(b),['right','down','rotate_cw','left']);
  assert.deepEqual(JSON.parse(b.storage.get(KEY)),order(b));
});
test('canceled drag does not alter saved order',()=>{
  const b=boot();
  b.window.BLOCKS_OPEN_SETTINGS();
  b.get('settings-control-row').children[0].children[0].listeners.pointerdown({
    pointerId:8,pointerType:'touch',clientX:15,clientY:30,preventDefault(){}
  });
  b.listeners.get('window:pointermove')({pointerId:8,clientX:275,clientY:30,preventDefault(){}});
  b.listeners.get('window:pointercancel')({pointerId:8});
  assert.deepEqual(order(b),ACTIONS);
  assert.equal(b.storage.has(KEY),false);
});
test('CSS only reorders solo portrait, not landscape or multiplayer',()=>{
  assert.match(css,/@media\s*\(orientation:portrait\)[\s\S]*?body:not\(\.two-player\):not\(\.remote-multiplayer\) #controls \.control/);
  assert.match(css,/order:var\(--portrait-control-order,0\)/);
});
