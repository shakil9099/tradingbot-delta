// Minimal service worker: makes the dashboard installable. It caches nothing and does not intercept requests,
// so prices, positions and the app itself always come from the server (docs/designs/pwa_login_design_draft.md).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
