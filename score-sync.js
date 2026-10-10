// One-player Supabase score sync. Sessions are identified by stable UUIDs.
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
 let lastSent='',lastAttempt=0,busy=false;
 let registered=new Set();
 function playerId(){
   try{return JSON.parse(localStorage.getItem('blocks:player:v1')||'null')?.player_id||null;}
   catch(_){return null;}
 }
 async function send(status='active',force=false){
   const pid=playerId();
   if(!pid||busy)return;
   const data={score:game.score,lines:game.lines,status};
   const signature=JSON.stringify(data);
   if(!force&&signature===lastSent)return;
   if(!force&&Date.now()-lastAttempt<5000)return;
   busy=true;lastAttempt=Date.now();
   const sid=id;
   try{
     if(!registered.has(sid)){
       const response=await fetch(API+'?select=session_id&session_id=eq.'+encodeURIComponent(sid),{headers});
       if(!response.ok)throw Error('Session lookup '+response.status);
       const existing=await response.json();
       if(!existing.length){
         const created=await fetch(API,{method:'POST',headers,body:JSON.stringify({
           session_id:sid,player_id:pid,...data,pieces_mode:mode,ghost_mode:ghost
         })});
         if(!created.ok)throw Error('Session create '+created.status);
         registered.add(sid);if(sid===id)lastSent=signature;return;
       }
       registered.add(sid);
     }
     const response=await fetch(API+'?session_id=eq.'+encodeURIComponent(id),{
       method:'PATCH',headers,body:JSON.stringify({...data,updated_at:new Date().toISOString()})
     });
     if(!response.ok)throw Error('Session update '+response.status);
     if(sid===id)lastSent=signature;
   }catch(error){console.warn('Blocks score sync:',error);}
   finally{busy=false;}
 }
 const timer=setInterval(()=>send(game.phase==='game_over'?'completed':'active'),1000);
 window.addEventListener('blocks:restart',()=>{
   void send('abandoned',true);
   id=crypto.randomUUID();window.BLOCKS_SESSION_ID=id;lastSent='';lastAttempt=0;
 });
 document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='hidden')void send(game.phase==='game_over'?'completed':'active',true);
   else void send(game.phase==='game_over'?'completed':'active',true);
 });
 window.addEventListener('pagehide',()=>void send(game.phase==='game_over'?'completed':'active',true));
 void send(game.phase==='game_over'?'completed':'active',true);
})();
