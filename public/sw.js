// The page tells the worker where it lives.
//
// The board is served at the site root on a kiosk and proxied under /ferryTimesMobile/ on
// juliet.nyc, where the root belongs to another site entirely. Its assets sit at the root in both
// cases, so those paths are fixed — but the document does not, and precaching a hardcoded '/' put
// somebody else's landing page in the shell on one host and failed the install outright when it
// 404ed. app.js passes its own directory in the registration URL, so the one entry that moves is
// the one entry that is asked for.
const SHELL='nyc-ferry-did-shell-v86',DATA='nyc-ferry-did-data-v86';
const BASE=new URL(self.location.href).searchParams.get('base')||'/';
const FILES=[BASE,'/styles.css?v=86','/app.js?v=86','/assets/app-icon.png?v=86','/assets/app-icon-180.png?v=86','/assets/app-icon-192.png?v=86','/assets/app-icon-512.png?v=86','/assets/app-icon-maskable-512.png?v=86','/assets/site.webmanifest?v=86','/assets/kitty.png?v=86','/assets/waterway.png','/assets/seastreak.png','/assets/nyu.png','/assets/cityferry.png','/assets/gi.png','/assets/fonts/lato-regular-latin.woff2','/assets/fonts/lato-bold-latin.woff2','/assets/fonts/lato-black-latin.woff2','/assets/fonts/oswald-variable-latin.woff2','/assets/fonts/bk-flame-latin.woff2'];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('nyc-ferry-did-')&&![SHELL,DATA].includes(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
async function networkFirst(request,cacheName){const cache=await caches.open(cacheName);try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response}catch{const saved=await cache.match(request);if(saved)return saved;throw new Error('offline')}}
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;const url=new URL(event.request.url);if(url.pathname.startsWith('/api/'))event.respondWith(networkFirst(event.request,DATA));else if(event.request.mode==='navigate')event.respondWith(networkFirst(event.request,SHELL).catch(()=>caches.match(BASE)));else event.respondWith(caches.match(event.request).then(saved=>saved||fetch(event.request).then(response=>{if(response.ok)caches.open(SHELL).then(cache=>cache.put(event.request,response.clone()));return response})))});
