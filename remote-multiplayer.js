// Two-phone Blocks: separate local boards, token-protected shared room, round-scoped attacks.
// One-phone multiplayer and solo play never load this mode's transport.
(()=>{
  if(new URLSearchParams(location.search).get('remote')!=='1')return;

  const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
  const STORAGE_KEY='blocks:remote-match:'+location.pathname;
  const headers={apikey:KEY,'Content-Type':'application/json'};
  const read=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){return null}};
  const saved=read();
  let match=saved?.id&&saved?.token&&[1,2].includes(saved.player)?saved:null;
  if(match){match.round=match.round||1;match.cursor ||= 0;match.outbox ||= [];}
  let busy=false,sending=false,ready=false,finished=false,forfeiting=false,interval=null;
  let creating=false,joining=false,rematchSending=false;

  const lobby=document.createElement('div');
  lobby.id='remote-lobby';
  lobby.innerHTML='<section class="remote-panel" role="dialog" aria-label="Two-phone multiplayer">'+
    '<div class="remote-kicker">BLOCKS · TWO PHONES</div>'+
    '<h2 id="remote-title">Play together</h2>'+
    '<p id="remote-status">Clear two lines to send a junk line to your opponent.</p>'+
    '<div class="remote-actions" id="remote-actions">'+
      '<button type="button" id="remote-create">CREATE GAME</button>'+
      '<button type="button" id="remote-join">JOIN GAME</button>'+
    '</div>'+
    '<div id="remote-code-panel" hidden>'+
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
  const codePanel=$('remote-code-panel'),room=$('remote-code'),copy=$('remote-copy');
  const entry=$('remote-entry'),input=$('remote-input'),slots=$('remote-slots'),entryBack=$('remote-entry-back');

  const resultPanel=document.createElement('div');
  resultPanel.id='remote-result';
  resultPanel.hidden=true;
  resultPanel.innerHTML='<section class="remote-result-panel" role="dialog" aria-label="Match result" aria-modal="true">'+
    '<div class="remote-kicker">MATCH COMPLETE</div>'+
    '<h2 id="remote-result-title"></h2>'+
    '<p id="remote-result-detail"></p>'+
    '<button type="button" id="remote-restart">PLAY AGAIN</button>'+
    '<p id="remote-rematch-status" aria-live="polite"></p>'+
    '</section>';
  document.body.append(resultPanel);
  const resultTitle=resultPanel.querySelector('#remote-result-title');
  const resultDetail=resultPanel.querySelector('#remote-result-detail');
  const restart=resultPanel.querySelector('#remote-restart');
  const rematchStatus=resultPanel.querySelector('#remote-rematch-status');

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
    actions.hidden=step!=='menu';
    codePanel.hidden=step!=='code';
    entry.hidden=step!=='entry';
    error.textContent='';
  }
  function showCode(){
    room.textContent=match?.code||'';
    lobbyStep('code');
    title.textContent='Game created';
    status.textContent='Share this code with Player 2. The game will start when they join.';
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

  let socket=null,heartbeat=null,reconnectTimer=null,reference=0;
  function closeSocket(){
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
    if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
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
        heartbeat=setInterval(()=>send('heartbeat',{},'phoenix'),25000);
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
        if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
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

  function readyUI(){
    if(ready||finished||forfeiting)return;
    ready=true;
    bar.hidden=false;
    bar.querySelector('#remote-match-label').textContent='ROOM '+match.code+' · PLAYER '+match.player;
    showLobby(false);showResult(false);
    window.dispatchEvent(new CustomEvent('blocks:remote-ready',{detail:{round:match.round}}));
  }
  function rematchView(state){
    if(!finished)return;
    const mine=match.player===1?state.host_ready:state.guest_ready;
    const theirs=match.player===1?state.guest_ready:state.host_ready;
    restart.disabled=Boolean(mine)||rematchSending;
    restart.classList.toggle('is-loading',rematchSending);
    restart.textContent=mine?'READY TO PLAY AGAIN':'PLAY AGAIN';
    rematchStatus.textContent=mine?'Waiting for the other player…':
      theirs?'Your opponent wants a rematch.':'Both players can choose to play again.';
  }
  function finish(winner,state){
    if(!finished){
      finished=true;ready=false;forfeiting=false;
      match.finished=true;match.winner=winner;
      window.dispatchEvent(new CustomEvent('blocks:remote-finished',{detail:{winner}}));
    }
    bar.hidden=true;showLobby(false);
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
    ready=false;finished=false;forfeiting=false;rematchSending=false;
    bar.hidden=true;showResult(false);
    window.dispatchEvent(new CustomEvent('blocks:remote-new-round',{detail:{round}}));
    persist(); // A late attack can no longer be delivered to this round.
  }
  async function poll(){
    if(!match||busy||navigator.onLine===false)return;
    const current=match;
    busy=true;
    try{
      const data=await rpc('blocks_match_poll',{
        p_match:current.id,p_token:current.token,p_after:current.cursor||0
      });
      if(current!==match)return;
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
      if(data.status==='playing')readyUI();
      else if(data.status==='waiting')showCode();
      else if(data.status==='finished')finish(data.winner,data);
      error.textContent='';
      if(ready)void flush();
    }catch(e){
      if(current!==match)return;
      setError(e);
      if(/not found|access denied|expired/i.test(e.message)){
        // Abandon only this device's expired match, not the unrelated solo save.
        match=null;ready=false;finished=false;
        try{localStorage.removeItem(STORAGE_KEY)}catch(_){}
        showResult(false);menu();showLobby(true);
        title.textContent='Room unavailable';
        status.textContent='That game has expired. Create or join another game.';
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
    ready=false;finished=false;forfeiting=false;rematchSending=false;
    if(fresh)window.BLOCKS_REMOTE_RESET?.();
    persist();
    lobbyStep('code');
    title.textContent='Connecting…';status.textContent='Checking the room…';
    if(match.player===2){codePanel.hidden=true;}
    showLobby(true);showResult(false);
    openSocket();
    await poll();
    interval=setInterval(()=>{void poll();void flush();},1600);
    void flush();
  }
  async function createRoom(){
    if(creating||joining)return;
    setCreating(true);error.textContent='';
    try{
      const rows=await rpc('blocks_create_match');
      const row=rows[0];
      await connect({id:row.match_id,token:row.player_token,code:row.room_code,player:1},true);
    }catch(e){setError(e);menu();setError(e)}
    finally{setCreating(false)}
  }
  async function joinRoom(code){
    if(joining||creating||!(/^[A-Z]{6}$/.test(code)))return;
    joining=true;input.disabled=true;
    entry.classList.add('is-loading');error.textContent='';
    try{
      const rows=await rpc('blocks_join_match',{p_code:code});
      const row=rows[0];
      await connect({id:row.match_id,token:row.player_token,code,player:2},true);
    }catch(e){
      input.value='';displaySlots();
      setError(e);input.disabled=false;
      input.focus();
    }finally{joining=false;entry.classList.remove('is-loading');}
  }
  async function requestRematch(){
    if(!match||!finished||rematchSending)return;
    rematchSending=true;restart.disabled=true;
    restart.classList.add('is-loading');rematchStatus.textContent='Requesting rematch…';
    try{
      const current=match;
      const status=await rpc('blocks_match_rematch',{
        p_match:current.id,p_token:current.token,p_round:current.round
      });
      if(current!==match)return;
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

  create.onclick=()=>{void createRoom()};
  join.onclick=()=>{enterCode()};
  entryBack.onclick=()=>{if(!joining)menu()};
  input.addEventListener('input',()=>{
    const value=displaySlots();
    if(value.length===6&&!joining)void joinRoom(value);
  });
  copy.onclick=async()=>{
    if(!match)return;
    try{await navigator.clipboard.writeText(match.code);copy.textContent='COPIED'}
    catch(_){setError('Copy the code shown above.')}
  };
  restart.onclick=()=>{void requestRematch()};
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

  window.addEventListener('online',()=>{void poll();void flush()});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){void poll();void flush();}
    else persist();
  });
  window.addEventListener('pagehide',()=>{persist();closeSocket()});
  window.addEventListener('pageshow',event=>{
    if(event.persisted&&match){openSocket();void poll();}
  });
  if(match)void connect(match);
  else{menu();showLobby(true);}
})();