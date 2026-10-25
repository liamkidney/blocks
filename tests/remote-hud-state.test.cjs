const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Exercise the actual pause-state listener and renderActions implementation,
// not a duplicate implementation of its conditions.
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const begin=source.indexOf('let remoteLocalPaused=false,remotePeerPaused=false;');
const end=source.indexOf('let lastPreviewTetromino=',begin);
assert.ok(begin>=0&&end>begin,'Remote HUD implementation can be isolated for testing');

function harness(remote=true){
  const listeners=new Map();
  const button=()=>{
    const attrs={};
    return {
      disabled:false,dataset:{},innerHTML:'',title:'',
      setAttribute(name,value){attrs[name]=value},
      getAttribute(name){return attrs[name]??null}
    };
  };
  const pause=button(),restart=button(),reactions=[button(),button()];
  const game={
    phase:'falling',
    pause(){if(this.phase==='falling')this.phase='paused'},
    resume(){if(this.phase==='paused')this.phase='falling'}
  };
  const classes=new Map();
  const document={
    querySelectorAll(){return []},
    body:{classList:{toggle(){}}}
  };
  const window={addEventListener(type,handler){listeners.set(type,handler)}};
  const board={parentElement:{classList:{toggle(name,on){classes.set(name,on)}}}};
  const context=vm.createContext({
    window,document,board,game,session:{outcome:null},
    REMOTE_PLAYER:remote,TWO_PLAYER:false,
    remoteReady:true,remoteFinished:false,remoteLost:false,
    pauseButton:pause,restartButton:restart,reactionButtons:reactions,
    pauseIcon:'pause-icon',resumeIcon:'resume-icon'
  });
  vm.runInContext(source.slice(begin,end),context,{filename:'remote-hud.js'});
  return {
    pause,restart,reactions,game,classes,context,
    render(){vm.runInContext('renderActions()',context)},
    state(local,peer){
      const listener=listeners.get('blocks:remote-pause-state');
      assert.ok(listener);
      listener({detail:{local,peer}});
      this.render();
    }
  };
}

test('remote button icon, state, and label agree during local pause and resume',()=>{
  const ui=harness();
  ui.render();
  assert.equal(ui.pause.dataset.state,'PAUSE');
  assert.equal(ui.pause.innerHTML,'pause-icon');
  assert.equal(ui.pause.getAttribute('aria-label'),'Pause game');
  assert.equal(ui.pause.disabled,false);
  assert.equal(ui.restart.disabled,false);
  assert.deepEqual(ui.reactions.map(b=>b.disabled),[false,false]);

  ui.state(true,false);
  assert.equal(ui.game.phase,'paused');
  assert.equal(ui.pause.dataset.state,'RESUME');
  assert.equal(ui.pause.innerHTML,'resume-icon');
  assert.equal(ui.pause.getAttribute('aria-label'),'Resume game');
  assert.equal(ui.pause.disabled,false,'the initiating player can resume');
  assert.equal(ui.restart.disabled,false,'restart remains active during pause');
  assert.deepEqual(ui.reactions.map(b=>b.disabled),[false,false]);

  ui.state(false,false);
  assert.equal(ui.game.phase,'falling');
  assert.equal(ui.pause.dataset.state,'PAUSE');
  assert.equal(ui.pause.innerHTML,'pause-icon');
  assert.equal(ui.restart.disabled,false);
  assert.deepEqual(ui.reactions.map(b=>b.disabled),[false,false]);
});

test('opponent pause shows a disabled resume icon and leaves restart and reactions enabled',()=>{
  const ui=harness();
  ui.render();
  ui.state(false,true);
  assert.equal(ui.game.phase,'paused');
  assert.equal(ui.pause.dataset.state,'RESUME');
  assert.equal(ui.pause.innerHTML,'resume-icon',
    'remote pause must not leave an old pause icon behind');
  assert.equal(ui.pause.getAttribute('aria-label'),'Paused by opponent');
  assert.equal(ui.pause.disabled,true,'cannot cancel another player\'s pause');
  assert.equal(ui.restart.disabled,false);
  assert.deepEqual(ui.reactions.map(b=>b.disabled),[false,false]);

  ui.state(true,true);
  assert.equal(ui.pause.disabled,false,'can release one\'s own pause');
  assert.equal(ui.pause.dataset.state,'RESUME');
  assert.equal(ui.restart.disabled,false);

  ui.state(false,true);
  assert.equal(ui.pause.disabled,true);
  ui.state(false,false);
  assert.equal(ui.game.phase,'falling');
  assert.equal(ui.pause.dataset.state,'PAUSE');
  assert.equal(ui.pause.innerHTML,'pause-icon');
  assert.equal(ui.pause.disabled,false);
  assert.equal(ui.restart.disabled,false);
  assert.deepEqual(ui.reactions.map(b=>b.disabled),[false,false]);
});

test('connection holds disable the other actions and non-remote controls retain their behaviour',()=>{
  const ui=harness();
  ui.render();
  ui.context.remoteReady=false;
  ui.game.pause();
  ui.render();
  assert.equal(ui.pause.disabled,true);
  assert.equal(ui.restart.disabled,true);
  assert.deepEqual(ui.reactions.map(b=>b.disabled),[true,true]);
  ui.context.remoteReady=true;
  ui.state(false,false);
  assert.equal(ui.restart.disabled,false);

  const solo=harness(false);
  solo.render();
  assert.equal(solo.pause.innerHTML,'pause-icon');
  solo.game.pause();
  solo.render();
  assert.equal(solo.pause.innerHTML,'resume-icon');
});

test('both remote HUD rows visibly grey out disabled controls',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  assert.match(css,/body:not\(\.two-player\) #game-actions button:disabled\{opacity:\.3\}/);
  assert.match(css,/body\.remote-multiplayer #remote-reaction-actions button:disabled\{opacity:\.3\}/);
});

test('rapid repeated taps reach the reaction button handler without being suppressed',()=>{
  const from=source.indexOf('function bindImmediateAction(');
  const to=source.indexOf('bindImmediateAction(pauseButton,',from);
  assert.ok(from>=0&&to>from);
  let now=0,accepted=0,prevented=0;
  const handlers=new Map();
  const button={
    disabled:false,
    addEventListener(type,callback){handlers.set(type,callback)}
  };
  const context=vm.createContext({performance:{now:()=>now}});
  vm.runInContext(source.slice(from,to),context);
  const bind=vm.runInContext('bindImmediateAction',context);
  bind(button,()=>accepted++);
  for(const delay of [0,50,75,110,180]){
    now=delay;
    handlers.get('touchstart')({preventDefault(){prevented++}});
  }
  assert.equal(accepted,5,'every distinct touch should be accepted');
  assert.equal(prevented,5);
  handlers.get('click')({preventDefault(){prevented++}});
  assert.equal(accepted,5,'iOS synthetic click must not duplicate the last touch');
  assert.equal(prevented,6);

  const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  assert.match(source,/button\.classList\.add\("reaction-sent"\)/);
  assert.match(css,/remote-reaction-actions button\.reaction-sent/);
  assert.match(css,/@keyframes remote-reaction-tap/);
});

test('each accepted emoji tap floats on sender; incoming emoji floats on opponent',()=>{
  // Execute the real UI event wiring with a lightweight mock DOM. This catches
  // regressions where feedback is shown only as a button pulse.
  const start=source.indexOf('for(const button of reactionButtons)if(REMOTE_PLAYER)');
  const end=source.indexOf('let remoteLocalPaused=false,remotePeerPaused=false;',start);
  assert.ok(start>=0&&end>start);
  const callbacks=new Map(),listeners=new Map(),layers=[];
  let accept=true;
  const sent=[];
  const reactionButtons=['heart','cry'].map(reaction=>({
    dataset:{reaction},
    classList:{add(){},remove(){}},
    offsetWidth:40
  }));
  const window={
    BLOCKS_REMOTE:{sendReaction(reaction){sent.push(reaction);return accept;}},
    addEventListener(name,fn){listeners.set(name,fn)},
    dispatchEvent(event){listeners.get(event.type)?.(event)}
  };
  function makeNode(){
    const node={
      children:[],style:{},className:'',textContent:'',
      setAttribute(){},addEventListener(){},
      appendChild(child){child.parent=this;this.children.push(child)},
      remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1)},
      get childElementCount(){return this.children.length},
      get firstChild(){return this.children[0]}
    };
    return node;
  }
  const board={parentElement:{appendChild(layer){layers.push(layer)}}};
  const document={createElement:()=>makeNode()};
  vm.runInNewContext(source.slice(start,end),{
    REMOTE_PLAYER:true,reactionButtons,window,document,board,
    bindImmediateAction(button,fn){callbacks.set(button.dataset.reaction,fn)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
    setTimeout(){},Math
  });
  assert.equal(layers.length,1);
  const visible=()=>layers[0].children.map(cell=>cell.textContent);
  callbacks.get('heart')();
  assert.deepEqual(visible(),['❤️'],'sender immediately sees their own floating heart');
  callbacks.get('cry')();
  callbacks.get('heart')();
  assert.deepEqual(visible(),['❤️','😭','❤️'],'repeated taps float locally each time');
  assert.deepEqual(sent,['heart','cry','heart']);
  accept=false;
  callbacks.get('cry')();
  assert.deepEqual(visible(),['❤️','😭','❤️'],'rejected action does not falsely animate');
  window.dispatchEvent({type:'blocks:remote-reaction',detail:{reaction:'cry'}});
  assert.deepEqual(visible(),['❤️','😭','❤️','😭'],
    'incoming reaction uses identical floating animation');
});
