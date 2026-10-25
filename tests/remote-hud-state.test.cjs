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
