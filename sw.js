// Keep each release self-contained: the app shell is always loaded from its
// installed cache, while a new worker waits for a safe launch to activate.
const CACHE="blocks-v5-speed-modes";
const ASSETS=["./","index.html","styles.css","game-modes.js","tetrominoes.js","game.js","session.js","board-renderer.js","app.js","multiplayer.js","config.js","version.js","player-name.js","score-sync.js","high-scores.js","manifest.json","icon.svg","favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png"];
const APP_PATHS=new Set(ASSETS.map(asset=>new URL(asset,self.registration.scope).pathname));

self.addEventListener("install",event=>{
  // If any required file fails, installation fails and the old release stays active.
  // Do not skipWaiting here: a newly downloaded release must not interrupt play.
  event.waitUntil(caches.open(CACHE)
    .then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:"reload"})))));
});

self.addEventListener("message",event=>{
  if(event.data?.type==="BLOCKS_ACTIVATE_UPDATE")
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate",event=>event.waitUntil((async()=>{
  // Separate prod/dev caches; never delete the other installed app's release.
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith("blocks-")&&key!==CACHE)
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
