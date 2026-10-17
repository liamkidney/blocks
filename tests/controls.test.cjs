const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");

function boot(){
  const source=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");
  const config=source.match(/^const REPEAT_DELAY=.*$/m)?.[0];
  const start=source.indexOf("// Held inputs repeat independently");
  const end=source.indexOf("board.addEventListener(\"pointerdown\"",start);
  assert.ok(config&&start>=0&&end>start,"control code should be discoverable");
  const logs=[],timers=new Map();
  let time=0,timerId=0;
  class Button{
    constructor(command,x,player=0){
      this.dataset={command,player:String(player)};
      this.listeners=new Map();
      this.classes=new Set();
      this.classList={
        contains:x=>this.classes.has(x),
        add:x=>this.classes.add(x),
        remove:x=>this.classes.delete(x),
      };
      this.rect={left:x,top:0,right:x+60,bottom:60};
    }
    addEventListener(event,fn){
      if(!this.listeners.has(event))this.listeners.set(event,[]);
      this.listeners.get(event).push(fn);
    }
    fire(event,details={}){
      for(const fn of this.listeners.get(event)||[])fn({
        pointerType:"mouse",button:0,pointerId:1,
        preventDefault(){},
        ...details
      });
    }
    getBoundingClientRect(){return this.rect;}
    setPointerCapture(id){this.captured=id;}
  }
  const buttons=[
    new Button("left",0),new Button("right",70),
    new Button("down",140),new Button("rotate_cw",210)
  ];
  const docListeners=new Map(),winListeners=new Map();
  const on=(map,name,fn)=>map.set(name,[...(map.get(name)||[]),fn]);
  const document={
    querySelectorAll:()=>buttons,
    addEventListener:(name,fn)=>on(docListeners,name,fn),
    elementFromPoint:(x,y)=>{
      const b=buttons.find(b=>x>=b.rect.left&&x<=b.rect.right&&y>=b.rect.top&&y<=b.rect.bottom);
      return b?{closest:()=>b}:null;
    }
  };
  const window={addEventListener:(name,fn)=>on(winListeners,name,fn)};
  const session={games:[{
    dropOne(){logs.push({command:"down",at:time});},
    press(command){logs.push({command,at:time});}
  }]};
  const context=vm.createContext({
    document,window,session,performance:{now:()=>time},
    setTimeout:(fn,delay)=>{
      const id=++timerId;
      timers.set(id,{fn,due:time+delay});
      return id;
    },
    clearTimeout:id=>timers.delete(id),
  });
  vm.runInContext(config+"\n"+source.slice(start,end),context,{filename:"input-controls"});
  function advance(ms){
    const target=time+ms;
    for(let steps=0;steps<200;steps++){
      const next=[...timers.entries()].sort((a,b)=>a[1].due-b[1].due)[0];
      if(!next||next[1].due>target)break;
      time=next[1].due;timers.delete(next[0]);next[1].fn();
    }
    time=target;
  }
  const contact=(identifier,x)=>({identifier,clientX:x,clientY:25});
  const send=(button,event,identifier,x)=>button.fire(event,{changedTouches:[contact(identifier,x)]});
  const notify=(map,name)=>{for(const fn of map.get(name)||[])fn();};
  return {buttons,logs,timers,advance,send,notify,docListeners,winListeners,
    context,now:()=>time};
}
const count=(logs,command)=>logs.filter(x=>x.command===command).length;

test("left/right repeat immediately, after 130ms, then every 50ms",()=>{
  const b=boot(),left=b.buttons[0];
  b.send(left,"touchstart",1,25);
  assert.equal(count(b.logs,"left"),1);
  b.advance(129);
  assert.equal(count(b.logs,"left"),1);
  b.advance(1);
  assert.equal(count(b.logs,"left"),2);
  b.advance(150);
  assert.equal(count(b.logs,"left"),5);
  b.send(left,"touchend",1,25);
  b.advance(300);
  assert.equal(count(b.logs,"left"),5);
  assert.equal(b.timers.size,0);
});

test("down repeats faster, and another finger can steer simultaneously",()=>{
  const b=boot(),[left,right,down]=b.buttons;
  b.send(down,"touchstart",5,165);
  b.send(right,"touchstart",6,95);
  b.advance(130);
  assert.equal(count(b.logs,"down"),2);
  assert.equal(count(b.logs,"right"),2);
  b.advance(140);
  assert.equal(count(b.logs,"down"),6); // t=130,165,200,235,270
  assert.equal(count(b.logs,"right"),4); // t=130,180,230
  b.send(right,"touchend",6,95);
  b.advance(70);
  assert.equal(count(b.logs,"right"),4);
  assert.equal(count(b.logs,"down"),8);
  b.send(down,"touchend",5,165);
  assert.equal(b.timers.size,0);
});

test("a held finger slides from left to right without lifting",()=>{
  const b=boot(),[left,right]=b.buttons;
  b.send(left,"touchstart",1,25);
  b.advance(40);
  b.send(left,"touchmove",1,95); // Delivered to original element.
  assert.equal(count(b.logs,"left"),1);
  assert.equal(count(b.logs,"right"),1);
  assert.equal(left.classList.contains("pressed"),false);
  assert.equal(right.classList.contains("pressed"),true);
  b.advance(130);
  assert.equal(count(b.logs,"left"),1);
  assert.equal(count(b.logs,"right"),2);
  b.send(left,"touchend",1,95);
  assert.equal(right.classList.contains("pressed"),false);
  assert.equal(b.timers.size,0);
});

test("two fingers on one button do not release each other's hold",()=>{
  const b=boot(),left=b.buttons[0];
  b.send(left,"touchstart",1,25);
  b.send(left,"touchstart",2,25);
  assert.equal(count(b.logs,"left"),1);
  b.send(left,"touchend",1,25);
  b.advance(130);
  assert.equal(count(b.logs,"left"),2);
  b.send(left,"touchend",2,25);
  b.advance(150);
  assert.equal(count(b.logs,"left"),2);
});

test("sliding through the gap between buttons uses a forgiving hit area",()=>{
  const b=boot(),[left,right]=b.buttons;
  b.send(left,"touchstart",1,25);
  b.send(left,"touchmove",1,67); // In the gap, closer to Right than Left
  assert.equal(count(b.logs,"left"),1);
  assert.equal(count(b.logs,"right"),1);
});

test("mouse pointer drag switches commands, and capture is cleaned up",()=>{
  const b=boot(),[left,right]=b.buttons;
  left.fire("pointerdown",{pointerId:3,clientX:20,clientY:20});
  assert.equal(left.captured,3);
  left.fire("pointermove",{pointerId:3,clientX:95,clientY:25});
  assert.deepEqual(b.logs.map(x=>x.command),["left","right"]);
  left.fire("pointerup",{pointerId:3});
  assert.equal(right.classList.contains("pressed"),false);
  assert.equal(b.timers.size,0);
});

test("synthetic pointer events after touch cannot trigger duplicate input",()=>{
  const b=boot(),left=b.buttons[0];
  b.send(left,"touchstart",1,25);
  left.fire("pointerdown",{pointerId:2,pointerType:"touch"});
  left.fire("pointerdown",{pointerId:3,pointerType:"mouse"});
  assert.equal(count(b.logs,"left"),1);
  b.send(left,"touchend",1,25);
  b.advance(800);
  left.fire("pointerdown",{pointerId:4,pointerType:"mouse"});
  assert.equal(count(b.logs,"left"),2);
  left.fire("pointerup",{pointerId:4,pointerType:"mouse"});
});

test("touchcancel, blur and hidden document stop held repeat timers",()=>{
  const b=boot(),left=b.buttons[0];
  b.send(left,"touchstart",1,25);
  b.send(left,"touchcancel",1,25);
  assert.equal(b.timers.size,0);
  b.send(left,"touchstart",2,25);
  b.notify(b.winListeners,"blur");
  assert.equal(b.timers.size,0);
  b.send(left,"touchstart",3,25);
  b.context.document.visibilityState="hidden";
  b.notify(b.docListeners,"visibilitychange");
  assert.equal(b.timers.size,0);
});
