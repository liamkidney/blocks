// Player identity and Supabase registration. No score writes yet.
(()=>{
  // The same identity and display name are used for solo leaderboards and
  // two-phone invitations. Only the profile dialog is hidden in remote mode.
  const remote=new URLSearchParams(location.search).get('remote')==='1';
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
  window.BLOCKS_PLAYER_NAME=()=>player?.anonymous?null:
    (typeof player?.display_name==='string'?player.display_name.trim()||null:null);
  window.BLOCKS_SAVE_PLAYER_NAME=name=>{
    const clean=String(name||'').trim();
    if(!clean||clean.length>40)return Promise.reject(Error('Choose a name (up to 40 characters).'));
    // Save locally immediately so the same name is available in solo and
    // multiplayer, even if the network update is still in progress.
    player={player_id:player.player_id,display_name:clean};
    try{localStorage.setItem(KEY,JSON.stringify(player));}catch(_){}
    return ensurePlayer().then(id=>fetch(API+'?player_id=eq.'+encodeURIComponent(id),{
      method:'PATCH',headers,body:JSON.stringify({display_name:clean})
    })).then(response=>{
      if(!response.ok)throw Error('Supabase error '+response.status);
      return clean;
    });
  };
  void ensurePlayer().catch(error=>console.warn('Blocks player registration:',error));
  // Remote multiplayer uses the same leaderboard nickname, requested only
  // when a player first chooses to save a friend.
  window.BLOCKS_CHOOSE_PLAYER_NAME=()=>{
    const existing=window.BLOCKS_PLAYER_NAME();
    if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{
      const dialog=document.createElement('div');
      dialog.id='remote-name-dialog';
      dialog.innerHTML='<section class="remote-name-panel" role="dialog" aria-modal="true" aria-labelledby="remote-name-title">'+
        '<h2 id="remote-name-title">What should your friend call you?</h2>'+
        '<form id="remote-name-form"><input id="remote-name-input" maxlength="40" type="text" autocomplete="nickname" required aria-label="Your name" placeholder="Your name">'+
        '<div class="remote-name-actions"><button type="button" id="remote-name-cancel">CANCEL</button>'+
        '<button type="submit" id="remote-name-continue">CONTINUE</button></div>'+
        '<p id="remote-name-error" role="alert"></p></form></section>';
      document.body.appendChild(dialog);
      const input=dialog.querySelector('#remote-name-input');
      const form=dialog.querySelector('form');
      const finish=()=>dialog.remove();
      dialog.querySelector('#remote-name-cancel').onclick=()=>{finish();reject(Error('Cancelled'));};
      form.onsubmit=async event=>{
        event.preventDefault();
        const name=input.value.trim();
        if(!name)return;
        const save=form.querySelector('[type=submit]');
        save.disabled=true;
        try{
          await window.BLOCKS_SAVE_PLAYER_NAME(name);
          finish();resolve(name);
        }catch(error){
          dialog.querySelector('#remote-name-error').textContent='Could not save name. Try again.';
          save.disabled=false;
        }
      };
      input.focus();
    });
  };
  if(remote)return;
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
      await window.BLOCKS_SAVE_PLAYER_NAME(name);
      close();
    }catch(error){message.textContent='Could not save online. Check connection and retry.';}
    finally{saveButton.disabled=false;}
  });
  document.addEventListener('keydown',e=>{
    if(!dialog.hidden&&e.key==='Escape'){e.preventDefault();close();}
  });
})();
