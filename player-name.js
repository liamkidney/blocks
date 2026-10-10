// Player identity and Supabase registration. No score writes yet.
(()=>{
  const KEY='blocks:player:v1';
  const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/players';
  const API_KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
  const headers={apikey:API_KEY,'Content-Type':'application/json'};
  let player=null;
  try{player=JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){}
  // Give every installation a stable identity, even before a name is chosen.
  if(!player?.player_id){
    player={player_id:crypto.randomUUID(),display_name:'Anonymous',anonymous:true};
    try{localStorage.setItem(KEY,JSON.stringify(player));}catch(_){}
  }
  let registration=null;
  async function ensurePlayer(){
    if(registration)return registration;
    registration=(async()=>{
      const id=player.player_id;
      const lookup=await fetch(API+'?select=player_id&player_id=eq.'+encodeURIComponent(id),{headers});
      if(!lookup.ok)throw Error('Player lookup '+lookup.status);
      if(!(await lookup.json()).length){
        const response=await fetch(API,{method:'POST',headers,
          body:JSON.stringify({player_id:id,display_name:player.display_name||'Anonymous'})});
        if(!response.ok&&response.status!==409)throw Error('Player create '+response.status);
      }
      return id;
    })();
    try{return await registration;}
    catch(error){registration=null;throw error;}
  }
  window.BLOCKS_ENSURE_PLAYER=ensurePlayer;
  void ensurePlayer().catch(error=>console.warn('Blocks player registration:',error));
  const dialog=document.createElement('div');
  dialog.id='player-dialog';dialog.hidden=true;
  dialog.innerHTML='<div class="player-panel" role="dialog" aria-modal="true" aria-labelledby="player-title"><form id="player-form"><label id="player-title" for="player-input">PLAYER NAME</label><input id="player-input" type="text" maxlength="40" autocomplete="nickname" required><div class="player-buttons"><button type="button" id="player-cancel">CANCEL</button><button type="submit">SAVE</button></div></form></div>';
  document.body.appendChild(dialog);
  const input=document.getElementById('player-input');
  function open(){message.textContent='';input.value=player?.anonymous?'':(player?.display_name||'');dialog.hidden=false;input.focus();input.select();}
  function close(){dialog.hidden=true;document.getElementById('hud-player-button').focus();}
  // Pythonista's WebView can emit duplicate synthetic clicks after a touch.
  function bindTap(element,action){
    let lastTouch=-Infinity;
    element.addEventListener('touchstart',e=>{
      e.preventDefault();
      lastTouch=performance.now();
      action();
    },{passive:false});
    element.addEventListener('click',e=>{
      if(performance.now()-lastTouch<750){e.preventDefault();return;}
      action();
    });
  }
  const hudPlayer=document.getElementById('hud-player-button');
  if(hudPlayer)bindTap(hudPlayer,open);
  bindTap(document.getElementById('player-cancel'),close);
  dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
  const form=document.getElementById('player-form');
  const saveButton=form.querySelector('button[type=submit]');
  const message=document.createElement('p');message.id='player-save-status';message.setAttribute('role','status');form.appendChild(message);
  document.getElementById('player-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=input.value.trim();
    if(!name)return;
    saveButton.disabled=true;message.textContent='Saving…';
    try{
      const id=await ensurePlayer();
      const response=await fetch(API+'?player_id=eq.'+encodeURIComponent(id),{
        method:'PATCH',headers,body:JSON.stringify({display_name:name})
      });
      if(!response.ok)throw new Error('Supabase error '+response.status);
      player={player_id:id,display_name:name};
      try{localStorage.setItem(KEY,JSON.stringify(player));}catch(_){}
      close();
    }catch(error){message.textContent='Could not save online. Check connection and retry.';}
    finally{saveButton.disabled=false;}
  });
  document.addEventListener('keydown',e=>{if(dialog.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}else if(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp'].includes(e.key))e.stopImmediatePropagation();},true);
})();
