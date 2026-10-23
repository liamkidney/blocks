// A completed two-phone game must reload with its finished board intact.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx=vm.createContext({console,Math});
for(const name of ['game-modes.js','tetrominoes.js','game.js']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),ctx,{filename:name});
}
const Game=vm.runInContext('Game',ctx);

test('a completed remote game snapshot restores its board without reviving the piece',()=>{
  const original=new Game();
  original.grid[0][0]='I';
  original.grid[0][3]='O';
  original.lines=12;
  original.score=1850;
  original.endGame();
  const saved=original.toSnapshot();
  assert.equal(saved.phase,'game_over');
  const restored=Game.fromSnapshot(saved);
  assert.equal(restored.phase,'game_over');
  assert.equal(restored.active,null);
  assert.equal(restored.grid[0][0],'I');
  assert.equal(restored.grid[0][3],'O');
  assert.equal(restored.lines,12);
  assert.equal(restored.score,1850);
  restored.update(1);
  assert.equal(restored.phase,'game_over');
  assert.equal(restored.grid[0][3],'O');
});

test('a completed snapshot cannot contain an active falling piece',()=>{
  const game=new Game();
  const snapshot=game.toSnapshot();
  snapshot.phase='game_over';
  assert.throws(()=>Game.fromSnapshot(snapshot),/Invalid active piece/);
});
