/* Service Worker – Giọt Nước
   - Lưu đệm các tệp để mở được khi mất mạng.
   - Xử lý nút "Đã uống" / "Nhắc lại" trên thông báo. */

const CACHE = 'giotnuoc-v2';
const FILES = [
  './', './index.html', './style.css', './app.js', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './apple-touch-icon.png', './badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Ưu tiên mạng, mất mạng thì dùng bản lưu đệm
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener('notificationclick', (e) => {
  const action = e.action || 'open';
  const ml = (e.notification.data && e.notification.data.cup) || 250;
  e.notification.close();

  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      if (action !== 'open') {
        // Gửi cho đúng một cửa sổ để không ghi nhận trùng
        wins[0].postMessage({ type: 'reminder-action', action, ml });
      }
      if (action === 'open') return wins[0].focus();
      return;
    }
    const scope = self.registration.scope;
    const target = action === 'open' ? scope : `${scope}?action=${action}&ml=${ml}`;
    return self.clients.openWindow(target);
  })());
});
