// Keep each release self-contained: the app shell is always loaded from its
// installed cache, while a new worker waits for a safe launch to activate.
const CACHE="blocks-v5-speed-modes";
const ASSETS=["./","index.html","styles.css","install-gate.css","install-gate.js","game-modes.js","tetrominoes.js","game.js","session.js","board-renderer.js","control-layout.js","app.js","multiplayer.js","remote-multiplayer.js","config.js","version.js","player-name.js","score-sync.js","high-scores.js","push-client.js","settings.js","manifest.json","icon.svg","favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png"];
const APP_PATHS=new Set(ASSETS.map(asset=>new URL(asset,self.registration.scope).pathname));

self.addEventListener("install",event=>{
  // If any required file fails, installation fails and the old release stays active.
  // Do not skipWaiting here: a newly downloaded release must not interrupt play.
  event.waitUntil(caches.open(CACHE)
    .then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:"reload"})))));
});

// A notification tap is a real navigation intent, unlike a stale room-code
// retry. Keep it for a maximum of three minutes so iOS can relaunch the PWA
// at its start URL or replace the page without losing the invite.
const INVITE_CACHE='blocks-push-handoff-'+encodeURIComponent(self.registration.scope);
const INVITE_REQUEST=new URL('__push_handoff__',self.registration.scope).href;
const INVITE_TTL_MS=180000;
// An acknowledgement may arrive before the asynchronous handoff is persisted.
let pendingPushSave=Promise.resolve();
function validInviteURL(value){
  if(typeof value!=='string')return null;
  try{
    const url=new URL(value);
    const scope=new URL(self.registration.scope);
    if(url.origin!==scope.origin||
       ![scope.pathname,scope.pathname+'index.html'].includes(url.pathname)||
       url.searchParams.get('remote')!=='1'||
       !/^[A-Z]{3}$/.test(url.searchParams.get('push_join')||''))return null;
    return url.href;
  }catch(_){return null}
}
async function savePushHandoff(url){
  try{
    const cache=await caches.open(INVITE_CACHE);
    await cache.put(INVITE_REQUEST,new Response(JSON.stringify({
      url,clickedAt:Date.now()
    }),{headers:{'Content-Type':'application/json'}}));
  }catch(error){console.warn('BLOCKS push handoff save:',error)}
}
async function readPushHandoff(){
  try{
    const cache=await caches.open(INVITE_CACHE);
    const item=await cache.match(INVITE_REQUEST);
    if(!item)return null;
    const stored=await item.json();
    if(!validInviteURL(stored?.url)||!Number.isFinite(stored?.clickedAt)||
       Date.now()-stored.clickedAt>INVITE_TTL_MS||stored.clickedAt>Date.now()+10000){
      await cache.delete(INVITE_REQUEST);return null;
    }
    return stored;
  }catch(error){console.warn('BLOCKS push handoff read:',error);return null}
}
self.addEventListener("message",event=>{
  if(event.data?.type==="BLOCKS_ACTIVATE_UPDATE"){
    event.waitUntil(self.skipWaiting());
  }else if(event.data?.type==="BLOCKS_GET_PUSH_INVITATION"){
    event.waitUntil((async()=>{
      // A cold-started page may ask before the click handler's CacheStorage
      // write finishes. Never respond "nothing pending" during that race.
      await pendingPushSave;
      const pending=await readPushHandoff();
      if(pending)event.source?.postMessage({
        type:'BLOCKS_PUSH_INVITATION',url:pending.url
      });
    })());
  }else if(event.data?.type==="BLOCKS_ACK_PUSH_INVITATION"){
    event.waitUntil((async()=>{
      await pendingPushSave;
      const pending=await readPushHandoff();
      if(pending?.url===event.data.url){
        const cache=await caches.open(INVITE_CACHE);
        await cache.delete(INVITE_REQUEST);
      }
    })());
  }
});

self.addEventListener("activate",event=>event.waitUntil((async()=>{
  // Separate prod/dev caches; never delete the other installed app's release.
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith("blocks-")&&key!==CACHE&&key!==INVITE_CACHE)
    .map(key=>caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||!APP_PATHS.has(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Ignore ?v= build stamps, but serve every file from the *same* release.
    const saved=await cache.match(event.request,{ignoreSearch:true});
    if(saved)return saved;
    // A missing/evicted file can still load online; never cache an unknown
    // network revision into an older release's otherwise immutable app shell.
    try{return await fetch(event.request)}
    catch(_){return Response.error()}
  })());
});

// Push notifications open this installed PWA, not an external shared URL.
self.addEventListener("push",event=>{
  if(!event.data)return;
  event.waitUntil((async()=>{
    let payload;
    try{payload=event.data.json()}catch(_){return}
    if(!payload||typeof payload.path!=="string")return;
    const url=new URL(payload.path,self.registration.scope);
    const scope=new URL(self.registration.scope);
    if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
    const body=typeof payload.body==="string"?payload.body:"You've been invited to play.";
    await self.registration.showNotification("BLOCKS",{
      body,
      icon:new URL("icon-192.png",scope).href,
      tag:"blocks-invite-"+String(payload.matchId||""),
      data:{url:url.href}
    });
    // iOS can leave the installed PWA on its current game board. Notify a
    // *visible* PWA immediately so it can offer Join/Dismiss in-game, without
    // requiring a second system-notification tap.
    const pages=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of pages){
      try{
        const opened=new URL(client.url);
        if(opened.origin===scope.origin&&
           [scope.pathname,scope.pathname+'index.html'].includes(opened.pathname)&&
           client.visibilityState==="visible")
          client.postMessage({type:'BLOCKS_PUSH_RECEIVED',url:url.href,body});
      }catch(_){}
    }
  })());
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=validInviteURL(event.notification.data?.url);
  if(!target)return;
  event.waitUntil((async()=>{
    // Preserve a clicked intent even when iOS refuses to focus or open a
    // window. The installed app will re-request it on resume/startup.
    // Do not await storage before focus/openWindow: that can lose the user
    // activation associated with the notification tap.
    let windows=[];
    try{
      windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    }catch(error){console.warn("BLOCKS notification clients:",error)}
    const scope=new URL(self.registration.scope);
    const candidates=windows.filter(client=>{
      try{
        const url=new URL(client.url);
        return url.origin===scope.origin&&
          [scope.pathname,scope.pathname+"index.html"].includes(url.pathname);
      }catch(_){return false}
    });
    // When several windows exist, send the invite to the foreground app,
    // not an old suspended tab returned first by matchAll().
    const existing=candidates.find(client=>client.focused===true)||
      candidates.find(client=>client.visibilityState==="visible")||
      candidates[0];
    const intent={type:"BLOCKS_PUSH_INVITATION",url:target};
    let opening=null;
    if(existing){
      // First notify the existing page; it may have a live match that must
      // ask the player before it can be forfeited.
      try{existing.postMessage(intent)}
      catch(error){console.warn("BLOCKS notification message:",error)}
      try{opening=existing.focus()}
      catch(error){console.warn("BLOCKS notification focus:",error)}
    }else{
      try{opening=self.clients.openWindow(target)}
      catch(error){console.warn("BLOCKS notification open:",error)}
    }

    const stored=savePushHandoff(target);
    pendingPushSave=stored;
    let focusSucceeded=false;
    try{
      const opened=await opening;
      focusSucceeded=Boolean(opening);
      if(!existing)opened?.postMessage?.(intent);
    }catch(error){console.warn("BLOCKS notification launch:",error)}
    // iOS can reject focus() for an existing/background PWA. Previously this
    // stopped here, leaving a notification tap with no visible effect.
    // Try opening the installed app; retained CacheStorage handoff is still
    // available if WebKit opens it at its start URL instead of the deep link.
    if(existing&&!focusSucceeded&&typeof self.clients.openWindow==="function"){
      try{
        const reopened=await self.clients.openWindow(target);
        reopened?.postMessage?.(intent);
      }catch(error){console.warn("BLOCKS notification reopen:",error)}
    }
    await stored;
  })());
});
