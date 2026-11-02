// Push-only friend invitations for installed BLOCKS Dev. No shareable invite links.
(()=>{
  if(new URLSearchParams(location.search).get('remote')!=='1')return;
  // Do not register identities or subscriptions for Safari/browser tabs.
  // On iOS only Home Screen PWAs may receive Web Push notifications.
  const installedPwa=navigator.standalone===true||
    window.matchMedia?.('(display-mode: standalone)')?.matches===true||
    window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches===true;
  if(!installedPwa)return;
  const API='https://psoncybkfsdmjksyrcvv.supabase.co/functions/v1/blocks-push';
  const ID_KEY='blocks:push-install:v1:'+location.pathname;
  const PLAYER_KEY='blocks:player:v1';
  let device;
  try{device=JSON.parse(localStorage.getItem(ID_KEY)||'null')}catch(_){}
  if(!device?.deviceId||!device?.deviceSecret){
    device={deviceId:crypto.randomUUID(),deviceSecret:crypto.randomUUID()};
    try{localStorage.setItem(ID_KEY,JSON.stringify(device))}catch(_){}
  }
  const player=()=>{try{return JSON.parse(localStorage.getItem(PLAYER_KEY)||'null')}catch(_){return null}};
  const supported=()=>typeof Notification!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window;
  let registering=null;
  async function call(action,other={}){
    const response=await fetch(API,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,...device,...other})
    });
    const body=await response.json().catch(()=>({error:'Notification service unavailable'}));
    if(!response.ok||body.error)throw Error(body.error||'Notification service error');
    return body;
  }
  async function register(subscription){
    if(registering){await registering;if(!subscription)return;}
    registering=(async()=>{
      await window.BLOCKS_ENSURE_PLAYER?.();
      const p=player();
      if(!p?.player_id)throw Error('Player identity is not available');
      return call('register',{
        playerId:p.player_id,
        name:p.anonymous?'Anonymous':p.display_name,
        ...(subscription?{subscription:subscription.toJSON()}: {})
      });
    })();
    try{return await registering}finally{registering=null}
  }
  const credentials=match=>({matchId:match.id,matchToken:match.token});
  async function authenticated(action,data={}){
    await register();
    return call(action,data);
  }
  const decodeKey=key=>{
    const padded=key.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-key.length%4)%4);
    return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
  };
  async function enable(){
    if(!supported())throw Error('Install BLOCKS Dev to your Home Screen to enable notifications.');
    if(Notification.permission==='denied')throw Error('Notifications are blocked in your device settings.');
    // Must be requested directly from the user's tap on iOS.
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(permission!=='granted')throw Error('Notification permission was not granted.');
    const config=await call('config');
    const worker=await navigator.serviceWorker.ready;
    const old=await worker.pushManager.getSubscription();
    const subscription=old||await worker.pushManager.subscribe({
      userVisibleOnly:true,applicationServerKey:decodeKey(config.publicKey)
    });
    await register(subscription);
    return {enabled:true};
  }
  async function restore(){
    if(!supported()||Notification.permission!=='granted')return;
    const worker=await navigator.serviceWorker.ready;
    const subscription=await worker.pushManager.getSubscription();
    if(subscription)await register(subscription);
  }
  window.BLOCKS_PUSH={
    supported,
    get enabled(){return supported()&&Notification.permission==='granted'},
    enable,
    attach:async match=>authenticated('attach',credentials(match)),
    status:async match=>authenticated('friend_status',credentials(match)),
    offer:async match=>authenticated('offer_friend',credentials(match)),
    friends:()=>authenticated('friends'),
    removeFriend:friendId=>authenticated('remove_friend',{friendId}),
    invite:(match,friendId)=>authenticated('invite',{...credentials(match),friendId}),
    refresh:restore
  };
  // Make the persistent anonymous installation available for room pairing
  // without showing notification permission on game launch.
  void register().then(async()=>{
    const current=window.BLOCKS_REMOTE?.matchCredentials;
    if(current)await window.BLOCKS_PUSH.attach(current);
    await restore();
  }).catch(error=>console.warn('BLOCKS push device setup:',error));
})();
