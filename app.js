const gameParams=new URLSearchParams(location.search);
const saveKeyFor=playerCount=>"blocks:game:v1:"+location.pathname.replace(/index[.]html$/,"")+(playerCount===2?":two":"")+(gameParams.get("pieces")?.toUpperCase()==="IO"?":io":"");
const REMOTE_PLAYER=gameParams.get("remote")==="1";
const TWO_PLAYER=!REMOTE_PLAYER&&gameParams.get("players")==="2";
const REMOTE_MATCH_KEY="blocks:remote-match:"+location.pathname;
let remoteStored=null;
if(REMOTE_PLAYER){try{remoteStored=JSON.parse(localStorage.getItem(REMOTE_MATCH_KEY)||"null")}catch(_){}}
const SAVE_KEY=saveKeyFor(TWO_PLAYER?2:1);
const DIFFICULTY_KEY="blocks:difficulty:v1:"+location.pathname.replace(/index[.]html$/,"");
const GHOST_KEY="blocks:ghost:v1:"+location.pathname.replace(/index[.]html$/,"");
const AUTO_START_KEY="blocks:auto-start:v1";
const SHOW_NEW_GAME_KEY="blocks:show-new-game-screen:v1:"+location.pathname.replace(/index[.]html$/,"");
let selectedDifficulty=DEFAULT_GAME_MODE,autoStart=false,showNewGameOnLaunch=false;
try{
  const savedMode=localStorage.getItem(DIFFICULTY_KEY)??localStorage.getItem("blocks:difficulty:v1");
  selectedDifficulty=parseGameMode(savedMode)??DEFAULT_GAME_MODE;
}catch(_){}
// A saved preference takes precedence over the original ?ghost= URL default.
let selectedGhostPiece=window.BLOCKS_CONFIG?.ghostPiece===true;
try{
  const savedGhost=localStorage.getItem(GHOST_KEY);
  if(savedGhost==="true"||savedGhost==="false")selectedGhostPiece=savedGhost==="true";
}catch(_){}
window.BLOCKS_CONFIG.ghostPiece=selectedGhostPiece;
try{
  showNewGameOnLaunch=sessionStorage.getItem(SHOW_NEW_GAME_KEY)==="1";
  sessionStorage.removeItem(SHOW_NEW_GAME_KEY);
  autoStart=!showNewGameOnLaunch&&sessionStorage.getItem(AUTO_START_KEY)==="1";
  sessionStorage.removeItem(AUTO_START_KEY);
}catch(_){}
const savedRemoteDifficulty=REMOTE_PLAYER&&[0,1,2].includes(remoteStored?.difficulty)?remoteStored.difficulty:null;
const sessionConfig={...window.BLOCKS_CONFIG,
  difficulty:savedRemoteDifficulty??selectedDifficulty,
  ...(REMOTE_PLAYER&&remoteStored?.piece_set==='IO'?{allowedPieces:["I","O"]}:
     REMOTE_PLAYER&&remoteStored?.piece_set==='ALL'?{allowedPieces:TETROMINOES.map(t=>t.name)}:{})
};
// Keep the owner's selected defaults separate from settings inherited when
// they previously joined somebody else's room.
window.BLOCKS_REMOTE_LOCAL_CONFIG={
  difficulty:selectedDifficulty,
  piece_set:window.BLOCKS_CONFIG.allowedPieces?.length===2&&
    window.BLOCKS_CONFIG.allowedPieces.includes('I')&&
    window.BLOCKS_CONFIG.allowedPieces.includes('O')?'IO':'ALL'
};
let session;
let storedSessionId=null;
try{
  const stored=localStorage.getItem(SAVE_KEY);
  const snapshot=REMOTE_PLAYER?remoteStored?.snapshot:(stored?JSON.parse(stored):null);
  storedSessionId=TWO_PLAYER||REMOTE_PLAYER?null:snapshot?.session_id||null;
  session=new GameSession({playerCount:TWO_PLAYER?2:1,config:sessionConfig,snapshots:TWO_PLAYER?(snapshot?.games||[]):[snapshot],attackProgress:snapshot?.attackProgress||[0,0]});
}catch(error){
  session=new GameSession({playerCount:TWO_PLAYER?2:1,config:sessionConfig});
  try{localStorage.removeItem(REMOTE_PLAYER?REMOTE_MATCH_KEY:SAVE_KEY)}catch(_){}
  if(REMOTE_PLAYER)remoteStored=null;
}
let game=session.games[0];
const initialStart=showNewGameOnLaunch||(!autoStart&&session.games.some(g=>g.phase!=="paused"));
if(initialStart||REMOTE_PLAYER)session.pause();
let awaitingInitialStart=initialStart;
window.BLOCKS_AWAITING_START=initialStart;
let skipSaveOnNavigation=false;
let lastSavedAt=performance.now();
let previousPhase=game.phase;
function saveGame(force=false){
  if(REMOTE_PLAYER){
    const now=performance.now();
    if(!force&&now-lastSavedAt<2000)return;
    lastSavedAt=now;
    window.BLOCKS_REMOTE?.persist();
    return;
  }
  if(skipSaveOnNavigation||awaitingInitialStart)return;
  const now=performance.now();
  if(!force&&now-lastSavedAt<2000)return;
  lastSavedAt=now;
  try{
    if(TWO_PLAYER){
      if(session.outcome||session.games.some(g=>g.phase==="game_over"))localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY,JSON.stringify({games:session.games.map(g=>g.toSnapshot()),attackProgress:session.attackProgress}));
    }else if(game.phase==="game_over")localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY,JSON.stringify({...game.toSnapshot(),session_id:window.BLOCKS_SESSION_ID||storedSessionId}));
  }catch(_){}
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden")saveGame(true);
});
window.addEventListener("pagehide",()=>saveGame(true));
const board=document.getElementById("board");
const preview=document.getElementById("preview");
const boardCells=[];
const actions=document.createElement("div");
actions.id="game-actions";
const pauseButton=document.createElement("button");
pauseButton.id="pause-button";pauseButton.type="button";
const restartButton=document.createElement("button");
restartButton.id="restart-button";restartButton.type="button";
const pauseIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
const resumeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" stroke-linejoin="round"/></svg>';
const restartIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 6M4 4v6h6"/></svg>';
restartButton.innerHTML=restartIcon;
restartButton.setAttribute("aria-label","Restart game");
restartButton.title="Restart game";
actions.append(pauseButton,restartButton);
const reactionActions=document.createElement("div");
reactionActions.id="remote-reaction-actions";
const reactionButtons=[["heart","❤️"],["cry","😭"]].map(([name,emoji])=>{
  const button=document.createElement("button");
  button.type="button";button.className="remote-reaction-button";
  button.dataset.reaction=name;button.textContent=emoji;
  button.setAttribute("aria-label",name==="heart"?"Send heart":"Send crying face");
  reactionActions.appendChild(button);
  return button;
});
const highScoresSlot=document.createElement("div");
highScoresSlot.id="high-scores-slot";
const playerButton=document.createElement("button");
playerButton.id="hud-player-button";playerButton.type="button";
playerButton.setAttribute("aria-label","Player");playerButton.title="Player";
playerButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';
highScoresSlot.appendChild(playerButton);
document.getElementById("hud").append(actions,highScoresSlot);
if(REMOTE_PLAYER){
  highScoresSlot.hidden=true;
  document.getElementById("hud").append(reactionActions);
  restartButton.setAttribute("aria-label","Restart (forfeit match)");
  restartButton.title="Restart (forfeit match)";
}

const gameOver=document.createElement("div");
gameOver.id="game-over";
gameOver.textContent="GAME OVER";
board.parentElement.appendChild(gameOver);
let lastTime=performance.now(),boardTouch=null;
const REPEAT_DELAY=130,REPEAT_INTERVAL=50,DOWN_REPEAT_INTERVAL=35;

for(let y=19;y>=0;y--) for(let x=0;x<10;x++){
  const cell=document.createElement("div");cell.className="cell";board.appendChild(cell);boardCells.push(cell);
}
const drawBoard=createBoardRenderer(boardCells);
// In two-phone mode, show the other player's board in a separate HUD miniature.
if(REMOTE_PLAYER)document.body.classList.add("remote-multiplayer");
const opponentMini=REMOTE_PLAYER?(()=>{
  const hud=document.getElementById("hud");
  const panel=document.createElement("div");
  panel.id="opponent-mini-panel";
  panel.innerHTML='<div class="hud-label">OPPONENT</div>'+
    '<div id="opponent-mini-board" role="img" aria-label="Opponent board"></div>';
  hud.insertBefore(panel,hud.children[1]);
  return createOpponentMiniBoard(panel.querySelector("#opponent-mini-board"));
})():null;
const clearOpponentMini=()=>opponentMini?.clear();
const scoreDisplay=document.getElementById("score");
const linesDisplay=document.getElementById("lines");

function togglePause(){
  if(REMOTE_PLAYER)return;
  if(TWO_PLAYER){
    if(session.outcome)return;
    if(game.phase==="paused")session.resume();
    else session.pause();
  }else if(game.phase==="paused")game.resume();
  else game.pause();
  renderActions();
  saveGame(true);
}
const restartDialog=document.createElement("div");
restartDialog.id="restart-dialog";
restartDialog.hidden=true;
restartDialog.setAttribute("role","dialog");
restartDialog.setAttribute("aria-modal","true");
restartDialog.setAttribute("aria-labelledby","restart-title");

restartDialog.innerHTML=`
  <div class="restart-panel">
    <div id="restart-title">NEW GAME</div>
    <p id="restart-description">CHOOSE YOUR SETTINGS BEFORE STARTING.</p>
    <div class="restart-mode-label" id="difficulty-label">SPEED</div>
    <div class="restart-options" role="group" aria-labelledby="difficulty-label">
      ${GAME_MODE_IDS.map(id=>`<button type="button" id="difficulty-${id}" aria-pressed="false">${GAME_MODES[id].label.toUpperCase()}</button>`).join("")}
    </div>
    <div id="difficulty-description" class="restart-hint"></div>
    <div class="restart-mode-label" id="ghost-label">GHOST PIECE</div>
    <div class="restart-options" role="group" aria-labelledby="ghost-label">
      <button type="button" id="ghost-off" aria-pressed="false">OFF</button>
      <button type="button" id="ghost-on" aria-pressed="false">ON</button>
    </div>
    <div class="restart-mode-label" id="players-label">PLAYERS</div>
    <div class="restart-options" id="player-mode-options" role="group" aria-labelledby="players-label">
      <button type="button" id="restart-one" aria-pressed="false">1 PLAYER</button>
      <button type="button" id="restart-two" aria-pressed="false">2 PLAYERS · ONE PHONE</button>
      <button type="button" id="restart-remote" aria-pressed="false">2 PLAYERS · TWO PHONES</button>
    </div>
    <button type="button" id="restart-start" class="restart-primary">START GAME</button>
    <button type="button" id="restart-cancel" class="restart-cancel">CANCEL</button>
  </div>`;
document.body.appendChild(restartDialog);
const cancelRestartButton=document.getElementById("restart-cancel");
const startGameButton=document.getElementById("restart-start");
const onePlayerButton=document.getElementById("restart-one");
const twoPlayerButton=document.getElementById("restart-two");
const remotePlayerButton=document.getElementById("restart-remote");
const difficultyButtons=GAME_MODE_IDS.map(id=>[id,document.getElementById("difficulty-"+id)]);
const ghostOffButton=document.getElementById("ghost-off");
const ghostOnButton=document.getElementById("ghost-on");
const difficultyDescription=document.getElementById("difficulty-description");
const restartTitle=document.getElementById("restart-title");
const restartDescription=document.getElementById("restart-description");
const currentPlayerMode=REMOTE_PLAYER?3:TWO_PLAYER?2:1;
let selectedPlayers=currentPlayerMode;
function selectDifficulty(difficulty){
  if(!Object.hasOwn(GAME_MODES,difficulty))return;
  selectedDifficulty=Number(difficulty);
  for(const [id,button] of difficultyButtons)
    button.setAttribute("aria-pressed",String(id===selectedDifficulty));
  difficultyDescription.textContent=GAME_MODES[selectedDifficulty].description;
}
function selectGhostPiece(enabled){
  selectedGhostPiece=enabled;
  ghostOffButton.setAttribute("aria-pressed",String(!enabled));
  ghostOnButton.setAttribute("aria-pressed",String(enabled));
}
function selectPlayerCount(count){
  if(![1,2,3].includes(count))return;
  selectedPlayers=count;
  onePlayerButton.setAttribute("aria-pressed",String(count===1));
  twoPlayerButton.setAttribute("aria-pressed",String(count===2));
  remotePlayerButton.setAttribute("aria-pressed",String(count===3));
}
let restartWasPaused=false;
function closeRestartDialog(){
  restartDialog.hidden=true;
  selectDifficulty(game.difficulty);
  selectGhostPiece(window.BLOCKS_CONFIG.ghostPiece===true);
  selectPlayerCount(currentPlayerMode);
  if(!restartWasPaused&&game.phase==="paused"){
    if(TWO_PLAYER)session.resume();
    else game.resume();
  }
  renderActions();
  saveGame(true);
  restartButton.focus();
}
function startNewGame(playerCount=selectedPlayers){
  try{
    localStorage.setItem(DIFFICULTY_KEY,selectedDifficulty);
    localStorage.setItem(GHOST_KEY,String(selectedGhostPiece));
  }catch(_){}
  if(!TWO_PLAYER&&!awaitingInitialStart)window.dispatchEvent(new Event("blocks:restart"));
  if(playerCount!==currentPlayerMode){
    skipSaveOnNavigation=true;
    try{localStorage.removeItem(SAVE_KEY);localStorage.removeItem(saveKeyFor(playerCount));}catch(_){}
    try{sessionStorage.setItem(AUTO_START_KEY,"1")}catch(_){}
    const url=new URL(location.href);
    url.searchParams.delete("players");
    url.searchParams.delete("remote");
    if(playerCount===2)url.searchParams.set("players","2");
    if(playerCount===3)url.searchParams.set("remote","1");
    location.href=url.href;
    return;
  }
  restartDialog.hidden=true;
  awaitingInitialStart=false;
  window.BLOCKS_AWAITING_START=false;
  try{localStorage.removeItem(SAVE_KEY)}catch(_){}
  session.config.difficulty=selectedDifficulty;
  window.BLOCKS_CONFIG.ghostPiece=selectedGhostPiece;
  updateVersionLabel();
  game=session.replaceGame(0);
  if(TWO_PLAYER){session.replaceGame(1);session.attackProgress=[0,0];}
  session.drainEvents();
  previousPhase=game.phase;
  lastTime=performance.now();
  for(const reset of gameControlResetters)reset();
  renderActions();
  saveGame(true);
}
function restartGame(){
  if(REMOTE_PLAYER||!restartDialog.hidden)return;
  selectDifficulty(game.difficulty);
  selectGhostPiece(window.BLOCKS_CONFIG.ghostPiece===true);
  selectPlayerCount(TWO_PLAYER?2:1);
  restartTitle.textContent="NEW GAME";
  restartDescription.textContent="CHANGING SETTINGS WILL DISCARD THE CURRENT GAME.";
  startGameButton.textContent="START NEW GAME";
  cancelRestartButton.hidden=false;
  restartWasPaused=game.phase==="paused";
  if(!restartWasPaused){
    if(TWO_PLAYER)session.pause();
    else game.pause();
  }
  restartDialog.hidden=false;
  renderActions();
  saveGame(true);
  startGameButton.focus();
}
bindImmediateAction(cancelRestartButton,closeRestartDialog);
bindImmediateAction(startGameButton,()=>startNewGame());
bindImmediateAction(onePlayerButton,()=>selectPlayerCount(1));
bindImmediateAction(twoPlayerButton,()=>selectPlayerCount(2));
bindImmediateAction(remotePlayerButton,()=>selectPlayerCount(3));
for(const [id,button] of difficultyButtons)
  bindImmediateAction(button,()=>selectDifficulty(id));
bindImmediateAction(ghostOffButton,()=>selectGhostPiece(false));
bindImmediateAction(ghostOnButton,()=>selectGhostPiece(true));
selectDifficulty(selectedDifficulty);
selectGhostPiece(selectedGhostPiece);
selectPlayerCount(selectedPlayers);

if(initialStart&&!REMOTE_PLAYER){
  restartTitle.textContent="START GAME";
  restartDescription.textContent="CHOOSE SPEED, GHOST PIECE AND PLAYER COUNT.";
  startGameButton.textContent="START GAME";
  cancelRestartButton.hidden=true;
  restartDialog.hidden=false;
}
function bindImmediateAction(button,action){
  let lastTouchAt=-Infinity;
  button.addEventListener("touchstart",event=>{
    event.preventDefault();
    lastTouchAt=performance.now();
    if(!button.disabled)action();
  },{passive:false});
  button.addEventListener("click",event=>{
    if(performance.now()-lastTouchAt<750){event.preventDefault();return;}
    if(!button.disabled)action();
  });
}
bindImmediateAction(pauseButton,()=>{
  if(REMOTE_PLAYER)window.BLOCKS_REMOTE?.togglePause();
  else togglePause();
});
bindImmediateAction(restartButton,()=>{
  if(REMOTE_PLAYER){
    if(window.confirm("Forfeit this match and restart?"))window.BLOCKS_REMOTE?.reportLoss();
  }else restartGame();
});
for(const button of reactionButtons)if(REMOTE_PLAYER)
  bindImmediateAction(button,()=>window.BLOCKS_REMOTE?.sendReaction(button.dataset.reaction));
const remoteReactionLayer=REMOTE_PLAYER?(()=>{
  const layer=document.createElement("div");
  layer.id="remote-reaction-layer";layer.setAttribute("aria-hidden","true");
  board.parentElement.appendChild(layer);
  return layer;
})():null;
window.addEventListener("blocks:remote-reaction",event=>{
  if(!REMOTE_PLAYER||!remoteReactionLayer)return;
  const emoji=event.detail?.reaction==="heart"?"❤️":
    event.detail?.reaction==="cry"?"😭":null;
  if(!emoji)return;
  // Keep a bounded number of transient reactions, including rapid bursts.
  while(remoteReactionLayer.childElementCount>=8)remoteReactionLayer.firstChild.remove();
  const element=document.createElement("span");
  element.className="remote-floating-reaction";element.textContent=emoji;
  element.style.left=(30+Math.random()*40)+"%";
  remoteReactionLayer.appendChild(element);
  element.addEventListener("animationend",()=>element.remove(),{once:true});
  setTimeout(()=>element.remove(),2500);
});
let remoteLocalPaused=false,remotePeerPaused=false;
function syncRemotePause(){
  if(!REMOTE_PLAYER||remoteFinished||remoteLost)return;
  if(remoteReady&&!remoteLocalPaused&&!remotePeerPaused)game.resume();
  else game.pause();
}
window.addEventListener("blocks:remote-pause-state",event=>{
  if(!REMOTE_PLAYER)return;
  remoteLocalPaused=Boolean(event.detail?.local);
  remotePeerPaused=Boolean(event.detail?.peer);
  syncRemotePause();
});
function renderActions(){
  const paused=game.phase==="paused";
  for(const button of document.querySelectorAll(".match-pause-button"))button.disabled=TWO_PLAYER?Boolean(session.outcome):game.phase==="game_over";
  pauseButton.disabled=REMOTE_PLAYER?
    !remoteReady||remoteFinished||remoteLost||(!remoteLocalPaused&&remotePeerPaused):
    TWO_PLAYER?Boolean(session.outcome):game.phase==="game_over";
  if(REMOTE_PLAYER)restartButton.disabled=!remoteReady||remoteFinished||remoteLost;
  for(const button of reactionButtons)button.disabled=!remoteReady||remoteFinished||remoteLost;
  const label=REMOTE_PLAYER?(remoteLocalPaused?"RESUME":"PAUSE"):(paused?"RESUME":"PAUSE");
  if(pauseButton.dataset.state!==label){
    pauseButton.innerHTML=paused?resumeIcon:pauseIcon;
    pauseButton.setAttribute("aria-label",paused?"Resume game":"Pause game");
    pauseButton.title=paused?"Resume game":"Pause game";
    pauseButton.dataset.state=label;
  }
  for(const button of document.querySelectorAll(".match-pause-button")){
    if(button.dataset.state!==label){button.innerHTML=paused?resumeIcon:pauseIcon;button.dataset.state=label;button.setAttribute("aria-label",paused?"Resume game":"Pause game");}
  }
  board.parentElement.classList.toggle("game-paused",paused);
  if(TWO_PLAYER)document.body.classList.toggle("match-paused",paused);
}
let lastPreviewTetromino=null;
function render(){
  drawBoard(game,window.BLOCKS_CONFIG.ghostPiece===true);
  // These counters are visible only in solo and same-phone multiplayer.
  if(!REMOTE_PLAYER){
    if(scoreDisplay.textContent!==String(game.score))scoreDisplay.textContent=game.score;
    if(linesDisplay.textContent!==String(game.lines))linesDisplay.textContent=game.lines;
  }
  renderPreview();
  const over=!TWO_PLAYER&&!REMOTE_PLAYER&&game.phase==="game_over";
  if(gameOver.hidden===over)gameOver.hidden=!over;
  renderActions();
}
function renderPreview(){
  const t=game.nextTetromino;
  if(t===lastPreviewTetromino)return;
  lastPreviewTetromino=t;
  preview.replaceChildren();
  if(!t)return;
  const offsets=t.orientations[0],xs=offsets.map(p=>p[0]),ys=offsets.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX+1,height=maxY-minY+1;
  const cellPercent=width===4?21:25;
  const pieceWidth=width*cellPercent,pieceHeight=height*cellPercent;
  const left=(100-pieceWidth)/2,top=(100-pieceHeight)/2;
  for(const [x,y] of offsets){
    const cell=document.createElement("div");
    cell.className="preview-cell filled";
    cell.style.backgroundColor=t.color;
    cell.style.width=cellPercent+"%";cell.style.height=cellPercent+"%";
    cell.style.left=left+(x-minX)*cellPercent+"%";
    cell.style.top=top+(maxY-y)*cellPercent+"%";
    preview.appendChild(cell);
  }
}
let remoteReady=false,remoteFinished=false,remoteLost=false;
let remoteAttackProgress=Number.isInteger(remoteStored?.progress)?remoteStored.progress:0;
// The local snapshot and last received event cursor are persisted together.
window.BLOCKS_REMOTE_CAPTURE=()=>({
  snapshot:game.toSnapshot(),
  progress:remoteAttackProgress
});
window.BLOCKS_REMOTE_BOARD_CAPTURE=()=>REMOTE_PLAYER?encodeOpponentBoard(game):null;
window.addEventListener('blocks:remote-board',event=>{
  if(REMOTE_PLAYER&&remoteReady&&!remoteFinished)opponentMini?.show(event.detail.rows);
});
window.addEventListener('blocks:remote-board-clear',clearOpponentMini);
window.BLOCKS_REMOTE_RESET=()=>{
  clearOpponentMini();
  game=session.replaceGame(0);
  game.pause();
  session.drainEvents();
  remoteReady=false;remoteFinished=false;remoteLost=false;remoteAttackProgress=0;
  remoteLocalPaused=false;remotePeerPaused=false;
  awaitingInitialStart=false;window.BLOCKS_AWAITING_START=false;
  previousPhase=game.phase;lastTime=performance.now();
  gameOver.textContent="GAME OVER";
};
window.addEventListener('blocks:remote-config',event=>{
  if(!REMOTE_PLAYER)return;
  const {difficulty,piece_set}=event.detail;
  if(![0,1,2].includes(difficulty)||!['ALL','IO'].includes(piece_set))return;
  if(session.config.difficulty===difficulty &&
    ((session.config.allowedPieces?.length===2&&
      session.config.allowedPieces.includes('I')&&
      session.config.allowedPieces.includes('O'))?'IO':'ALL')===piece_set)return;
  session.config.difficulty=difficulty;
  session.config.allowedPieces=piece_set==='IO'?['I','O']:TETROMINOES.map(t=>t.name);
  window.BLOCKS_REMOTE_RESET();
});
window.addEventListener('blocks:remote-new-round',()=>{
  if(REMOTE_PLAYER)window.BLOCKS_REMOTE_RESET();
});
window.addEventListener('blocks:remote-ready',()=>{
  if(remoteReady||remoteFinished)return;
  remoteReady=true;
  awaitingInitialStart=false;
  window.BLOCKS_AWAITING_START=false;
  restartDialog.hidden=true;
  syncRemotePause();
});
window.addEventListener('blocks:remote-hold',()=>{
  if(!REMOTE_PLAYER||remoteFinished)return;
  remoteReady=false;
  game.pause();
  saveGame(true);
});
window.addEventListener('blocks:remote-unhold',()=>{
  if(!REMOTE_PLAYER||remoteFinished||remoteLost)return;
  remoteReady=true;
  syncRemotePause();
});
window.addEventListener('blocks:remote-event',event=>{
  if(!REMOTE_PLAYER||remoteFinished)return;
  const received=event.detail;
  if(received.type==='attack'&&Number.isInteger(received.rows)&&received.rows>0)
    game.addGarbage(received.rows);
  // A match loss is settled by the server's authoritative 'finished' status.
});
window.addEventListener('blocks:remote-forfeiting',()=>{
  if(!REMOTE_PLAYER)return;
  clearOpponentMini();
  remoteReady=false;remoteLost=true;game.pause();
});
window.addEventListener('blocks:remote-finished',event=>{
  if(!REMOTE_PLAYER||remoteFinished)return;
  clearOpponentMini();
  remoteFinished=true;remoteReady=false;remoteLost=true;
  game.endGame();
  const player=window.BLOCKS_REMOTE?.player;
  gameOver.textContent=event.detail.winner===player?'YOU WIN':
    event.detail.winner===0?'DRAW':'YOU LOSE';
  saveGame(true);
});
function loop(now){if(!REMOTE_PLAYER||(remoteReady&&!remoteFinished))session.update(Math.min((now-lastTime)/1000,.25));
const drained=session.drainEvents();
if(REMOTE_PLAYER&&remoteReady)for(const event of drained){
  if(event.type!=='lines_cleared')continue;
  const attack=GameSession.attackForLines(remoteAttackProgress,event.count);
  remoteAttackProgress=attack.remainder;
  if(attack.rows)window.BLOCKS_REMOTE?.sendAttack(attack.rows);
}
if(REMOTE_PLAYER&&remoteReady&&!remoteLost&&game.phase==='game_over'){
  remoteLost=true;window.BLOCKS_REMOTE?.reportLoss();
}
lastTime=now;render();const finished=game.phase==="game_over"&&previousPhase!=="game_over";saveGame(finished);if(finished)window.BLOCKS_QUEUE_SCORE?.("completed",true);previousPhase=game.phase;requestAnimationFrame(loop)}
requestAnimationFrame(loop);

board.addEventListener("animationend",event=>{
  if(game.phase==="clearing_lines"&&event.animationName==="clearFlash"&&event.pseudoElement==="::after"&&event.target.classList.contains("clearing")&&event.target===board.querySelector(".cell.clearing")) {game.presentationComplete();saveGame(true);}
});

// Held inputs repeat independently; a second finger can steer while Down is held.
const repeatTimers=new Map();
const repeatable=new Set(["down","left","right"]);
const gameControlResetters=[];
function applyCommand(command,player=0){
  const target=session.games[player];
  if(!target)return;
  if(command==="down")target.dropOne();
  else target.press(command);
}
function stopRepeat(button){
  clearTimeout(repeatTimers.get(button));
  repeatTimers.delete(button);
}
function repeat(button){
  if(!repeatTimers.has(button))return;
  const command=button.dataset.command;
  applyCommand(command,Number(button.dataset.player||0));
  repeatTimers.set(button,setTimeout(()=>repeat(button),
    command==="down"?DOWN_REPEAT_INTERVAL:REPEAT_INTERVAL));
}
function press(button){
  const command=button.dataset.command;
  if(button.classList.contains("pressed"))return;
  button.classList.add("pressed");
  applyCommand(command,Number(button.dataset.player||0));
  if(repeatable.has(command))
    repeatTimers.set(button,setTimeout(()=>repeat(button),REPEAT_DELAY));
}
function release(button){
  button.classList.remove("pressed");
  stopRepeat(button);
}
// Track touches at document level, not at the originally touched button.
// This allows a finger to leave every hit target and later reacquire one,
// and recognises touches that begin in the gaps between buttons.
const controlGroups=[];
const controlContacts=new Map();
const controlOwners=new Map();
const CONTROL_HIT_SLOP=40; // Covers the middle of the landscape left/right gap.
let lastControlTouchAt=-Infinity;
let controlEventsInstalled=false;

function nearestControl(buttons,x,y){
  let closest=null,bestDistance=CONTROL_HIT_SLOP*CONTROL_HIT_SLOP;
  for(const button of buttons){
    const r=button.getBoundingClientRect?.();
    if(!r||r.width===0||r.height===0)continue;
    const dx=Math.max(r.left-x,0,x-r.right);
    const dy=Math.max(r.top-y,0,y-r.bottom);
    const distance=dx*dx+dy*dy;
    if(distance<bestDistance){bestDistance=distance;closest=button;}
  }
  return closest;
}
function findControlStart(target,x,y){
  const direct=target?.closest?.(".control");
  if(direct){
    const group=controlGroups.find(item=>item.buttons.includes(direct));
    return group?{group,button:direct}:null;
  }
  // Never turn a press on a game board, dialog, or another button into
  // a movement, even if it lies near the control pad.
  if(target?.closest?.("button,a,input,select,textarea,[role='dialog'],#board-frame,.player-board-wrap,.player-board-frame,#high-scores-overlay,#player-dialog"))
    return null;

  const pad=target?.closest?.("#controls,#player-two-controls");
  const owningGroup=controlGroups.find(item=>item.pad===pad&&pad);
  if(owningGroup){
    // Remember even a far-away gap touch so sliding onto a control works.
    return {group:owningGroup,button:nearestControl(owningGroup.buttons,x,y)};
  }

  let best=null,bestDistance=CONTROL_HIT_SLOP*CONTROL_HIT_SLOP;
  for(const group of controlGroups)for(const button of group.buttons){
    const r=button.getBoundingClientRect?.();
    if(!r||r.width===0||r.height===0)continue;
    const dx=Math.max(r.left-x,0,x-r.right);
    const dy=Math.max(r.top-y,0,y-r.bottom);
    const distance=dx*dx+dy*dy;
    if(distance<bestDistance){
      bestDistance=distance;
      best={group,button};
    }
  }
  return best;
}
function assignControl(id,next){
  const contact=controlContacts.get(id);
  if(!contact||contact.button===next)return;
  if(contact.button){
    const owners=controlOwners.get(contact.button);
    owners.delete(id);
    if(!owners.size){
      controlOwners.delete(contact.button);
      release(contact.button);
    }
  }
  contact.button=next;
  if(next){
    if(!controlOwners.has(next))controlOwners.set(next,new Set());
    const owners=controlOwners.get(next),wasEmpty=owners.size===0;
    owners.add(id);
    if(wasEmpty)press(next);
  }
}
function endControl(id){
  if(!controlContacts.has(id))return;
  assignControl(id,null);
  controlContacts.delete(id);
}
function clearControlContacts(){
  for(const id of [...controlContacts.keys()])endControl(id);
}
function bindGameControls(root=document){
  const buttons=Array.from(root.querySelectorAll(".control"));
  if(!buttons.length)return;
  const pad=buttons[0].closest?.("#controls,#player-two-controls")||
    (root===document?document.getElementById("controls"):root);
  controlGroups.push({buttons,pad});
  if(controlEventsInstalled)return;
  controlEventsInstalled=true;
  gameControlResetters.push(clearControlContacts);
  window.addEventListener("blur",clearControlContacts);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden")clearControlContacts();
  });

  document.addEventListener("touchstart",e=>{
    let handled=false;
    for(const touch of e.changedTouches){
      const id="touch:"+touch.identifier;
      if(controlContacts.has(id))continue;
      const hit=findControlStart(e.target,touch.clientX,touch.clientY);
      if(!hit)continue;
      controlContacts.set(id,{group:hit.group,button:null});
      assignControl(id,hit.button);
      handled=true;
    }
    if(handled){
      e.preventDefault();
      lastControlTouchAt=performance.now();
    }
  },{capture:true,passive:false});

  document.addEventListener("touchmove",e=>{
    let handled=false;
    for(const touch of e.changedTouches){
      const id="touch:"+touch.identifier;
      const contact=controlContacts.get(id);
      if(!contact)continue;
      // The contact stays tracked while outside all controls. It can
      // reacquire the same button (or another) without lifting.
      assignControl(id,nearestControl(contact.group.buttons,touch.clientX,touch.clientY));
      handled=true;
    }
    if(handled){e.preventDefault();lastControlTouchAt=performance.now();}
  },{capture:true,passive:false});

  for(const name of ["touchend","touchcancel"])
    document.addEventListener(name,e=>{
      let handled=false;
      for(const touch of e.changedTouches){
        const id="touch:"+touch.identifier;
        if(!controlContacts.has(id))continue;
        endControl(id);
        handled=true;
      }
      if(handled){e.preventDefault();lastControlTouchAt=performance.now();}
    },{capture:true,passive:false});

  // Pointer events are for mouse/pen; native touches use the touch path.
  // The 750ms guard only suppresses emulated mouse events following a touch.
  document.addEventListener("pointerdown",e=>{
    if(e.pointerType==="touch"||
       (e.pointerType==="mouse"&&performance.now()-lastControlTouchAt<750))return;
    if(e.pointerType==="mouse"&&e.button!==0)return;
    const id="pointer:"+e.pointerId;
    if(controlContacts.has(id))return;
    const hit=findControlStart(e.target,e.clientX,e.clientY);
    if(!hit)return;
    controlContacts.set(id,{group:hit.group,button:null});
    assignControl(id,hit.button);
    e.preventDefault();
    const captureTarget=e.target?.closest?.(".control")||e.target;
    captureTarget?.setPointerCapture?.(e.pointerId);
  },true);

  document.addEventListener("pointermove",e=>{
    const contact=controlContacts.get("pointer:"+e.pointerId);
    if(!contact)return;
    assignControl("pointer:"+e.pointerId,
      nearestControl(contact.group.buttons,e.clientX,e.clientY));
    e.preventDefault();
  },true);

  for(const name of ["pointerup","pointercancel","lostpointercapture"])
    document.addEventListener(name,e=>{
      const id="pointer:"+e.pointerId;
      if(!controlContacts.has(id))return;
      endControl(id);
      if(name!=="lostpointercapture")e.preventDefault();
    },true);
}
bindGameControls();
board.addEventListener("pointerdown",e=>{e.preventDefault();board.setPointerCapture(e.pointerId);boardTouch={x:e.clientX,y:e.clientY}});
board.addEventListener("pointerup",e=>{
  e.preventDefault();if(!boardTouch)return;
  const dx=e.clientX-boardTouch.x,dy=e.clientY-boardTouch.y,threshold=board.clientWidth/10;
  if(Math.abs(dy)>=threshold&&Math.abs(dy)>Math.abs(dx)&&dy>0)game.dropOne();
  else if(Math.abs(dx)>=threshold&&Math.abs(dx)>Math.abs(dy))game.press(dx>0?"right":"left");
  else if(Math.abs(dx)<threshold&&Math.abs(dy)<threshold){
    if(dy>2)game.dropOne();
    else{const r=board.getBoundingClientRect();game.press(boardTouch.x>=r.left+r.width/2?"rotate_cw":"rotate_ccw")}
  }
  boardTouch=null;
});
if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
    const hadController=Boolean(navigator.serviceWorker.controller);
    let activatingAtLaunch=false,refreshing=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      // Reload only after deliberately activating an update at launch.
      // Never reload an ongoing game just because a background update arrived.
      if(!activatingAtLaunch||refreshing)return;
      refreshing=true;
      saveGame(true);
      location.reload();
    });
    try{
      const registration=await navigator.serviceWorker.register("sw.js",{updateViaCache:"none"});
      // A worker that was already waiting when the new page launched can
      // safely replace this build. New downloads wait until a later launch.
      // Two-phone matchmaking is already interactive on launch. Updating here
      // can reload the page between the user's first tap and room creation.
      // Defer activation until the app next opens outside two-phone mode.
      if(!REMOTE_PLAYER&&hadController&&registration.waiting&&
         (awaitingInitialStart||game.phase==="paused"||game.phase==="game_over")){
        activatingAtLaunch=true;
        saveGame(true);
        registration.waiting.postMessage({type:"BLOCKS_ACTIVATE_UPDATE"});
      }
      const checkForUpdate=()=>registration.update().catch(()=>{});
      void checkForUpdate();
      document.addEventListener("visibilitychange",()=>{
        if(document.visibilityState==="visible")void checkForUpdate();
      });
      window.addEventListener("pageshow",event=>{
        if(event.persisted)void checkForUpdate();
      });
    }catch(error){console.warn("Service worker registration failed",error);}
  });
}

document.addEventListener("contextmenu",e=>e.preventDefault());
document.addEventListener("selectstart",e=>e.preventDefault());

const versionElement=document.getElementById("version");
const baseVersion=window.BLOCKS_VERSION||versionElement?.textContent||"";
function updateVersionLabel(){
  if(versionElement)versionElement.textContent=baseVersion+
    (window.BLOCKS_CONFIG?.ghostPiece?" · Ghost piece on, which is cheating btw":"");
}
updateVersionLabel();
