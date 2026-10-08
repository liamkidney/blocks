const CACHE="blocks-v3";
const ASSETS=["./","index.html","styles.css","tetrominoes.js","game.js","app.js","manifest.json","icon.svg","favicon-32.png","apple-touch-icon.png","icon-192.png","icon-512.png"];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener("activate",event=>event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
])));

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
