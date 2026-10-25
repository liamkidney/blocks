const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const context=vm.createContext({Math});
for(const file of ['game-modes.js','tetrominoes.js','game.js','session.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
const {Game,GameSession,TETROMINOES}=vm.runInContext('({Game,GameSession,TETROMINOES})',context);
const names=Array.from(TETROMINOES,t=>t.name).sort();

function sequence(game,count){
  const pieces=[];
  for(let i=0;i<count;i++){
    pieces.push(game.queue.current().name);
    game.queue.advance();
  }
  return pieces;
}

test('every seven-piece bag contains each tetromino exactly once',()=>{
  for(let trial=0;trial<50;trial++){
    const actual=sequence(new Game(),35);
    for(let i=0;i<actual.length;i+=7){
      const bag=actual.slice(i,i+7);
      assert.equal(new Set(bag).size,7);
      assert.deepEqual(bag.sort(),names);
    }
  }
});

test('restricted I/O mode shuffles its complete allowed set with no other pieces',()=>{
  for(let trial=0;trial<30;trial++){
    const game=new Game({allowedPieces:['I','O']});
    const actual=sequence(game,20);
    for(let i=0;i<actual.length;i+=2)assert.deepEqual(actual.slice(i,i+2).sort(),['I','O']);
  }
});

test('saving and reconnecting restores the unconsumed bag in precisely the same order',()=>{
  const original=new Game();
  sequence(original,3);
  const snapshot=original.toSnapshot();
  assert.equal(snapshot.version,4);
  assert.ok(Array.isArray(snapshot.bag));
  const restored=Game.fromSnapshot(snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.toSnapshot().bag)),JSON.parse(JSON.stringify(snapshot.bag)));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.toSnapshot().queue)),JSON.parse(JSON.stringify(snapshot.queue)));
  // Only compare draws that were committed before saving. A fresh bag is
  // random on each phone once the previously persisted bag runs out.
  const n=snapshot.bag.length;
  for(let i=0;i<n;i++){
    assert.equal(restored.queue.current().name,original.queue.current().name);
    original.queue.advance();restored.queue.advance();
  }
});

test('old versions keep their current and next pieces and migrate to a fresh bag',()=>{
  const original=new Game();
  const snapshot=original.toSnapshot();
  snapshot.version=3;
  delete snapshot.bag;
  snapshot.droughts=Object.fromEntries(names.map(name=>[name,1]));
  const restored=Game.fromSnapshot(snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.toSnapshot().queue)),JSON.parse(JSON.stringify(snapshot.queue)));
  assert.equal(restored.toSnapshot().version,4);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.toSnapshot().bag)),[]);
  // After the previously saved lookahead, the next draw begins a fair bag.
  restored.queue.advance();
  assert.equal(restored.queue.bag.length,6);
});

test('corrupted saved bags are rejected instead of disrupting gameplay',()=>{
  const snapshot=new Game().toSnapshot();
  for(const bag of [null,['I','I'],['?', 'T'],Array(8).fill('I')]){
    assert.throws(()=>Game.fromSnapshot({...snapshot,bag}),/Invalid saved game/);
  }
});

test('each junk row contains exactly 4–7 randomly placed blocks',()=>{
  const counts=new Set(),layouts=new Set();
  for(let i=0;i<200;i++){
    const game=new Game();
    game.addGarbage(1);
    const row=game.grid[0];
    assert.equal(row.length,10);
    const blocks=row.filter(Boolean).length;
    assert.ok(blocks>=4&&blocks<=7,'expected 4–7 occupied columns, got '+blocks);
    assert.equal(row.filter(x=>x===null).length,10-blocks);
    counts.add(blocks);
    layouts.add(row.map(x=>x===null?'_':'X').join(''));
  }
  assert.equal(counts.size,4,'all four block counts should occur');
  assert.ok(layouts.size>=20,'junk must have varying hole positions');
});

test('one junk row per two cleared lines still applies in both multiplayer modes',()=>{
  const cases=[
    [0,1,0,1],
    [1,1,1,0],
    [0,2,1,0],
    [0,4,2,0],
    [1,4,2,1]
  ];
  for(const [carry,cleared,rows,remainder] of cases){
    const attack=GameSession.attackForLines(carry,cleared);
    assert.equal(attack.rows,rows);
    assert.equal(attack.remainder,remainder);
  }
  const samePhone=new GameSession({playerCount:2});
  samePhone.games[0].onEvent({type:'lines_cleared',count:2});
  const garbage=samePhone.games[1].grid[0];
  const filled=garbage.filter(Boolean).length;
  assert.ok(filled>=4&&filled<=7);
  assert.equal(samePhone.attackProgress[0],0);
});
