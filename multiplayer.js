// Mode selection, independent second board, and simultaneous player controls.
(function(){
  if(!TWO_PLAYER)return;
  document.body.classList.add("two-player");
  const second=document.createElement("div");
  second.id="second-game";
  second.innerHTML='<div class="second-board-wrap"><div class="player-label">PLAYER 2</div><div class="second-board-frame"><div class="second-board"></div></div></div><div class="second-hud"><div class="hud-label">NEXT</div><div class="second-preview"></div><div class="metric"><div class="hud-label">SCORE</div><div class="value second-score">0</div></div><div class="metric"><div class="hud-label">LINES</div><div class="value second-lines">0</div></div></div>';
  document.getElementById("console").appendChild(second);
  const controls2=document.createElement("div");
  controls2.id="player-two-controls";
  controls2.innerHTML='<div class="second-movement"><button class="control" data-player="1" data-command="left" aria-label="Player 2 move left"><span class="icon">←</span></button><button class="control" data-player="1" data-command="right" aria-label="Player 2 move right"><span class="icon">→</span></button><button class="control" data-player="1" data-command="down" aria-label="Player 2 drop"><span class="icon">↓</span></button></div><button class="control rotate" data-player="1" data-command="rotate_cw" aria-label="Player 2 rotate clockwise"><span class="icon"><svg class="rotate-svg" viewBox="0 0 32 32"><path d="M25 11 A11 11 0 1 0 25 22"/><path d="M25 11 L25 5 M25 11 L19 10"/></svg></span></button>';
  document.getElementById("console").appendChild(controls2);
  bindGameControls(controls2);
  const consoleElement=document.getElementById("console");
  const playerOneStation=document.createElement("div");
  playerOneStation.id="player-one-station";
  consoleElement.insertBefore(playerOneStation,document.getElementById("game"));
  playerOneStation.append(document.getElementById("game"),document.getElementById("controls"));
  const playerTwoStation=document.createElement("div");
  playerTwoStation.id="player-two-station";
  consoleElement.insertBefore(playerTwoStation,playerOneStation);
  playerTwoStation.append(second,controls2);
  // Normalize both pads to the same four direct children before applying the grid.
  // The single-player DOM remains unchanged.
  for(const pad of [document.getElementById("controls"),controls2]){
    const buttons=Array.from(pad.querySelectorAll("button.control"));
    for(const button of buttons)pad.appendChild(button);
    pad.classList.add("diamond-pad");
  }

  for(const id of ["movement-controls","rotation-controls"]){
    const wrapper=document.getElementById(id);
    if(wrapper)wrapper.remove();
  }
  const secondMovement=controls2.querySelector(".second-movement");
  if(secondMovement)secondMovement.remove();
  const secondHud=second.querySelector(".second-hud");
  const nextGroup=document.createElement("div");
  nextGroup.className="next-group";
  secondHud.insertBefore(nextGroup,secondHud.firstChild);
  nextGroup.append(secondHud.querySelector(".hud-label"),secondHud.querySelector(".second-preview"));
  document.getElementById("hud").firstElementChild.classList.add("next-group");
  const firstLabel=document.createElement("div");
  firstLabel.className="player-label first-player-label";
  firstLabel.textContent="PLAYER 1";
  document.getElementById("board-frame").appendChild(firstLabel);
  const result=document.createElement("div");
  result.id="match-result";
  result.hidden=true;
  result.setAttribute("role","status");
  result.innerHTML='<div class="match-result-panel"><div id="match-result-title"></div><button id="match-again" type="button">NEW MATCH</button></div>';
  document.body.appendChild(result);
  bindImmediateAction(result.querySelector("#match-again"),restartGame);
  const board2=second.querySelector(".second-board");
  const cells=[];
  for(let y=19;y>=0;y--)for(let x=0;x<10;x++){
    const cell=document.createElement("div");
    cell.className="cell";board2.appendChild(cell);cells.push(cell);
  }
  const preview2=second.querySelector(".second-preview");
  const getGame2=()=>session.games[1];
  const boardIndex2=(x,y)=>(19-y)*10+x;
  function paint(x,y,name,clearing){
    if(x<0||x>=10||y<0||y>=20)return;
    const cell=cells[boardIndex2(x,y)];
    const cls=clearing?"cell filled clearing":"cell filled";
    if(cell.className!==cls)cell.className=cls;
    cell.style.backgroundColor=TETROMINO_BY_NAME[name].color;
  }
  function drawPreview(){
    preview2.replaceChildren();
    const t=getGame2().nextTetromino;
    if(!t)return;
    const offsets=t.orientations[0];
    const xs=offsets.map(p=>p[0]),ys=offsets.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const pct=maxX-minX+1===4?21:25;
    const left=(100-(maxX-minX+1)*pct)/2;
    const top=(100-(maxY-minY+1)*pct)/2;
    for(const [x,y] of offsets){
      const cell=document.createElement("div");
      cell.className="preview-cell filled";
      cell.style.backgroundColor=t.color;
      cell.style.width=pct+"%";cell.style.height=pct+"%";
      cell.style.left=left+(x-minX)*pct+"%";
      cell.style.top=top+(maxY-y)*pct+"%";
      preview2.appendChild(cell);
    }
  }
  let previousNext=null;
  function renderSecond(){
    const game2=getGame2();
    const clearing=game2.phase==="clearing_lines"||(game2.phase==="paused"&&game2.pausedPhase==="clearing_lines");
    for(const cell of cells){
      if(!(clearing&&cell.classList.contains("clearing")))cell.className="cell";
      cell.style.background="";
    }
    for(let y=0;y<20;y++)for(let x=0;x<10;x++){
      const name=game2.grid[y][x];
      if(name)paint(x,y,name,clearing&&game2.completedRows.includes(y));
    }
    if(game2.active)for(const [ox,oy] of game2.offsets)
      paint(game2.active.x+ox,game2.active.y+oy,game2.active.tetromino.name,false);
    second.querySelector(".second-score").textContent=game2.score;
    second.querySelector(".second-lines").textContent=game2.lines;
    if(previousNext!==game2.nextTetromino){previousNext=game2.nextTetromino;drawPreview();}
    const outcome=session.resolveOutcome();
    result.hidden=!outcome;
    if(outcome)result.querySelector("#match-result-title").textContent=outcome==="draw"?"DRAW":outcome==="player1"?"PLAYER 1 WINS":"PLAYER 2 WINS";
    second.classList.toggle("second-game-over",game2.phase==="game_over"&&!outcome);
    requestAnimationFrame(renderSecond);
  }
  board2.addEventListener("animationend",event=>{
    const game2=getGame2();
    if(!session.outcome&&game2.phase==="clearing_lines"&&event.animationName==="clearFlash"&&
      event.pseudoElement==="::after"&&event.target===board2.querySelector(".cell.clearing"))
      game2.presentationComplete();
  });
  renderSecond();
})();
