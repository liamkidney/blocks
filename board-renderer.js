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

// Render the opponent's board in its own 10x20 HUD miniature, never
// on top of the local playfield. Only changed cells update.
function createOpponentMiniBoard(container){
  const cells=[];
  for(let i=0;i<200;i++){
    const cell=document.createElement("span");
    cell.className="opponent-mini-cell";
    container.appendChild(cell);
    cells.push(cell);
  }
  const previous=Array(200).fill(0);
  const paint=next=>{
    for(let i=0;i<200;i++){
      if(next[i]===previous[i])continue;
      cells[i].className=next[i]===2?"opponent-mini-cell falling":
        next[i]===1?"opponent-mini-cell locked":"opponent-mini-cell";
      previous[i]=next[i];
    }
  };
  return {
    show(rows){
      if(!validOpponentBoard(rows))return false;
      const next=Array(200).fill(0);
      for(let y=0;y<20;y++)for(let x=0;x<10;x++){
        const mask=rows[y];
        next[(19-y)*10+x]=(mask>>(x+10)&1)?2:(mask>>x&1)?1:0;
      }
      paint(next);
      return true;
    },
    clear(){paint(Array(200).fill(0))}
  };
}
