// Run with: node --test tests/speed.test.cjs
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const context=vm.createContext({});
for(const file of ["game-modes.js","tetrominoes.js","game.js","session.js"]){
  vm.runInContext(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),context,{filename:file});
}
const {Game,GameSession}=vm.runInContext("({Game,GameSession})",context);

test("easy and hard start at classic levels 0 and 5",()=>{
  const easy=new Game({difficulty:1});
  const hard=new Game({difficulty:2});
  assert.equal(easy.level,0);
  assert.equal(easy.tickSeconds,48/60);
  assert.equal(hard.level,5);
  assert.equal(hard.tickSeconds,23/60);
});
test("clearing ten lines increases gravity speed",()=>{
  const game=new Game({difficulty:1});
  game.lines=9;
  game.grid[0]=Array(10).fill("I");
  game.completedRows=[0];
  game.active=null;
  game.phase="clearing_lines";
  game.presentationComplete();
  assert.equal(game.lines,10);
  assert.equal(game.level,1);
  assert.equal(game.tickSeconds,43/60);
});
test("gravity is capped at the final classic level",()=>{
  const game=new Game({difficulty:2});
  game.lines=500;
  assert.equal(game.tickSeconds,1/60);
});
test("saved games retain the mode and current level",()=>{
  const game=new Game({difficulty:2});
  game.lines=30;
  const restored=Game.fromSnapshot(game.toSnapshot(),{difficulty:1});
  assert.equal(restored.difficulty,2);
  assert.equal(restored.level,8);
  assert.equal(restored.phase,"paused");
});
test("legacy snapshots without difficulty still restore",()=>{
  const game=new Game({difficulty:1});
  const snapshot=game.toSnapshot();
  delete snapshot.difficulty;
  assert.equal(Game.fromSnapshot(snapshot,{}).difficulty,0);
  assert.equal(Game.fromSnapshot(snapshot,{difficulty:2}).tickSeconds,48/60);
});
test("old string snapshots migrate to numeric IDs",()=>{
  const snapshot=new Game({difficulty:0}).toSnapshot();
  snapshot.difficulty="fixed";
  const restored=Game.fromSnapshot(snapshot,{difficulty:2});
  assert.equal(restored.difficulty,0);
  assert.equal(restored.tickSeconds,48/60);
  assert.equal(restored.toSnapshot().difficulty,0);
});
test("both players use the selected mode for a new match",()=>{
  const session=new GameSession({playerCount:2,config:{difficulty:2}});
  assert.ok(session.games.every(game=>game.difficulty===2));
  session.config.difficulty="easy";
  session.replaceGame(0);
  session.replaceGame(1);
  assert.ok(session.games.every(game=>game.difficulty===1));
});

test("beginner mode always stays at 0.8 seconds per row",()=>{
  const game=new Game({difficulty:0});
  assert.equal(game.tickSeconds,48/60);
  game.lines=500;
  assert.equal(game.level,0);
  assert.equal(game.tickSeconds,48/60);
});
test("beginner difficulty survives a saved game",()=>{
  const game=new Game({difficulty:0});
  game.lines=40;
  const resumed=Game.fromSnapshot(game.toSnapshot(),{difficulty:2});
  assert.equal(resumed.difficulty,0);
  assert.equal(resumed.tickSeconds,48/60);
});
test("difficulty is validated when restoring saved games",()=>{
  const snapshot=new Game().toSnapshot();
  snapshot.difficulty="impossible";
  assert.throws(()=>Game.fromSnapshot(snapshot,{}),/Invalid saved difficulty/);
});

test("all stable IDs map to the intended labels",()=>{
  assert.equal(vm.runInContext("GAME_MODES[0].label",context),"Beginner");
  assert.equal(vm.runInContext("GAME_MODES[1].label",context),"Easy");
  assert.equal(vm.runInContext("GAME_MODES[2].label",context),"Hard");
  assert.equal(vm.runInContext("parseGameMode('beginner')",context),0);
  assert.equal(vm.runInContext("parseGameMode('fixed')",context),0);
  assert.equal(vm.runInContext("parseGameMode('easy')",context),1);
  assert.equal(vm.runInContext("parseGameMode('hard')",context),2);
  assert.equal(vm.runInContext("parseGameMode('2')",context),2);
  assert.equal(vm.runInContext("parseGameMode(99)",context),null);
});
test("every newly created game saves an integer difficulty",()=>{
  for(const id of [0,1,2]){
    const game=new Game({difficulty:id});
    const snapshot=game.toSnapshot();
    assert.equal(typeof snapshot.difficulty,"number");
    assert.equal(snapshot.difficulty,id);
    assert.equal(Game.fromSnapshot(snapshot).difficulty,id);
  }
});
test("pre-integer string snapshots remain recoverable",()=>{
  for(const [old,expected] of [["beginner",0],["fixed",0],["easy",1],["hard",2]]){
    const snapshot=new Game({difficulty:expected}).toSnapshot();
    snapshot.difficulty=old;
    assert.equal(Game.fromSnapshot(snapshot).difficulty,expected);
  }
});

test("soft drop resets gravity movement without delaying the landing lock",()=>{
  const game=new Game({difficulty:0});
  game.elapsed=game.tickSeconds-.01;
  const before=game.active.y;
  game.dropOne();
  assert.equal(game.active.y,before-1);
  assert.equal(game.elapsed,0,"successful soft drop begins a new gravity interval");
  game.update(.02);
  assert.equal(game.active.y,before-1,"the old gravity tick is not inherited");
  game.update(game.tickSeconds-.021);
  assert.equal(game.active.y,before-1);
  game.update(.002);
  assert.equal(game.active.y,before-2);
});

test("ground contact starts a fixed 500 ms lock at every difficulty",()=>{
  for(const difficulty of [0,1,2]){
    const game=new Game({difficulty});
    while(game.tryMove(0,-1)){}
    const piece=game.active;
    assert.equal(game.lockElapsed,0,"first contact arms lock timer");
    game.update(.499);
    assert.strictEqual(game.active,piece,"lock delay is independent of gravity speed");
    assert.equal(game.phase,"falling");
    game.update(.001);
    assert.notStrictEqual(game.active,piece,"piece locks exactly 500 ms after landing");
    assert.equal(game.elapsed,0,"next piece starts with clean gravity timing");
    assert.equal(game.phase,"falling");
  }
});

test("unsuccessful held Down cannot prolong the grounded lock",()=>{
  const game=new Game({difficulty:0});
  while(game.tryMove(0,-1)){}
  const piece=game.active;
  game.update(.25);
  for(let i=0;i<12;i++)game.dropOne();
  assert.strictEqual(game.active,piece);
  assert.equal(game.lockElapsed,.25);
  game.update(.249);
  assert.strictEqual(game.active,piece);
  game.update(.001);
  assert.notStrictEqual(game.active,piece);
});

test("grounded movement resets lock, but the allowance is bounded",()=>{
  const game=new Game({difficulty:0,allowedPieces:["O"]});
  while(game.tryMove(0,-1)){}
  const grounded=game.active;
  game.update(.25);
  assert.equal(game.tryMove(1,0),true);
  assert.equal(game.lockElapsed,0,"first grounded adjustment restarts 500ms");
  assert.equal(game.lockResets,1);
  game.update(.49);
  assert.strictEqual(game.active,grounded);
  game.update(.01);
  assert.notStrictEqual(game.active,grounded);
  const game2=new Game({difficulty:0,allowedPieces:["O"]});
  game2.grid[0][4]="I";
  // Align an O piece one row above a single support, then slide off it.
  game2.active.x=3;
  game2.active.y=1;
  assert.equal(game2.canPlace(game2.offsets,3,1),true);
  game2.syncLockTimer();
  assert.equal(game2.lockElapsed,0);
  game2.update(.25);
  assert.equal(game2.tryMove(-1,0),true);
  assert.equal(game2.lockElapsed,null,"falling away from support cancels the lock");
});

test("only 15 grounded movement or rotation resets are permitted",()=>{
  const game=new Game({difficulty:0,allowedPieces:["O"]});
  while(game.tryMove(0,-1)){}
  for(let i=0;i<15;i++){
    game.update(.3);
    assert.equal(game.tryRotate(1),true);
    assert.equal(game.lockElapsed,0,"each of the first 15 rotations resets the clock");
  }
  assert.equal(game.lockResets,15);
  game.update(.3);
  assert.equal(game.tryRotate(1),true);
  assert.equal(game.lockElapsed,.3,"16th adjustment must not reset the lock");
  game.update(.2);
  assert.equal(game.phase,"falling");
  assert.notEqual(game.lockResets,15,"the old piece must lock and be replaced");
});
test("descending below the previous lowest row replenishes lock resets",()=>{
  const game=new Game({difficulty:0,allowedPieces:["O"]});
  game.grid[0][4]="I";
  game.active.x=3;game.active.y=1;
  game.syncLockTimer();
  assert.equal(game.lockElapsed,0);
  for(let i=0;i<5;i++)game.tryRotate(1);
  assert.equal(game.lockResets,5);
  assert.equal(game.tryMove(-1,0),true);
  assert.equal(game.lockElapsed,null);
  assert.equal(game.tryMove(0,-1),true);
  assert.equal(game.lockResets,0);
  assert.ok(game.lowestY<1);
});
test("paused and restored games preserve their remaining lock time",()=>{
  const game=new Game({difficulty:0});
  while(game.tryMove(0,-1)){}
  game.update(.25);
  game.pause();
  game.update(.5);
  assert.equal(game.lockElapsed,.25,"pause does not count against lock time");
  const snapshot=game.toSnapshot();
  const restored=Game.fromSnapshot(snapshot);
  assert.equal(restored.lockElapsed,.25);
  assert.equal(restored.phase,"paused");
  const piece=restored.active;
  restored.resume();
  restored.update(.249);
  assert.strictEqual(restored.active,piece);
  restored.update(.001);
  assert.notStrictEqual(restored.active,piece);
});

test("gravity landing starts its own lock clock before changing pieces",()=>{
  const game=new Game({difficulty:2});
  while(game.tryMove(0,-1)){}
  game.active.y++;
  game.syncLockTimer();
  assert.equal(game.lockElapsed,null);
  const original=game.active;
  game.elapsed=game.tickSeconds-.01;
  game.update(.06);
  assert.strictEqual(game.active,original);
  assert.equal(game.lockElapsed!==null,true);
  assert.ok(game.lockElapsed>.04&&game.lockElapsed<.051);
  game.update(.449);
  assert.strictEqual(game.active,original);
  game.update(.002);
  assert.notStrictEqual(game.active,original);
  assert.equal(game.elapsed,0);
});
