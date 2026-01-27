const CACHE_NAME = 'camera-remote-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/camera.html',
  '/remote.html',
  '/css/style.css',
  '/js/camera.js',
  '/js/remote.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/node_modules/nosleep.js/dist/NoSleep.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  // Network first strategy for API/Socket stuff, cache first for static assets
  if (e.request.url.includes('/socket.io/') || e.request.url.includes('/network-info')) {
       return;
  }
  
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
