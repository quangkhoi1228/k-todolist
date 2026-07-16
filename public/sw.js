// Simple service worker to satisfy PWA criteria

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Simple pass-through. 
  // Next.js client-side router handles offline transitions, 
  // but a fetch handler is required by Chromium browsers to permit PWA installation.
  event.respondWith(fetch(event.request));
});
