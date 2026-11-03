// Shared BLOCKS profile/preferences. Settings never change an active match.
(()=>{
  const DIFFICULTY_KEY='blocks:difficulty:v1:'+location.pathname.replace(/index[.]html$/,'');
  const GHOST_KEY='blocks:ghost:v1:'+location.pathname.replace(/index[.]html$/,'');
  const modal=document.createElement('div');
  modal.id='blocks-settings';
  modal.hidden=true;
  modal.innerHTML=[
    '<section class="blocks-settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">',
      '<header class="blocks-settings-header">',
        '<h2 id="settings-title">Settings</h2>',
        '<button type="button" id="settings-close" aria-label="Close settings">×</button>',
      '</header>',
      '<div class="blocks-settings-body">',
        '<section aria-labelledby="settings-profile-heading">',
          '<h3 id="settings-profile-heading">Profile</h3>',
          '<form id="settings-name-form">',
            '<label for="settings-name">Your name</label>',
            '<div class="blocks-settings-field">',
              '<input id="settings-name" maxlength="40" autocomplete="nickname" required placeholder="Choose a name" aria-describedby="settings-name-hint">',
              '<button type="submit" id="settings-name-save">Save</button>',
            '</div>',
            '<p class="blocks-settings-hint" id="settings-name-hint">Your leaderboard name and the name friends see.</p>',
            '<p id="settings-name-status" role="status" aria-live="polite"></p>',
          '</form>',
        '</section>',
        '<section aria-labelledby="settings-gameplay-heading">',
          '<h3 id="settings-gameplay-heading">Gameplay defaults</h3>',
          '<label for="settings-speed">Default speed</label>',
          '<select id="settings-speed"></select>',
          '<label for="settings-ghost">Ghost piece</label>',
          '<select id="settings-ghost">',
            '<option value="true">On</option><option value="false">Off</option>',
          '</select>',
          '<p class="blocks-settings-hint">Defaults for new games. The host sets the rules for both players in a two-phone match.</p>',
          '<div class="settings-button-layout">',
            '<h4>Button order</h4>',
            '<p class="blocks-settings-hint">Drag to rearrange the four controls. Applies to single-player portrait only.</p>',
            '<div id="settings-control-row" class="settings-control-row" role="group" aria-label="Rearrange gameplay buttons"></div>',
            '<div class="settings-control-options">',
              '<button type="button" id="settings-control-reset">Reset order</button>',
              '<span id="settings-control-status" role="status" aria-live="polite"></span>',
            '</div>',
          '</div>',
        '</section>',
        '<section id="settings-social-section" aria-labelledby="settings-social-heading" hidden>',
          '<h3 id="settings-social-heading">Friends &amp; notifications</h3>',
          '<div id="settings-friends-list"></div>',
          '<p id="settings-friends-status" role="status"></p>',
          '<div class="blocks-settings-notifications">',
            '<p id="settings-notification-status"></p>',
            '<button type="button" id="settings-enable-notifications">Enable notifications</button>',
          '</div>',
        '</section>',
      '</div>',
    '</section>'
  ].join('');
  document.body.appendChild(modal);
  const $=id=>modal.querySelector('#'+id);
  const closeButton=$('settings-close');
  const nameInput=$('settings-name');
  const nameForm=$('settings-name-form');
  const nameSave=$('settings-name-save');
  const nameStatus=$('settings-name-status');
  const speed=$('settings-speed');
  const ghost=$('settings-ghost');
  const orderRow=$('settings-control-row');
  const orderReset=$('settings-control-reset');
  const orderStatus=$('settings-control-status');
  const social=$('settings-social-section');
  const friendsList=$('settings-friends-list');
  const friendsStatus=$('settings-friends-status');
  const notificationStatus=$('settings-notification-status');
  const notificationButton=$('settings-enable-notifications');
  for(const id of GAME_MODE_IDS){
    const option=document.createElement('option');
    option.value=String(id);option.textContent=GAME_MODES[id].label;
    speed.appendChild(option);
  }
  let previousFocus=null,revision=0;
  const read=(key,fallback)=>{try{return localStorage.getItem(key)??fallback}catch(_){return fallback}};
  const save=(key,value)=>{try{localStorage.setItem(key,String(value))}catch(_){}};

  // Four physical slots, independent of gameplay commands. Never move the live
  // game buttons: app.js keeps touch owners and hold-repeat timers on those nodes.
  const CONTROL_ACTIONS=['left','right','down','rotate_cw'];
  const ORDER_KEY='blocks:control-order:v1:'+location.pathname.replace(/index[.]html$/,'');
  const gameButtons=Array.from(document.querySelectorAll?.('#controls button.control')||[]);
  function validOrder(value){
    return Array.isArray(value)&&value.length===CONTROL_ACTIONS.length&&
      new Set(value).size===CONTROL_ACTIONS.length&&
      CONTROL_ACTIONS.every(command=>value.includes(command));
  }
  function loadOrder(){
    try{
      const stored=JSON.parse(read(ORDER_KEY,'null'));
      return validOrder(stored)?stored:CONTROL_ACTIONS.slice();
    }catch(_){return CONTROL_ACTIONS.slice()}
  }
  let controlOrder=loadOrder();
  function applyControlOrder(){
    for(const button of gameButtons){
      const position=controlOrder.indexOf(button.dataset.command);
      if(position>=0)button.style?.setProperty?.('--portrait-control-order',position);
    }
  }
  applyControlOrder();
  const controlSlots=new Map();
  function currentSlots(){return Array.from(orderRow.children)}
  function slotOrder(){return currentSlots().map(slot=>slot.dataset.command)}
  function renderSlots(slots){
    if(typeof orderRow.replaceChildren==='function')orderRow.replaceChildren(...slots);
    else{
      orderRow.children=[];
      for(const slot of slots)orderRow.appendChild(slot);
    }
  }
  function updateReset(){
    orderReset.disabled=controlOrder.every((command,i)=>command===CONTROL_ACTIONS[i]);
  }
  function persistOrder(){
    const candidate=slotOrder();
    if(!validOrder(candidate))return;
    controlOrder=candidate;
    save(ORDER_KEY,JSON.stringify(controlOrder));
    applyControlOrder();
    updateReset();
    orderStatus.textContent='Saved';
  }
  // Animate neighbours using FLIP so they slide into the newly empty slot.
  function moveSlot(slot,index){
    const original=currentSlots();
    const from=original.indexOf(slot);
    if(from===index||from<0)return;
    const before=new Map(original.map(item=>[item,item.getBoundingClientRect?.()]));
    const reordered=original.filter(item=>item!==slot);
    reordered.splice(index,0,slot);
    renderSlots(reordered);
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
    for(const item of reordered){
      if(item===slot||typeof item.animate!=='function')continue;
      const start=before.get(item),end=item.getBoundingClientRect?.();
      if(!start||!end||Math.abs(start.left-end.left)<1)continue;
      item.getAnimations?.().forEach(animation=>animation.cancel());
      item.animate([
        {transform:'translateX('+(start.left-end.left)+'px)'},
        {transform:'translateX(0)'}
      ],{duration:170,easing:'ease-out'});
    }
  }
  let dragging=null;
  function endDrag(commit){
    if(!dragging)return;
    const active=dragging;
    dragging=null;
    active.ghost.remove?.();
    active.slot.classList.remove('is-placeholder');
    if(commit)persistOrder();
    else renderSlots(controlOrder.map(command=>controlSlots.get(command)));
  }
  function beginDrag(event,slot,button){
    if(modal.hidden||dragging||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();
    const bounds=button.getBoundingClientRect();
    const ghost=button.cloneNode(true);
    ghost.classList.add('is-drag-ghost');
    ghost.setAttribute('aria-hidden','true');
    ghost.tabIndex=-1;
    ghost.style.left=bounds.left+'px';
    ghost.style.top=bounds.top+'px';
    ghost.style.width=bounds.width+'px';
    ghost.style.height=bounds.height+'px';
    document.body.appendChild(ghost);
    slot.classList.add('is-placeholder');
    dragging={id:event.pointerId,startX:event.clientX,startY:event.clientY,slot,ghost};
    orderStatus.textContent='';
  }
  for(const command of CONTROL_ACTIONS){
    const source=gameButtons.find(button=>button.dataset.command===command);
    const button=source?.cloneNode?.(true)||document.createElement('button');
    button.type='button';
    button.className='settings-control-key';
    button.dataset.command=command;
    button.setAttribute('aria-label',{
      left:'Move left',right:'Move right',down:'Drop',rotate_cw:'Rotate'
    }[command]+'. Drag or use arrow keys to reorder.');
    if(!source)button.textContent={
      left:'←',right:'→',down:'↓',rotate_cw:'↻'
    }[command];
    const slot=document.createElement('div');
    slot.className='settings-control-slot';
    slot.dataset.command=command;
    slot.appendChild(button);
    controlSlots.set(command,slot);
    button.addEventListener('pointerdown',event=>beginDrag(event,slot,button));
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key)||dragging)return;
      event.preventDefault();
      const from=currentSlots().indexOf(slot);
      const target=Math.max(0,Math.min(3,from+(event.key==='ArrowRight'?1:-1)));
      if(target!==from){moveSlot(slot,target);persistOrder()}
      button.focus?.();
    });
  }
  renderSlots(controlOrder.map(command=>controlSlots.get(command)));
  updateReset();
  orderReset.onclick=()=>{
    if(dragging)endDrag(false);
    renderSlots(CONTROL_ACTIONS.map(command=>controlSlots.get(command)));
    persistOrder();
  };
  window.addEventListener?.('pointermove',event=>{
    if(!dragging||event.pointerId!==dragging.id)return;
    const {ghost,startX,startY,slot}=dragging;
    ghost.style.transform='translate3d('+(event.clientX-startX)+'px,'+
      (event.clientY-startY)+'px,0) scale(1.07)';
    const rect=orderRow.getBoundingClientRect();
    const gap=parseFloat(window.getComputedStyle?.(orderRow)?.columnGap)||0;
    const width=(rect.width-3*gap)/4;
    if(width<=0)return;
    const index=Math.max(0,Math.min(3,Math.round(
      (event.clientX-rect.left-width/2)/(width+gap)
    )));
    moveSlot(slot,index);
    event.preventDefault();
  });
  window.addEventListener?.('pointerup',event=>{
    if(dragging&&event.pointerId===dragging.id)endDrag(true);
  });
  window.addEventListener?.('pointercancel',event=>{
    if(dragging&&event.pointerId===dragging.id)endDrag(false);
  });
  window.addEventListener?.('blur',()=>endDrag(false));
  function updateDefaults(){
    window.dispatchEvent(new CustomEvent('blocks:settings-updated',{
      detail:{difficulty:Number(speed.value),ghostPiece:ghost.value==='true'}
    }));
  }
  speed.onchange=()=>{
    const id=Number(speed.value);
    if(!Object.hasOwn(GAME_MODES,id))return;
    save(DIFFICULTY_KEY,id);updateDefaults();
  };
  ghost.onchange=()=>{save(GHOST_KEY,ghost.value);updateDefaults()};
  nameForm.onsubmit=async event=>{
    event.preventDefault();
    const name=nameInput.value.trim();
    if(!name||name.length>40)return;
    nameSave.disabled=true;nameStatus.textContent='Saving…';
    try{
      await window.BLOCKS_SAVE_PLAYER_NAME(name);
      nameStatus.textContent='Name saved.';
      // Leaderboard identity is already committed. If push profile sync is
      // temporarily offline, do not misleadingly report that rename failed.
      try{await window.BLOCKS_PUSH?.refreshProfile?.()}
      catch(error){
        console.warn('BLOCKS friends profile sync:',error);
        nameStatus.textContent='Name saved. Friends will see it when reconnected.';
      }
    }catch(error){
      nameStatus.textContent='Could not save name. Check your connection.';
    }finally{nameSave.disabled=false}
  };
  function notificationState(){
    const active=window.BLOCKS_PUSH?.enabled===true;
    const denied=typeof Notification!=='undefined'&&Notification.permission==='denied';
    notificationStatus.textContent=active?'Notifications enabled.':
      denied?'Notifications blocked in device settings.':
      'Receive game invitations from friends.';
    notificationButton.hidden=active||denied;
  }
  notificationButton.onclick=async()=>{
    notificationButton.disabled=true;
    notificationStatus.textContent='Enabling notifications…';
    try{await window.BLOCKS_PUSH.enable();notificationState()}
    catch(error){notificationStatus.textContent=error.message}
    finally{notificationButton.disabled=false}
  };
  async function loadFriends(){
    if(!window.BLOCKS_PUSH)return;
    const current=revision;
    friendsList.textContent='';
    friendsStatus.textContent='Loading friends…';
    try{
      const response=await window.BLOCKS_PUSH.friends();
      if(current!==revision||modal.hidden)return;
      const friends=Array.isArray(response.friends)?response.friends:[];
      friendsStatus.textContent=friends.length?'':'No saved friends yet.';
      for(const friend of friends){
        const row=document.createElement('div');
        row.className='blocks-settings-friend';
        const name=document.createElement('span');
        name.textContent=friend.name;
        const remove=document.createElement('button');
        remove.type='button';remove.textContent='Remove';
        remove.setAttribute('aria-label','Remove '+friend.name+' from friends');
        remove.onclick=async()=>{
          if(!window.confirm('Remove '+friend.name+' from friends? You will no longer be able to invite each other.'))return;
          remove.disabled=true;friendsStatus.textContent='Removing '+friend.name+'…';
          try{
            await window.BLOCKS_PUSH.removeFriend(friend.id);
            if(current!==revision)return;
            window.dispatchEvent(new Event('blocks:friends-changed'));
            void loadFriends();
          }catch(error){
            friendsStatus.textContent=error.message||'Could not remove friend.';
            remove.disabled=false;
          }
        };
        row.append(name,remove);
        friendsList.append(row);
      }
    }catch(error){
      if(current===revision)friendsStatus.textContent='Friends unavailable. Check your connection.';
    }
  }
  function open(){
    if(!modal.hidden)return;
    previousFocus=document.activeElement;
    nameInput.value=window.BLOCKS_PLAYER_NAME?.()||'';
    nameStatus.textContent='';
    const storedSpeed=Number(read(DIFFICULTY_KEY,DEFAULT_GAME_MODE));
    speed.value=String(Object.hasOwn(GAME_MODES,storedSpeed)?storedSpeed:DEFAULT_GAME_MODE);
    // Keep personal defaults separate from the host's inherited ghost rule
    // when this installation previously joined a two-phone room.
    const ownGhost=window.BLOCKS_REMOTE_LOCAL_CONFIG?.ghost_piece;
    ghost.value=read(GHOST_KEY,String(
      typeof ownGhost==='boolean'?ownGhost:window.BLOCKS_CONFIG?.ghostPiece===true));
    social.hidden=!window.BLOCKS_PUSH;
    modal.hidden=false;
    revision++;
    if(!social.hidden){notificationState();void loadFriends()}
    closeButton.focus();
  }
  function close(){
    if(modal.hidden)return;
    endDrag(false);
    revision++;modal.hidden=true;
    previousFocus?.focus?.();
  }
  closeButton.onclick=close;
  modal.addEventListener('click',event=>{if(event.target===modal)close()});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!modal.hidden){event.preventDefault();close()}
  });
  window.BLOCKS_OPEN_SETTINGS=open;
})();