class PieceQueue {
  static DROUGHT_WEIGHT = 0.2;
  constructor(){
    this.pieces=[];
    this.droughts=Object.fromEntries(TETROMINOES.map(t=>[t.name,0]));
    this.fill();
  }
  choose(){
    const weights=TETROMINOES.map(t=>1+PieceQueue.DROUGHT_WEIGHT*this.droughts[t.name]);
    const total=weights.reduce((a,b)=>a+b,0);
    let pick=Math.random()*total, chosen=TETROMINOES[TETROMINOES.length-1];
    for(let i=0;i<TETROMINOES.length;i++){ pick-=weights[i]; if(pick<0){ chosen=TETROMINOES[i]; break; } }
    for(const t of TETROMINOES) this.droughts[t.name]=t.name===chosen.name?0:this.droughts[t.name]+1;
    return chosen;
  }
  fill(){ while(this.pieces.length<2) this.pieces.push(this.choose()); }
  current(){ return this.pieces[0]; }
  next(){ return this.pieces[1]; }
  advance(){ this.pieces.shift(); this.fill(); }
}

class Game {
  constructor(){
    this.width=10; this.height=20;
    this.grid=Array.from({length:this.height},()=>Array(this.width).fill(null));
    this.phase="falling"; this.completedRows=[]; this.score=0; this.lines=0;
    this.tickSeconds=1.0; this.elapsed=0;
    this.queue=new PieceQueue(); this.nextTetromino=this.queue.next(); this.active=null; this.spawn();
  }
  get offsets(){ return this.active.tetromino.orientations[this.active.orientation]; }
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
    for(const [ox,oy] of this.offsets) this.grid[this.active.y+oy][this.active.x+ox]=this.active.tetromino.name;
    this.active=null;
    this.completedRows=this.grid.map((row,y)=>row.every(Boolean)?y:-1).filter(y=>y>=0);
    if(this.completedRows.length){ this.phase="clearing_lines"; this.elapsed=0; }
    else this.advance();
  }
  presentationComplete(){
    if(this.phase!=="clearing_lines") return;
    const points={1:100,2:300,3:500,4:800};
    this.score+=points[this.completedRows.length];
    this.lines+=this.completedRows.length;
    const done=new Set(this.completedRows);
    this.grid=this.grid.filter((_,y)=>!done.has(y));
    while(this.grid.length<this.height) this.grid.push(Array(this.width).fill(null));
    this.completedRows=[]; this.phase="falling"; this.elapsed=0; this.advance();
  }
  advance(){ this.queue.advance(); this.nextTetromino=this.queue.next(); this.spawn(); }
  spawn(){
    const t=this.queue.current(), offsets=t.orientations[0];
    const xs=offsets.map(p=>p[0]),ys=offsets.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),maxY=Math.max(...ys);
    const x=Math.floor((this.width-(maxX-minX+1))/2)-minX;
    const y=this.height-1-maxY;
    if(this.canPlace(offsets,x,y)) this.active={tetromino:t,x,y,orientation:0};
  }
  tryMove(dx,dy){
    if(!this.active) return false;
    const x=this.active.x+dx,y=this.active.y+dy;
    if(!this.canPlace(this.offsets,x,y)) return false;
    this.active.x=x;this.active.y=y;return true;
  }
  tryRotate(direction){
    if(!this.active) return;
    const orientation=(this.active.orientation+direction+4)%4;
    const offsets=this.active.tetromino.orientations[orientation];
    if(this.canPlace(offsets,this.active.x,this.active.y)) this.active.orientation=orientation;
  }
  canPlace(offsets,x,y){
    return offsets.every(([ox,oy])=>{
      const cx=x+ox,cy=y+oy;
      return cx>=0&&cx<this.width&&cy>=0&&cy<this.height&&this.grid[cy][cx]===null;
    });
  }
}
