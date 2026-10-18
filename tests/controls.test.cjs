const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");

function boot(){
  const source=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");
  const config=source.match(/^const REPEAT_DELAY=.*$/m)?.[0];
  const start=source.indexOf("// Held inputs repeat independently");
  const end=source.indexOf('board.addEventListener("pointerdown"',start);
  assert.ok(config&&start>=0&&end>start,"control code should be discoverable");
  const logs=[],timers=new Map();
  let time=0,timerId=0;
  class Pad {
    constructor(id){this.id=id;this.buttons=[];}
    closest(selector){
      return selector.includes("#controls,#player-two-controls")?this:null;
    }
    querySelectorAll(){return this.buttons;}
    setPointerCapture(id){this.captured=id;}
  }
  class Button {
    constructor(command,x,player=0,pad){
      this.dataset={command,player:String(player)};
      this.classes=new Set();
      this.classList={
        contains:x=>this.classes.has(x),
        add:x=>this.classes.add(x),
        remove:x=>this.classes.delete(x)
      };
      this.pad=pad;
      this.rect={left:x,top:0,right:x+60,bottom:60,width:60,height:60};
    }
    closest(selector){
      if(selector===".control")return this;
      if(selector.includes("#controls,#player-two-controls"))return this.pad;
      return null;
    }
    getBoundingClientRect(){return this.rect;}
    setPointerCapture(id){this.captured=id;}
  }
  const pad=new Pad("controls");
  const buttons=[
    new Button("left",0,0,pad),new Button("right",70,0,pad),
    new Button("down",140,0,pad),new Button("rotate_cw",210,0,pad)
  ];
  pad.buttons=buttons;
  const docListeners=new Map(),winListeners=new Map();
  const on=(map,name,fn)=>map.set(name,[...(map.get(name)||[]),fn]);
  const document={
    querySelectorAll:()=>buttons,
    getElementById:id=>id==="controls"?pad:null,
    addEventListener:(name,fn)=>on(docListeners,name,fn)
  };
  const window={addEventListener:(name,fn)=>on(winListeners,name,fn)};
  const session={games:[0,1].map(player=>({
    dropOne(){logs.push({command:"down",player,at:time});},
    press(command){logs.push({command,player,at:time});}
  }))};
  const context=vm.createContext({
    document,window,session,performance:{now:()=>time},
    setTimeout:(fn,delay)=>{
      const id=++timerId;
      timers.set(id,{fn,due:time+delay});
      return id;
    },
    clearTimeout:id=>timers.delete(id)
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
  const touch=(identifier,x,y=25)=>({identifier,clientX:x,clientY:y});
  function dispatch(name,target,details){
    let prevented=false;
    const event={
      target,pointerType:"mouse",button:0,pointerId:1,
      clientX:0,clientY:25,changedTouches:[],
      preventDefault(){prevented=true;},
      ...details
    };
    for(const fn of docListeners.get(name)||[])fn(event);
    return prevented;
  }
  const send=(target,event,identifier,x,y=25)=>dispatch(event,target,{
    changedTouches:[touch(identifier,x,y)]
  });
  const pointer=(target,event,id,x,y=25,extra={})=>dispatch(event,target,{
    pointerId:id,clientX:x,clientY:y,...extra
  });
  const notify=(map,name)=>{for(const fn of map.get(name)||[])fn();};
  function addPlayerTwo(){
    const p2=new Pad("player-two-controls");
    const controls=[
      new Button("left",450,1,p2),new Button("right",520,1,p2),
      new Button("down",590,1,p2),new Button("rotate_cw",660,1,p2)
    ];
    p2.buttons=controls;
    vm.runInContext("bindGameControls",context)(p2);
    return {pad:p2,buttons:controls};
  }
  return {buttons,pad,logs,timers,advance,send,pointer,dispatch,notify,
    addPlayerTwo,docListeners,winListeners,context,now:()=>time};
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
  assert.equal(count(b.logs,"down"),6);
  assert.equal(count(b.logs,"right"),4);
  b.send(right,"touchend",6,95);
  b.advance(70);
  assert.equal(count(b.logs,"right"),4);
  assert.equal(count(b.logs,"down"),8);
  b.send(down,"touchend",5,165);
  assert.equal(b.timers.size,0);
});

test("a held finger slides left to right without lifting",()=>{
  const b=boot(),[left,right]=b.buttons;
  b.send(left,"touchstart",1,25);
  b.advance(40);
  b.send(left,"touchmove",1,95);
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

test("moving outside all controls and back REACQUIRES the same held button",()=>{
  const b=boot(),left=b.buttons[0];
  b.send(left,"touchstart",23,25);
  b.advance(75);
  b.send(left,"touchmove",23,-150);
  assert.equal(left.classList.contains("pressed"),false);
  b.advance(500);
  assert.equal(count(b.logs,"left"),1);
  b.send(left,"touchmove",23,25);
  assert.equal(count(b.logs,"left"),2);
  assert.equal(left.classList.contains("pressed"),true);
  b.advance(130);
  assert.equal(count(b.logs,"left"),3);
  b.send(left,"touchend",23,25);
  assert.equal(b.timers.size,0);
});

test("a touch STARTING in portrait gap immediately acquires nearest control",()=>{
  const b=boot();
  const handled=b.send(b.pad,"touchstart",24,67);
  assert.equal(handled,true);
  assert.equal(count(b.logs,"right"),1);
  assert.equal(b.buttons[1].classList.contains("pressed"),true);
  b.advance(130);
  assert.equal(count(b.logs,"right"),2);
  b.send(b.pad,"touchend",24,67);
  assert.equal(b.timers.size,0);
});

test("touch STARTING in 60px landscape gap finds the nearer button",()=>{
  const b=boot();
  b.buttons[1].rect={left:120,top:0,right:180,bottom:60,width:60,height:60};
  b.send(b.pad,"touchstart",25,92);
  assert.equal(count(b.logs,"right"),1);
  assert.equal(count(b.logs,"left"),0);
  b.send(b.pad,"touchend",25,92);
});

test("a gap touch far from all keys remains tracked for later acquisition",()=>{
  const b=boot();
  b.send(b.pad,"touchstart",26,-1000);
  assert.equal(b.logs.length,0);
  b.send(b.pad,"touchmove",26,95);
  assert.equal(count(b.logs,"right"),1);
  b.send(b.pad,"touchend",26,95);
  assert.equal(b.timers.size,0);
});

test("a touch beginning near a button edge but outside the pad is accepted",()=>{
  const b=boot();
  const neutral={closest:()=>null};
  const handled=b.send(neutral,"touchstart",27,-20);
  assert.equal(handled,true);
  assert.equal(count(b.logs,"left"),1);
  b.send(neutral,"touchend",27,-20);
});

test("a press on the board or an unrelated button is never stolen",()=>{
  const b=boot();
  const board={closest:selector=>selector.includes("#board-frame")?board:null};
  const otherButton={closest:selector=>selector.includes("button,a,input")?otherButton:null};
  assert.equal(b.send(board,"touchstart",21,25),false);
  assert.equal(b.send(otherButton,"touchstart",22,25),false);
  assert.equal(b.logs.length,0);
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

test("a finger on one player's pad cannot operate the other player's keys",()=>{
  const b=boot();
  const two=b.addPlayerTwo();
  b.send(b.buttons[0],"touchstart",31,25);
  b.send(two.pad,"touchstart",32,540);
  assert.deepEqual(b.logs.map(e=>[e.player,e.command]),[[0,"left"],[1,"right"]]);
  b.send(b.buttons[0],"touchmove",31,540);
  assert.equal(b.logs.length,2,"player-one finger does not transfer to player two");
  b.send(b.buttons[0],"touchend",31,540);
  b.send(two.pad,"touchend",32,540);
  assert.equal(b.timers.size,0);
});

test("mouse pointer dragging switches commands and cleans up capture",()=>{
  const b=boot(),[left,right]=b.buttons;
  b.pointer(left,"pointerdown",3,20);
  assert.equal(left.captured,3);
  b.pointer(left,"pointermove",3,95);
  assert.deepEqual(b.logs.map(x=>x.command),["left","right"]);
  b.pointer(left,"pointerup",3,95);
  assert.equal(right.classList.contains("pressed"),false);
  assert.equal(b.timers.size,0);
});

test("pointer starting in gap moves immediately and supports re-entry",()=>{
  const b=boot();
  b.pointer(b.pad,"pointerdown",4,67);
  assert.equal(count(b.logs,"right"),1);
  b.pointer(b.pad,"pointermove",4,-150);
  assert.equal(b.buttons[1].classList.contains("pressed"),false);
  b.pointer(b.pad,"pointermove",4,95);
  assert.equal(count(b.logs,"right"),2);
  b.pointer(b.pad,"pointercancel",4,95);
  assert.equal(b.timers.size,0);
});

test("synthetic pointer events after touch cannot trigger duplicate input",()=>{
  const b=boot(),left=b.buttons[0];
  b.send(left,"touchstart",1,25);
  b.pointer(left,"pointerdown",2,25,25,{pointerType:"touch"});
  b.pointer(left,"pointerdown",3,25);
  assert.equal(count(b.logs,"left"),1);
  b.send(left,"touchend",1,25);
  b.advance(800);
  b.pointer(left,"pointerdown",4,25);
  assert.equal(count(b.logs,"left"),2);
  b.pointer(left,"pointerup",4,25);
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
