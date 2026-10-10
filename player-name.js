// Player identity and Supabase registration. No score writes yet.
(()=>{
  const KEY='blocks:player:v1';
  const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/players';
  const API_KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
  const headers={apikey:API_KEY,'Content-Type':'application/json'};
  let player=null;
  try{player=JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){}
  const bar=document.createElement('div');
  bar.id='player-identity';
  bar.innerHTML='<span id="player-display"></span><button id="player-edit" type="button" aria-label="Edit player name" title="Edit player name">✎</button>';
  // Keep the name in the game's HUD flow, not a viewport-fixed overlay.
  document.getElementById('player-header').appendChild(bar);
  const dialog=document.createElement('div');
  dialog.id='player-dialog';dialog.hidden=true;
  dialog.innerHTML='<div class="player-panel" role="dialog" aria-modal="true" aria-labelledby="player-title"><form id="player-form"><label id="player-title" for="player-input">PLAYER NAME</label><input id="player-input" type="text" maxlength="40" autocomplete="nickname" required><div class="player-buttons"><button type="button" id="player-cancel">CANCEL</button><button type="submit">SAVE</button></div></form></div>';
  document.body.appendChild(dialog);
  const display=document.getElementById('player-display');
  const input=document.getElementById('player-input');
  function refresh(){display.textContent=player?.display_name||'YOUR NAME';}
  function open(){message.textContent='';input.value=player?.display_name||'';dialog.hidden=false;input.focus();input.select();}
  function close(){dialog.hidden=true;document.getElementById('player-edit').focus();}
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
  bindTap(document.getElementById('player-edit'),open);
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
      const id=player?.player_id||crypto.randomUUID();
      // Existing local players may not have been registered yet.
      const lookup=await fetch(API+'?select=player_id&player_id=eq.'+encodeURIComponent(id),{headers});
      if(!lookup.ok)throw new Error('Unable to check player');
      const exists=(await lookup.json()).length>0;
      const response=await fetch(API+(exists?'?player_id=eq.'+encodeURIComponent(id):''),{
        method:exists?'PATCH':'POST',headers,
        body:JSON.stringify(exists?{display_name:name}:{player_id:id,display_name:name})
      });
      if(!response.ok)throw new Error('Supabase error '+response.status);
      player={player_id:id,display_name:name};
      try{localStorage.setItem(KEY,JSON.stringify(player));}catch(_){}
      refresh();close();
    }catch(error){message.textContent='Could not save online. Check connection and retry.';}
    finally{saveButton.disabled=false;}
  });
  document.addEventListener('keydown',e=>{if(dialog.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}else if(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp'].includes(e.key))e.stopImmediatePropagation();},true);
  refresh();
})();
