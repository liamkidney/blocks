// Draw only changed board cells. Identical scenes do not rewrite the DOM,
// keeping the main thread available for touch input at high fall speeds.
function createBoardRenderer(cells){
  if(cells.length!==200)throw new Error("A Blocks board needs exactly 200 cells");
  const oldClasses=Array(200).fill(null);
  const oldColors=Array(200).fill(null);
  const nextClasses=Array(200).fill("cell");
  const nextColors=Array(200).fill("");
  const at=(x,y)=>(19-y)*10+x;

  return function drawBoard(game,showGhost=false){
    nextClasses.fill("cell");
    nextColors.fill("");
    const mark=(x,y,name)=>{
      if(x<0||x>=10||y<0||y>=20)return;
      const i=at(x,y);
      nextClasses[i]="cell filled";
      nextColors[i]=TETROMINO_BY_NAME[name].color;
    };
    for(let y=0;y<20;y++)for(let x=0;x<10;x++){
      const name=game.grid[y][x];
      if(name)mark(x,y,name);
    }
    if(game.active&&showGhost){
      const ghostY=game.ghostY;
      if(ghostY!==game.active.y)for(const [dx,dy] of game.offsets){
        const x=game.active.x+dx,y=ghostY+dy;
        if(x>=0&&x<10&&y>=0&&y<20)nextClasses[at(x,y)]+=" ghost";
      }
    }
    if(game.active)for(const [dx,dy] of game.offsets)
      mark(game.active.x+dx,game.active.y+dy,game.active.tetromino.name);

    const clearing=game.phase==="clearing_lines"||
      (game.phase==="paused"&&game.pausedPhase==="clearing_lines");
    if(clearing)for(const y of game.completedRows)for(let x=0;x<10;x++)
      nextClasses[at(x,y)]+=" clearing";

    for(let i=0;i<200;i++){
      if(nextClasses[i]!==oldClasses[i]){
        cells[i].className=nextClasses[i];
        oldClasses[i]=nextClasses[i];
      }
      if(nextColors[i]!==oldColors[i]){
        cells[i].style.backgroundColor=nextColors[i];
        oldColors[i]=nextColors[i];
      }
    }
  };
}

// Encode the opponent's complete 10x20 board as twenty small integers.
// Low 10 bits are locked blocks; high 10 bits are the active falling piece.
// No colours, game state, tokens or player identifiers are transmitted here.
function encodeOpponentBoard(game){
  const rows=Array(20).fill(0);
  for(let y=0;y<20;y++)for(let x=0;x<10;x++)
    if(game.grid[y][x])rows[y]|=1<<x;
  if(game.active)for(const [dx,dy] of game.offsets){
    const x=game.active.x+dx,y=game.active.y+dy;
    if(x>=0&&x<10&&y>=0&&y<20)rows[y]|=1<<(x+10);
  }
  return rows;
}

function validOpponentBoard(rows){
  return Array.isArray(rows)&&rows.length===20&&
    rows.every(n=>Number.isSafeInteger(n)&&n>=0&&n<1048576);
}

// A non-interactive translucent layer; it does not steal taps or alter
// the local board's highly optimised renderer.
function createOpponentBoardOverlay(board){
  const layer=document.createElement("div");
  layer.id="remote-opponent-overlay";
  layer.hidden=true;
  layer.setAttribute("aria-hidden","true");
  const cells=[];
  for(let i=0;i<200;i++){
    const cell=document.createElement("div");
    cell.className="remote-opponent-cell";
    layer.appendChild(cell);
    cells.push(cell);
  }
  board.appendChild(layer);
  board.classList.add("has-opponent-overlay");
  let previous=Array(200).fill(0),stale=false;
  return {
    show(rows){
      if(!validOpponentBoard(rows))return false;
      for(let y=0;y<20;y++)for(let x=0;x<10;x++){
        const mask=rows[y],state=(mask>>(x+10)&1)?2:(mask>>x&1)?1:0;
        const index=(19-y)*10+x;
        if(state===previous[index])continue;
        cells[index].className=state===2?"remote-opponent-cell active":
          state===1?"remote-opponent-cell occupied":"remote-opponent-cell";
        previous[index]=state;
      }
      layer.hidden=false;
      this.setStale(false);
      return true;
    },
    setStale(next){
      const value=Boolean(next);
      if(value===stale)return;
      stale=value;
      layer.className=stale?"stale":"";
    },
    hide(){
      layer.hidden=true;
      this.setStale(false);
    },
    get visible(){return !layer.hidden},
    get stale(){return stale}
  };
}
