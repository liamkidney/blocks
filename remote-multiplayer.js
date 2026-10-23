// Two-phone multiplayer transport: independent local boards, durable attack outbox.
// Only activated in ?remote=1; solo and single-phone multiplayer remain unchanged.
(()=>{
  if(new URLSearchParams(location.search).get('remote')!=='1')return;
  const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
  const STORAGE_KEY='blocks:remote-match:'+location.pathname;
  const headers={apikey:KEY,'Content-Type':'application/json'};
  const read=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(_){return null}};
  const saved=read();
  let match=saved&&saved.id&&saved.token&&[1,2].includes(saved.player)?saved:null;
  let busy=false,sending=false,ready=false,finished=false,forfeiting=false,interval=null;

  const lobby=document.createElement('div');
  lobby.id='remote-lobby';
  lobby.innerHTML='<section class="remote-panel" role="dialog" aria-label="Two-phone multiplayer">'+
    '<div class="remote-kicker">BLOCKS · TWO PHONES</div>'+
    '<h2 id="remote-title">Play on two phones</h2>'+
    '<p id="remote-status">Each player has a separate board. Clearing two lines sends one junk line to your opponent.</p>'+
    '<div id="remote-code" aria-live="polite"></div>'+\n    '<button type="button" id="remote-copy" hidden>COPY CODE</button>'+
    '<input id="remote-input" type="text" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="SIX-LETTER CODE" aria-label="Room code">'+
    '<div class="remote-actions"><button type="button" id="remote-create">CREATE MATCH</button>'+
    '<button type="button" id="remote-join">JOIN MATCH</button></div>'+
    '<button type="button" id="remote-resume" hidden>RECONNECT</button>'+
    '<button type="button" id="remote-new" hidden>NEW MATCH</button>'+
    '<button type="button" id="remote-back">SOLO PLAY</button>'+
    '<p id="remote-error" role="alert"></p></section>';
  document.body.append(lobby);
  const $=id=>lobby.querySelector('#'+id);
  const title=$('remote-title'),status=$('remote-status'),room=$('remote-code'),input=$('remote-input');
  const copy=$('remote-copy');
  const create=$('remote-create'),join=$('remote-join'),resume=$('remote-resume');
  const newMatch=$('remote-new'),back=$('remote-back'),error=$('remote-error');
  const bar=document.createElement('div');
  bar.id='remote-match-bar';
  bar.hidden=true;
  bar.innerHTML='<span id="remote-match-label"></span><button type="button" id="remote-leave">FORFEIT</button>';
  document.getElementById('console').prepend(bar);
  const show=visible=>{lobby.hidden=!visible;document.body.classList.toggle('remote-waiting',visible)};
  const setError=e=>{error.textContent=e?.message||String(e);};
  const updateRoom=()=>{room.textContent=match?.code||'';copy.hidden=!match?.code;};
  copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(match.code);copy.textContent='COPIED';}
    catch(_){setError('Select the code above to copy it.');}
  };
  const persist=()=>{
    if(!match)return;
    const state=window.BLOCKS_REMOTE_CAPTURE?.();
    if(state){match.snapshot=state.snapshot;match.progress=state.progress;}
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(match))}catch(e){console.warn('Remote match save:',e);}
  };
  // Supabase's Phoenix websocket provides fast database-triggered wake-ups.
  // All event data is still read via token-validated RPC. Polling is a fallback.
  let socket=null,heartbeat=null,reconnectTimer=null,reference=0;
  function closeSocket(){
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
    if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
    const old=socket;socket=null;
    if(old){old.onclose=null;old.close();}
  }
  function openSocket(){
    if(!match||finished||typeof WebSocket!=='function')return;
    const matchId=match.id;
    const topic='realtime:blocks-match-'+matchId;
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
          const msg=JSON.parse(event.data);
          if(msg.topic===topic&&msg.event==='broadcast')void poll();
        }catch(_){}
      };
      ws.onclose=()=>{
        if(socket!==ws)return;
        socket=null;
        if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
        if(match?.id===matchId&&!finished)
          reconnectTimer=setTimeout(openSocket,3000);
      };
      ws.onerror=()=>{}; // Periodic polling continues if Realtime is unavailable.
    }catch(error){console.warn('Blocks Realtime:',error);}
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
    show(false);
    bar.hidden=false;
    bar.querySelector('#remote-match-label').textContent='ROOM '+match.code+' · PLAYER '+match.player;
    window.dispatchEvent(new CustomEvent('blocks:remote-ready'));
  }
  function finish(winner){
    if(finished)return;
    finished=true;
    ready=false;
    if(interval){clearInterval(interval);interval=null;}
    closeSocket();
    window.dispatchEvent(new CustomEvent('blocks:remote-finished',{detail:{winner}}));
    bar.hidden=true;
    title.textContent=winner===match.player?'YOU WIN':winner===0?'DRAW':'YOU LOSE';
    status.textContent='Match finished.';
    input.hidden=true;create.hidden=true;join.hidden=true;resume.hidden=true;
    newMatch.hidden=false;
    updateRoom();show(true);
    match.finished=true;persist();
  }
  async function poll(){
    if(!match||busy||finished||navigator.onLine===false)return;
    busy=true;
    try{
      const result=await rpc('blocks_match_poll',{
        p_match:match.id,p_token:match.token,p_after:match.cursor||0
      });
      if(result.status==='playing'&&!forfeiting)readyUI();
      else if(result.status==='waiting'){
        status.textContent='Waiting for Player 2. Share this code:';
        updateRoom();show(true);
      }
      for(const event of result.events||[]){
        if(event.id<=(match.cursor||0))continue;
        if(event.sender!==match.player){
          window.dispatchEvent(new CustomEvent('blocks:remote-event',{detail:event}));
        }
        match.cursor=event.id;
        // Atomically persist cursor and the board updated by the event handler.
        persist();
      }
      if(result.status==='finished')finish(result.winner);
      error.textContent='';
      if(ready)void flush();
    }catch(e){
      setError(e);
      if(/not found|access denied|expired/i.test(e.message)){
        title.textContent='Room unavailable';
        status.textContent='This match may have expired. Start a new match.';
        newMatch.hidden=false;show(true);
      }
    }
    finally{busy=false;}
  }
  async function flush(){
    if(!match||sending||finished||navigator.onLine===false)return;
    sending=true;
    try{
      while(match?.outbox?.length){
        const current=match;
        const event=current.outbox[0];
        await rpc('blocks_match_send',{
          p_match:current.id,p_token:current.token,
          p_type:event.type,p_rows:event.rows,p_key:event.key
        });
        if(match!==current)break;
        current.outbox.shift();
        persist();
      }
    }catch(e){setError(e)}
    finally{sending=false}
  }
  async function connect(value,fresh=false){
    if(interval)clearInterval(interval);
    closeSocket();
    match=fresh?{...value,cursor:0,outbox:[],progress:0,snapshot:null}:value;
    newMatch.hidden=true;copy.textContent='COPY CODE';
    ready=false;finished=false;forfeiting=false;
    if(fresh)window.BLOCKS_REMOTE_RESET?.();
    persist();
    updateRoom();
    title.textContent='Connecting';
    status.textContent='Checking the room…';
    create.hidden=true;join.hidden=true;input.hidden=true;resume.hidden=true;
    show(true);error.textContent='';
    openSocket();
    await poll();
    interval=setInterval(()=>{void poll();void flush();},1600);
    void flush();
  }
  async function newRoom(kind){
    create.disabled=join.disabled=true;
    error.textContent='';
    try{
      let value;
      if(kind==='create'){
        const rows=await rpc('blocks_create_match');
        const row=rows[0];
        value={id:row.match_id,token:row.player_token,code:row.room_code,player:1};
      }else{
        const code=input.value.trim().toUpperCase();
        if(!/^[A-Z]{6}$/.test(code))throw Error('Enter a six-letter room code.');
        const rows=await rpc('blocks_join_match',{p_code:code});
        const row=rows[0];
        value={id:row.match_id,token:row.player_token,code,player:2};
      }
      await connect(value,true);
    }catch(e){setError(e);create.disabled=join.disabled=false}
  }
  create.onclick=()=>{void newRoom('create')};
  join.onclick=()=>{void newRoom('join')};
  input.addEventListener('input',()=>{input.value=input.value.toUpperCase().replace(/[^A-Z]/g,'')});
  input.addEventListener('keydown',e=>{if(e.key==='Enter')void newRoom('join')});
  resume.onclick=()=>{if(match)void connect(match)};
  newMatch.onclick=()=>{
    if(interval)clearInterval(interval);
    closeSocket();
    try{localStorage.removeItem(STORAGE_KEY)}catch(_){}
    const url=new URL(location.href);url.searchParams.set('remote','1');location.href=url.href;
  };
  back.onclick=()=>{
    const url=new URL(location.href);
    url.searchParams.delete('remote');url.searchParams.delete('players');
    location.href=url.href;
  };
  bar.querySelector('#remote-leave').onclick=()=>{
    if(!window.confirm('Forfeit this match?'))return;
    window.BLOCKS_REMOTE?.reportLoss();
    status.textContent='Forfeiting match…';
    bar.hidden=true;show(true);
  };

  window.BLOCKS_REMOTE={
    get active(){return Boolean(match)},
    get ready(){return ready},
    get player(){return match?.player||null},
    persist,
    sendAttack(rows){
      if(!ready||!Number.isInteger(rows)||rows<1||rows>20)return;
      match.outbox ||= [];
      match.outbox.push({key:crypto.randomUUID(),type:'attack',rows});
      persist();void flush();
    },
    reportLoss(){
      if(!match||finished||!ready)return;
      ready=false;forfeiting=true;
      window.dispatchEvent(new CustomEvent('blocks:remote-forfeiting'));
      match.outbox ||= [];
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

  if(match&&!match.finished){
    title.textContent='Resume match?';
    status.textContent='A previous match is saved on this device.';
    create.hidden=true;join.hidden=true;input.hidden=true;
    resume.hidden=false;updateRoom();
  }else if(match?.finished){
    match=null;
    try{localStorage.removeItem(STORAGE_KEY)}catch(_){}
  }
  show(true);
})();