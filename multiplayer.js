// Mode selection, independent second board, and simultaneous player controls.
(function(){
  if(!TWO_PLAYER)return;
  document.body.classList.add("two-player");
  const second=document.createElement("div");
  second.id="second-game";
  second.innerHTML='<div class="second-board-wrap"><div class="player-label">PLAYER 2</div><div class="second-board-frame"><div class="second-board"></div></div></div><div class="second-hud"><div class="hud-label">NEXT</div><div class="second-preview"></div><div class="metric"><div class="hud-label">SCORE</div><div class="value second-score">0</div></div><div class="metric"><div class="hud-label">LINES</div><div class="value second-lines">0</div></div></div>';
  document.getElementById("console").appendChild(second);
  // Reuse the exact same buttons/icons/labels as the main control pad.
  const controls2=window.BLOCKS_CONTROL_LAYOUT.createPad(
    document.getElementById("controls"),1);
  controls2.id="player-two-controls";
  document.getElementById("console").appendChild(controls2);
  bindGameControls(controls2);
  const consoleElement=document.getElementById("console");
  const playerOneStation=document.createElement("div");
  playerOneStation.id="player-one-station";
  playerOneStation.classList.add("player-station");
  consoleElement.insertBefore(playerOneStation,document.getElementById("game"));
  playerOneStation.append(document.getElementById("game"),document.getElementById("controls"));
  const playerTwoStation=document.createElement("div");
  playerTwoStation.id="player-two-station";
  playerTwoStation.classList.add("player-station");
  consoleElement.insertBefore(playerTwoStation,playerOneStation);
  playerTwoStation.append(second,controls2);
  // The shared model prepares both instances for the diamond geometry.
  for(const pad of [document.getElementById("controls"),controls2])
    window.BLOCKS_CONTROL_LAYOUT.prepareDiamondPad(pad);

  for(const id of ["movement-controls","rotation-controls"]){
    const wrapper=document.getElementById(id);
    if(wrapper)wrapper.remove();
  }
  document.getElementById("game").classList.add("player-game");
  second.classList.add("player-game");
  document.getElementById("hud").classList.add("player-hud");
  document.getElementById("preview-card").classList.add("player-preview-frame");
  second.querySelector(".second-preview").classList.add("player-preview-frame");
  const secondHud=second.querySelector(".second-hud");
  secondHud.classList.add("player-hud");
  const secondActions=actions.cloneNode(true);
  secondActions.removeAttribute("id");
  secondActions.className="match-actions";
  const secondPause=secondActions.querySelector("#pause-button");
  const secondRestart=secondActions.querySelector("#restart-button");
  secondPause.removeAttribute("id");
  secondRestart.removeAttribute("id");
  secondPause.classList.add("match-pause-button");
  secondRestart.classList.add("match-restart-button");
  secondHud.appendChild(secondActions);
  bindImmediateAction(secondPause,togglePause);
  bindImmediateAction(secondRestart,restartGame);
  const nextGroup=document.createElement("div");
  nextGroup.className="next-group";
  secondHud.insertBefore(nextGroup,secondHud.firstChild);
  nextGroup.append(secondHud.querySelector(".hud-label"),secondHud.querySelector(".second-preview"));
  document.getElementById("hud").firstElementChild.classList.add("next-group");
  document.getElementById("board-frame").classList.add("player-board-wrap","player-board-frame");
  document.getElementById("board").classList.add("player-board");
  second.querySelector(".second-board-frame").classList.add("player-board-frame");
  second.querySelector(".second-board").classList.add("player-board");
  document.getElementById("game-actions").classList.add("player-actions");
  secondActions.classList.add("player-actions");
  second.querySelector(".second-board-wrap").classList.add("player-board-wrap");
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
  const drawBoard2=createBoardRenderer(cells);
  const score2=second.querySelector(".second-score");
  const lines2=second.querySelector(".second-lines");
  const resultTitle=result.querySelector("#match-result-title");
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
    drawBoard2(game2,window.BLOCKS_CONFIG.ghostPiece===true);
    if(score2.textContent!==String(game2.score))score2.textContent=game2.score;
    if(lines2.textContent!==String(game2.lines))lines2.textContent=game2.lines;
    if(previousNext!==game2.nextTetromino){previousNext=game2.nextTetromino;drawPreview();}
    const outcome=session.resolveOutcome();
    if(result.hidden===Boolean(outcome))result.hidden=!outcome;
    if(outcome){
      const label=outcome==="draw"?"DRAW":outcome==="player1"?"PLAYER 1 WINS":"PLAYER 2 WINS";
      if(resultTitle.textContent!==label)resultTitle.textContent=label;
    }
    const over=game2.phase==="game_over"&&!outcome;
    if(second.classList.contains("second-game-over")!==over)
      second.classList.toggle("second-game-over",over);
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
