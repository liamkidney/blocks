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
  assert.ok(session.games.every(game=>game.difficulty==="hard"));
  session.config.difficulty="easy";
  session.replaceGame(0);
  session.replaceGame(1);
  assert.ok(session.games.every(game=>game.difficulty==="easy"));
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
