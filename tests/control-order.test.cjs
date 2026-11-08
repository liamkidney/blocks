const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const settings=fs.readFileSync(path.join(__dirname,'..','settings.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
const ACTIONS=['left','right','down','rotate_cw'];
const KEY='blocks:control-order:v1:/blocks/dev/';

function boot({saved=null,phase='falling',portrait=true,twoPlayer=false,remote=false,menu=false}={}){
  const storage=new Map();
  if(saved!==null)storage.set(KEY,saved);
  const docEvents=new Map(),winEvents=new Map();
  const on=(bucket,type,callback)=>bucket.set(type,[...(bucket.get(type)||[]),callback]);
  const makeClasses=()=>{
    const names=new Set();
    return {add:name=>names.add(name),remove:name=>names.delete(name),
      contains:name=>names.has(name)};
  };
  function makeStyle(){
    const props={};
    return {props,setProperty:(key,value)=>{props[key]=String(value)}};
  }
  const body={children:[],classList:makeClasses(),appendChild(item){
    this.children.push(item);item.parent=this;
  }};
  function makeButton(command,index){
    return {
      dataset:{command},classList:makeClasses(),style:makeStyle(),parent:null,
      animations:[],cssWiggleCancelled:false,
      getAnimations(){return [{cancel:()=>{this.cssWiggleCancelled=true}}]},
      animate(keyframes,options){
        const animation={keyframes,options,cancelled:false,cancel(){this.cancelled=true}};
        this.animations.push(animation);
        return animation;
      },
      getBoundingClientRect(){
        const order=Number(this.style.props['--portrait-control-order']??index);
        return {left:order*71,top:0,width:63,height:66};
      },
      closest(selector){return selector==='#controls .control'?this:null},
      setPointerCapture(){},setAttribute(){},
      cloneNode(){
        const copy=makeButton(command,index);
        copy.remove=function(){
          if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);
          this.parent=null;
        };
        return copy;
      }
    };
  }
  const buttons=ACTIONS.map((command,index)=>makeButton(command,index));
  const otherButtons=ACTIONS.map((command,index)=>makeButton(command,index));
  const otherPad={querySelectorAll:()=>otherButtons};
  let otherPadMounted=false;
  const pad={
    children:[],querySelectorAll:()=>buttons,
    getBoundingClientRect:()=>({left:0,top:0,width:276,height:66}),
    appendChild(child){this.children.push(child);child.parent=this}
  };
  const makeToolbarControl=()=>({
    listeners:{},addEventListener(type,listener){this.listeners[type]=listener},
    click(){this.listeners.click?.()}
  });
  const done=makeToolbarControl(),reset=makeToolbarControl();
  const document={
    body,getElementById:id=>id==='controls'?pad:
      id==='player-two-controls'&&otherPadMounted?otherPad:null,
    createElement:()=>({
      id:'',innerHTML:'',parent:null,remove(){
        if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);
        this.parent=null;
      },
      querySelector:selector=>selector==='#controls-edit-reset'?reset:
        selector==='#controls-edit-done'?done:null
    }),
    addEventListener:(type,callback)=>on(docEvents,type,callback)
  };
  const window={
    matchMedia:query=>({matches:query.includes('orientation: portrait')?portrait:false}),
    getComputedStyle:()=>({columnGap:'8px'}),
    addEventListener:(type,callback)=>on(winEvents,type,callback)
  };
  const game={phase,
    pause(){if(['falling','clearing_lines'].includes(this.phase))this.phase='paused'},
    resume(){if(this.phase==='paused')this.phase='falling'}
  };
  const restartDialog={hidden:!menu};
  let clears=0,renders=0,saves=0;
  const start=app.indexOf('// One personal button order is shared');
  const end=app.indexOf('// End shared control order and portrait editor.',start);
  assert.ok(start>0&&end>start,'live editor code must have stable markers');
  const code=app.slice(start,end);
  const context={
    document,window,game,restartDialog,controlEditing:false,
    TWO_PLAYER:twoPlayer,REMOTE_PLAYER:remote,location:{pathname:'/blocks/dev/'},
    localStorage:{
      getItem:key=>storage.get(key)??null,
      setItem:(key,value)=>storage.set(key,String(value))
    },
    clearControlContacts:()=>clears++,
    renderActions:()=>renders++,
    saveGame:()=>saves++,
    console
  };
  vm.runInNewContext(code,context,{filename:'shared-control-editor.js'});
  if(twoPlayer){
    // multiplayer.js inserts the second station after the initial app load.
    otherPadMounted=true;
    window.BLOCKS_APPLY_CONTROL_ORDER();
  }
  const dispatch=(type,event)=>{for(const listener of docEvents.get(type)||[])listener({
    preventDefault(){},...event
  })};
  const visualOrder=()=>buttons.slice().sort((a,b)=>
    Number(a.style.props['--portrait-control-order'])-
    Number(b.style.props['--portrait-control-order'])
  ).map(button=>button.dataset.command);
  const pointer=(type,button,id,x)=>dispatch(type,{
    target:button,pointerId:id,pointerType:'touch',clientX:x,clientY:30
  });
  return {window,document,pad,buttons,otherButtons,done,reset,game,storage,visualOrder,pointer,
    restartDialog,context,get clears(){return clears},get saves(){return saves}};
}

test('Settings offers live edit mode rather than a second mock control row',()=>{
  assert.match(settings,/id="settings-control-start"/);
  assert.match(settings,/BLOCKS_BEGIN_CONTROL_EDIT/);
  assert.doesNotMatch(settings,/settings-control-row|settings-control-key/);
});
test('solo portrait editor pauses game and exposes floating Done',()=>{
  const b=boot();
  assert.equal(b.window.BLOCKS_BEGIN_CONTROL_EDIT(),true);
  assert.equal(b.game.phase,'paused');
  assert.equal(b.document.body.classList.contains('controls-editing'),true);
  assert.equal(b.pad.children.length,1,'Done toolbar is rendered over live controls');
  assert.ok(b.clears>0,'held controls are released');
  b.done.click();
  assert.equal(b.game.phase,'falling','editing resumes a running game');
  assert.equal(b.pad.children.length,0);
  assert.equal(b.document.body.classList.contains('controls-editing'),false);
});
test('reordering a live button shifts neighbours and Done saves the order',()=>{
  const b=boot();
  b.window.BLOCKS_BEGIN_CONTROL_EDIT();
  const left=b.buttons[0];
  b.pointer('pointerdown',left,10,10);
  b.pointer('pointermove',left,10,252);
  assert.deepEqual(b.visualOrder(),['right','down','rotate_cw','left']);
  assert.equal(b.game.phase,'paused','game stays paused throughout dragging');
  b.pointer('pointerup',left,10,252);
  b.done.click();
  assert.deepEqual(JSON.parse(b.storage.get(KEY)),['right','down','rotate_cw','left']);
  assert.equal(b.game.phase,'falling');
  const restored=boot({saved:b.storage.get(KEY)});
  assert.deepEqual(restored.visualOrder(),['right','down','rotate_cw','left']);
});
test('cancelled pointer drag rolls back preview without saving',()=>{
  const b=boot();
  b.window.BLOCKS_BEGIN_CONTROL_EDIT();
  b.pointer('pointerdown',b.buttons[0],9,10);
  b.pointer('pointermove',b.buttons[0],9,252);
  b.pointer('pointercancel',b.buttons[0],9,252);
  assert.deepEqual(b.visualOrder(),ACTIONS);
  b.done.click();
  assert.deepEqual(JSON.parse(b.storage.get(KEY)),ACTIONS);
});
test('editing an already paused game does not resume it on Done',()=>{
  const b=boot({phase:'paused',menu:true});
  b.window.BLOCKS_BEGIN_CONTROL_EDIT();
  assert.equal(b.restartDialog.hidden,true,'menu is hidden during editing');
  b.done.click();
  assert.equal(b.restartDialog.hidden,false,'menu returns on Done');
  assert.equal(b.game.phase,'paused');
});
test('editor is unavailable outside solo portrait',()=>{
  for(const options of [{portrait:false},{twoPlayer:true},{remote:true}]){
    const b=boot(options);
    assert.equal(b.window.BLOCKS_BEGIN_CONTROL_EDIT(),false);
    assert.equal(b.game.phase,'falling');
    assert.equal(b.pad.children.length,0);
  }
});
test('stored invalid or duplicate actions are ignored',()=>{
  for(const saved of ['invalid','["left","left","down","rotate_cw"]','["left","right"]']){
    assert.deepEqual(boot({saved}).visualOrder(),ACTIONS);
  }
});
test('reset returns all four actual controls to default order',()=>{
  const b=boot({saved:'["rotate_cw","left","down","right"]'});
  assert.equal(b.window.BLOCKS_RESET_CONTROL_ORDER(),true);
  assert.deepEqual(b.visualOrder(),ACTIONS);
  assert.deepEqual(JSON.parse(b.storage.get(KEY)),ACTIONS);
});
test('touch input is gated during edit mode and portrait CSS provides wiggle',()=>{
  assert.match(app,/function press\(button\)\{\s*if\(controlEditing\)return/);
  assert.match(app,/function findControlStart\(target,x,y\)\{\s*if\(controlEditing\)return null/);
  assert.match(css,/body:not\(\.two-player\) #controls \.control/);
  assert.doesNotMatch(css,/body:not\(\.two-player\):not\(\.remote-multiplayer\)/);
  assert.match(css,/blocks-control-wiggle/);
  assert.match(app,/const ghost=button\.cloneNode\(true\)/);
  assert.match(css,/body > \.control\.control-edit-ghost/);
});

test('wiggle remains enabled in user-entered edit mode, including Reduce Motion',()=>{
  assert.match(css,/body\.controls-editing:not\(\.two-player\) #controls \.control:not\(\.control-edit-placeholder\)/);
  assert.match(css,/animation:blocks-control-wiggle \.14s/);
  assert.match(css,/animation-delay:-\.14s/);
  assert.match(css,/from\{transform:rotate\(-4deg\)\}/);
  assert.match(css,/to\{transform:rotate\(4deg\)\}/);
  assert.doesNotMatch(css,/body\.controls-editing #controls \.control\{animation:none!important\}/);
});
test('neighbours keep their CSS wiggle while horizontal shifts are animated',()=>{
  const b=boot();
  b.window.BLOCKS_BEGIN_CONTROL_EDIT();
  const dragged=b.buttons[0];
  b.pointer('pointerdown',dragged,10,12);
  b.pointer('pointermove',dragged,10,252);
  for(const neighbour of b.buttons.slice(1)){
    assert.ok(neighbour.animations.length>0,'neighbour should glide into a new slot');
    assert.equal(neighbour.cssWiggleCancelled,false,'CSS wiggle must not be cancelled');
    const last=neighbour.animations.at(-1);
    assert.equal(typeof last.keyframes[0].translate,'string');
    assert.equal(last.keyframes[0].transform,undefined,
      'movement must not override the CSS rotation transform');
  }
  b.pointer('pointermove',dragged,10,110);
  for(const neighbour of b.buttons.slice(1)){
    assert.equal(neighbour.cssWiggleCancelled,false,'CSS wiggle persists on repeated rearranging');
    assert.equal(neighbour.animations.at(-1).keyframes.at(-1).translate,'0px 0');
  }
  b.pointer('pointerup',dragged,10,110);
  b.done.click();
});

test('HUD Settings uses the official Lucide gear with internal padding',()=>{

  assert.match(app,/settingsButton\.innerHTML='<svg class="settings-cog"/);
  assert.match(app,/class="settings-cog"[\s\S]*?<circle cx="12" cy="12" r="3"\/>/);
  assert.match(app,/M9\.671 4\.136a2\.34/,'official Lucide Settings path');
  assert.doesNotMatch(app,/M12 2\.5v3M12 18\.5v3/);
  assert.doesNotMatch(app,/scale\(\.975\)/,'no icon scaling that could clip its edge');
});

test('floating editor offers Reset and Done without instruction text',()=>{
  assert.match(app,/id="controls-edit-reset">Reset<\/button>/);
  assert.match(app,/id="controls-edit-done">Done<\/button>/);
  assert.doesNotMatch(app,/<span>Drag controls to rearrange<\/span>/);
  assert.doesNotMatch(settings,/id="settings-control-reset"/);
});
test('Reset stays in edit mode and Done persists the default arrangement',()=>{
  const saved='["rotate_cw","left","down","right"]';
  const b=boot({saved});
  b.window.BLOCKS_BEGIN_CONTROL_EDIT();
  assert.equal(b.game.phase,'paused');
  b.reset.click();
  assert.deepEqual(b.visualOrder(),ACTIONS);
  assert.equal(b.game.phase,'paused');
  assert.equal(b.document.body.classList.contains('controls-editing'),true);
  assert.equal(b.storage.get(KEY),saved);
  b.done.click();
  assert.deepEqual(JSON.parse(b.storage.get(KEY)),ACTIONS);
  assert.equal(b.game.phase,'falling');
});
test('Reset while dragging removes placeholder and keeps editor open',()=>{
  const b=boot({saved:'["rotate_cw","left","down","right"]'});
  b.window.BLOCKS_BEGIN_CONTROL_EDIT();
  const dragged=b.buttons[0];
  b.pointer('pointerdown',dragged,33,100);
  b.pointer('pointermove',dragged,33,252);
  assert.equal(dragged.classList.contains('control-edit-placeholder'),true);
  b.reset.click();
  assert.equal(dragged.classList.contains('control-edit-placeholder'),false);
  assert.deepEqual(b.visualOrder(),ACTIONS);
  assert.equal(b.document.body.classList.contains('controls-editing'),true);
  b.done.click();
  assert.deepEqual(JSON.parse(b.storage.get(KEY)),ACTIONS);
});

test('saved solo order is restored in two-phone mode using the same storage key',()=>{
  const saved='["right","down","rotate_cw","left"]';
  const solo=boot({saved});
  const remote=boot({saved,remote:true});
  assert.deepEqual(remote.visualOrder(),solo.visualOrder());
  assert.deepEqual(remote.visualOrder(),["right","down","rotate_cw","left"]);
  assert.equal(remote.window.BLOCKS_BEGIN_CONTROL_EDIT(),false,
    'layout editing stays in solo mode; the preference still applies remotely');
});

test('one-phone two-player mode maps shared button order to both diamond pads',()=>{
  const saved='["right","down","rotate_cw","left"]';
  const b=boot({saved,twoPlayer:true});
  // Slots are left-middle, right-middle, bottom-middle, top-middle.
  const expected={
    right:['1','2'], down:['2','2'],
    rotate_cw:['1 / 3','3'], left:['1 / 3','1']
  };
  for(const group of [b.buttons,b.otherButtons]){
    for(const button of group){
      const [column,row]=expected[button.dataset.command];
      assert.equal(button.style.props['--diamond-control-column'],column);
      assert.equal(button.style.props['--diamond-control-row'],row);
    }
  }
  assert.match(css,/grid-column:var\(--diamond-control-column,/);
  assert.match(css,/grid-row:var\(--diamond-control-row,/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','multiplayer.js'),'utf8'),
    /window\.BLOCKS_APPLY_CONTROL_ORDER\?\.\(\)/);
});

test('uncustomised one-phone controls retain the original diamond positions',()=>{
  const b=boot({twoPlayer:true});
  const defaults={
    left:['1','2'],right:['2','2'],
    down:['1 / 3','3'],rotate_cw:['1 / 3','1']
  };
  for(const group of [b.buttons,b.otherButtons])
    for(const button of group){
      const [column,row]=defaults[button.dataset.command];
      assert.equal(button.style.props['--diamond-control-column'],column);
      assert.equal(button.style.props['--diamond-control-row'],row);
    }
});

test('saved button preferences survive switching solo, remote and local two-player',()=>{
  const original=boot();
  original.window.BLOCKS_BEGIN_CONTROL_EDIT();
  original.pointer('pointerdown',original.buttons[0],4,10);
  original.pointer('pointermove',original.buttons[0],4,252);
  original.pointer('pointerup',original.buttons[0],4,252);
  original.done.click();
  const saved=original.storage.get(KEY);
  assert.ok(saved);
  assert.deepEqual(boot({saved}).visualOrder(),["right","down","rotate_cw","left"]);
  assert.deepEqual(boot({saved,remote:true}).visualOrder(),
    ["right","down","rotate_cw","left"]);
  assert.deepEqual(boot({saved,twoPlayer:true}).visualOrder(),
    ["right","down","rotate_cw","left"]);
});
