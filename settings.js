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