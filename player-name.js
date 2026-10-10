// Local-only player name UI prototype. Supabase registration comes next.
(()=>{
  const KEY='blocks:player:v1';
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
  function open(){input.value=player?.display_name||'';dialog.hidden=false;input.focus();input.select();}
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
  document.getElementById('player-form').addEventListener('submit',e=>{
    e.preventDefault();
    const name=input.value.trim();
    if(!name)return;
    player={player_id:player?.player_id||crypto.randomUUID(),display_name:name};
    try{localStorage.setItem(KEY,JSON.stringify(player));}catch(_){}
    refresh();close();
  });
  document.addEventListener('keydown',e=>{if(dialog.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}else if(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp'].includes(e.key))e.stopImmediatePropagation();},true);
  refresh();
})();
