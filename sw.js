/* Service Worker – Giọt Nước
   - Lưu đệm các tệp để mở được khi mất mạng.
   - Nhận tin đẩy từ máy chủ (Web Push) và hiện thông báo kể cả khi đã đóng tab.
   - Xử lý nút "Đã uống" / "Nhắc lại" trên thông báo. */

importScripts('push-config.js');       // self.GIOTNUOC_PUSH = { api, vapidPublicKey }

const CACHE = 'giotnuoc-v3';
const ACTIONS = 'giotnuoc-actions';    // hàng đợi thao tác bấm trên thông báo – không xóa khi cập nhật
const ACTION_PREFIX = '__action/';
const NOTIF_TAG = 'giotnuoc-reminder';
const FILES = [
  './', './index.html', './style.css', './app.js', './push-config.js', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './apple-touch-icon.png', './badge-96.png',
];
const UA = self.navigator.userAgent || '';
// Safari thu hồi quyền đẩy nếu nhận tin mà không hiện thông báo → luôn hiện trên Safari
const IS_SAFARI = /Safari/.test(UA) && !/Chrome|Chromium|Edg|OPR/.test(UA);
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobi/i.test(UA);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ACTIONS).map((k) => caches.delete(k))))
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

/* ---------------- Tin đẩy từ máy chủ ---------------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Đến giờ uống nước rồi! 💧';
  const cup = d.cup || 250;

  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const looking = wins.some((w) => w.focused && w.visibilityState === 'visible');
    // Trang đang mở trước mặt: để trang hiện hộp nhắc, không bật thêm thông báo hệ thống
    const show = d.test || !looking || IS_SAFARI;
    wins.forEach((w) => w.postMessage({ type: 'push-reminder', shown: show, payload: d }));
    if (!show) return;

    await self.registration.showNotification(title, {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'badge-96.png',
      tag: NOTIF_TAG,
      renotify: true,
      requireInteraction: !IS_MOBILE,   // máy tính: giữ thông báo đến khi bấm, như Zalo
      vibrate: [200, 100, 200],
      timestamp: d.at || Date.now(),
      data: { cup, sid: d.sid, tok: d.tok },
      actions: [
        { action: 'drink', title: `Đã uống ${cup} ml` },
        { action: 'snooze', title: 'Nhắc lại sau 10 phút' },
      ],
    });
  })());
});

/** Báo thao tác cho máy chủ để lịch nhắc trên máy chủ cập nhật ngay, kể cả khi trang đang đóng. */
async function reportToServer(data, item) {
  const api = self.GIOTNUOC_PUSH && self.GIOTNUOC_PUSH.api;
  if (!api || !data.sid || !data.tok) return;
  try {
    await fetch(api.replace(/\/+$/, '') + '/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.sid, token: data.tok, action: item.action, ml: item.ml, t: item.t }),
    });
  } catch { /* mất mạng: trang sẽ đồng bộ khi mở lại */ }
}

self.addEventListener('notificationclick', (e) => {
  const action = e.action || 'open';
  const data = e.notification.data || {};
  const ml = data.cup || 250;
  e.notification.close();

  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (action === 'drink' || action === 'snooze') {
      // Ghi thao tác vào hàng đợi (kèm giờ bấm) trước khi báo cho trang. Trang đang bị
      // điện thoại đóng băng hoặc đã tắt vẫn đọc được khi mở lại, nên không mất lần bấm.
      const item = { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, action, ml, t: Date.now() };
      const c = await caches.open(ACTIONS);
      await c.put(new URL(ACTION_PREFIX + item.id, self.registration.scope).href,
        new Response(JSON.stringify(item), { headers: { 'Content-Type': 'application/json' } }));
      wins.forEach((w) => w.postMessage({ type: 'reminder-action' }));
      await reportToServer(data, item);
      // Không có trang nào mở và không có máy chủ ghi nhận: mở trang để người dùng thấy kết quả
      if (!wins.length && action === 'drink' && !data.sid) return self.clients.openWindow(self.registration.scope);
      return;
    }

    if (wins.length) return wins[0].focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
