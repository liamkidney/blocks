// Render scores in the current document: avoids nested WebView/iframe loading issues.
(()=>{
 const button=document.getElementById('high-scores-button');
 button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v7a5 5 0 0 1-10 0V3zM7 5H4v3a4 4 0 0 0 4 4M17 5h3v3a4 4 0 0 1-4 4M12 15v4M8 21h8M9 19h6"/></svg>';
 button.setAttribute('aria-label','High scores');button.title='High scores';
 document.getElementById('high-scores-slot').appendChild(button);
 const overlay=document.createElement('div');
 overlay.id='high-scores-overlay';overlay.hidden=true;
 overlay.innerHTML='<main class="scores-panel"><button id="scores-back" type="button">← BACK TO GAME</button><h1>HIGH SCORES</h1><table aria-label="High scores"><thead><tr><th>#</th><th>PLAYER</th><th>SCORE</th><th>LINES</th><th>DATE</th></tr></thead><tbody id="scores-rows"></tbody></table><p id="scores-status" role="status"></p><button id="scores-retry" type="button" hidden>RETRY</button></main>';
 document.body.appendChild(overlay);
 const rows=overlay.querySelector('#scores-rows');
 const status=overlay.querySelector('#scores-status');
 const retry=overlay.querySelector('#scores-retry');
 const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/';
 const headers={apikey:'sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH'};
 let resumeOnClose=false,controller=null;
 function cell(row,value){const td=document.createElement('td');td.textContent=String(value);row.appendChild(td);}
 async function load(){
  if(controller)controller.abort();
  controller=new AbortController();
  const signal=controller.signal;
  const timeout=setTimeout(()=>controller.abort(),12000);
  status.textContent='Loading scores…';retry.hidden=true;rows.replaceChildren();
  try{
   const [pr,sr]=await Promise.all([
    fetch(API+'players?select=player_id,display_name&limit=1000',{headers,signal}),
    fetch(API+'sessions?select=player_id,score,lines,started_at&order=score.desc&limit=10',{headers,signal})
   ]);
   if(!pr.ok||!sr.ok)throw Error('HTTP '+pr.status+'/'+sr.status);
   const players=new Map((await pr.json()).map(p=>[p.player_id,p.display_name]));
   const sessions=await sr.json();
   if(overlay.hidden)return;
   sessions.forEach((s,i)=>{
    const tr=document.createElement('tr');
    [i+1,players.get(s.player_id)??'Unknown',s.score.toLocaleString(),s.lines,new Date(s.started_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})].forEach(v=>cell(tr,v));
    rows.appendChild(tr);
   });
   status.textContent=sessions.length?'':'No scores yet';
  }catch(error){
   if(overlay.hidden)return;
   status.textContent='Could not load scores. Check your connection and retry.';
   retry.hidden=false;
  }finally{clearTimeout(timeout);}
 }
 function open(){
  if(!overlay.hidden)return;
  resumeOnClose=game.phase!=='paused'&&game.phase!=='game_over'&&!session.outcome;
  if(resumeOnClose)togglePause();
  saveGame(true);overlay.hidden=false;void load();
 }
 function close(){
  if(overlay.hidden)return;
  overlay.hidden=true;if(controller)controller.abort();
  if(resumeOnClose&&game.phase==='paused')togglePause();
  resumeOnClose=false;button.focus();
 }
 function tap(el,fn){
  let last=-Infinity;
  el.addEventListener('touchstart',e=>{e.preventDefault();last=performance.now();fn();},{passive:false});
  el.addEventListener('click',e=>{if(performance.now()-last<750){e.preventDefault();return;}fn();});
 }
 tap(button,open);tap(overlay.querySelector('#scores-back'),close);tap(retry,()=>void load());
 button.hidden=false;
 document.addEventListener('keydown',e=>{if(!overlay.hidden){if(e.key==='Escape')close();e.preventDefault();e.stopImmediatePropagation();}},true);
})();
