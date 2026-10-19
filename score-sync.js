// Durable, idempotent score synchronization. The local outbox is authoritative
// until Supabase acknowledges each score (including completed/abandoned games).
(()=>{
  if(TWO_PLAYER)return;
  const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/sessions';
  const KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
  const headers={apikey:KEY,'Content-Type':'application/json'};
  const mode=new URLSearchParams(location.search).get('pieces')?.toUpperCase()==='IO'?'IO':'ALL';
  const OUTBOX_KEY='blocks:score-outbox:v1:'+location.pathname.replace(/index[.]html$/,'');
  const pending=new Map(),registered=new Set(),sent=new Map(),terminal=new Map();
  let busy=false,lastAttempt=0;
  let id=storedSessionId||crypto.randomUUID();
  window.BLOCKS_SESSION_ID=id;
  function persist(){
    try{
      if(pending.size)localStorage.setItem(OUTBOX_KEY,JSON.stringify([...pending.values()]));
      else localStorage.removeItem(OUTBOX_KEY);
    }catch(error){console.warn('Blocks score outbox could not be saved:',error)}
  }
  try{
    const stored=JSON.parse(localStorage.getItem(OUTBOX_KEY)||'[]');
    if(Array.isArray(stored))for(const item of stored){
      if(!item||typeof item.session_id!=='string'||!item.player_id||!Number.isSafeInteger(item.score)||
        !Number.isSafeInteger(item.lines)||!['active','completed','abandoned'].includes(item.status))continue;
      pending.set(item.session_id,item);
      if(item.status!=='active')terminal.set(item.session_id,item.status);
    }
  }catch(error){console.warn('Blocks score outbox could not be read:',error)}
  function playerId(){
    try{return JSON.parse(localStorage.getItem('blocks:player:v1')||'null')?.player_id||null}
    catch(_){return null}
  }
  function capture(status){
    return {session_id:id,player_id:playerId(),score:game.score,lines:game.lines,status,
      pieces_mode:mode,ghost_mode:window.BLOCKS_CONFIG.ghostPiece===true,difficulty:game.difficulty};
  }
  function queue(status=game.phase==='game_over'?'completed':'active',force=false){
    if(window.BLOCKS_AWAITING_START)return Promise.resolve();
    const item=capture(status);
    if(!item.player_id)return Promise.resolve();
    const previous=pending.get(item.session_id);
    // Once a game has ended it must never turn active again.
    if((previous&&previous.status!=='active'&&item.status!==previous.status)||
       (terminal.has(item.session_id)&&terminal.get(item.session_id)!==item.status))return Promise.resolve();
    const signature=JSON.stringify([item.score,item.lines,item.status,item.difficulty,item.ghost_mode]);
    if(!previous&&sent.get(item.session_id)===signature)return Promise.resolve();
    if(previous&&JSON.stringify(previous)===JSON.stringify(item))return drain(force);
    pending.set(item.session_id,item);
    if(item.status!=='active')terminal.set(item.session_id,item.status);
    persist(); // Before any network attempt, including when offline.
    return drain(force);
  }
  window.BLOCKS_QUEUE_SCORE=queue;
  async function write(item){
    const sid=encodeURIComponent(item.session_id);
    if(!registered.has(item.session_id)){
      const lookup=await fetch(API+'?select=session_id&session_id=eq.'+sid,{headers});
      if(!lookup.ok)throw Error('Session lookup '+lookup.status);
      if(!(await lookup.json()).length){
        const created=await fetch(API,{method:'POST',headers,body:JSON.stringify(item),keepalive:true});
        if(!created.ok&&created.status!==409)throw Error('Session create '+created.status);
        if(created.ok){registered.add(item.session_id);return}
      }
      registered.add(item.session_id);
    }
    const response=await fetch(API+'?session_id=eq.'+sid,{
      method:'PATCH',headers,keepalive:true,
      body:JSON.stringify({score:item.score,lines:item.lines,status:item.status,difficulty:item.difficulty,
        ghost_mode:item.ghost_mode,updated_at:new Date().toISOString()})
    });
    if(!response.ok)throw Error('Session update '+response.status);
  }
  async function drain(force=false){
    if(busy||!pending.size||navigator.onLine===false)return;
    if(!force&&Date.now()-lastAttempt<5000)return;
    busy=true;
    try{
      while(pending.size&&navigator.onLine!==false){
        const [sid,item]=pending.entries().next().value;
        lastAttempt=Date.now();
        try{
          if(window.BLOCKS_ENSURE_PLAYER)await window.BLOCKS_ENSURE_PLAYER();
          await write(item);
          sent.set(sid,JSON.stringify([item.score,item.lines,item.status,item.difficulty,item.ghost_mode]));
          if(pending.get(sid)===item){pending.delete(sid);persist()}
        }catch(error){
          console.warn('Blocks score sync:',error);
          break;
        }
      }
    }finally{busy=false}
  }
  window.addEventListener('blocks:restart',()=>{
    void queue(game.phase==='game_over'?'completed':'abandoned',true);
    id=crypto.randomUUID();
    window.BLOCKS_SESSION_ID=id;
  });
  window.addEventListener('online',()=>{void drain(true)});
  setInterval(()=>{void queue();void drain()},1000);
  document.addEventListener('visibilitychange',()=>{void queue(undefined,true)});
  window.addEventListener('pagehide',()=>{void queue(undefined,true)});
  void queue(undefined,true);
})();
