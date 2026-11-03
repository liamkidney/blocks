const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.join(__dirname,"..");
const context=vm.createContext({Math});
for(const name of ["game-modes.js","tetrominoes.js","game.js"])
  vm.runInContext(fs.readFileSync(path.join(root,name),"utf8"),context,{filename:name});
const {Game,TETROMINOES,TETROMINO_BY_NAME}=
  vm.runInContext("({Game,TETROMINOES,TETROMINO_BY_NAME})",context);

test("green S has upper pair to the right; red Z has upper pair to the left",()=>{
  const profile=name=>{
    const piece=TETROMINO_BY_NAME[name];
    const top=Math.max(...piece.orientations[0].map(([,y])=>y));
    const bottom=Math.min(...piece.orientations[0].map(([,y])=>y));
    return {
      top:piece.orientations[0].filter(([,y])=>y===top).map(([x])=>x).sort(),
      bottom:piece.orientations[0].filter(([,y])=>y===bottom).map(([x])=>x).sort()
    };
  };
  assert.deepEqual(JSON.parse(JSON.stringify(profile("S"))),{top:[1,2],bottom:[0,1]});
  assert.deepEqual(JSON.parse(JSON.stringify(profile("Z"))),{top:[0,1],bottom:[1,2]});
  assert.equal(TETROMINO_BY_NAME.S.color,"#33b34d");
  assert.equal(TETROMINO_BY_NAME.Z.color,"#d93340");
});

test("all seven pieces enter view immediately from the two-row spawn buffer",()=>{
  for(const piece of TETROMINOES){
    const game=new Game({allowedPieces:[piece.name]});
    assert.equal(game.grid.length,20);
    assert.equal(game.hiddenGrid.length,2);
    assert.equal(game.phase,"falling");
    const cells=game.offsets.map(([x,y])=>[x+game.active.x,y+game.active.y]);
    assert.ok(cells.every(([x,y])=>x>=0&&x<10&&y>=0&&y<22),piece.name);
    assert.ok(cells.some(([,y])=>y<20),"piece must be visible immediately: "+piece.name);
  }
});

test("an occupied hidden spawn cell causes immediate block-out",()=>{
  const game=new Game({allowedPieces:["O"]});
  const [ox,oy]=game.offsets[0];
  const spawnY=game.height+1-Math.max(...game.offsets.map(([,y])=>y));
  game.hiddenGrid[spawnY+oy-20][game.active.x+ox]="I";
  game.spawn();
  assert.equal(game.phase,"game_over");
  assert.equal(game.active,null);
});

test("a piece supported entirely above the visible field locks out",()=>{
  const game=new Game({allowedPieces:["O"]});
  game.active.y=20; // Keep the O piece entirely in the spawn buffer.
  game.grid[19][4]="I";
  game.syncLockTimer();
  assert.equal(game.lockElapsed,0);
  game.update(.5);
  assert.equal(game.phase,"game_over");
  assert.equal(game.active,null);
});

test("a piece partly above the visible field stores all its blocks before block-out",()=>{
  const game=new Game({allowedPieces:["O"]});
  game.grid[18][4]="I";
  game.syncLockTimer();
  assert.equal(game.active.y,19);
  assert.equal(game.lockElapsed,0);
  game.update(.5);
  assert.equal(game.grid[19][4],"O");
  assert.equal(game.hiddenGrid[0][4],"O");
  assert.equal(game.phase,"game_over","the next spawn is obstructed by hidden blocks");
});

test("line clear shifts hidden blocks down into visible rows",()=>{
  const game=new Game({allowedPieces:["O"]});
  game.hiddenGrid[0][0]="S";
  game.grid[0].fill("I");
  game.active=null;game.phase="clearing_lines";game.completedRows=[0];
  game.presentationComplete();
  assert.equal(game.grid.length,20);
  assert.equal(game.grid[19][0],"S");
  assert.equal(game.hiddenGrid[0][0],null);
});

test("garbage moves visible top-row blocks into the hidden buffer",()=>{
  const game=new Game({allowedPieces:["O"]});
  game.grid[19][0]="J";
  game.addGarbage(1);
  assert.equal(game.phase,"falling");
  assert.equal(game.hiddenGrid[0][0],"J");
  assert.equal(game.grid[19][0],null);
});

test("v4 S/Z snapshots preserve their occupied shape under corrected v5 names",()=>{
  const game=new Game({allowedPieces:["S","Z"]});
  game.active={tetromino:TETROMINO_BY_NAME.Z,x:3,y:10,orientation:1};
  const snapshot=game.toSnapshot();
  snapshot.version=4;
  snapshot.active.name="S"; // v4 called the current Z silhouette S.
  snapshot.queue=snapshot.queue.map(name=>name==="S"?"Z":"S");
  snapshot.bag=snapshot.bag.map(name=>name==="S"?"Z":"S");
  snapshot.grid[0][0]="S";
  delete snapshot.hiddenGrid;
  delete snapshot.lockResets;delete snapshot.lowestY;delete snapshot.hasLanded;
  const restored=Game.fromSnapshot(snapshot,{allowedPieces:["S","Z"]});
  assert.equal(restored.active.tetromino.name,"Z");
  assert.equal(restored.active.x,3);
  assert.equal(restored.active.y,10);
  assert.equal(restored.active.orientation,1);
  assert.equal(restored.grid[0][0],"Z");
  assert.equal(restored.toSnapshot().version,5);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.toSnapshot().queue)),
    JSON.parse(JSON.stringify(game.toSnapshot().queue)));
});

test("v5 preserves hidden rows and bounded lock-reset state across pause",()=>{
  const game=new Game({allowedPieces:["O"]});
  game.hiddenGrid[0][0]="O";
  while(game.tryMove(0,-1)){}
  game.tryRotate(1);game.tryRotate(1);
  game.update(.2);
  game.pause();
  const saved=game.toSnapshot();
  const restored=Game.fromSnapshot(saved,{allowedPieces:["O"]});
  assert.equal(restored.phase,"paused");
  assert.equal(restored.hiddenGrid[0][0],"O");
  assert.equal(restored.lockResets,2);
  assert.equal(restored.lockElapsed,.2);
});

test("250ms line-clear animation and opaque pause masking are retained",()=>{
  const css=fs.readFileSync(path.join(root,"styles.css"),"utf8");
  const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
  assert.match(css,/animation:clearFlash 250ms steps\(1,end\) 1 forwards/);
  const flash=css.match(/@keyframes clearFlash \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(flash,"line-clear keyframes should be present");
  assert.match(flash,/0%,49\.999%\s*\{\s*background:var\(--ink\)/);
  assert.match(flash,/50%,100%\s*\{\s*background:var\(--paper\)/);
  assert.doesNotMatch(flash,/16\.666%|33\.333%|66\.666%|83\.333%/,
    "the original triple-flash strobe must not return");
  assert.match(css,/#board-frame\.game-paused #board\{visibility:hidden\}/);
  assert.match(css,/body\.match-paused \.second-board\{visibility:hidden\}/);
  assert.match(css,/body\.blocks-game-paused :is\(#preview,#preview-card,\.second-preview\)\{visibility:hidden\}/);
  assert.match(app,/classList\.toggle\("blocks-game-paused",paused\)/);
});
