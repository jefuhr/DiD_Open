const SHELL='nyc-ferry-did-shell-v116',DATA='nyc-ferry-did-data-v116';
const requestedBase = new URL(self.location.href).searchParams.get('base');
const BASE = requestedBase === '/ferryTimesMobile/' ? requestedBase : '/';
const FILES=[BASE,`${BASE}ride`,'/assets/ride.js?v=116','/assets/ride.css?v=116','/assets/ride-controller.js','/assets/ride-session.js','/assets/map-projection.js','/assets/view-lifecycle.js','/assets/app-shell.js?v=116','/assets/app-shell.css?v=116','/assets/schedule.js','/assets/preferences.js','/assets/panels.js','/assets/schedule-store.js','/assets/app-icon.png?v=116','/assets/app-icon-180.png?v=116','/assets/app-icon-maskable-512.png?v=116','/assets/waterway.png','/assets/seastreak.png','/assets/nyu.png','/assets/cityferry.png','/assets/gi.png',`${BASE}map`,'/styles.css?v=116','/app.js?v=116','/assets/mobile-runtime.js?v=116','/assets/map.js?v=116','/assets/map.css?v=116','/assets/map-theme.js?v=116','/assets/site.webmanifest?v=116','/assets/app-icon-192.png?v=116','/assets/app-icon-512.png?v=116','/assets/fonts/lato-regular-latin.woff2','/assets/fonts/lato-bold-latin.woff2','/assets/fonts/lato-black-latin.woff2','/assets/fonts/oswald-variable-latin.woff2'];
// Theme artwork and optional fonts enter the cache after first use.
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
async function upgradeCaches() {
  const names = await caches.keys();
  const data = await caches.open(DATA);
  const oldData = names.filter(name => /^nyc-ferry-did-data-v\d+$/.test(name) && name !== DATA)
    .sort((a, b) => Number(b.split('-v').at(-1)) - Number(a.split('-v').at(-1)));
  for (const name of oldData) {
    try {
      const previous = await caches.open(name);
      for (const request of await previous.keys()) {
        const path = new URL(request.url).pathname;
        if (!path.startsWith('/api/') || path === '/api/override' || await data.match(request)) continue;
        const response = await previous.match(request);
        if (response) await data.put(request, response);
      }
      await caches.delete(name);
    } catch { /* Keep the source cache if copying fails; schedules must not be lost on upgrade. */ }
  }
  await Promise.all(names.filter(name => name.startsWith('nyc-ferry-did-shell-v') && name !== SHELL).map(name => caches.delete(name)));
}
self.addEventListener('activate',event=>event.waitUntil(upgradeCaches().then(()=>self.clients.claim())));
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
  if(url.pathname === '/api/override')return;
  if(url.pathname.startsWith('/api/'))event.respondWith(networkFirst(event.request,DATA));
  else if(event.request.mode==='navigate')event.respondWith(networkFirst(event.request,SHELL,2500));
  else event.respondWith(caches.match(event.request).then(saved=>saved||fetch(event.request).then(response=>{
    if(response.ok)event.waitUntil(caches.open(SHELL).then(cache=>cache.put(event.request,response.clone())).catch(()=>{}));
    return response;
  })));
});
