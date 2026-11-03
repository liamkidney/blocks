// NES gravity curve in 60 Hz frames per row. Easy begins at level 0;
// Hard begins at level 5. Both advance one level per ten cleared lines.
const GRAVITY_FRAMES=[48,43,38,33,28,23,18,13,8,6,5,5,5,4,4,4,3,3,3,2,2,2,2,2,2,2,2,2,2,1];
const LOCK_DELAY_SECONDS=0.5;
const MAX_LOCK_RESETS=15;
const HIDDEN_ROWS=2;

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
  constructor(tetrominoes=TETROMINOES){
    if(!tetrominoes.length)throw new Error("Piece queue needs at least one piece");
    this.tetrominoes=tetrominoes;
    this.pieces=[];
    this.bag=[];
    this.fill();
  }
  draw(){
    if(!this.bag.length){
      // Fisher-Yates: each standard seven-piece bag contains exactly one
      // of each tetromino. Restricted I/O games shuffle their allowed set.
      this.bag=[...this.tetrominoes];
      for(let i=this.bag.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];
      }
    }
    return this.bag.pop();
  }
  fill(){ while(this.pieces.length<2)this.pieces.push(this.draw()); }
  current(){ return this.pieces[0]; }
  next(){ return this.pieces[1]; }
  advance(){ this.pieces.shift();this.fill(); }
}

class Game {
  constructor(config={}){
    this.onEvent=typeof config.onEvent==="function"?config.onEvent:()=>{};
    this.width=10; this.height=20;
    this.grid=Array.from({length:this.height},()=>Array(this.width).fill(null));
    this.hiddenGrid=Array.from({length:HIDDEN_ROWS},()=>Array(this.width).fill(null));
    this.phase="falling"; this.completedRows=[]; this.score=0; this.lines=0;
    this.difficulty=parseGameMode(config.difficulty)??DEFAULT_GAME_MODE;
    this.elapsed=0;
    this.lockElapsed=null;
    this.lockResets=0;this.lowestY=null;this.hasLanded=false;
    const allowedNames=config.allowedPieces||TETROMINOES.map(t=>t.name);
    const tetrominoes=TETROMINOES.filter(t=>allowedNames.includes(t.name));
    this.queue=new PieceQueue(tetrominoes); this.nextTetromino=this.queue.next(); this.active=null; this.spawn();
  }
  get level(){const mode=GAME_MODES[this.difficulty];return mode.startingLevel+(mode.progressive?Math.floor(this.lines/10):0);}
  get tickSeconds(){return GRAVITY_FRAMES[Math.min(this.level,GRAVITY_FRAMES.length-1)]/60;}
  toSnapshot(){
    return {
      version:5,difficulty:this.difficulty,grid:this.grid.map(row=>[...row]),
      hiddenGrid:this.hiddenGrid.map(row=>[...row]),phase:this.phase,
      pausedPhase:this.pausedPhase||null,completedRows:[...this.completedRows],
      score:this.score,lines:this.lines,elapsed:this.elapsed,
      lockElapsed:this.lockElapsed,lockResets:this.lockResets,
      lowestY:this.lowestY,hasLanded:this.hasLanded,
      active:this.active?{name:this.active.tetromino.name,x:this.active.x,y:this.active.y,orientation:this.active.orientation}:null,
      queue:this.queue.pieces.map(t=>t.name),
      bag:this.queue.bag.map(t=>t.name)
    };
  }
  static fromSnapshot(snapshot,config={}){
    const allowedNames=config.allowedPieces||TETROMINOES.map(t=>t.name);
    const allowed=TETROMINOES.filter(t=>allowedNames.includes(t.name));
    const byName=Object.fromEntries(allowed.map(t=>[t.name,t]));
    const validName=name=>typeof name==="string"&&Object.hasOwn(byName,name);
    const integer=n=>Number.isSafeInteger(n)&&n>=0;
    if(!snapshot||![1,2,3,4,5].includes(snapshot.version)||!Array.isArray(snapshot.grid)||snapshot.grid.length!==20||
       !snapshot.grid.every(row=>Array.isArray(row)&&row.length===10&&row.every(v=>v===null||validName(v)))||
       (snapshot.version===5&&(!Array.isArray(snapshot.hiddenGrid)||snapshot.hiddenGrid.length!==HIDDEN_ROWS||
         !snapshot.hiddenGrid.every(row=>Array.isArray(row)&&row.length===10&&row.every(v=>v===null||validName(v)))))||
       !["falling","clearing_lines","paused","game_over"].includes(snapshot.phase)||
       !integer(snapshot.score)||!integer(snapshot.lines)||
       !Number.isFinite(snapshot.elapsed)||snapshot.elapsed<0||snapshot.elapsed>2||
       (snapshot.lockElapsed!==undefined&&snapshot.lockElapsed!==null&&
         (!Number.isFinite(snapshot.lockElapsed)||snapshot.lockElapsed<0||
          snapshot.lockElapsed>LOCK_DELAY_SECONDS))||
       !Array.isArray(snapshot.queue)||snapshot.queue.length!==2||!snapshot.queue.every(validName)||
       (snapshot.version>=4&&(!Array.isArray(snapshot.bag)||
         snapshot.bag.length>allowed.length||!snapshot.bag.every(validName)||
         new Set(snapshot.bag).size!==snapshot.bag.length))||
       (snapshot.version===5&&(!integer(snapshot.lockResets)||snapshot.lockResets>MAX_LOCK_RESETS||
         (snapshot.lowestY!==null&&!Number.isSafeInteger(snapshot.lowestY))||typeof snapshot.hasLanded!=="boolean"))||
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
    // v4 saved the pre-fix S/Z silhouettes. Swap identifiers to keep their
    // original shape and position on restore, including the queue and stack.
    const mapped=name=>snapshot.version===4?(name==="S"?"Z":name==="Z"?"S":name):name;
    game.grid=snapshot.grid.map(row=>row.map(v=>v===null?null:mapped(v)));
    game.hiddenGrid=snapshot.version===5?snapshot.hiddenGrid.map(row=>[...row]):
      Array.from({length:HIDDEN_ROWS},()=>Array(game.width).fill(null));
    game.phase=terminal?"game_over":"paused";
    game.pausedPhase=terminal?null:(clearing?"clearing_lines":"falling");
    game.completedRows=[...snapshot.completedRows];
    game.score=snapshot.score;game.lines=snapshot.lines;game.elapsed=snapshot.elapsed;
    game.queue.pieces=snapshot.queue.map(name=>byName[mapped(name)]);
    // Legacy saved games used weighted random selection, with no bag to
    // restore. Keep their current + next pieces, then begin a fresh bag.
    game.queue.bag=snapshot.version>=4?
      snapshot.bag.map(name=>byName[mapped(name)]):[];
    game.nextTetromino=game.queue.next();
    game.active=active?{tetromino:byName[mapped(active.name)],x:active.x,y:active.y,orientation:active.orientation}:null;
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
    game.lockElapsed=game.active?(snapshot.lockElapsed??null):null;
    game.lockResets=snapshot.version===5?snapshot.lockResets:0;
    game.lowestY=snapshot.version===5?snapshot.lowestY:null;
    game.hasLanded=snapshot.version===5?snapshot.hasLanded:game.lockElapsed!==null;
    game.syncLockTimer();
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
  // Extended Placement: at most fifteen movement/rotation resets after contact.
  // Only reaching a new lowest row replenishes the allowance.
  syncLockTimer(){
    if(!this.active){this.lockElapsed=null;return;}
    const bottom=Math.min(...this.offsets.map(([,y])=>this.active.y+y));
    if(this.lowestY===null||bottom<this.lowestY){this.lowestY=bottom;this.lockResets=0;}
    if(this.canPlace(this.offsets,this.active.x,this.active.y-1))this.lockElapsed=null;
    else{
      if(this.lockElapsed===null)this.lockElapsed=0;
      this.hasLanded=true;
    }
  }
  noteAdjustment(wasLanded){
    this.syncLockTimer();
    if(wasLanded&&this.lockResets<MAX_LOCK_RESETS){
      this.lockResets++;
      if(this.lockElapsed!==null)this.lockElapsed=0;
    }
  }
  update(dt){
    if(this.phase!=="falling"||!Number.isFinite(dt)||dt<=0)return;
    // Process the frame chronologically so landing partway through a frame
    // counts only the time actually spent grounded. The newly spawned piece
    // never inherits the remainder of the previous piece's frame.
    let remaining=dt;
    const piece=this.active;
    this.syncLockTimer();
    while(remaining>0&&this.phase==="falling"&&this.active===piece){
      const gravityIn=Math.max(0,this.tickSeconds-this.elapsed);
      const lockIn=this.lockElapsed===null?Infinity:
        Math.max(0,LOCK_DELAY_SECONDS-this.lockElapsed);
      const step=Math.min(remaining,gravityIn,lockIn);
      this.elapsed+=step;
      if(this.lockElapsed!==null)this.lockElapsed+=step;
      remaining-=step;
      if(this.lockElapsed!==null&&this.lockElapsed>=LOCK_DELAY_SECONDS-1e-9){
        this.lockPiece();return;
      }
      if(this.elapsed>=this.tickSeconds-1e-9){
        this.elapsed=Math.max(0,this.elapsed-this.tickSeconds);
        this.tick();
      }else if(step===0)break;
    }
  }
  press(name){
    if(this.phase!=="falling") return;
    if(name==="left") this.tryMove(-1,0);
    else if(name==="right") this.tryMove(1,0);
    else if(name==="rotate_ccw") this.tryRotate(-1);
    else if(name==="rotate_cw") this.tryRotate(1);
  }
  dropOne(){
    if(this.phase!=="falling"||!this.tryMove(0,-1))return;
    this.score++;
    // A successful soft drop never consumes a movement/rotation reset.
    this.elapsed=0;
  }
  tick(){
    if(!this.active)return;
    this.tryMove(0,-1);
    // Gravity landing arms the separate 500 ms lock clock.
    this.syncLockTimer();
  }
  lockPiece(){
    if(!this.active||this.phase!=="falling")return;
    // Lock-out only when the entire piece is outside the visible 20 rows.
    if(this.offsets.every(([,oy])=>this.active.y+oy>=this.height)){
      this.endGame();return;
    }
    for(const [ox,oy] of this.offsets){
      const y=this.active.y+oy,x=this.active.x+ox;
      const row=y>=this.height?this.hiddenGrid[y-this.height]:this.grid[y];
      if(!row){this.endGame();return;}
      row[x]=this.active.tetromino.name;
    }
    this.active=null;this.lockElapsed=null;
    this.completedRows=this.grid.map((row,y)=>row.every(Boolean)?y:-1).filter(y=>y>=0);
    if(this.completedRows.length){this.phase="clearing_lines";this.elapsed=0;}
    else this.advance();
  }
  presentationComplete(){
    if(this.phase!=="clearing_lines") return;
    const cleared=this.completedRows.length;
    const points={1:100,2:300,3:500,4:800};
    this.score+=points[cleared];
    this.lines+=this.completedRows.length;
    const done=new Set(this.completedRows);
    const rows=[...this.grid,...this.hiddenGrid].filter((_,y)=>!done.has(y));
    while(rows.length<this.height+HIDDEN_ROWS)rows.push(Array(this.width).fill(null));
    this.grid=rows.slice(0,this.height);
    this.hiddenGrid=rows.slice(this.height);
    this.completedRows=[]; this.phase="falling"; this.elapsed=0; this.advance();
    this.onEvent({type:"lines_cleared",count:cleared});
  }
  // Garbage enters at the bottom; both stack and active piece rise together.
  addGarbage(rows){
    if(!Number.isInteger(rows)||rows<0)throw new Error("Invalid garbage count");
    if(this.phase==="game_over"||rows===0)return;
    for(let i=0;i<rows;i++){
      const rows=[...this.grid,...this.hiddenGrid];
      const overflow=rows.pop().some(Boolean);
      // Each attack still grants ONE junk row per two cleared lines.
      // Fill exactly 4–7 randomly selected columns; leave 3–6 gaps.
      const columns=Array.from({length:this.width},(_,x)=>x);
      for(let j=columns.length-1;j>0;j--){
        const k=Math.floor(Math.random()*(j+1));
        [columns[j],columns[k]]=[columns[k],columns[j]];
      }
      const blockCount=4+Math.floor(Math.random()*4);
      const row=Array(this.width).fill(null);
      for(let j=0;j<blockCount;j++)row[columns[j]]="I";
      rows.unshift(row);
      this.grid=rows.slice(0,this.height);this.hiddenGrid=rows.slice(this.height);
      if(this.active)this.active.y++;
      if(this.completedRows.length)this.completedRows=this.completedRows.map(y=>y+1);
      // Only locked blocks crossing the top cause a garbage top-out.
      if(overflow||this.completedRows.some(y=>y>=this.height)){
        this.endGame();
        return;
      }
    }
    this.syncLockTimer();
  }
  endGame(){
    this.phase="game_over";
    this.completedRows=[];
    this.active=null;
    this.lockElapsed=null;this.lockResets=0;this.lowestY=null;this.hasLanded=false;
  }
  advance(){ this.queue.advance(); this.nextTetromino=this.queue.next(); this.spawn(); }
  spawn(){
    this.elapsed=0;this.lockElapsed=null;
    this.lockResets=0;this.lowestY=null;this.hasLanded=false;
    const t=this.queue.current(),offsets=t.orientations[0];
    const xs=offsets.map(p=>p[0]),ys=offsets.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),maxY=Math.max(...ys);
    const x=Math.floor((this.width-(maxX-minX+1))/2)-minX;
    const y=this.height+HIDDEN_ROWS-1-maxY;
    if(this.canPlace(offsets,x,y)){
      this.active={tetromino:t,x,y,orientation:0};this.syncLockTimer();
    }else this.endGame(); // Block-out in the hidden spawn area.
  }
  tryMove(dx,dy){
    if(!this.active)return false;
    const x=this.active.x+dx,y=this.active.y+dy;
    if(!this.canPlace(this.offsets,x,y))return false;
    const landed=this.hasLanded;
    this.active.x=x;this.active.y=y;
    if(dx!==0&&dy===0)this.noteAdjustment(landed);
    else this.syncLockTimer();
    return true;
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
      const landed=this.hasLanded;
      piece.x=x;piece.y=y;piece.orientation=orientation;
      this.noteAdjustment(landed);
      return true;
    }
    return false;
  }
  canPlace(offsets,x,y){
    return offsets.every(([ox,oy])=>{
      const cx=x+ox,cy=y+oy;
      return cx>=0&&cx<this.width&&cy>=0&&
        (cy>=this.height+HIDDEN_ROWS||
          (cy>=this.height?this.hiddenGrid[cy-this.height][cx]===null:this.grid[cy][cx]===null));
    });
  }
}
