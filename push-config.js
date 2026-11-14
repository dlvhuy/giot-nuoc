/* Cấu hình máy chủ nhắc (Web Push) – dùng chung cho trang (app.js) và Service Worker (sw.js).
   Để trống `api` thì trang chỉ nhắc khi đang mở (không có thông báo kiểu Zalo/Facebook). */
(function () {
  var local = /^(localhost|127\.0\.0\.1)$/.test(self.location.hostname);
  self.GIOTNUOC_PUSH = {
    // Máy chủ trong thư mục worker/ (Cloudflare Worker). Chạy thử tại máy: `npm run dev` → cổng 8787
    // (chạy trang tại máy mà không bật máy chủ thử thì đổi thành địa chỉ workers.dev bên dưới)
    api: local ? 'http://localhost:8787' : 'https://giot-nuoc-push.giot-nuoc-push.workers.dev',
    // Khoá công khai VAPID – phải trùng VAPID_PUBLIC_KEY trong worker/wrangler.toml
    vapidPublicKey: 'BK0uWWrqhDQ4OWYznAI6F4D-lWPSsFwAEW7dpIPNYv8UDwAZ1LPeZqTQUO8vTRuiYBdXJSaCCyKWOHCYFCGa7-w',
  };
})();
