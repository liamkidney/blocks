// Run with: node tests/match.test.cjs
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const context=vm.createContext({console,Math});
for(const file of ["game-modes.js","tetrominoes.js","game.js","session.js"])
  vm.runInContext(fs.readFileSync(file,"utf8"),context,{filename:file});
const {GameSession}=vm.runInContext("({GameSession})",context);
const s=new GameSession({playerCount:2});
s.pause();
assert.equal(s.games[0].phase,"paused");
assert.equal(s.games[1].phase,"paused");
const y=s.games[1].active.y;
s.update(5);
assert.equal(s.games[1].active.y,y);
s.resume();
assert.equal(s.games[0].phase,"falling");
assert.equal(s.games[1].phase,"falling");
s.games[0].phase="game_over";
assert.equal(s.resolveOutcome(),"player2");
assert.equal(s.resolveOutcome(),"player2");
s.update(5);
assert.equal(s.games[1].active.y,y);
s.pause();
assert.equal(s.games[1].phase,"falling");
s.replaceGame(0);s.replaceGame(1);
assert.equal(s.outcome,null);
const draw=new GameSession({playerCount:2});
draw.games[0].phase="game_over";
draw.games[1].phase="game_over";
assert.equal(draw.resolveOutcome(),"draw");
const other=new GameSession({playerCount:2});
other.games[1].phase="game_over";
assert.equal(other.resolveOutcome(),"player1");
// Both multiplayer transports must use the same two-lines-per-junk rule.
const outcomes=[[0,1,0,1],[1,1,1,0],[0,2,1,0],[1,4,2,1]];
for(const [progress,cleared,rows,remainder] of outcomes){
  const attack=GameSession.attackForLines(progress,cleared);
  assert.equal(attack.rows,rows);
  assert.equal(attack.remainder,remainder);
}
console.log("Match tests passed");
