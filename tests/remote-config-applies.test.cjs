const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Exercise the actual app.js settings event handler against the real engine,
// rather than merely asserting that the network layer emits an event.
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const start=app.indexOf("window.addEventListener('blocks:remote-config',event=>{");
const end=app.indexOf("window.addEventListener('blocks:remote-new-round'",start);
assert.ok(start>=0&&end>start,'remote configuration listener must be present');
const handler=app.slice(start,end);

function phone({difficulty=0,pieces='IO',ghost=false}={}){
  const events=new Map();
  const window={
    BLOCKS_CONFIG:{ghostPiece:ghost},
    BLOCKS_REMOTE_LOCAL_CONFIG:{difficulty:0,ghost_piece:false,piece_set:'IO'},
    addEventListener(name,fn){events.set(name,fn)}
  };
  const context=vm.createContext({window,console,Math,REMOTE_PLAYER:true,resetCount:0,
    updateVersionLabel(){}});
  for(const file of ['game-modes.js','tetrominoes.js','game.js','session.js'])
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  vm.runInContext("session=new GameSession({config:{difficulty:"+difficulty+
    ",allowedPieces:"+JSON.stringify(pieces==='IO'?['I','O']:['I','J','L','O','S','T','Z'])+"}});game=session.games[0]",context);
  window.BLOCKS_REMOTE_RESET=()=>{
    context.game=context.session.replaceGame(0);
    context.resetCount++;
  };
  vm.runInContext(handler,context,{filename:'app.js:remote-config'});
  const apply=detail=>events.get('blocks:remote-config')({detail});
  return {context,window,apply};
}

test('host-selected Hard, all pieces and Ghost ON take effect in its running engine',()=>{
  const p=phone({difficulty:0,pieces:'IO',ghost:false});
  const original=p.context.game;
  p.apply({difficulty:2,piece_set:'ALL',ghost_piece:true});
  assert.equal(p.context.session.config.difficulty,2);
  assert.equal(p.context.game.difficulty,2);
  assert.notStrictEqual(p.context.game,original);
  assert.equal(p.context.game.level,5,'Hard begins at NES gravity level 5');
  assert.equal(p.context.game.queue.tetrominoes.length,7);
  assert.equal(p.window.BLOCKS_CONFIG.ghostPiece,true);
  assert.equal(p.context.resetCount,1);
  assert.equal(p.window.BLOCKS_REMOTE_LOCAL_CONFIG.ghost_piece,false,
    'inherited host match rules must not overwrite the user defaults');
});

test('the other phone adopts the host speed and disables its own ghost setting',()=>{
  const p=phone({difficulty:1,pieces:'ALL',ghost:true});
  p.apply({difficulty:0,piece_set:'ALL',ghost_piece:false});
  assert.equal(p.context.game.difficulty,0);
  assert.equal(p.context.game.level,0);
  assert.equal(p.context.game.tickSeconds,.8);
  assert.equal(p.window.BLOCKS_CONFIG.ghostPiece,false);
  assert.equal(p.context.resetCount,1);
});

test('matching live rules do not restart an existing game',()=>{
  const p=phone({difficulty:2,pieces:'ALL',ghost:true});
  const original=p.context.game;
  p.apply({difficulty:2,piece_set:'ALL',ghost_piece:true});
  assert.strictEqual(p.context.game,original);
  assert.equal(p.context.resetCount,0);
});

test('a stale restored board is corrected even if session defaults already match',()=>{
  const p=phone({difficulty:2,pieces:'ALL',ghost:false});
  p.context.game.difficulty=0; // Restored snapshot overrode config.
  p.apply({difficulty:2,piece_set:'ALL',ghost_piece:false});
  assert.equal(p.context.game.difficulty,2);
  assert.equal(p.context.resetCount,1);
});
