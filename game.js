// NES gravity curve in 60 Hz frames per row. Easy begins at level 0;
// Hard begins at level 5. Both advance one level per ten cleared lines.
const GRAVITY_FRAMES=[48,43,38,33,28,23,18,13,8,6,5,5,5,4,4,4,3,3,3,2,2,2,2,2,2,2,2,2,2,1];

// Guideline Super Rotation System (SRS), using x right and y up.
// Transition state numbers: 0=spawn, 1=R, 2=reverse, 3=L.
// Each transition tests up to five positions, in priority order.
const SRS_KICKS_JLSTZ={
  "0>1":[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "1>0":[[0,0],[1,0],[1,-1],[0,2],[1,2]],
  "1>2":[[0,0],[1,0],[1,-1],[0,2],[1,2]],
  "2>1":[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "2>3":[[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  "3>2":[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "3>0":[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "0>3":[[0,0],[1,0],[1,1],[0,-2],[1,-2]]
};
const SRS_KICKS_I={
  "0>1":[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  "1>0":[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  "1>2":[[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  "2>1":[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  "2>3":[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  "3>2":[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  "3>0":[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  "0>3":[[0,0],[-1,0],[2,0],[-1,2],[2,-1]]
};

class PieceQueue {
  static DROUGHT_WEIGHT = 0.2;
  constructor(tetrominoes=TETROMINOES){
    this.tetrominoes=tetrominoes;
    this.pieces=[];
    this.droughts=Object.fromEntries(this.tetrominoes.map(t=>[t.name,0]));
    this.fill();
  }
  choose(){
    const weights=this.tetrominoes.map(t=>1+PieceQueue.DROUGHT_WEIGHT*this.droughts[t.name]);
    const total=weights.reduce((a,b)=>a+b,0);
    let pick=Math.random()*total, chosen=this.tetrominoes[this.tetrominoes.length-1];
    for(let i=0;i<this.tetrominoes.length;i++){ pick-=weights[i]; if(pick<0){ chosen=this.tetrominoes[i]; break; } }
    for(const t of this.tetrominoes) this.droughts[t.name]=t.name===chosen.name?0:this.droughts[t.name]+1;
    return chosen;
  }
  fill(){ while(this.pieces.length<2) this.pieces.push(this.choose()); }
  current(){ return this.pieces[0]; }
  next(){ return this.pieces[1]; }
  advance(){ this.pieces.shift(); this.fill(); }
}

class Game {
  constructor(config={}){
    this.onEvent=typeof config.onEvent==="function"?config.onEvent:()=>{};
    this.width=10; this.height=20;
    this.grid=Array.from({length:this.height},()=>Array(this.width).fill(null));
    this.phase="falling"; this.completedRows=[]; this.score=0; this.lines=0;
    this.difficulty=parseGameMode(config.difficulty)??DEFAULT_GAME_MODE;
    this.elapsed=0;
    const allowedNames=config.allowedPieces||TETROMINOES.map(t=>t.name);
    const tetrominoes=TETROMINOES.filter(t=>allowedNames.includes(t.name));
    this.queue=new PieceQueue(tetrominoes); this.nextTetromino=this.queue.next(); this.active=null; this.spawn();
  }
  get level(){const mode=GAME_MODES[this.difficulty];return mode.startingLevel+(mode.progressive?Math.floor(this.lines/10):0);}
  get tickSeconds(){return GRAVITY_FRAMES[Math.min(this.level,GRAVITY_FRAMES.length-1)]/60;}
  toSnapshot(){
    return {
      version:3,difficulty:this.difficulty,grid:this.grid.map(row=>[...row]),phase:this.phase,
      pausedPhase:this.pausedPhase||null,completedRows:[...this.completedRows],
      score:this.score,lines:this.lines,elapsed:this.elapsed,
      active:this.active?{name:this.active.tetromino.name,x:this.active.x,y:this.active.y,orientation:this.active.orientation}:null,
      queue:this.queue.pieces.map(t=>t.name),droughts:{...this.queue.droughts}
    };
  }
  static fromSnapshot(snapshot,config={}){
    const allowedNames=config.allowedPieces||TETROMINOES.map(t=>t.name);
    const allowed=TETROMINOES.filter(t=>allowedNames.includes(t.name));
    const byName=Object.fromEntries(allowed.map(t=>[t.name,t]));
    const validName=name=>typeof name==="string"&&Object.hasOwn(byName,name);
    const integer=n=>Number.isSafeInteger(n)&&n>=0;
    if(!snapshot||![1,2,3].includes(snapshot.version)||!Array.isArray(snapshot.grid)||snapshot.grid.length!==20||
       !snapshot.grid.every(row=>Array.isArray(row)&&row.length===10&&row.every(v=>v===null||validName(v)))||
       !["falling","clearing_lines","paused","game_over"].includes(snapshot.phase)||
       !integer(snapshot.score)||!integer(snapshot.lines)||
       !Number.isFinite(snapshot.elapsed)||snapshot.elapsed<0||snapshot.elapsed>2||
       !Array.isArray(snapshot.queue)||snapshot.queue.length!==2||!snapshot.queue.every(validName)||
       !snapshot.droughts||!allowed.every(t=>integer(snapshot.droughts[t.name]))||
       !Array.isArray(snapshot.completedRows)||!snapshot.completedRows.every(y=>integer(y)&&y<20)||
       (snapshot.phase==="paused"&&!["falling","clearing_lines"].includes(snapshot.pausedPhase))) throw new Error("Invalid saved game");
    const terminal=snapshot.phase==="game_over";
    const clearing=snapshot.phase==="clearing_lines"||snapshot.phase==="paused"&&snapshot.pausedPhase==="clearing_lines";
    if(clearing!==Boolean(snapshot.completedRows.length))throw new Error("Invalid clearing state");
    const active=snapshot.active;
    if((!clearing&&!terminal&&!active)||(clearing&&active)||(terminal&&active))throw new Error("Invalid active piece");
    if(active&&(!validName(active.name)||!Number.isInteger(active.x)||!Number.isInteger(active.y)||
       !integer(active.orientation)||active.orientation>3))throw new Error("Invalid active piece");
    if(snapshot.difficulty!==undefined&&parseGameMode(snapshot.difficulty)===null)throw new Error("Invalid saved difficulty");
    // Older snapshots without a mode used constant 0.8s gravity (Beginner).
    const game=new Game({...config,difficulty:snapshot.difficulty===undefined?0:parseGameMode(snapshot.difficulty)});
    game.grid=snapshot.grid.map(row=>[...row]);
    game.phase=terminal?"game_over":"paused";
    game.pausedPhase=terminal?null:(clearing?"clearing_lines":"falling");
    game.completedRows=[...snapshot.completedRows];
    game.score=snapshot.score;game.lines=snapshot.lines;game.elapsed=snapshot.elapsed;
    game.queue.pieces=snapshot.queue.map(name=>byName[name]);
    game.queue.droughts=Object.fromEntries(allowed.map(t=>[t.name,snapshot.droughts[t.name]]));
    game.nextTetromino=game.queue.next();
    game.active=active?{tetromino:byName[active.name],x:active.x,y:active.y,orientation:active.orientation}:null;
    // S/Z had offset pivots in snapshots v1 and v2. Preserve the
    // occupied board cells when restoring into the corrected v3 SRS
    // orientations; only the anchor changes, never the visible piece.
    if(snapshot.version<3&&game.active&&["S","Z"].includes(active.name)){
      if(active.orientation===0)game.active.y--;
      else if(active.orientation===1)game.active.x--;
      else if(snapshot.version===2&&active.orientation===2)game.active.y++;
      else if(snapshot.version===2&&active.orientation===3)game.active.x++;
    }
    if(game.active&&!game.canPlace(game.offsets,game.active.x,game.active.y))throw new Error("Invalid active position");
    return game;
  }
  pause(){
    if(this.phase!=="falling"&&this.phase!=="clearing_lines")return;
    this.pausedPhase=this.phase;
    this.phase="paused";
  }
  resume(){
    if(this.phase!=="paused")return;
    this.phase=this.pausedPhase;
    this.pausedPhase=null;
  }
  get offsets(){ return this.active.tetromino.orientations[this.active.orientation]; }
  get ghostY(){
    if(!this.active)return null;
    let y=this.active.y;
    while(this.canPlace(this.offsets,this.active.x,y-1))y--;
    return y;
  }
  update(dt){
    if(this.phase!=="falling") return;
    this.elapsed+=dt;
    while(this.elapsed>=this.tickSeconds){ this.elapsed-=this.tickSeconds; this.tick(); }
  }
  press(name){
    if(this.phase!=="falling") return;
    if(name==="left") this.tryMove(-1,0);
    else if(name==="right") this.tryMove(1,0);
    else if(name==="rotate_ccw") this.tryRotate(-1);
    else if(name==="rotate_cw") this.tryRotate(1);
  }
  dropOne(){ if(this.phase==="falling"&&this.tryMove(0,-1)) this.score++; }
  tick(){
    if(!this.active) return;
    if(this.tryMove(0,-1)) return;
    // A piece may rotate above the visible board, but must never lock there.
    if(this.offsets.some(([,oy])=>this.active.y+oy>=this.height)){
      this.endGame();return;
    }
    for(const [ox,oy] of this.offsets) this.grid[this.active.y+oy][this.active.x+ox]=this.active.tetromino.name;
    this.active=null;
    this.completedRows=this.grid.map((row,y)=>row.every(Boolean)?y:-1).filter(y=>y>=0);
    if(this.completedRows.length){ this.phase="clearing_lines"; this.elapsed=0; }
    else this.advance();
  }
  presentationComplete(){
    if(this.phase!=="clearing_lines") return;
    const cleared=this.completedRows.length;
    const points={1:100,2:300,3:500,4:800};
    this.score+=points[cleared];
    this.lines+=this.completedRows.length;
    const done=new Set(this.completedRows);
    this.grid=this.grid.filter((_,y)=>!done.has(y));
    while(this.grid.length<this.height) this.grid.push(Array(this.width).fill(null));
    this.completedRows=[]; this.phase="falling"; this.elapsed=0; this.advance();
    this.onEvent({type:"lines_cleared",count:cleared});
  }
  // Garbage enters at the bottom; both stack and active piece rise together.
  addGarbage(rows){
    if(!Number.isInteger(rows)||rows<0)throw new Error("Invalid garbage count");
    if(this.phase==="game_over"||rows===0)return;
    for(let i=0;i<rows;i++){
      const overflow=this.grid[this.height-1].some(Boolean);
      this.grid.pop();
      const row=Array.from({length:this.width},()=>Math.random()<0.7?"I":null);
      if(row.every(Boolean))row[Math.floor(Math.random()*this.width)]=null;
      this.grid.unshift(row);
      if(this.active)this.active.y++;
      if(this.completedRows.length)this.completedRows=this.completedRows.map(y=>y+1);
      // Only locked blocks crossing the top cause a garbage top-out.
      if(overflow||this.completedRows.some(y=>y>=this.height)){
        this.endGame();
        return;
      }
    }
  }
  endGame(){
    this.phase="game_over";
    this.completedRows=[];
    this.active=null;
  }
  advance(){ this.queue.advance(); this.nextTetromino=this.queue.next(); this.spawn(); }
  spawn(){
    const t=this.queue.current(), offsets=t.orientations[0];
    const xs=offsets.map(p=>p[0]),ys=offsets.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),maxY=Math.max(...ys);
    const x=Math.floor((this.width-(maxX-minX+1))/2)-minX;
    const y=this.height-1-maxY;
    if(this.canPlace(offsets,x,y)) this.active={tetromino:t,x,y,orientation:0};
    else this.endGame();
  }
  tryMove(dx,dy){
    if(!this.active) return false;
    const x=this.active.x+dx,y=this.active.y+dy;
    if(!this.canPlace(this.offsets,x,y)) return false;
    this.active.x=x;this.active.y=y;return true;
  }
  tryRotate(direction){
    if(!this.active||(direction!==1&&direction!==-1))return false;
    const piece=this.active;
    const orientation=(piece.orientation+direction+4)%4;
    const offsets=piece.tetromino.orientations[orientation];
    const transition=piece.orientation+">"+orientation;
    const kicks=piece.tetromino.name==="O"?[[0,0]]:
      (piece.tetromino.name==="I"?SRS_KICKS_I:SRS_KICKS_JLSTZ)[transition];
    // Never move or rotate unless a candidate fits; a blocked rotation
    // must leave the active piece untouched.
    for(const [dx,dy] of kicks){
      const x=piece.x+dx,y=piece.y+dy;
      if(!this.canPlace(offsets,x,y))continue;
      piece.x=x;piece.y=y;piece.orientation=orientation;
      return true;
    }
    return false;
  }
  canPlace(offsets,x,y){
    return offsets.every(([ox,oy])=>{
      const cx=x+ox,cy=y+oy;
      return cx>=0&&cx<this.width&&cy>=0&&(cy>=this.height||this.grid[cy][cx]===null);
    });
  }
}
