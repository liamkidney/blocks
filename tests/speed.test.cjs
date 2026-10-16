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
  assert.equal(Game.fromSnapshot(snapshot,{}).difficulty,"easy");
});
test("both players use the selected mode for a new match",()=>{
  const session=new GameSession({playerCount:2,config:{difficulty:"hard"}});
  assert.ok(session.games.every(game=>game.difficulty==="hard"));
  session.config.difficulty="easy";
  session.replaceGame(0);
  session.replaceGame(1);
  assert.ok(session.games.every(game=>game.difficulty==="easy"));
});
