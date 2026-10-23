// Two-phone Blocks: separate local boards, token-protected shared room, round-scoped attacks.
// One-phone multiplayer and solo play never load this mode's transport.
(()=>{
  if(new URLSearchParams(location.search).get('remote')!=='1')return;

  const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
  const STORAGE_KEY='blocks:remote-match:'+location.pathname;
  const PENDING_JOIN_KEY='blocks:remote-pending-join:'+location.pathname;
  const NEW_GAME_SCREEN_KEY='blocks:show-new-game-screen:v1:'+location.pathname.replace(/index[.]html$/,'');
  const headers={apikey:KEY,'Content-Type':'application/json'};
  const read=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){return null}};
  const saved=read();
  const pendingJoin=(()=>{try{return JSON.parse(localStorage.getItem(PENDING_JOIN_KEY)||'null')}catch(_){return null}})();
  let match=saved?.id&&saved?.token&&[1,2].includes(saved.player)?saved:null;
  if(match){match.round=match.round||1;match.cursor ||= 0;match.outbox ||= [];}
  let busy=false,sending=false,ready=false,staging=false,finished=false,forfeiting=false,interval=null;
  let creating=false,joining=false,startSending=false,rematchSending=false,exiting=false;
  let held=false,heartbeatInFlight=false,lastHeartbeatAt=0;

  const lobby=document.createElement('div');
  lobby.id='remote-lobby';
  lobby.innerHTML='<section class="remote-panel" role="dialog" aria-label="Two-phone multiplayer">'+
    '<button type="button" id="remote-menu-exit" aria-label="Back to New Game" title="Back to New Game">×</button>'+
    '<div class="remote-kicker">BLOCKS · TWO PHONES</div>'+
    '<h2 id="remote-title">Play together</h2>'+
    '<p id="remote-status">Clear two lines to send a junk line to your opponent.</p>'+
    '<div class="remote-actions" id="remote-actions">'+
      '<button type="button" id="remote-create">CREATE GAME</button>'+
      '<button type="button" id="remote-join">JOIN GAME</button>'+
    '</div>'+
    '<div id="remote-code-panel" hidden>'+
      '<button id="remote-code-exit" type="button" aria-label="Cancel room" title="Cancel room">×</button>'+
      '<div class="remote-code-label">YOUR ROOM CODE</div>'+
      '<div id="remote-code" aria-live="polite"></div>'+
      '<button type="button" id="remote-copy">COPY CODE</button>'+
    '</div>'+
    '<div id="remote-entry" hidden>'+
      '<div class="remote-code-label">ENTER THE SIX-LETTER CODE</div>'+
      '<div class="remote-code-entry">'+
        '<div id="remote-slots" aria-hidden="true">— — — — — —</div>'+
        '<input id="remote-input" type="text" inputmode="text" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Six-letter room code">'+
      '</div>'+
      '<button type="button" id="remote-entry-back">BACK</button>'+
    '</div>'+
    '<p id="remote-error" role="alert"></p>'+
    '</section>';
  document.body.append(lobby);
  const $=id=>lobby.querySelector('#'+id);
  const title=$('remote-title'),status=$('remote-status'),error=$('remote-error');
  const actions=$('remote-actions'),create=$('remote-create'),join=$('remote-join');
  const menuExit=$('remote-menu-exit');
  const codePanel=$('remote-code-panel'),room=$('remote-code'),copy=$('remote-copy'),codeExit=$('remote-code-exit');
  const entry=$('remote-entry'),input=$('remote-input'),slots=$('remote-slots'),entryBack=$('remote-entry-back');

  const resultPanel=document.createElement('div');
  resultPanel.id='remote-result';
  resultPanel.hidden=true;
  resultPanel.innerHTML='<section class="remote-result-panel" role="dialog" aria-label="Multiplayer match status" aria-modal="true">'+
    '<button type="button" id="remote-result-exit" aria-label="Exit to new game" title="Exit to new game">×</button>'+
    '<div class="remote-kicker" id="remote-result-kicker">MATCH COMPLETE</div>'+
    '<h2 id="remote-result-title"></h2>'+
    '<p id="remote-result-detail"></p>'+
    '<div id="remote-session-score" role="group" aria-label="Session matches won">'+
      '<div class="remote-score-heading">MATCHES WON</div>'+
      '<div class="remote-score-values">'+
        '<div class="remote-score-side"><span>YOU</span><strong id="remote-score-you">0</strong></div>'+
        '<span class="remote-score-dash" aria-hidden="true">—</span>'+
        '<div class="remote-score-side"><span>OPPONENT</span><strong id="remote-score-opponent">0</strong></div>'+
      '</div>'+
    '</div>'+
    '<button type="button" id="remote-restart">PLAY AGAIN</button>'+
    '<p id="remote-rematch-status" aria-live="polite"></p>'+
    '</section>';
  document.body.append(resultPanel);
  const resultKicker=resultPanel.querySelector('#remote-result-kicker');
  const resultTitle=resultPanel.querySelector('#remote-result-title');
  const resultDetail=resultPanel.querySelector('#remote-result-detail');
  const restart=resultPanel.querySelector('#remote-restart');
  const exitResult=resultPanel.querySelector('#remote-result-exit');
  const rematchStatus=resultPanel.querySelector('#remote-rematch-status');
  const scoreYou=resultPanel.querySelector('#remote-score-you');
  const scoreOpponent=resultPanel.querySelector('#remote-score-opponent');

  const bar=document.createElement('div');
  bar.id='remote-match-bar';
  bar.hidden=true;
  bar.innerHTML='<span id="remote-match-label"></span><button type="button" id="remote-leave">FORFEIT</button>';
  document.getElementById('console').prepend(bar);

  const showLobby=show=>{lobby.hidden=!show;document.body.classList.toggle('remote-waiting',show)};
  const showResult=show=>{resultPanel.hidden=!show;document.body.classList.toggle('remote-complete',show)};
  const setError=e=>{error.textContent=e?.message||String(e)};
  const persist=()=>{
    if(!match)return;
    const state=window.BLOCKS_REMOTE_CAPTURE?.();
    if(state){match.snapshot=state.snapshot;match.progress=state.progress;}
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(match))}
    catch(e){console.warn('Could not save remote match:',e);}
  };

  function lobbyStep(step){
    menuExit.hidden=step!=='menu';
    actions.hidden=step!=='menu';
    codePanel.hidden=step!=='code';
    entry.hidden=step!=='entry';
    error.textContent='';
  }
  function showCode(){
    room.textContent=match?.code||'';
    lobbyStep('code');
    title.textContent='Game created';
    status.textContent='Share this code with Player 2. You will both press Start when they join.';
    showLobby(true);
  }
  function displaySlots(){
    const value=input.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,6);
    input.value=value;
    slots.textContent=Array.from({length:6},(_,i)=>value[i]||'—').join(' ');
    return value;
  }
  function enterCode(){
    lobbyStep('entry');
    title.textContent='Join a game';
    status.textContent='Enter the six-letter room code.';
    input.value='';
    displaySlots();
    input.disabled=false;
    input.focus();
  }
  function menu(){
    lobbyStep('menu');
    title.textContent='Play together';
    status.textContent='Clear two lines to send a junk line to your opponent.';
    create.disabled=false;join.disabled=false;
  }
  function setCreating(on){
    creating=on;
    create.disabled=on;join.disabled=on;
    create.classList.toggle('is-loading',on);
    create.setAttribute('aria-busy',String(on));
  }

  let socket=null,wsHeartbeat=null,reconnectTimer=null,reference=0;
  function closeSocket(){
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
    if(wsHeartbeat){clearInterval(wsHeartbeat);wsHeartbeat=null;}
    const old=socket;socket=null;
    if(old){old.onclose=null;old.close();}
  }
  function openSocket(){
    if(!match||typeof WebSocket!=='function')return;
    const id=match.id,topic='realtime:blocks-match-'+id;
    try{
      const ws=new WebSocket('wss://psoncybkfsdmjksyrcvv.supabase.co/realtime/v1/websocket?apikey='+
        encodeURIComponent(KEY)+'&vsn=1.0.0');
      socket=ws;
      const send=(event,payload,target=topic)=>{
        if(ws.readyState===1)
          ws.send(JSON.stringify({topic:target,event,payload,ref:String(++reference)}));
      };
      ws.onopen=()=>{
        send('phx_join',{config:{broadcast:{ack:false,self:false}}});
        wsHeartbeat=setInterval(()=>send('heartbeat',{},'phoenix'),25000);
      };
      ws.onmessage=event=>{
        try{
          const message=JSON.parse(event.data);
          if(message.topic===topic&&message.event==='broadcast')void poll();
        }catch(_){}
      };
      ws.onclose=()=>{
        if(socket!==ws)return;
        socket=null;
        if(wsHeartbeat){clearInterval(wsHeartbeat);wsHeartbeat=null;}
        if(match?.id===id)reconnectTimer=setTimeout(openSocket,3000);
      };
      ws.onerror=()=>{}; // Polling is the reliable fallback.
    }catch(e){console.warn('Blocks Realtime:',e);}
  }
  async function rpc(name,args={}){
    const response=await fetch(API+name,{method:'POST',headers,body:JSON.stringify(args),cache:'no-store'});
    if(!response.ok){
      const body=await response.json().catch(()=>null);
      throw Error(body?.message||'Connection failed ('+response.status+')');
    }
    return response.json();
  }

  // Room-level session scoreboard is server-authoritative and remains visible
  // through every rematch. It resets only for a new room.
  function updateSessionScore(state){
    if(!match||!state)return;
    const hostWins=Number(state.host_wins);
    const guestWins=Number(state.guest_wins);
    if(!Number.isSafeInteger(hostWins)||hostWins<0||
       !Number.isSafeInteger(guestWins)||guestWins<0)return;
    match.hostWins=hostWins;match.guestWins=guestWins;
    scoreYou.textContent=String(match.player===1?hostWins:guestWins);
    scoreOpponent.textContent=String(match.player===1?guestWins:hostWins);
  }
  // Initial shared ready screen appears on BOTH devices after code entry.
  // Neither local board is started until the server sees both Start presses.
  function showStart(state){
    if(!match||finished||exiting)return;
    staging=true;ready=false;
    bar.hidden=true;
    showLobby(false);showResult(true);
    resultKicker.textContent='ROOM '+match.code+' · PLAYER '+match.player;
    resultTitle.textContent='READY TO START';
    resultDetail.textContent='Both players must press Start to begin.';
    updateSessionScore(state);
    const mine=match.player===1?state.host_ready:state.guest_ready;
    const theirs=match.player===1?state.guest_ready:state.host_ready;
    restart.disabled=Boolean(mine)||startSending;
    restart.classList.toggle('is-loading',startSending);
    restart.textContent=mine?'READY TO START':'START GAME';
    rematchStatus.textContent=mine?'Waiting for the other player…':
      theirs?'Opponent is ready. Press Start to begin.':
      'Waiting for both players to press Start.';
  }
  function holdGame(reason){
    if(!ready||held)return;
    held=true;
    bar.querySelector('#remote-match-label').textContent='PAUSED · '+reason;
    window.dispatchEvent(new CustomEvent('blocks:remote-hold'));
  }
  function resumeGame(){
    if(!ready||!held)return;
    held=false;
    bar.querySelector('#remote-match-label').textContent='ROOM '+match.code+' · PLAYER '+match.player;
    window.dispatchEvent(new CustomEvent('blocks:remote-unhold'));
  }
  function checkPresence(data){
    if(!ready||!data.presence_enabled)return;
    const peerOnline=match.player===1?data.guest_online:data.host_online;
    const ownOnline=match.player===1?data.host_online:data.guest_online;
    if(document.visibilityState==='hidden')holdGame('APP IN BACKGROUND');
    else if(!ownOnline)holdGame('RECONNECTING');
    else if(!peerOnline)holdGame('OPPONENT DISCONNECTED');
    else resumeGame();
  }
  async function heartbeat(force=false){
    if(!match||heartbeatInFlight||navigator.onLine===false||
       document.visibilityState==='hidden')return;
    const now=Date.now();
    if(!force&&now-lastHeartbeatAt<4000)return;
    lastHeartbeatAt=now;
    const current=match,round=current.round;
    heartbeatInFlight=true;
    try{
      await rpc('blocks_match_heartbeat',{
        p_match:current.id,p_token:current.token,p_round:round
      });
    }catch(e){
      if(match===current&&ready)holdGame('CONNECTION LOST');
    }finally{heartbeatInFlight=false;}
  }
  function readyUI(){
    if(ready||finished||forfeiting||exiting)return;
    ready=true;staging=false;held=false;
    bar.hidden=false;
    bar.querySelector('#remote-match-label').textContent='ROOM '+match.code+' · PLAYER '+match.player;
    showLobby(false);showResult(false);
    window.dispatchEvent(new CustomEvent('blocks:remote-ready',{detail:{round:match.round}}));
  }
  function rematchView(state){
    if(!finished||exiting)return;
    updateSessionScore(state);
    const mine=match.player===1?state.host_ready:state.guest_ready;
    const theirs=match.player===1?state.guest_ready:state.host_ready;
    restart.disabled=Boolean(mine)||rematchSending;
    restart.classList.toggle('is-loading',rematchSending);
    restart.textContent=mine?'READY TO PLAY AGAIN':'PLAY AGAIN';
    rematchStatus.textContent=mine?'Waiting for the other player…':
      theirs?'Your opponent wants a rematch.':'Both players can choose to play again.';
  }
  function finish(winner,state){
    if(exiting)return;
    if(!finished){
      finished=true;ready=false;forfeiting=false;
      match.finished=true;match.winner=winner;
      window.dispatchEvent(new CustomEvent('blocks:remote-finished',{detail:{winner}}));
    }
    bar.hidden=true;showLobby(false);
    resultKicker.textContent='MATCH COMPLETE · ROUND '+match.round;
    resultTitle.textContent=winner===match.player?'YOU WIN':winner===0?'DRAW':'YOU LOSE';
    if(winner===0)resultDetail.textContent='The match ended in a draw.';
    else resultDetail.textContent='PLAYER '+winner+' WON · PLAYER '+(3-winner)+' LOST';
    showResult(true);
    rematchView(state);
    persist();
  }
  function nextRound(round){
    if(round<=match.round)return;
    match.round=round;
    match.cursor=0;match.outbox=[];match.snapshot=null;match.progress=0;
    match.finished=false;match.winner=null;
    ready=false;staging=false;finished=false;forfeiting=false;startSending=false;rematchSending=false;exiting=false;held=false;
    bar.hidden=true;showResult(false);
    window.dispatchEvent(new CustomEvent('blocks:remote-new-round',{detail:{round}}));
    persist(); // A late attack can no longer be delivered to this round.
  }
  // Leaving a finished match invalidates the shared room, not merely this
  // device's local storage. A player who already requested a rematch is also
  // released, instead of waiting forever for the person who exited.
  function returnToNewGame(message=''){
    if(interval){clearInterval(interval);interval=null;}
    closeSocket();
    match=null;
    busy=false;ready=false;staging=false;finished=false;forfeiting=false;
    startSending=false;rematchSending=false;exiting=false;held=false;
    try{localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(PENDING_JOIN_KEY)}catch(_){}
    window.BLOCKS_REMOTE_RESET?.();
    bar.hidden=true;showResult(false);
    exitResult.disabled=false;codeExit.disabled=false;
    menu();showLobby(true);
    if(message)status.textContent=message;
  }
  async function exitToNewGame(){
    if(!match||exiting||ready&&!finished)return;
    exiting=true;exitResult.disabled=true;codeExit.disabled=true;
    rematchStatus.textContent='Leaving the room…';
    const current=match;
    try{
      await rpc('blocks_match_exit',{
        p_match:current.id,p_token:current.token,p_round:current.round
      });
      if(match===current)returnToNewGame();
    }catch(e){
      if(match!==current)return;
      exiting=false;exitResult.disabled=false;codeExit.disabled=false;
      rematchStatus.textContent='Could not leave the room. Try again.';
      error.textContent='Could not cancel room. Try again.';
      console.warn('Blocks match exit failed:',e);
    }
  }
  async function poll(){
    if(!match||busy||exiting||navigator.onLine===false)return;
    const current=match;
    busy=true;
    try{
      const data=await rpc('blocks_match_poll',{
        p_match:current.id,p_token:current.token,p_after:current.cursor||0
      });
      if(current!==match||exiting)return;
      if([0,1,2].includes(data.difficulty)&&['ALL','IO'].includes(data.piece_set)){
        if(current.difficulty!==data.difficulty||current.piece_set!==data.piece_set){
          current.difficulty=data.difficulty;current.piece_set=data.piece_set;
          window.dispatchEvent(new CustomEvent('blocks:remote-config',{
            detail:{difficulty:data.difficulty,piece_set:data.piece_set}
          }));
          persist();
        }
      }
      if(data.status==='cancelled'){
        returnToNewGame('The other player left the room. Create or join a new game.');
        return;
      }
      if(data.round>current.round){
        nextRound(data.round);
        // The request's cursor belonged to the previous round. Its response
        // could miss early new-round events; fetch from zero on next poll.
        if(data.status==='playing')readyUI();
        return;
      }
      if(data.round<current.round)return;
      for(const event of data.events||[]){
        if(event.id<=(current.cursor||0))continue;
        if(event.sender!==current.player)
          window.dispatchEvent(new CustomEvent('blocks:remote-event',{detail:event}));
        current.cursor=event.id;
        // Persist applied board and event cursor in a single saved value.
        persist();
      }
      if(data.status==='playing'){readyUI();checkPresence(data)}
      else if(data.status==='waiting')showCode();
      else if(data.status==='ready')showStart(data);
      else if(data.status==='finished')finish(data.winner,data);
      error.textContent='';
      if(ready)void flush();
    }catch(e){
      if(current!==match||exiting)return;
      if(ready)holdGame('CONNECTION LOST');
      setError(e);
      if(/not found|access denied|expired/i.test(e.message)){
        // Abandon only this device's expired match, not the unrelated solo save.
        returnToNewGame('That game has expired. Create or join another game.');
        title.textContent='Room unavailable';
      }
    }finally{busy=false}
  }
  async function flush(){
    if(!match||sending||finished||navigator.onLine===false)return;
    sending=true;
    try{
      while(match?.outbox?.length){
        const current=match;
        const currentRound=current.round;
        const event=current.outbox[0];
        await rpc('blocks_match_send',{
          p_match:current.id,p_token:current.token,p_type:event.type,
          p_rows:event.rows,p_key:event.key,p_round:currentRound
        });
        if(match!==current||current.round!==currentRound)break;
        if(current.outbox[0]?.key===event.key)current.outbox.shift();
        persist();
      }
    }catch(e){setError(e)}
    finally{sending=false}
  }
  async function connect(value,fresh=false){
    if(interval){clearInterval(interval);interval=null;}
    closeSocket();
    match=fresh?{...value,round:1,cursor:0,outbox:[],snapshot:null,progress:0,finished:false}:
      {...value,round:value.round||1,outbox:value.outbox||[]};
    ready=false;staging=false;finished=false;forfeiting=false;held=false;
    startSending=false;rematchSending=false;
    if(fresh)window.BLOCKS_REMOTE_RESET?.();
    persist();
    lobbyStep('code');
    title.textContent='Connecting…';status.textContent='Checking the room…';
    if(match.player===2){codePanel.hidden=true;}
    showLobby(true);showResult(false);
    openSocket();
    await heartbeat(true);
    await poll();
    interval=setInterval(()=>{void heartbeat();void poll();void flush();},1600);
    void flush();
  }
  async function createRoom(){
    if(creating||joining)return;
    try{localStorage.removeItem(PENDING_JOIN_KEY)}catch(_){}
    setCreating(true);error.textContent='';
    try{
      const config=window.BLOCKS_REMOTE_LOCAL_CONFIG||{difficulty:1,piece_set:'ALL'};
      const rows=await rpc('blocks_create_match_config',{
        p_difficulty:config.difficulty,p_piece_set:config.piece_set
      });
      const row=rows[0];
      await connect({id:row.match_id,token:row.player_token,code:row.room_code,player:1,...config},true);
    }catch(e){setError(e);menu();setError(e)}
    finally{setCreating(false)}
  }
  async function joinRoom(code){
    if(joining||creating||!(/^[A-Z]{6}$/.test(code)))return;
    joining=true;input.disabled=true;
    entry.classList.add('is-loading');error.textContent='';
    try{
      let attempt;
      try{attempt=JSON.parse(localStorage.getItem(PENDING_JOIN_KEY)||'null')}catch(_){}
      if(!attempt||attempt.code!==code||typeof attempt.token!=='string'){
        attempt={code,token:crypto.randomUUID()};
        localStorage.setItem(PENDING_JOIN_KEY,JSON.stringify(attempt));
      }
      const rows=await rpc('blocks_join_match_v2',{
        p_code:code,p_join_token:attempt.token
      });
      const row=rows[0];
      await connect({id:row.match_id,token:row.player_token,code,player:2},true);
      localStorage.removeItem(PENDING_JOIN_KEY);
    }catch(e){
      input.value='';displaySlots();
      setError(e);input.disabled=false;
      input.focus();
    }finally{joining=false;entry.classList.remove('is-loading');}
  }
  async function requestStart(){
    if(!match||!staging||ready||finished||startSending||exiting)return;
    startSending=true;
    restart.disabled=true;restart.classList.add('is-loading');
    rematchStatus.textContent='Confirming your readiness…';
    try{
      const current=match,round=current.round;
      const state=await rpc('blocks_match_start',{
        p_match:current.id,p_token:current.token,p_round:round
      });
      if(current!==match||exiting||current.round!==round)return;
      if(state.status==='playing')readyUI();
      else showStart(state);
      void poll();
    }catch(e){
      if(match&&!exiting)rematchStatus.textContent=e.message;
    }finally{
      startSending=false;restart.classList.remove('is-loading');
      if(match&&staging&&!exiting)void poll();
    }
  }
  async function requestRematch(){
    if(!match||!finished||rematchSending||exiting)return;
    rematchSending=true;restart.disabled=true;
    restart.classList.add('is-loading');rematchStatus.textContent='Requesting rematch…';
    try{
      const current=match;
      const status=await rpc('blocks_match_rematch',{
        p_match:current.id,p_token:current.token,p_round:current.round
      });
      if(current!==match||exiting)return;
      if(status.round>match.round)nextRound(status.round);
      else rematchView(status);
      void poll();
    }catch(e){rematchStatus.textContent=e.message}
    finally{
      rematchSending=false;
      restart.classList.remove('is-loading');
      // The authoritative poll will update both players' readiness.
      if(match&&finished)void poll();
    }
  }

  menuExit.onclick=()=>{
    // There is no match on the Play Together menu. Return to the full
    // New Game selector, not to an automatically resumed solo board.
    if(match||creating||joining)return;
    try{
      sessionStorage.setItem(NEW_GAME_SCREEN_KEY,'1');
      sessionStorage.removeItem('blocks:auto-start:v1');
      localStorage.removeItem(PENDING_JOIN_KEY);
    }catch(_){}
    const url=new URL(location.href);
    url.searchParams.delete('remote');
    url.searchParams.delete('players');
    location.href=url.href;
  };
  create.onclick=()=>{void createRoom()};
  join.onclick=()=>{enterCode()};
  entryBack.onclick=()=>{if(!joining){
    try{localStorage.removeItem(PENDING_JOIN_KEY)}catch(_){}
    menu();
  }};
  input.addEventListener('input',()=>{
    const value=displaySlots();
    if(value.length===6&&!joining)void joinRoom(value);
  });
  copy.onclick=async()=>{
    if(!match)return;
    try{await navigator.clipboard.writeText(match.code);copy.textContent='COPIED'}
    catch(_){setError('Copy the code shown above.')}
  };
  restart.onclick=()=>{if(finished)void requestRematch();else if(staging)void requestStart();};
  exitResult.onclick=()=>{void exitToNewGame()};
  codeExit.onclick=()=>{void exitToNewGame()};
  bar.querySelector('#remote-leave').onclick=()=>{
    if(!window.confirm('Forfeit this match?'))return;
    window.BLOCKS_REMOTE?.reportLoss();
    bar.hidden=true;
  };

  window.BLOCKS_REMOTE={
    get active(){return Boolean(match)},
    get ready(){return ready},
    get player(){return match?.player||null},
    get round(){return match?.round||null},
    persist,
    sendAttack(rows){
      if(!ready||finished||!Number.isInteger(rows)||rows<1||rows>20)return;
      match.outbox.push({key:crypto.randomUUID(),type:'attack',rows});
      persist();void flush();
    },
    reportLoss(){
      if(!match||finished||forfeiting||!ready)return;
      ready=false;forfeiting=true;
      window.dispatchEvent(new CustomEvent('blocks:remote-forfeiting'));
      match.outbox.push({key:crypto.randomUUID(),type:'lost',rows:null});
      persist();void flush();
    }
  };

  window.addEventListener('online',()=>{void heartbeat(true);void poll();void flush()});
  window.addEventListener('offline',()=>holdGame('CONNECTION LOST'));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){void heartbeat(true);void poll();void flush();}
    else{holdGame('APP IN BACKGROUND');persist();}
  });
  window.addEventListener('pagehide',()=>{persist();closeSocket()});
  window.addEventListener('pageshow',event=>{
    if(event.persisted&&match){openSocket();void heartbeat(true);void poll();}
  });
  if(match)void connect(match);
  else if(pendingJoin?.code&&pendingJoin?.token){
    menu();showLobby(true);enterCode();
    input.value=pendingJoin.code;displaySlots();
    void joinRoom(pendingJoin.code);
  }else{menu();showLobby(true);}
})();