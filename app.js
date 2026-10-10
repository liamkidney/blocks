const SAVE_KEY="blocks:game:v1:"+location.pathname.replace(/index[.]html$/,"");
const TWO_PLAYER=new URLSearchParams(location.search).get("players")==="2";
let session;
try{
  const stored=localStorage.getItem(SAVE_KEY);
  const snapshot=stored?JSON.parse(stored):null;
  session=new GameSession({playerCount:TWO_PLAYER?2:1,config:window.BLOCKS_CONFIG||{},snapshots:TWO_PLAYER?[]:[snapshot]});
}catch(error){
  session=new GameSession({playerCount:TWO_PLAYER?2:1,config:window.BLOCKS_CONFIG||{}});
  try{localStorage.removeItem(SAVE_KEY)}catch(_){}
}
let game=session.games[0];
let skipSaveOnNavigation=false;
let lastSavedAt=performance.now();
let previousPhase=game.phase;
function saveGame(force=false){
  if(TWO_PLAYER||skipSaveOnNavigation)return;
  const now=performance.now();
  if(!force&&now-lastSavedAt<2000)return;
  lastSavedAt=now;
  try{
    if(game.phase==="game_over")localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY,JSON.stringify(game.toSnapshot()));
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
document.getElementById("hud").appendChild(actions);
const gameOver=document.createElement("div");
gameOver.id="game-over";
gameOver.textContent="GAME OVER";
board.parentElement.appendChild(gameOver);
let lastTime=performance.now(),boardTouch=null;
const REPEAT_DELAY=220,REPEAT_INTERVAL=80;

for(let y=19;y>=0;y--) for(let x=0;x<10;x++){
  const cell=document.createElement("div");cell.className="cell";board.appendChild(cell);boardCells.push(cell);
}

function togglePause(){
  if(game.phase==="paused")game.resume();
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
restartDialog.innerHTML='<div class="restart-panel"><div id="restart-title">NEW GAME</div><p>CHOOSE NUMBER OF PLAYERS. YOUR CURRENT GAME WILL BE LOST.</p><div class="restart-choices"><button type="button" id="restart-one">1 PLAYER</button><button type="button" id="restart-two">2 PLAYERS</button></div><button type="button" id="restart-cancel" class="restart-cancel">CANCEL</button></div>';
document.body.appendChild(restartDialog);
const cancelRestartButton=document.getElementById("restart-cancel");
const onePlayerButton=document.getElementById("restart-one");
const twoPlayerButton=document.getElementById("restart-two");
let restartWasPaused=false;
function closeRestartDialog(){
  restartDialog.hidden=true;
  if(!restartWasPaused&&game.phase==="paused")game.resume();
  renderActions();
  saveGame(true);
  restartButton.focus();
}
function startNewGame(playerCount=TWO_PLAYER?2:1){
  if(playerCount!==(TWO_PLAYER?2:1)){
    skipSaveOnNavigation=true;
    try{localStorage.removeItem(SAVE_KEY)}catch(_){}
    const url=new URL(location.href);
    if(playerCount===2)url.searchParams.set("players","2");
    else url.searchParams.delete("players");
    location.href=url.href;
    return;
  }
  restartDialog.hidden=true;
  game=session.replaceGame(0);
  if(TWO_PLAYER)session.replaceGame(1);
  session.drainEvents();
  previousPhase=game.phase;
  lastTime=performance.now();
  for(const button of document.querySelectorAll(".control"))release(button);
  renderActions();
  saveGame(true);
}
function restartGame(){
  if(!restartDialog.hidden)return;
  restartWasPaused=game.phase==="paused";
  if(!restartWasPaused)game.pause();
  restartDialog.hidden=false;
  renderActions();
  saveGame(true);
  (TWO_PLAYER?twoPlayerButton:onePlayerButton).focus();
}
bindImmediateAction(cancelRestartButton,closeRestartDialog);
bindImmediateAction(onePlayerButton,()=>startNewGame(1));
bindImmediateAction(twoPlayerButton,()=>startNewGame(2));
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
bindImmediateAction(pauseButton,togglePause);
bindImmediateAction(restartButton,restartGame);
function renderActions(){
  const paused=game.phase==="paused";
  pauseButton.disabled=game.phase==="game_over";
  const label=paused?"RESUME":"PAUSE";
  if(pauseButton.dataset.state!==label){
    pauseButton.innerHTML=paused?resumeIcon:pauseIcon;
    pauseButton.setAttribute("aria-label",paused?"Resume game":"Pause game");
    pauseButton.title=paused?"Resume game":"Pause game";
    pauseButton.dataset.state=label;
  }
  board.parentElement.classList.toggle("game-paused",paused);
}
const boardIndex=(x,y)=>(19-y)*10+x;
function paintBoard(x,y,name){
  if(x<0||x>=10||y<0||y>=20)return;
  const cell=boardCells[boardIndex(x,y)];
  const className=cell.classList.contains("clearing")&&(game.phase==="clearing_lines"||(game.phase==="paused"&&game.pausedPhase==="clearing_lines"))?"cell filled clearing":"cell filled";
  if(cell.className!==className)cell.className=className;
  cell.style.backgroundColor=TETROMINO_BY_NAME[name].color;
}
function render(){
  for(const cell of boardCells){
    if(!((game.phase==="clearing_lines"||(game.phase==="paused"&&game.pausedPhase==="clearing_lines"))&&cell.classList.contains("clearing")))cell.className="cell";
    cell.style.background="";
  }
  for(let y=0;y<20;y++) for(let x=0;x<10;x++) if(game.grid[y][x]) paintBoard(x,y,game.grid[y][x]);
  if(game.active) for(const [ox,oy] of game.offsets) paintBoard(game.active.x+ox,game.active.y+oy,game.active.tetromino.name);
  document.getElementById("score").textContent=game.score;
  document.getElementById("lines").textContent=game.lines;
  renderPreview();
  gameOver.hidden=game.phase!=="game_over";
  renderActions();
  if(game.phase==="clearing_lines"||(game.phase==="paused"&&game.pausedPhase==="clearing_lines")) for(const y of game.completedRows) for(let x=0;x<10;x++) boardCells[boardIndex(x,y)].classList.add("clearing");
}
function renderPreview(){
  preview.replaceChildren();
  const t=game.nextTetromino;if(!t)return;
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
function loop(now){session.update(Math.min((now-lastTime)/1000,.25));session.drainEvents();lastTime=now;render();saveGame(game.phase==="game_over"&&previousPhase!=="game_over");previousPhase=game.phase;requestAnimationFrame(loop)}
requestAnimationFrame(loop);

board.addEventListener("animationend",event=>{
  if(game.phase==="clearing_lines"&&event.animationName==="clearFlash"&&event.pseudoElement==="::after"&&event.target.classList.contains("clearing")&&event.target===board.querySelector(".cell.clearing")) {game.presentationComplete();saveGame(true);}
});

// Each held button owns its repeat timer, so simultaneous presses do not interfere.
const repeatTimers=new Map();
const repeatable=new Set(["down","left","right"]);
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
  applyCommand(button.dataset.command,Number(button.dataset.player||0));
  repeatTimers.set(button,setTimeout(()=>repeat(button),REPEAT_INTERVAL));
}
function press(button){
  const command=button.dataset.command;
  if(button.classList.contains("pressed"))return;
  button.classList.add("pressed");
  applyCommand(command,Number(button.dataset.player||0));
  if(repeatable.has(command)){
    repeatTimers.set(button,setTimeout(()=>repeat(button),REPEAT_DELAY));
  }
}
function release(button){
  button.classList.remove("pressed");
  stopRepeat(button);
}
// Prefer real touch events on touch devices. Pythonista's WebView emits a
// second synthetic pointerdown/click after touchend, which must be ignored.
function bindGameControls(root=document){
root.querySelectorAll(".control").forEach(button=>{
  let touchActive=false;
  let lastTouchAt=-Infinity;
  const suppressSyntheticPointer=e=>e.pointerType==="touch"||performance.now()-lastTouchAt<750;
  button.addEventListener("touchstart",e=>{
    e.preventDefault();
    lastTouchAt=performance.now();
    if(touchActive)return;
    touchActive=true;
    press(button);
  },{passive:false});
  button.addEventListener("touchend",e=>{
    e.preventDefault();
    lastTouchAt=performance.now();
    if(touchActive)release(button);
    touchActive=false;
  },{passive:false});
  button.addEventListener("touchcancel",e=>{
    e.preventDefault();
    lastTouchAt=performance.now();
    if(touchActive)release(button);
    touchActive=false;
  },{passive:false});
  button.addEventListener("pointerdown",e=>{
    if(suppressSyntheticPointer(e)){e.preventDefault();return;}
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    press(button);
  });
  button.addEventListener("pointerup",e=>{
    if(suppressSyntheticPointer(e)){e.preventDefault();return;}
    e.preventDefault();
    release(button);
  });
  button.addEventListener("pointercancel",()=>{
    if(!touchActive)release(button);
  });
});
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
document.addEventListener("keydown",e=>{
  const map={ArrowLeft:"left",ArrowRight:"right",ArrowUp:"rotate_cw",z:"rotate_ccw",Z:"rotate_ccw"};
  if(e.key==="ArrowDown"){e.preventDefault();game.dropOne()}
  else if(map[e.key]){e.preventDefault();game.press(map[e.key])}
});
if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
    const hadController=Boolean(navigator.serviceWorker.controller);
    let refreshing=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(!hadController||refreshing)return;
      refreshing=true;
      saveGame(true);
      location.reload();
    });
    try{
      const registration=await navigator.serviceWorker.register("sw.js",{updateViaCache:"none"});
      const checkForUpdate=()=>registration.update().catch(()=>{});
      checkForUpdate();
      document.addEventListener("visibilitychange",()=>{
        if(document.visibilityState==="visible")checkForUpdate();
      });
      window.addEventListener("pageshow",event=>{
        if(event.persisted)checkForUpdate();
      });
    }catch(error){console.warn("Service worker registration failed",error);}
  });
}

document.addEventListener("contextmenu",e=>e.preventDefault());
document.addEventListener("selectstart",e=>e.preventDefault());

const versionElement=document.getElementById("version");
if(versionElement&&window.BLOCKS_VERSION)versionElement.textContent=window.BLOCKS_VERSION;
