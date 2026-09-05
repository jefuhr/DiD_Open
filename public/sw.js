const SHELL='nyc-ferry-did-shell-v91',DATA='nyc-ferry-did-data-v91';
const requestedBase = new URL(self.location.href).searchParams.get('base');
const BASE = requestedBase === '/ferryTimesMobile/' ? requestedBase : '/';
const FILES=[BASE,'/assets/app-icon.png?v=91','/assets/app-icon-180.png?v=91','/assets/app-icon-maskable-512.png?v=91','/assets/waterway.png','/assets/seastreak.png','/assets/nyu.png','/assets/cityferry.png','/assets/gi.png',`${BASE}map`,'/styles.css?v=91','/app.js?v=91','/assets/mobile-runtime.js?v=91','/assets/mobile-console.css?v=91','/assets/map.js?v=91','/assets/map.css?v=91','/assets/map-theme.js?v=91','/assets/site.webmanifest?v=91','/assets/app-icon-192.png?v=91','/assets/app-icon-512.png?v=91','/assets/fonts/lato-regular-latin.woff2','/assets/fonts/lato-bold-latin.woff2','/assets/fonts/lato-black-latin.woff2','/assets/fonts/oswald-variable-latin.woff2'];
// Theme artwork and optional fonts enter the cache after first use.
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('nyc-ferry-did-')&&![SHELL,DATA].includes(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
async function networkFirst(request,cacheName,wait=10000){
  const cache=await caches.open(cacheName).catch(()=>null);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),wait);
  try{
    const response=await fetch(request,{signal:controller.signal});
    if(!response.ok)throw new Error('unavailable');
    // Cache errors must not discard a successful response.
    try{await cache?.put(request,response.clone())}catch{}
    return response;
  }catch(error){
    const saved=await cache?.match(request);
    if(saved){
      if(cacheName===DATA){
        const headers=new Headers(saved.headers);headers.set('X-Ferry-Saved','1');
        return new Response(saved.body,{status:saved.status,statusText:saved.statusText,headers});
      }
      return saved;
    }
    if(request.mode==='navigate'){
      const isMap=/\/map(?:\.html)?$/.test(new URL(request.url).pathname);
      const shell=await cache?.match(isMap?`${BASE}map`:BASE);
      if(shell)return shell;
    }
    throw error;
  }finally{clearTimeout(timer)}
}
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
  const url=new URL(event.request.url);
  if(url.pathname.startsWith('/api/'))event.respondWith(networkFirst(event.request,DATA));
  else if(event.request.mode==='navigate')event.respondWith(networkFirst(event.request,SHELL,2500));
  else event.respondWith(caches.match(event.request).then(saved=>saved||fetch(event.request).then(response=>{
    if(response.ok)event.waitUntil(caches.open(SHELL).then(cache=>cache.put(event.request,response.clone())).catch(()=>{}));
    return response;
  })));
});
