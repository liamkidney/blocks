const CACHE="blocks-v3-score-sync";
const ASSETS=["./","index.html","styles.css","tetrominoes.js","game.js","session.js","app.js","multiplayer.js","config.js","version.js","player-name.js","score-sync.js","high-scores.js","manifest.json","icon.svg","favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png"];

self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE)
  .then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:"reload"}))))
  .then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>event.waitUntil(Promise.all([
 self.clients.claim(),
 caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("blocks-")&&key!==CACHE).map(key=>caches.delete(key))))
])));

self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET"||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(
  fetch(new Request(event.request,{cache:"no-store"}))
   .then(response=>{
    if(response.ok){
     const copy=response.clone();
     event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
    }
    return response;
   })
   .catch(async()=>{
    const cache=await caches.open(CACHE);
    return (await cache.match(event.request,{ignoreSearch:true}))||Response.error();
   })
 );
});
