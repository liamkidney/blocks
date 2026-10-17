// Render scores in the current document: avoids nested WebView/iframe loading issues.
(()=>{
 const button=document.getElementById('high-scores-button');
 button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v7a5 5 0 0 1-10 0V3zM7 5H4v3a4 4 0 0 0 4 4M17 5h3v3a4 4 0 0 1-4 4M12 15v4M8 21h8M9 19h6"/></svg>';
 button.setAttribute('aria-label','High scores');button.title='High scores';
 document.getElementById('high-scores-slot').appendChild(button);
 const overlay=document.createElement('div');
 overlay.id='high-scores-overlay';overlay.hidden=true;
 overlay.innerHTML=`<main class="scores-panel"><button id="scores-back" type="button">← BACK TO GAME</button><h1>HIGH SCORES</h1><div id="scores-mode-tabs" class="restart-options scores-mode-tabs" role="group" aria-label="Difficulty">${GAME_MODE_IDS.map(id=>`<button type="button" data-mode="${id}" aria-pressed="false">${GAME_MODES[id].label.toUpperCase()}</button>`).join("")}</div><table aria-label="High scores"><thead><tr><th>#</th><th>PLAYER</th><th>SCORE</th><th>LINES</th><th>DATE</th><th aria-label="Remove score"></th></tr></thead><tbody id="scores-rows"></tbody></table><p id="scores-status" role="status"></p><button id="scores-retry" type="button" hidden>RETRY</button></main>`;
 document.body.appendChild(overlay);
 const rows=overlay.querySelector('#scores-rows');
 const status=overlay.querySelector('#scores-status');
 const retry=overlay.querySelector('#scores-retry');
 const modeButtons=Array.from(overlay.querySelectorAll('#scores-mode-tabs button'));
 function currentPlayerId(){
  try{return JSON.parse(localStorage.getItem('blocks:player:v1')||'null')?.player_id||null;}
  catch(_){return null;}
 }
 let selectedMode=0;
 function selectMode(mode){
  const parsed=parseGameMode(mode);
  if(parsed===null||selectedMode===parsed)return;
  selectedMode=parsed;
  for(const tab of modeButtons)tab.setAttribute('aria-pressed',String(Number(tab.dataset.mode)===selectedMode));
  if(!overlay.hidden)void load();
 }
 function setDefaultMode(){
  selectedMode=parseGameMode(game.difficulty)??0;
  for(const tab of modeButtons)tab.setAttribute('aria-pressed',String(Number(tab.dataset.mode)===selectedMode));
 }
 const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/';
 const headers={apikey:'sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH'};
 let resumeOnClose=false,controller=null;
 function cell(row,value){const td=document.createElement('td');td.textContent=String(value);row.appendChild(td);return td;}
 async function load(){
  if(controller)controller.abort();
  controller=new AbortController();
  const request=controller;
  const signal=request.signal;
  const mode=selectedMode;
  const timeout=setTimeout(()=>request.abort(),12000);
  status.textContent='Loading scores…';retry.hidden=true;rows.replaceChildren();
  try{
   const [pr,sr,ownership]=await Promise.all([
    fetch(API+'players?select=player_id,display_name&limit=1000',{headers,signal}),
    fetch(API+'sessions?select=session_id,player_id,score,lines,status,updated_at&difficulty=eq.'+mode+'&order=score.desc&limit=10',{headers,signal}),
    window.BLOCKS_SCORE_OWNER.ownedScoreIds()
     .then(ids=>({ids,available:true}))
     .catch(()=>({ids:new Set(),available:false}))
   ]);
   if(!pr.ok||!sr.ok)throw Error('HTTP '+pr.status+'/'+sr.status);
   const players=new Map((await pr.json()).map(p=>[p.player_id,p.display_name]));
   const sessions=await sr.json();
   if(overlay.hidden||controller!==request||signal.aborted)return;
   const now=Date.now();
   const myPlayerId=currentPlayerId();
   const ownedIds=ownership.ids;
   let hasLegacyOwnedScores=false;
   let hasMyScores=false;
   sessions.forEach((s,i)=>{
    const tr=document.createElement('tr');
    cell(tr,i+1);
    const playerCell=cell(tr,players.get(s.player_id)??'Unknown');
    const updated=Date.parse(s.updated_at);
    if(s.status==='active'&&Number.isFinite(updated)&&now-updated>=0&&now-updated<30*60*1000){
     const dot=document.createElement('span');
     dot.textContent='●';dot.style.color='#20a44b';dot.style.marginLeft='6px';
     dot.setAttribute('aria-label','Game active recently');dot.title='Game in progress (updated within 30 minutes)';
     playerCell.appendChild(dot);
    }
    [s.score.toLocaleString(),s.lines,new Date(s.updated_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})].forEach(v=>cell(tr,v));
    const action=cell(tr,'');
    if(myPlayerId&&s.player_id===myPlayerId){
     hasMyScores=true;
     if(ownership.available&&!ownedIds.has(s.session_id))hasLegacyOwnedScores=true;
    }
    if(myPlayerId&&s.player_id===myPlayerId&&ownedIds.has(s.session_id)){
     const remove=document.createElement('button');
     remove.type='button';
     remove.className='score-delete-button';
     remove.setAttribute('aria-label','Delete your score of '+s.score.toLocaleString()+' points');
     remove.title='Delete your score';
     remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 4h4M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>';
     tap(remove,()=>void removeScore(s,remove));
     action.appendChild(remove);
    }
    rows.appendChild(tr);
   });
   status.textContent=sessions.length
    ?(hasMyScores&&!ownership.available?'Delete controls are temporarily unavailable.'
      :hasLegacyOwnedScores?'Older scores cannot be deleted securely.':'')
    :'No '+GAME_MODES[mode].label.toUpperCase()+' scores yet';
  }catch(error){
   if(overlay.hidden||controller!==request||signal.aborted)return;
   status.textContent='Could not load scores. Check your connection and retry.';
   retry.hidden=false;
  }finally{clearTimeout(timeout);}
 }
 async function removeScore(score,control){
  if(!window.confirm('Delete this score from the leaderboard? This cannot be undone.'))return;
  control.disabled=true;
  try{
   const removed=await window.BLOCKS_SCORE_OWNER.removeScore(score.session_id);
   if(!removed)throw new Error('Score deletion was not authorised');
   if(!overlay.hidden)await load(); // Fill the vacant ranking with the next score.
  }catch(error){
   control.disabled=false;
   if(!overlay.hidden)status.textContent='Could not delete that score. Please try again.';
  }
 }
 function open(){
  if(!overlay.hidden)return;
  resumeOnClose=game.phase!=='paused'&&game.phase!=='game_over'&&!session.outcome;
  if(resumeOnClose)togglePause();
  saveGame(true);overlay.hidden=false;setDefaultMode();void load();
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
 for(const tab of modeButtons)tap(tab,()=>selectMode(tab.dataset.mode));
 button.hidden=false;
 document.addEventListener('keydown',e=>{if(!overlay.hidden){if(e.key==='Escape')close();e.preventDefault();e.stopImmediatePropagation();}},true);
})();
