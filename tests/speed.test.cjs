// Run with: node --test tests/speed.test.cjs
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const context=vm.createContext({});
for(const file of ["tetrominoes.js","game.js","session.js"]){
  vm.runInContext(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),context,{filename:file});
}
const {Game,GameSession}=vm.runInContext("({Game,GameSession})",context);

test("easy and hard start at classic levels 0 and 5",()=>{
  const easy=new Game({difficulty:"easy"});
  const hard=new Game({difficulty:"hard"});
  assert.equal(easy.level,0);
  assert.equal(easy.tickSeconds,48/60);
  assert.equal(hard.level,5);
  assert.equal(hard.tickSeconds,23/60);
});
test("clearing ten lines increases gravity speed",()=>{
  const game=new Game({difficulty:"easy"});
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
  const game=new Game({difficulty:"hard"});
  game.lines=500;
  assert.equal(game.tickSeconds,1/60);
});
test("saved games retain the mode and current level",()=>{
  const game=new Game({difficulty:"hard"});
  game.lines=30;
  const restored=Game.fromSnapshot(game.toSnapshot(),{difficulty:"easy"});
  assert.equal(restored.difficulty,"hard");
  assert.equal(restored.level,8);
  assert.equal(restored.phase,"paused");
});
test("legacy snapshots without difficulty still restore",()=>{
  const game=new Game({difficulty:"easy"});
  const snapshot=game.toSnapshot();
  delete snapshot.difficulty;
  assert.equal(Game.fromSnapshot(snapshot,{}).difficulty,"beginner");
  assert.equal(Game.fromSnapshot(snapshot,{difficulty:"hard"}).tickSeconds,48/60);
});
test("old fixed-mode snapshots migrate to Beginner",()=>{
  const snapshot=new Game({difficulty:"beginner"}).toSnapshot();
  snapshot.difficulty="fixed";
  const restored=Game.fromSnapshot(snapshot,{difficulty:"hard"});
  assert.equal(restored.difficulty,"beginner");
  assert.equal(restored.tickSeconds,48/60);
  assert.equal(restored.toSnapshot().difficulty,"beginner");
});
test("both players use the selected mode for a new match",()=>{
  const session=new GameSession({playerCount:2,config:{difficulty:"hard"}});
  assert.ok(session.games.every(game=>game.difficulty==="hard"));
  session.config.difficulty="easy";
  session.replaceGame(0);
  session.replaceGame(1);
  assert.ok(session.games.every(game=>game.difficulty==="easy"));
});

test("beginner mode always stays at 0.8 seconds per row",()=>{
  const game=new Game({difficulty:"beginner"});
  assert.equal(game.tickSeconds,48/60);
  game.lines=500;
  assert.equal(game.level,0);
  assert.equal(game.tickSeconds,48/60);
});
test("beginner difficulty survives a saved game",()=>{
  const game=new Game({difficulty:"beginner"});
  game.lines=40;
  const resumed=Game.fromSnapshot(game.toSnapshot(),{difficulty:"hard"});
  assert.equal(resumed.difficulty,"beginner");
  assert.equal(resumed.tickSeconds,48/60);
});
test("difficulty is validated when restoring saved games",()=>{
  const snapshot=new Game().toSnapshot();
  snapshot.difficulty="impossible";
  assert.throws(()=>Game.fromSnapshot(snapshot,{}),/Invalid saved difficulty/);
});
