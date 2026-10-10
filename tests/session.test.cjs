// Run with: node tests/session.test.cjs
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const context=vm.createContext({console,Math});
for(const file of ["tetrominoes.js","game.js","session.js"])
  vm.runInContext(fs.readFileSync(file,"utf8"),context,{filename:file});
const {Game,GameSession}=vm.runInContext("({Game,GameSession})",context);
const session=new GameSession({playerCount:2});
assert.equal(session.games.length,2);
assert.notEqual(session.games[0].grid,session.games[1].grid);
assert.notEqual(session.games[0].queue,session.games[1].queue);
session.games[0].grid[0][0]="I";
assert.equal(session.games[1].grid[0][0],null);
session.games[0].pause();
assert.equal(session.games[1].phase,"falling");
session.games[0].resume();
session.games[0].score=123;
const snapshot=session.games[0].toSnapshot();
const restored=new GameSession({snapshots:[snapshot]});
assert.equal(restored.games[0].score,123);
assert.equal(restored.games[0].grid[0][0],"I");
const originalSecond=session.games[1];
session.replaceGame(0);
assert.equal(session.games[1],originalSecond);
assert.equal(session.games[0].score,0);
const game=session.games[0];
game.active=null;
game.phase="clearing_lines";
game.completedRows=[0,1];
game.grid[0].fill("I");
game.grid[1].fill("I");
game.presentationComplete();
assert.deepEqual(JSON.parse(JSON.stringify(session.drainEvents())),[
  {player:1,type:"lines_cleared",count:2}
]);
assert.equal(session.drainEvents().length,0);
assert.equal(session.games[1].lines,0);
assert.throws(()=>new GameSession({playerCount:3}));
console.log("GameSession tests passed");
