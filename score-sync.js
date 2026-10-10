// Serial, retryable score synchronization. Never confuse two session IDs.
(()=>{
 if(TWO_PLAYER)return;
 const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/sessions';
 const KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
 const headers={apikey:KEY,'Content-Type':'application/json'};
 const params=new URLSearchParams(location.search);
 const mode=params.get('pieces')?.toUpperCase()==='IO'?'IO':'ALL';
 const ghost=params.get('ghost')==='true';
 let id=storedSessionId||crypto.randomUUID();
 window.BLOCKS_SESSION_ID=id;
 const pending=new Map();
 const registered=new Set();
 const sent=new Map();
 const terminal=new Set();
 let busy=false,lastAttempt=0;
 function playerId(){
  try{return JSON.parse(localStorage.getItem('blocks:player:v1')||'null')?.player_id||null;}
  catch(_){return null;}
 }
 function capture(status){
  return {session_id:id,player_id:playerId(),score:game.score,lines:game.lines,status,
   pieces_mode:mode,ghost_mode:ghost};
 }
 function queue(status=game.phase==='game_over'?'completed':'active',force=false){
  const item=capture(status);
  if(!item.player_id)return Promise.resolve();
  const previous=pending.get(item.session_id);
  // A terminal status must never be replaced by an active update.
  if((previous&&previous.status!=='active'&&item.status==='active')||
     (terminal.has(item.session_id)&&item.status==='active'))return Promise.resolve();
  const signature=JSON.stringify([item.score,item.lines,item.status]);
  if(!previous&&sent.get(item.session_id)===signature)return Promise.resolve();
  pending.set(item.session_id,item);
  return drain(force);
 }
 async function write(item){
  const sid=encodeURIComponent(item.session_id);
  if(!registered.has(item.session_id)){
   const lookup=await fetch(API+'?select=session_id&session_id=eq.'+sid,{headers});
   if(!lookup.ok)throw Error('Session lookup '+lookup.status);
   if(!(await lookup.json()).length){
    const created=await fetch(API,{method:'POST',headers,
     body:JSON.stringify(item),keepalive:true});
    if(!created.ok&&created.status!==409)throw Error('Session create '+created.status);
    if(created.ok){registered.add(item.session_id);return;}
   }
   registered.add(item.session_id);
  }
  const response=await fetch(API+'?session_id=eq.'+sid,{
   method:'PATCH',headers,keepalive:true,
   body:JSON.stringify({score:item.score,lines:item.lines,status:item.status,updated_at:new Date().toISOString()})
  });
  if(!response.ok)throw Error('Session update '+response.status);
 }
 async function drain(force=false){
  if(busy||!pending.size)return;
  if(!force&&Date.now()-lastAttempt<5000)return;
  busy=true;
  try{
   while(pending.size){
    const [sid,item]=pending.entries().next().value;
    lastAttempt=Date.now();
    try{
     if(window.BLOCKS_ENSURE_PLAYER)await window.BLOCKS_ENSURE_PLAYER();
     await write(item);
     sent.set(sid,JSON.stringify([item.score,item.lines,item.status]));
     if(item.status!=='active')terminal.add(sid);
     // Preserve a newer snapshot queued while the request was in flight.
     if(pending.get(sid)===item)pending.delete(sid);
    }catch(error){
     console.warn('Blocks score sync:',error);
     break; // Retry on the next interval, without discarding data.
    }
   }
  }finally{busy=false;}
 }
 window.addEventListener('blocks:restart',()=>{
  // Capture the old game's final state before the game object is replaced.
  void queue('abandoned',true);
  id=crypto.randomUUID();
  window.BLOCKS_SESSION_ID=id;
  // The next tick creates the new session after the game is reset.
 });
 setInterval(()=>{
  void queue();
  void drain();
 },1000);
 document.addEventListener('visibilitychange',()=>{void queue(undefined,true);});
 window.addEventListener('pagehide',()=>{void queue(undefined,true);});
 void queue(undefined,true);
})();
