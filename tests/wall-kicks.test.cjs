const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const context=vm.createContext({});
for(const file of ["game-modes.js","tetrominoes.js","game.js","session.js"]){
  vm.runInContext(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),context,{filename:file});
}
const {Game,GameSession,TETROMINO_BY_NAME,SRS_KICKS_JLSTZ,SRS_KICKS_I}=
  vm.runInContext("({Game,GameSession,TETROMINO_BY_NAME,SRS_KICKS_JLSTZ,SRS_KICKS_I})",context);

function setPiece(game,name,orientation,x,y){
  game.grid=Array.from({length:20},()=>Array(10).fill(null));
  game.phase="falling";
  game.active={tetromino:TETROMINO_BY_NAME[name],orientation,x,y};
  assert.ok(game.canPlace(game.offsets,x,y),name+" must start at a valid position");
  return game;
}
function occupied(game){
  const {x,y}=game.active;
  return game.offsets.map(([dx,dy])=>[x+dx,y+dy].join(",")).sort();
}
function occupiedFrom(name,orientation,x,y,legacy=false){
  let offsets=TETROMINO_BY_NAME[name].orientations[orientation];
  if(legacy&&["S","Z"].includes(name)&&orientation===0)
    offsets=TETROMINO_BY_NAME[name].orientations[2];
  if(legacy&&["S","Z"].includes(name)&&orientation===1)
    offsets=TETROMINO_BY_NAME[name].orientations[3];
  return offsets.map(([dx,dy])=>[x+dx,y+dy].join(",")).sort();
}

test("SRS kick lists match all eight clockwise/counterclockwise transitions",()=>{
  const transitions=["0>1","1>2","2>3","3>0","0>3","3>2","2>1","1>0"];
  for(const table of [SRS_KICKS_JLSTZ,SRS_KICKS_I]){
    assert.deepEqual(Object.keys(table).sort(),transitions.slice().sort());
    for(const key of transitions){
      assert.equal(table[key].length,5);
      assert.deepEqual(Array.from(table[key][0]),[0,0]);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(SRS_KICKS_JLSTZ["0>1"])),
    [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]]);
  assert.deepEqual(JSON.parse(JSON.stringify(SRS_KICKS_JLSTZ["0>3"])),
    [[0,0],[1,0],[1,1],[0,-2],[1,-2]]);
  assert.deepEqual(JSON.parse(JSON.stringify(SRS_KICKS_I["0>1"])),
    [[0,0],[-2,0],[1,0],[-2,-1],[1,2]]);
  assert.deepEqual(JSON.parse(JSON.stringify(SRS_KICKS_I["0>3"])),
    [[0,0],[-1,0],[2,0],[-1,2],[2,-1]]);
});

test("all four orientations rotate around SRS pivots for all six non-O shapes",()=>{
  for(const name of ["I","J","L","S","T","Z"]){
    const states=TETROMINO_BY_NAME[name].orientations;
    const span=name==="I"?3:2;
    for(let from=0;from<4;from++){
      const expected=states[from].map(([x,y])=>[y,span-x].join(",")).sort();
      const actual=states[(from+1)%4].map(p=>p.join(",")).sort();
      assert.deepEqual(actual,expected,name+" rotation "+from+"->"+(from+1)%4);
    }
  }
});

test("ordinary rotations keep x/y when the next orientation already fits",()=>{
  const game=setPiece(new Game(),"T",0,4,10);
  const before=occupied(game);
  assert.equal(game.tryRotate(1),true);
  assert.equal(game.active.orientation,1);
  assert.equal(game.active.x,4);
  assert.equal(game.active.y,10);
  assert.notDeepEqual(occupied(game),before);
  assert.equal(game.tryRotate(-1),true);
  assert.deepEqual(occupied(game),before);
});

test("T-piece kicks right at the left wall on clockwise rotation",()=>{
  const game=setPiece(new Game(),"T",1,-1,5);
  assert.equal(game.tryRotate(1),true); // R -> 2 (+1,0) after basic collision
  assert.equal(game.active.orientation,2);
  assert.equal(game.active.x,0);
  assert.equal(game.active.y,5);
});
test("T-piece kicks left at the right wall on clockwise rotation",()=>{
  const game=setPiece(new Game(),"T",3,8,5);
  assert.equal(game.tryRotate(1),true); // L -> 0 (-1,0)
  assert.equal(game.active.orientation,0);
  assert.equal(game.active.x,7);
  assert.equal(game.active.y,5);
});

test("floor kick moves T piece one cell up when basic rotation intersects the floor",()=>{
  const game=setPiece(new Game(),"T",0,4,-1);
  assert.equal(game.tryRotate(1),true);
  assert.equal(game.active.orientation,1);
  assert.equal(game.active.x,3);
  assert.equal(game.active.y,0);
  assert.ok(game.canPlace(game.offsets,game.active.x,game.active.y));
});

test("I-piece uses its distinct two-square lateral kick near a block",()=>{
  const game=setPiece(new Game(),"I",0,3,5);
  game.grid[5][5]="J"; // Blocks the first I kick, not the second (-2,0).
  assert.equal(game.tryRotate(1),true);
  assert.equal(game.active.orientation,1);
  assert.equal(game.active.x,1);
  assert.equal(game.active.y,5);
});

test("I-piece can kick up two rows at the floor",()=>{
  const game=setPiece(new Game(),"I",0,3,-2);
  assert.equal(game.tryRotate(1),true);
  assert.equal(game.active.orientation,1);
  assert.equal(game.active.x,4);
  assert.equal(game.active.y,0);
  assert.ok(game.canPlace(game.offsets,game.active.x,game.active.y));
});

test("a stack obstruction uses the third kick when the first two are blocked",()=>{
  const game=setPiece(new Game(),"T",0,4,5);
  game.grid[5][5]="I"; // Base: (0,0) would overlap.
  game.grid[5][4]="J"; // First kick: (-1,0) would overlap.
  assert.equal(game.tryRotate(1),true);
  assert.equal(game.active.orientation,1);
  assert.equal(game.active.x,3);
  assert.equal(game.active.y,6); // Third test: (-1,+1)
});

test("a fully obstructed rotation leaves the piece unchanged",()=>{
  const game=setPiece(new Game(),"T",0,4,5);
  game.grid[5][5]="I";
  game.grid[5][4]="J";
  game.grid[8][4]="L";
  const before=occupied(game);
  const old=game.active;
  assert.equal(game.tryRotate(1),false);
  assert.strictEqual(game.active,old);
  assert.equal(game.active.orientation,0);
  assert.equal(game.active.x,4);
  assert.equal(game.active.y,5);
  assert.deepEqual(occupied(game),before);
});

test("square O rotates without moving its footprint or kicking",()=>{
  const game=setPiece(new Game(),"O",0,0,0);
  const before=occupied(game);
  for(let step=0;step<4;step++){
    assert.equal(game.tryRotate(1),true);
    assert.deepEqual(occupied(game),before);
    assert.equal(game.active.x,0);
    assert.equal(game.active.y,0);
  }
});

test("saved version-2 games keep the kicked position on restore",()=>{
  const game=setPiece(new Game({difficulty:2}),"T",0,4,-1);
  assert.equal(game.tryRotate(1),true);
  const snapshot=game.toSnapshot();
  assert.equal(snapshot.version,3);
  const restored=Game.fromSnapshot(snapshot);
  assert.equal(restored.phase,"paused");
  assert.equal(restored.difficulty,2);
  assert.deepEqual(occupied(restored),occupied(game));
});

test("legacy v1 S/Z rotations 2 and 3 restore to the same four cells",()=>{
  for(const name of ["S","Z"]){
    for(const orientation of [0,1,2,3]){
      const game=setPiece(new Game(),name,orientation,4,8);
      const snapshot=game.toSnapshot();
      snapshot.version=1;
      snapshot.active.x=4;
      snapshot.active.y=8;
      const restored=Game.fromSnapshot(snapshot);
      assert.deepEqual(occupied(restored),
        occupiedFrom(name,orientation,4,8,true),
        name+" legacy orientation "+orientation);
      assert.equal(restored.toSnapshot().version,3);
    }
  }
});

test("wall kicks work for both players and all three difficulty modes",()=>{
  for(const difficulty of [0,1,2]){
    const session=new GameSession({playerCount:2,config:{difficulty}});
    for(const game of session.games){
      setPiece(game,"T",3,8,5);
      game.press("rotate_cw");
      assert.equal(game.active.orientation,0);
      assert.equal(game.active.x,7);
      assert.equal(game.difficulty,difficulty);
    }
  }
});

test("pause and game over reject player rotation requests",()=>{
  const game=setPiece(new Game(),"T",3,8,5);
  game.pause();
  game.press("rotate_cw");
  assert.equal(game.active.orientation,3);
  game.resume();
  game.press("rotate_cw");
  assert.equal(game.active.orientation,0);
  game.endGame();
  game.press("rotate_cw");
  assert.equal(game.phase,"game_over");
  assert.equal(game.active,null);
});

test("all wall rotations work for all pieces in both directions",()=>{
  for(const name of ["I","J","L","O","S","T","Z"]){
    for(let from=0;from<4;from++){
      for(const direction of [-1,1]){
        for(const wall of ["left","right"]){
          const game=new Game();
          const offsets=TETROMINO_BY_NAME[name].orientations[from];
          const xs=offsets.map(([x])=>x);
          const x=wall==="left"?-Math.min(...xs):9-Math.max(...xs);
          setPiece(game,name,from,x,8);
          assert.equal(game.tryRotate(direction),true,
            name+" "+from+" -> "+((from+direction+4)%4)+" at "+wall+" wall");
          assert.ok(game.canPlace(game.offsets,game.active.x,game.active.y));
        }
      }
    }
  }
});

test("S/Z wall kicks on right and left use SRS offsets",()=>{
  for(const name of ["S","Z"]){
    for(const to of [0,2]){
      const right=setPiece(new Game(),name,1,7,8);
      assert.equal(right.tryRotate(to===2?1:-1),true);
      assert.equal(right.active.orientation,to);
      assert.equal(right.active.x,7);
      const left=setPiece(new Game(),name,3,0,8);
      assert.equal(left.tryRotate(to===0?1:-1),true);
      assert.equal(left.active.orientation,to);
      assert.equal(left.active.x,0);
    }
  }
});

test("v2 S/Z saved games preserve occupied cells in all orientations",()=>{
  for(const name of ["S","Z"])for(let orientation=0;orientation<4;orientation++){
    const game=setPiece(new Game(),name,orientation,4,8);
    const snapshot=game.toSnapshot();
    snapshot.version=2;
    snapshot.active.x=4;snapshot.active.y=8;
    const oldOffsets=TETROMINO_BY_NAME[name].orientations[orientation].map(([x,y])=>{
      if(orientation===0)return [x,y-1];
      if(orientation===1)return [x-1,y];
      if(orientation===2)return [x,y+1];
      return [x+1,y];
    });
    const expected=oldOffsets.map(([x,y])=>[x+4,y+8].join(",")).sort();
    const restored=Game.fromSnapshot(snapshot);
    assert.deepEqual(occupied(restored),expected,name+" v2 orientation "+orientation);
  }
});
