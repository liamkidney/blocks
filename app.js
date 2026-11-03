const gameParams=new URLSearchParams(location.search);
const saveKeyFor=playerCount=>"blocks:game:v1:"+location.pathname.replace(/index[.]html$/,"")+(playerCount===2?":two":"")+(gameParams.get("pieces")?.toUpperCase()==="IO"?":io":"");
const REMOTE_PLAYER=gameParams.get("remote")==="1";
const TWO_PLAYER=!REMOTE_PLAYER&&gameParams.get("players")==="2";
const REMOTE_MATCH_KEY="blocks:remote-match:"+location.pathname;
// A tapped invitation can arrive while the installed PWA is on its normal
// New Game screen. Route into multiplayer even if iOS only refocuses the app.
if(!REMOTE_PLAYER&&navigator.serviceWorker?.addEventListener){
  const installed=navigator.standalone===true||
    window.matchMedia?.('(display-mode: standalone)')?.matches===true||
    window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches===true;
  let routingPushUrl=null;
  navigator.serviceWorker.addEventListener('message',event=>{
    const pushType=event.data?.type;
    if(!installed||!['BLOCKS_PUSH_INVITATION','BLOCKS_PUSH_RECEIVED'].includes(pushType)||
       (pushType==='BLOCKS_PUSH_RECEIVED'&&document.visibilityState!=='visible'))return;
    try{
      const target=new URL(event.data.url);
      if(target.origin!==new URL(location.href).origin||
         target.pathname.replace(/index[.]html$/,'')!==
           location.pathname.replace(/index[.]html$/,'')||
         target.searchParams.get('remote')!=='1'||
         !/^[A-Z]{3}$/.test(target.searchParams.get('push_join')||''))return;
      if(window.BLOCKS_PRESENT_INVITATION){
        window.BLOCKS_PRESENT_INVITATION(target.href,{
          foreground:pushType==='BLOCKS_PUSH_RECEIVED',
          body:typeof event.data.body==='string'?event.data.body:null
        });
      }else if(pushType==='BLOCKS_PUSH_RECEIVED'){
        // The UI may still be initialising when a foreground push arrives.
        window.BLOCKS_EARLY_INVITE={url:target.href,foreground:true,
          body:event.data.body};
      }else if(routingPushUrl!==target.href){
        routingPushUrl=target.href;
        location.href=target.href;
      }
    }catch(_){}
  });
  if(installed){
    const requestPushHandoff=()=>{
      navigator.serviceWorker.controller?.postMessage?.({
        type:'BLOCKS_GET_PUSH_INVITATION'
      });
    };
    requestPushHandoff();
    navigator.serviceWorker.ready?.then?.(registration=>{
      registration.active?.postMessage({
        type:'BLOCKS_GET_PUSH_INVITATION'
      });
    }).catch?.(()=>{});
    window.addEventListener?.('pageshow',requestPushHandoff);
    if(typeof document!=='undefined')document.addEventListener?.(
      'visibilitychange',()=>{
        if(document.visibilityState==='visible')requestPushHandoff();
      }
    );
  }
}
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
// New two-phone rooms store the host's Ghost Piece selection. Reconnects
// must use that room setting rather than the guest's saved preference.
const savedRemoteGhost=REMOTE_PLAYER&&typeof remoteStored?.ghost_piece==="boolean"?
  remoteStored.ghost_piece:null;
window.BLOCKS_CONFIG.ghostPiece=savedRemoteGhost??selectedGhostPiece;
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
    window.BLOCKS_CONFIG.allowedPieces.includes('O')?'IO':'ALL',
  ghost_piece:selectedGhostPiece
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
const settingsButton=document.createElement("button");
settingsButton.id="hud-settings-button";settingsButton.type="button";
settingsButton.setAttribute("aria-label","Settings");settingsButton.title="Settings";
settingsButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.2 2.2M16.5 16.5l2.2 2.2M18.7 5.3l-2.2 2.2M7.5 16.5l-2.2 2.2"/></svg>';
highScoresSlot.appendChild(settingsButton);
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
    <p id="restart-description">CHOOSE HOW TO PLAY.</p>
    <div id="restart-mode-screen" class="restart-mode-screen">
      <button type="button" id="restart-one">PLAY SOLO</button>
      <button type="button" id="restart-two">TWO PLAYERS · ONE PHONE</button>
      <button type="button" id="restart-remote">PLAY TOGETHER · TWO PHONES</button>
      <div class="restart-utilities">
        <button type="button" id="restart-high-scores" class="restart-secondary">HIGH SCORES</button>
        <button type="button" id="restart-settings" class="restart-secondary">SETTINGS</button>
      </div>
    </div>
    <div id="restart-rules-screen" hidden>
      <button type="button" id="restart-back" class="restart-back" aria-label="Back to New Game" title="Back to New Game">←</button>
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
      <button type="button" id="restart-start" class="restart-primary">START GAME</button>
    </div>
    <button type="button" id="restart-cancel" class="restart-cancel" aria-label="Close New Game" title="Close New Game">×</button>
  </div>`;
document.body.appendChild(restartDialog);
// One invitation dialog works for solo, one-phone and live two-phone games.
// Notification clicks should never silently discard a game in progress.
const inviteDialog=document.createElement("div");
inviteDialog.id="blocks-invite-dialog";
inviteDialog.hidden=true;
inviteDialog.innerHTML=
  '<section class="blocks-invite-panel" role="dialog" aria-modal="true" aria-labelledby="blocks-invite-title">'+
    '<h2 id="blocks-invite-title">GAME INVITATION</h2>'+
    '<p id="blocks-invite-message">A friend invited you to play BLOCKS.</p>'+
    '<p id="blocks-invite-warning"></p>'+
    '<p id="blocks-invite-status" role="alert"></p>'+
    '<div class="blocks-invite-buttons">'+
      '<button type="button" id="blocks-invite-join">JOIN GAME</button>'+
      '<button type="button" id="blocks-invite-dismiss">DISMISS</button>'+
    '</div>'+
  '</section>';
document.body.appendChild(inviteDialog);
const inviteMessage=document.getElementById("blocks-invite-message");
const inviteWarning=document.getElementById("blocks-invite-warning");
const inviteStatus=document.getElementById("blocks-invite-status");
const inviteJoin=document.getElementById("blocks-invite-join");
const inviteDismiss=document.getElementById("blocks-invite-dismiss");
let presentedInvite=null;
function acknowledgeIncomingInvite(url){
  const ack={type:'BLOCKS_ACK_PUSH_INVITATION',url};
  const worker=navigator.serviceWorker;
  if(worker?.controller?.postMessage)worker.controller.postMessage(ack);
  else void worker?.ready?.then?.(registration=>
    registration.active?.postMessage(ack)).catch?.(()=>{});
}
function closeIncomingInvite(resume=true){
  const invite=presentedInvite;
  presentedInvite=null;
  inviteDialog.hidden=true;
  inviteJoin.disabled=false;
  inviteDismiss.disabled=false;
  if(resume&&invite?.pausedSoloGame){
    if(TWO_PLAYER)session.resume();
    else game.resume();
    renderActions();saveGame(true);
  }
  invite?.previousFocus?.focus?.();
}
window.BLOCKS_PRESENT_INVITATION=(destination,options={})=>{
  const installed=navigator.standalone===true||
    window.matchMedia?.('(display-mode: standalone)')?.matches===true||
    window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches===true;
  if(!installed)return false;
  let target;
  try{
    target=new URL(destination);
    const current=new URL(location.href);
    if(target.origin!==current.origin||
       target.pathname.replace(/index[.]html$/,'')!==
         current.pathname.replace(/index[.]html$/,'')||
       target.searchParams.get('remote')!=='1'||
       !/^[A-Z]{3}$/.test(target.searchParams.get('push_join')||''))return false;
  }catch(_){return false}
  if(presentedInvite?.url===target.href)return true;
  const soloHasGame=!REMOTE_PLAYER&&!awaitingInitialStart&&
    game.phase!=='game_over';
  const remoteHasGame=REMOTE_PLAYER&&
    window.BLOCKS_REMOTE?.active===true;
  const needsChoice=options.foreground===true||soloHasGame||remoteHasGame;
  const join=options.onJoin||(()=>{
    // Switching from solo or one-phone deliberately abandons that game.
    skipSaveOnNavigation=true;
    try{localStorage.removeItem(SAVE_KEY)}catch(_){}
    location.href=target.href;
    return true;
  });
  const dismiss=options.onDismiss||
    (()=>acknowledgeIncomingInvite(target.href));
  if(!needsChoice){
    void Promise.resolve().then(join).catch(error=>
      console.warn('BLOCKS invitation open failed:',error));
    return true;
  }
  if(presentedInvite){
    // A second invitation supersedes the first; restore its pause first.
    closeIncomingInvite(true);
  }
  const pausedSoloGame=soloHasGame&&game.phase!=='paused';
  if(pausedSoloGame){
    if(TWO_PLAYER)session.pause();
    else game.pause();
    renderActions();saveGame(true);
  }
  presentedInvite={
    url:target.href,join,dismiss,pausedSoloGame,
    previousFocus:document.activeElement
  };
  inviteMessage.textContent=typeof options.body==='string'&&
    options.body.length<180?options.body:'A friend invited you to play BLOCKS.';
  inviteWarning.textContent=remoteHasGame?
    'Joining forfeits your current match. Your opponent will win.':
    soloHasGame?'Joining abandons your current game.':
      'Would you like to join the game?';
  inviteStatus.textContent='';
  inviteDialog.hidden=false;
  inviteJoin.disabled=false;inviteDismiss.disabled=false;
  inviteJoin.focus();
  return true;
};
inviteDismiss.onclick=()=>{
  if(!presentedInvite)return;
  try{presentedInvite.dismiss()}catch(_){}
  closeIncomingInvite(true);
};
inviteJoin.onclick=async()=>{
  const invite=presentedInvite;
  if(!invite||inviteJoin.disabled)return;
  inviteJoin.disabled=true;inviteDismiss.disabled=true;
  inviteStatus.textContent='Joining…';
  try{
    const result=await invite.join();
    if(result===false)throw Error('Unable to join that room. You can try again.');
    if(presentedInvite===invite)closeIncomingInvite(false);
  }catch(error){
    if(presentedInvite===invite){
      inviteStatus.textContent=error?.message||'Could not join that game.';
      inviteJoin.disabled=false;inviteDismiss.disabled=false;
    }
  }
};
if(window.BLOCKS_EARLY_INVITE){
  const earlier=window.BLOCKS_EARLY_INVITE;
  window.BLOCKS_EARLY_INVITE=null;
  window.BLOCKS_PRESENT_INVITATION(earlier.url,earlier);
}
const cancelRestartButton=document.getElementById("restart-cancel");
const startGameButton=document.getElementById("restart-start");
const restartModeScreen=document.getElementById("restart-mode-screen");
const restartRulesScreen=document.getElementById("restart-rules-screen");
const restartBackButton=document.getElementById("restart-back");
const restartSettingsButton=document.getElementById("restart-settings");
const restartScoresButton=document.getElementById("restart-high-scores");
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
function showModeMenu(){
  restartDialog.hidden=false;
  restartModeScreen.hidden=false;
  restartRulesScreen.hidden=true;
  restartTitle.textContent='NEW GAME';
  restartDescription.textContent='CHOOSE HOW TO PLAY.';
  cancelRestartButton.hidden=awaitingInitialStart;
}
function showRulesFor(playerCount){
  // Only a solo or single-device game asks the person starting it to
  // choose rules. A guest in two-phone play inherits the creator's rules.
  if(playerCount!==1&&playerCount!==2)return;
  selectPlayerCount(playerCount);
  restartModeScreen.hidden=true;
  restartRulesScreen.hidden=false;
  restartTitle.textContent=playerCount===1?'PLAY SOLO':'TWO PLAYERS';
  restartDescription.textContent='CHOOSE SPEED AND GHOST PIECE.';
  startGameButton.textContent='START GAME';
  restartBackButton.focus();
}
function openPlayTogether(){
  // Enter multiplayer matchmaking immediately, with no irrelevant speed or
  // ghost selection. Those choices are made by the actual room creator.
  if(REMOTE_PLAYER)return;
  skipSaveOnNavigation=true;
  try{
    sessionStorage.removeItem(AUTO_START_KEY);
    localStorage.removeItem(SAVE_KEY);
  }catch(_){}
  const url=new URL(location.href);
  url.searchParams.delete('players');
  url.searchParams.set('remote','1');
  location.href=url.href;
}
function closeRestartDialog(){
  restartDialog.hidden=true;
  // Discard unconfirmed rule edits; do not overwrite preferences chosen in
  // Settings or the rules of the currently running game.
  try{
    selectDifficulty(parseGameMode(localStorage.getItem(DIFFICULTY_KEY))??game.difficulty);
    const saved=localStorage.getItem(GHOST_KEY);
    selectGhostPiece(saved==='true'?true:saved==='false'?false:
      window.BLOCKS_CONFIG.ghostPiece===true);
  }catch(_){
    selectDifficulty(game.difficulty);
    selectGhostPiece(window.BLOCKS_CONFIG.ghostPiece===true);
  }
  selectPlayerCount(currentPlayerMode);
  if(!restartWasPaused&&game.phase==='paused'){
    if(TWO_PLAYER)session.resume();
    else game.resume();
  }
  renderActions();
  saveGame(true);
  restartButton.focus();
}
function startNewGame(playerCount=selectedPlayers){
  if(playerCount!==1&&playerCount!==2)return;
  try{
    localStorage.setItem(DIFFICULTY_KEY,selectedDifficulty);
    localStorage.setItem(GHOST_KEY,String(selectedGhostPiece));
  }catch(_){}
  if(!TWO_PLAYER&&!awaitingInitialStart)window.dispatchEvent(new Event('blocks:restart'));
  if(playerCount!==currentPlayerMode){
    skipSaveOnNavigation=true;
    try{localStorage.removeItem(SAVE_KEY);localStorage.removeItem(saveKeyFor(playerCount))}catch(_){}
    try{sessionStorage.setItem(AUTO_START_KEY,'1')}catch(_){}
    const url=new URL(location.href);
    url.searchParams.delete('players');
    url.searchParams.delete('remote');
    if(playerCount===2)url.searchParams.set('players','2');
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
  restartWasPaused=game.phase==='paused';
  if(!restartWasPaused){
    if(TWO_PLAYER)session.pause();
    else game.pause();
  }
  showModeMenu();
  renderActions();
  saveGame(true);
  onePlayerButton.focus();
}
bindImmediateAction(cancelRestartButton,closeRestartDialog);
bindImmediateAction(restartBackButton,showModeMenu);
bindImmediateAction(startGameButton,()=>startNewGame());
bindImmediateAction(onePlayerButton,()=>showRulesFor(1));
bindImmediateAction(twoPlayerButton,()=>showRulesFor(2));
bindImmediateAction(remotePlayerButton,openPlayTogether);
bindImmediateAction(restartSettingsButton,()=>window.BLOCKS_OPEN_SETTINGS?.());
bindImmediateAction(restartScoresButton,()=>{
  if(typeof window.BLOCKS_OPEN_HIGH_SCORES!=='function')return;
  restartDialog.hidden=true;
  window.BLOCKS_OPEN_HIGH_SCORES(()=>{
    restartDialog.hidden=false;
    restartScoresButton.focus();
  });
});
bindImmediateAction(settingsButton,()=>window.BLOCKS_OPEN_SETTINGS?.());
for(const [id,button] of difficultyButtons)
  bindImmediateAction(button,()=>selectDifficulty(id));
bindImmediateAction(ghostOffButton,()=>selectGhostPiece(false));
bindImmediateAction(ghostOnButton,()=>selectGhostPiece(true));
selectDifficulty(selectedDifficulty);
selectGhostPiece(selectedGhostPiece);
selectPlayerCount(selectedPlayers);
window.addEventListener('blocks:settings-updated',event=>{
  const config=event.detail||{};
  if(Object.hasOwn(GAME_MODES,config.difficulty))selectDifficulty(config.difficulty);
  if(typeof config.ghostPiece==='boolean')selectGhostPiece(config.ghostPiece);
  window.BLOCKS_REMOTE_LOCAL_CONFIG={
    ...window.BLOCKS_REMOTE_LOCAL_CONFIG,
    difficulty:selectedDifficulty,ghost_piece:selectedGhostPiece
  };
});
if(initialStart&&!REMOTE_PLAYER)showModeMenu();
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
    if(remoteFinished)window.BLOCKS_REMOTE?.showResults();
    else if(window.confirm("Forfeit this match and restart?"))window.BLOCKS_REMOTE?.reportLoss();
  }else restartGame();
});
for(const button of reactionButtons)if(REMOTE_PLAYER)
  bindImmediateAction(button,()=>{
    const reaction=button.dataset.reaction;
    if(!window.BLOCKS_REMOTE?.sendReaction(reaction))return;
    // Show the same floating reaction immediately on the sender's board.
    // The opponent receives it separately over Realtime (self:false).
    window.dispatchEvent(new CustomEvent("blocks:remote-reaction",{detail:{reaction}}));
    button.classList.remove("reaction-sent");
    void button.offsetWidth; // Restart animation for repeated taps.
    button.classList.add("reaction-sent");
  });
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
  // Both phones must show the same pause/resume icon. The previous
  // implementation used localPaused for the button state but game.phase for
  // its icon, which diverged whenever the opponent paused.
  const remotePaused=REMOTE_PLAYER&&(paused||remoteLocalPaused||remotePeerPaused);
  const showResume=REMOTE_PLAYER?remotePaused:paused;
  const unavailable=!remoteReady||remoteFinished||remoteLost;
  for(const button of document.querySelectorAll(".match-pause-button"))
    button.disabled=TWO_PLAYER?Boolean(session.outcome):game.phase==="game_over";
  pauseButton.disabled=REMOTE_PLAYER?
    unavailable||(!remoteLocalPaused&&remotePeerPaused):
    TWO_PLAYER?Boolean(session.outcome):game.phase==="game_over";
  if(REMOTE_PLAYER){
    // During play, restart forfeits; after a result it reopens the popup
    // so the frozen board can be reviewed without losing rematch controls.
    restartButton.disabled=unavailable&&!remoteFinished;
    const actionMode=remoteFinished?"results":"forfeit";
    if(restartButton.dataset.mode!==actionMode){
      // Keep the familiar restart icon, even when it reopens Play again.
      restartButton.innerHTML=restartIcon;
      const restartLabel=remoteFinished?"Restart / play again":"Restart (forfeit match)";
      restartButton.setAttribute("aria-label",restartLabel);
      restartButton.title=restartLabel;
      restartButton.dataset.mode=actionMode;
    }
    for(const button of reactionButtons)button.disabled=unavailable;
  }
  const label=showResume?"RESUME":"PAUSE";
  const ariaLabel=REMOTE_PLAYER&&remotePeerPaused&&!remoteLocalPaused?
    "Paused by opponent":showResume?"Resume game":"Pause game";
  if(pauseButton.dataset.state!==label||pauseButton.getAttribute("aria-label")!==ariaLabel){
    pauseButton.innerHTML=showResume?resumeIcon:pauseIcon;
    pauseButton.setAttribute("aria-label",ariaLabel);
    pauseButton.title=ariaLabel;
    pauseButton.dataset.state=label;
  }
  for(const button of document.querySelectorAll(".match-pause-button")){
    if(button.dataset.state!==label){
      button.innerHTML=showResume?resumeIcon:pauseIcon;
      button.dataset.state=label;
      button.setAttribute("aria-label",showResume?"Resume game":"Pause game");
    }
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
  const {difficulty,piece_set,ghost_piece}=event.detail;
  if(![0,1,2].includes(difficulty)||!['ALL','IO'].includes(piece_set))return;
  const currentSet=session.config.allowedPieces?.length===2&&
    session.config.allowedPieces.includes('I')&&
    session.config.allowedPieces.includes('O')?'IO':'ALL';
  // Old rooms may not have a stored Ghost Piece value. Preserve local
  // preferences in that one backwards-compatible case.
  const ghostChanged=typeof ghost_piece==='boolean'&&
    window.BLOCKS_CONFIG.ghostPiece!==ghost_piece;
  if(session.config.difficulty===difficulty&&currentSet===piece_set&&!ghostChanged)return;
  session.config.difficulty=difficulty;
  session.config.allowedPieces=piece_set==='IO'?['I','O']:TETROMINOES.map(t=>t.name);
  if(typeof ghost_piece==='boolean'){
    window.BLOCKS_CONFIG.ghostPiece=ghost_piece;
    session.config.ghostPiece=ghost_piece;
  }
  updateVersionLabel();
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
  // Keep the last opponent frame visible while the result is settled.
  remoteReady=false;remoteLost=true;game.pause();
});
window.addEventListener('blocks:remote-finished',event=>{
  if(!REMOTE_PLAYER||remoteFinished)return;
  // Preserve the opponent's last received grid for post-match review.
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
let controlEditing=false;
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
  const player=Number(button.dataset.player||0);
  applyCommand(command,player);
  repeatTimers.set(button,setTimeout(()=>repeat(button),
    command==="down"?DOWN_REPEAT_INTERVAL:REPEAT_INTERVAL));
}
function press(button){
  if(controlEditing)return;
  const command=button.dataset.command;
  if(button.classList.contains("pressed"))return;
  button.classList.add("pressed");
  const player=Number(button.dataset.player||0);
  applyCommand(command,player);
  if(repeatable.has(command))
    repeatTimers.set(button,setTimeout(()=>repeat(button),
      command==="down"?DOWN_REPEAT_INTERVAL:REPEAT_DELAY));
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
  if(controlEditing)return null;
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
      // The idle Play Together menu is a safe update point. Previously
      // refusing every remote-mode activation could leave an installed PWA
      // running an old notification handler indefinitely. Never interrupt
      // room creation, code entry, live games or an incoming push deep link.
      const safeRemoteMenu=REMOTE_PLAYER&&
        window.BLOCKS_REMOTE?.atMenu===true&&
        !/(?:[?&])push_join=/.test(location.search||'');
      if(hadController&&registration.waiting&&
         (!REMOTE_PLAYER||safeRemoteMenu)&&
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

// Solo portrait control arrangement. Always drag the real game's control row;
// the floating proxy is an exact clone of the grabbed control, including its SVG.
const SOLO_CONTROL_ACTIONS=["left","right","down","rotate_cw"];
const SOLO_CONTROL_ORDER_KEY="blocks:control-order:v1:"+
  location.pathname.replace(/index[.]html$/,"");
const soloControlPad=document.getElementById("controls");
const soloControlButtons=Array.from(soloControlPad.querySelectorAll(".control"));
const isSoloPortrait=()=>!TWO_PLAYER&&!REMOTE_PLAYER&&
  window.matchMedia?.("(orientation: portrait)")?.matches===true;
function isValidSoloControlOrder(value){
  return Array.isArray(value)&&value.length===4&&new Set(value).size===4&&
    SOLO_CONTROL_ACTIONS.every(command=>value.includes(command));
}
function getSavedSoloControlOrder(){
  try{
    const value=JSON.parse(localStorage.getItem(SOLO_CONTROL_ORDER_KEY)||"null");
    return isValidSoloControlOrder(value)?value:SOLO_CONTROL_ACTIONS.slice();
  }catch(_){return SOLO_CONTROL_ACTIONS.slice()}
}
let soloControlOrder=getSavedSoloControlOrder();
function applySoloControlOrder(order){
  for(const button of soloControlButtons)
    button.style.setProperty("--portrait-control-order",order.indexOf(button.dataset.command));
}
applySoloControlOrder(soloControlOrder);
let soloControlEditor=null;
function moveSoloControlTo(index){
  const state=soloControlEditor;
  if(!state?.drag)return;
  const oldIndex=state.order.indexOf(state.drag.button.dataset.command);
  if(index===oldIndex)return;
  const before=new Map(soloControlButtons.map(button=>[
    button,button.getBoundingClientRect()
  ]));
  const reordered=state.order.slice();
  const [command]=reordered.splice(oldIndex,1);
  reordered.splice(index,0,command);
  state.order=reordered;
  applySoloControlOrder(reordered);
  if(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)return;
  for(const button of soloControlButtons){
    if(button===state.drag.button||!button.animate)continue;
    const from=before.get(button),to=button.getBoundingClientRect();
    const delta=from.left-to.left;
    if(Math.abs(delta)<1)continue;
    button.getAnimations?.().forEach(animation=>animation.cancel());
    button.animate([
      {transform:"translateX("+delta+"px)"},
      {transform:"translateX(0)"}
    ],{duration:175,easing:"ease-out"});
  }
}
function stopSoloControlDrag(commit){
  const state=soloControlEditor;
  if(!state?.drag)return;
  const {button,ghost}=state.drag;
  state.drag=null;
  ghost.remove();
  button.classList.remove("control-edit-placeholder");
  if(!commit){
    state.order=soloControlOrder.slice();
    applySoloControlOrder(state.order);
  }
}
function finishSoloControlEdit(){
  const state=soloControlEditor;
  if(!state)return;
  stopSoloControlDrag(true);
  soloControlOrder=state.order.slice();
  try{localStorage.setItem(SOLO_CONTROL_ORDER_KEY,JSON.stringify(soloControlOrder))}
  catch(_){}
  state.toolbar.remove();
  soloControlEditor=null;
  controlEditing=false;
  document.body.classList.remove("controls-editing");
  clearControlContacts();
  if(state.showModeMenu)restartDialog.hidden=false;
  if(state.resumeGame&&game.phase==="paused")game.resume();
  renderActions();
  saveGame(true);
}
window.BLOCKS_BEGIN_CONTROL_EDIT=()=>{
  if(!isSoloPortrait())return false;
  if(soloControlEditor)return true;
  clearControlContacts();
  const resumeGame=game.phase==="falling"||game.phase==="clearing_lines";
  if(resumeGame)game.pause();
  const showModeMenu=!restartDialog.hidden;
  restartDialog.hidden=true;
  const toolbar=document.createElement("div");
  toolbar.id="controls-edit-toolbar";
  toolbar.innerHTML='<span>Drag controls to rearrange</span><button type="button" id="controls-edit-done">Done</button>';
  soloControlPad.appendChild(toolbar);
  toolbar.querySelector("button").addEventListener("click",finishSoloControlEdit);
  soloControlEditor={order:soloControlOrder.slice(),resumeGame,showModeMenu,toolbar,drag:null};
  controlEditing=true;
  document.body.classList.add("controls-editing");
  renderActions();
  saveGame(true);
  return true;
};
window.BLOCKS_RESET_CONTROL_ORDER=()=>{
  if(TWO_PLAYER||REMOTE_PLAYER)return false;
  if(soloControlEditor)finishSoloControlEdit();
  soloControlOrder=SOLO_CONTROL_ACTIONS.slice();
  applySoloControlOrder(soloControlOrder);
  try{localStorage.setItem(SOLO_CONTROL_ORDER_KEY,JSON.stringify(soloControlOrder))}
  catch(_){}
  return true;
};
document.addEventListener("pointerdown",event=>{
  if(!controlEditing||!soloControlEditor||soloControlEditor.drag)return;
  if(event.pointerType==="mouse"&&event.button!==0)return;
  const button=event.target?.closest?.("#controls .control");
  if(!button||!soloControlButtons.includes(button))return;
  event.preventDefault();
  const rect=button.getBoundingClientRect();
  const ghost=button.cloneNode(true);
  ghost.classList.remove("pressed");
  ghost.classList.add("control-edit-ghost");
  ghost.setAttribute("aria-hidden","true");
  ghost.style.left=rect.left+"px";
  ghost.style.top=rect.top+"px";
  ghost.style.width=rect.width+"px";
  ghost.style.height=rect.height+"px";
  document.body.appendChild(ghost);
  button.classList.add("control-edit-placeholder");
  soloControlEditor.drag={
    id:event.pointerId,button,ghost,startX:event.clientX,startY:event.clientY
  };
  button.setPointerCapture?.(event.pointerId);
},true);
document.addEventListener("pointermove",event=>{
  const drag=soloControlEditor?.drag;
  if(!drag||drag.id!==event.pointerId)return;
  event.preventDefault();
  drag.ghost.style.transform="translate3d("+
    (event.clientX-drag.startX)+"px,"+(event.clientY-drag.startY)+
    "px,0) scale(1.05)";
  const rect=soloControlPad.getBoundingClientRect();
  const gap=parseFloat(window.getComputedStyle(soloControlPad).columnGap)||0;
  const keyWidth=(rect.width-3*gap)/4;
  if(keyWidth<=0)return;
  const index=Math.max(0,Math.min(3,Math.round(
    (event.clientX-rect.left-keyWidth/2)/(keyWidth+gap)
  )));
  moveSoloControlTo(index);
},true);
document.addEventListener("pointerup",event=>{
  if(soloControlEditor?.drag?.id!==event.pointerId)return;
  event.preventDefault();
  stopSoloControlDrag(true);
},true);
document.addEventListener("pointercancel",event=>{
  if(soloControlEditor?.drag?.id===event.pointerId)stopSoloControlDrag(false);
},true);
window.addEventListener("blur",()=>stopSoloControlDrag(false));
window.addEventListener("resize",()=>{
  if(controlEditing&&!isSoloPortrait())finishSoloControlEdit();
});
// End solo portrait control arrangement.

// Gameplay blocks long-press menus, but profile/settings text inputs must
// retain ordinary iOS editing, selection, paste and correction behaviour.
function isEditableUi(target){
  return Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"],#blocks-settings'));
}
document.addEventListener("contextmenu",e=>{
  if(!isEditableUi(e.target))e.preventDefault();
});
document.addEventListener("selectstart",e=>{
  if(!isEditableUi(e.target))e.preventDefault();
});

const versionElement=document.getElementById("version");
const baseVersion=window.BLOCKS_VERSION||versionElement?.textContent||"";
function updateVersionLabel(){
  if(versionElement)versionElement.textContent=baseVersion+
    (window.BLOCKS_CONFIG?.ghostPiece?" · Ghost piece on, which is cheating btw":"");
}
updateVersionLabel();
