'use strict';
/* =========================================================
   Giọt Nước – Nhắc uống nước
   Toàn bộ dữ liệu lưu trong localStorage của trình duyệt.
   ========================================================= */

const STORE_KEY = 'giotnuoc.v1';
const SNOOZE_MIN = 10;
const PAUSE_MIN = 60;
const NOTIF_TAG = 'giotnuoc-reminder';

const TITLES = [
  'Đến giờ uống nước rồi! 💧',
  'Cơ thể bạn đang khát đấy 🥤',
  'Một ngụm nước nào! 💦',
  'Nghỉ tay uống nước nhé 🌊',
];
const TIPS = [
  'Uống nước giúp tập trung học bài tốt hơn.',
  'Thiếu nước dễ gây mệt mỏi và đau đầu.',
  'Uống từng ngụm nhỏ, đừng uống quá nhanh.',
  'Đứng dậy, vươn vai rồi uống nước nhé.',
  'Nước lọc là lựa chọn tốt nhất cho cơ thể.',
  'Uống đều trong ngày tốt hơn uống dồn một lúc.',
];

/* ---------------- Trạng thái ---------------- */
let S = load();
let swReg = null;
let lastAdd = null;        // { day, id } – để hoàn tác
let currentDay = '';       // gán trong init()
let blinkTimer = null;
let audioCtx = null;

/* ---------------- Nhận biết thiết bị ---------------- */
const ICON = 'icon-192.png';
const BADGE = 'badge-96.png';
const UA = navigator.userAgent || '';
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_MOBILE = IS_IOS || /Android|Mobi/i.test(UA);
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
/** Lưu vào máy; `sync` = gửi lịch mới lên máy chủ đẩy (nếu đã bật nhắc kiểu Zalo/Facebook). */
function save({ sync = true } = {}) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* bộ nhớ bị chặn */ }
  if (sync && typeof schedulePushSync === 'function') schedulePushSync();
}

/* ---------------- Tiện ích thời gian ---------------- */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (n) => Math.round(n).toLocaleString('vi-VN');
const hhmm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function atTime(str, base = new Date()) {
  const [h, m] = str.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}
/** Khung giờ thức [bắt đầu, kết thúc] của ngày chứa `base` (hỗ trợ ngủ sau 0h). */
function awakeWindow(base = new Date()) {
  const s = atTime(S.profile.wake, base);
  const e = atTime(S.profile.sleep, base);
  if (e <= s) e.setDate(e.getDate() + 1);
  return [s.getTime(), e.getTime()];
}
function isAwake(t) {
  for (const off of [0, -1]) {
    const b = new Date(t);
    b.setDate(b.getDate() + off);
    const [s, e] = awakeWindow(b);
    if (t >= s && t < e) return true;
  }
  return false;
}
function nextWake(t) {
  const w = atTime(S.profile.wake, new Date(t));
  if (w.getTime() <= t) w.setDate(w.getDate() + 1);
  return w.getTime();
}
function tomorrowWake() {
  const m = new Date();
  m.setHours(24, 0, 0, 0);
  return nextWake(m.getTime() - 1);
}

/* ---------------- Dữ liệu uống nước ---------------- */
const goal = () => S.profile.goal;
const cup = () => S.profile.cup;
const logsOf = (k) => S.logs[k] || [];
const totalOf = (k = dayKey()) => logsOf(k).reduce((a, x) => a + x.ml, 0);
const firstName = () => S.profile.name.trim().split(/\s+/).pop();

/**
 * Ghi một lần uống. `t` là thời điểm uống (mặc định: bây giờ) – bấm "Đã uống" trên thông báo
 * có thể được xử lý muộn khi điện thoại mở lại trang, nên phải ghi đúng giờ đã bấm.
 */
function addWater(ml, { t = Date.now(), id } = {}) {
  ml = Math.round(Number(ml));
  if (!ml || ml < 1 || ml > 3000) return;
  if (!Number.isFinite(t) || t > Date.now()) t = Date.now();
  const k = dayKey(new Date(t));
  const before = totalOf(k);
  const entry = { id: id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t, ml };
  const list = (S.logs[k] ||= []);
  let i = list.length;                    // chèn đúng thứ tự thời gian
  while (i > 0 && list[i - 1].t > t) i--;
  list.splice(i, 0, entry);
  lastAdd = { day: k, id: entry.id };
  scheduleNext(t);
  if (S.nextAt <= Date.now()) scheduleNext();
  save();
  closeReminders();
  renderAll();

  const after = before + ml;
  const late = Date.now() - t > 60000 ? ` (lúc ${hhmm(t)})` : '';
  if (k === dayKey() && before < goal() && after >= goal()) {
    toast(`🎉 Tuyệt vời ${firstName()}! Bạn đã uống đủ ${fmt(goal())} ml hôm nay!`, 4000);
  } else {
    toast(`+${fmt(ml)} ml 💧${late} Còn ${fmt(Math.max(0, goal() - totalOf()))} ml nữa`);
  }
}

function removeEntry(day, id) {
  const list = logsOf(day);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  list.splice(i, 1);
  if (lastAdd && lastAdd.id === id) lastAdd = null;
  scheduleNext(Date.now());
  save();
  renderAll();
}
function lastDrinkTime() {
  const l = logsOf(dayKey());
  return l.length ? l[l.length - 1].t : 0;
}

/* ---------------- Lịch nhắc ---------------- */
/** Đặt lần nhắc tiếp theo: sau `minutes` phút kể từ `from`, chỉ trong giờ thức, dừng khi đã đạt mục tiêu. */
function scheduleNext(from = Date.now(), minutes = S.profile.interval) {
  let t = from + minutes * 60000;
  if (totalOf() >= goal()) t = Math.max(t, tomorrowWake());
  if (!isAwake(t)) t = nextWake(t);
  S.nextAt = t;
}

/** Nhắc lại sau 10 phút kể từ lúc bấm `from` (bấm trên thông báo có thể được xử lý muộn). */
function snooze(from = Date.now()) {
  closeReminders();
  const at = from + SNOOZE_MIN * 60000;
  if (at <= Date.now()) return;          // đã quá 10 phút kể từ lúc bấm – bỏ qua
  S.nextAt = at;
  save();
  renderReminder();
  toast(`⏰ Mình sẽ nhắc lại sau ${SNOOZE_MIN} phút`);
}

/** Lần nhắc tiếp theo cách bây giờ ít nhất 1 giờ – không bao giờ kéo lịch sớm hơn. */
function pauseOneHour() {
  const prev = S.nextAt || 0;
  scheduleNext(Date.now(), PAUSE_MIN);
  S.nextAt = Math.max(S.nextAt, prev);
  save();
  closeReminders();
  renderReminder();
  toast(`⏸ Đã hoãn – lần nhắc tiếp theo lúc ${hhmm(S.nextAt)}`);
}

function tick() {
  if (!S) return;
  if (dayKey() !== currentDay) {        // sang ngày mới
    currentDay = dayKey();
    lastAdd = null;
    renderAll();
  }
  const fresh = load();                  // đồng bộ với tab khác
  if (fresh && fresh.nextAt) S.nextAt = fresh.nextAt;

  const now = Date.now();
  if (now >= S.nextAt) {
    // Đã bật nhắc qua máy chủ: để máy chủ gửi (tránh nhắc trùng). Chỉ tự nhắc nếu
    // quá PUSH_GRACE mà không thấy tin đẩy nào (máy chủ lỗi hoặc mất mạng).
    if (pushActive() && isAwake(now) && totalOf() < goal()) {
      pushDueSince ||= now;
      if (now - pushDueSince < PUSH_GRACE) { renderReminder(); return; }
    }
    pushDueSince = 0;
    if (isAwake(now) && totalOf() < goal()) fireReminder();
    scheduleNext(now);
    save();
  }
  renderReminder();
}

/* ---------------- Gửi nhắc nhở ---------------- */
function reminderText() {
  const done = totalOf();
  const remain = Math.max(0, goal() - done);
  const cups = Math.ceil(remain / cup());
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  return {
    title: TITLES[Math.floor(Math.random() * TITLES.length)],
    body: `${firstName()} ơi, bạn đã uống ${fmt(done)}/${fmt(goal())} ml. Uống thêm một cốc ${cup()} ml nhé (còn ${cups} cốc). ${tip}`,
  };
}

/** `forceSystem`: luôn gửi thông báo hệ thống (nút "Gửi thử"). Khi người dùng đang nhìn
    trang thì chỉ hiện hộp nhắc trong trang, không gửi thêm thông báo hệ thống để tránh nhắc trùng. */
async function fireReminder({ forceSystem = false } = {}) {
  const { title, body } = reminderText();
  const looking = document.visibilityState === 'visible' && document.hasFocus();
  const shown = looking && !forceSystem ? false : await systemNotify(title, body);
  if (!shown || document.visibilityState === 'visible') showModal(title, body);
  if (S.profile.sound) chime();
  // Rung chỉ được phép sau khi người dùng đã chạm vào trang
  const touched = !navigator.userActivation || navigator.userActivation.hasBeenActive;
  try { if (touched && navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch { /* bỏ qua */ }
  if (document.hidden) startBlink();
}

/** Lấy Service Worker đang chạy (đợi tối đa 4 giây – điện thoại có thể khởi động chậm). */
async function getReg() {
  if (swReg) return swReg;
  if (!('serviceWorker' in navigator)) return null;
  try {
    swReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
    ]) || await navigator.serviceWorker.getRegistration();
  } catch { swReg = null; }
  return swReg;
}

async function systemNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = {
    body,
    icon: ICON,
    badge: BADGE,                 // biểu tượng nhỏ trên thanh trạng thái Android
    tag: NOTIF_TAG,
    renotify: true,
    requireInteraction: !IS_MOBILE,
    vibrate: [200, 100, 200],
    // sid/tok: để Service Worker báo thao tác "Đã uống"/"Nhắc lại" cho máy chủ đẩy
    data: { cup: cup(), sid: S.push && S.push.id, tok: S.push && S.push.token },
    actions: [
      { action: 'drink', title: `Đã uống ${cup()} ml` },
      { action: 'snooze', title: `Nhắc lại sau ${SNOOZE_MIN} phút` },
    ],
  };
  // Android Chrome và iPhone chỉ cho phép hiện thông báo qua Service Worker
  try {
    const reg = await getReg();
    if (reg) { await reg.showNotification(title, opts); return true; }
  } catch { /* dùng cách dự phòng bên dưới */ }
  // Máy tính không có Service Worker (ví dụ mở file trực tiếp)
  try {
    delete opts.actions;
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch { return false; }
}

async function closeReminders() {
  $('reminderModal').hidden = true;
  stopBlink();
  try {
    const reg = await getReg();
    if (reg) (await reg.getNotifications({ tag: NOTIF_TAG })).forEach((n) => n.close());
  } catch { /* bỏ qua */ }
}

function showModal(title, body) {
  $('remTitle').textContent = title;
  $('remBody').textContent = body;
  $('remDrink').textContent = `Đã uống ${cup()} ml`;
  $('reminderModal').hidden = false;
  $('remDrink').focus();
}

/** Trình duyệt chỉ cho phát âm thanh sau khi người dùng chạm/bấm vào trang:
    tạo sẵn AudioContext trong lúc đó để lời nhắc tự động (từ bộ hẹn giờ) vẫn kêu được. */
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch { /* trình duyệt không hỗ trợ âm thanh */ }
}
['pointerdown', 'keydown', 'touchend'].forEach((ev) =>
  document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));

function chime() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
    [0, 0.22].forEach((delay) => {
      const t0 = audioCtx.currentTime + delay;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1100, t0);
      o.frequency.exponentialRampToValueAtTime(420, t0 + 0.18);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + 0.3);
    });
  } catch { /* trình duyệt không hỗ trợ âm thanh */ }
}

function startBlink() {
  if (blinkTimer) return;
  const base = document.title;
  let on = false;
  blinkTimer = setInterval(() => {
    on = !on;
    document.title = on ? '💧 Uống nước nào!' : base;
  }, 1000);
}
function stopBlink() {
  if (!blinkTimer) return;
  clearInterval(blinkTimer);
  document.title = 'Giọt Nước – Nhắc uống nước';
  blinkTimer = null;
}

async function askPermission() {
  if (!('Notification' in window)) return 'unsupported';
  let p = Notification.permission;
  if (p === 'default') {
    try { p = await Notification.requestPermission(); } catch { /* bỏ qua */ }
  }
  renderPermission();
  if (p === 'granted') toast('🔔 Đã bật thông báo nhắc uống nước');
  return p;
}

/* ---------------- Cài ứng dụng (PWA) ---------------- */
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {   // Android Chrome / Edge
  e.preventDefault();
  installEvent = e;
  renderPermission();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  renderPermission();
  toast('✅ Đã cài Giọt Nước lên màn hình chính');
});
async function installApp() {
  if (!installEvent) return;
  installEvent.prompt();
  try { await installEvent.userChoice; } catch { /* bỏ qua */ }
  installEvent = null;
  renderPermission();
}

/* ---------------- Hiển thị ---------------- */
function renderAll() {
  if (!S) return;
  renderHeader();
  renderToday();
  renderReminder();
  renderPermission();
  if (!$('tab-history').hidden) renderHistory();
}

function renderHeader() {
  $('hello').textContent = `Chào ${firstName()} 👋`;
  $('avatar').textContent = firstName().charAt(0).toUpperCase();
  const d = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
  $('todayLabel').textContent = `${d.charAt(0).toUpperCase() + d.slice(1)} · Mục tiêu ${fmt(goal())} ml`;
}

function renderToday() {
  const done = totalOf();
  const pct = Math.min(100, Math.round((done / goal()) * 100));
  $('drunk').textContent = fmt(done);
  $('goalLabel').textContent = fmt(goal());
  $('percent').textContent = `${pct}% mục tiêu`;
  $('water').style.height = `${pct}%`;
  // Tiến độ nhỏ trên thanh điều hướng bên trái (chỉ hiện trên máy tính)
  $('navDrunk').textContent = fmt(done);
  $('navGoal').textContent = fmt(goal());
  $('navBar').style.width = `${pct}%`;

  // Chỉ báo tiến độ so với lượng "lẽ ra" phải uống đến giờ này
  const pace = $('pace');
  const remain = goal() - done;
  if (remain <= 0) {
    pace.className = 'pace done';
    pace.textContent = '🎉 Đã đạt mục tiêu hôm nay';
  } else {
    const [s, e] = awakeWindow(new Date());
    const frac = Math.min(1, Math.max(0, (Date.now() - s) / (e - s)));
    const expected = Math.round((goal() * frac) / 50) * 50;
    const behind = expected - done;
    const cups = Math.ceil(remain / cup());
    if (behind > 100) {
      pace.className = 'pace behind';
      pace.textContent = `⚠ Đang chậm ${fmt(behind)} ml · còn ${cups} cốc`;
    } else {
      pace.className = 'pace ok';
      pace.textContent = `✓ Đúng tiến độ · còn ${cups} cốc`;
    }
  }

  // Nút thêm nhanh
  const sizes = [cup(), ...[100, 200, 350, 500].filter((v) => v !== cup())].slice(0, 5);
  const icon = (v) => (v <= 100 ? '💧' : v <= 250 ? '🥛' : v <= 350 ? '🥤' : '🍶');
  $('quick').innerHTML = sizes.map((v, i) =>
    `<button type="button" data-ml="${v}" class="${i === 0 ? 'main' : ''}" aria-label="Thêm ${v} ml">
       <span class="ico">${icon(v)}</span><span class="ml">${i === 0 ? 'Cốc ' : '+'}${v}</span>
     </button>`).join('');

  $('undoBtn').disabled = !(lastAdd && lastAdd.day === dayKey());

  // Dòng thời gian
  const list = [...logsOf(dayKey())].reverse();
  $('timeline').innerHTML = list.length
    ? list.map((x) =>
        `<li><span class="t">${hhmm(x.t)}</span><span class="v">${icon(x.ml)} ${fmt(x.ml)} ml</span>
         <button class="del" data-del="${x.id}" aria-label="Xóa lần uống ${fmt(x.ml)} ml lúc ${hhmm(x.t)}">✕</button></li>`).join('')
    : '<li class="empty">Chưa có lần uống nào. Bắt đầu với một cốc nước nhé!</li>';
}

function renderReminder() {
  if (!S || !S.nextAt) return;
  const now = Date.now();
  const cd = $('countdown');
  const label = $('nextAtLabel');
  const sameDay = dayKey(new Date(S.nextAt)) === dayKey();

  if (totalOf() >= goal()) {
    cd.textContent = 'Đã đủ nước 🎉';
    label.textContent = `Hẹn bạn lúc ${hhmm(S.nextAt)} ngày mai`;
    $('pauseBtn').hidden = true;
    return;
  }
  $('pauseBtn').hidden = false;
  const left = Math.max(0, Math.round((S.nextAt - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  cd.textContent = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  label.textContent = `lúc ${hhmm(S.nextAt)}${sameDay ? '' : ' ngày mai'} · nhắc mỗi ${S.profile.interval} phút`;
}

function renderPermission() {
  const supported = 'Notification' in window;
  // iPhone chỉ có thông báo khi chạy từ biểu tượng trên Màn hình chính
  const iosNeedsInstall = IS_IOS && !IS_STANDALONE;
  const perm = iosNeedsInstall ? 'ios-install' : supported ? Notification.permission : 'unsupported';
  const insecure = !window.isSecureContext;

  $('permBanner').hidden = perm !== 'default' || insecure;
  $('iosBanner').hidden = perm !== 'ios-install';
  $('installBanner').hidden = !installEvent || IS_STANDALONE;
  $('mobileTip').hidden = !IS_MOBILE;

  const msg = insecure
    ? '🔒 Thông báo chỉ hoạt động khi trang được mở qua HTTPS (hoặc localhost).'
    : {
      granted: IS_IOS
        ? '✅ Thông báo đã được bật. Chạm vào thông báo để mở Giọt Nước và ghi nhận.'
        : '✅ Thông báo đã được bật. Bạn có thể bấm "Đã uống" ngay trên thông báo.',
      default: 'Thông báo chưa được bật. Bấm "Gửi thử thông báo" để cho phép.',
      denied: IS_MOBILE
        ? '🚫 Điện thoại đang chặn thông báo của trang này. Vào Cài đặt trình duyệt → Cài đặt trang web → Thông báo để cho phép lại. Trong lúc đó trang vẫn nhắc bằng hộp thoại khi đang mở.'
        : '🚫 Trình duyệt đang chặn thông báo. Hãy bật lại trong phần quyền của trang (biểu tượng ổ khóa cạnh thanh địa chỉ). Trong lúc đó trang vẫn nhắc bằng hộp thoại và âm báo khi đang mở.',
      'ios-install': '📱 iPhone/iPad (iOS 16.4 trở lên) chỉ cho phép thông báo khi Giọt Nước được thêm vào Màn hình chính: bấm Chia sẻ → Thêm vào MH chính, rồi mở từ biểu tượng đó.',
      unsupported: 'Trình duyệt này không hỗ trợ thông báo. Trang sẽ nhắc bằng hộp thoại và âm báo.',
    }[perm];
  $('notifStatus').textContent = msg;
  renderPush();
}

/* ---------------- Lịch sử & huy hiệu ---------------- */
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push({ key: dayKey(d), date: d, ml: totalOf(dayKey(d)) });
  }
  return out;
}

function currentStreak() {
  let n = 0;
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  if (totalOf(dayKey(d)) < goal()) d.setDate(d.getDate() - 1); // hôm nay chưa xong thì tính đến hôm qua
  while (totalOf(dayKey(d)) >= goal()) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function longestStreak() {
  const hit = new Set(Object.keys(S.logs).filter((k) => totalOf(k) >= goal()));
  let best = 0;
  for (const k of hit) {
    const d = new Date(`${k}T12:00:00`);
    d.setDate(d.getDate() - 1);
    if (hit.has(dayKey(d))) continue;   // không phải ngày bắt đầu chuỗi
    let n = 0;
    const c = new Date(`${k}T12:00:00`);
    while (hit.has(dayKey(c))) { n++; c.setDate(c.getDate() + 1); }
    best = Math.max(best, n);
  }
  return best;
}

function renderHistory() {
  const days = lastDays(7);
  $('statStreak').textContent = `${currentStreak()} 🔥`;
  $('statAvg').textContent = `${fmt(days.reduce((a, d) => a + d.ml, 0) / 7)}`;
  $('statHit').textContent = `${days.filter((d) => d.ml >= goal()).length}`;
  renderChart(days);
  renderBadges();
}

function renderChart(days) {
  const box = $('chart');
  const W = Math.max(280, box.clientWidth || 320);
  const H = Math.max(210, box.clientHeight || 210);   // máy tính: biểu đồ cao hơn
  const padL = 34, padR = 6, padT = 18, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(goal() * 1.2, ...days.map((d) => d.ml));
  const yMax = Math.ceil(max / 500) * 500;
  const y = (v) => padT + ih - (v / yMax) * ih;
  const slot = iw / days.length;
  const bw = Math.min(W > 600 ? 44 : 30, slot * 0.55);
  const step = yMax > 3000 ? 1000 : 500;

  let grid = '';
  for (let v = 0; v <= yMax; v += step) {
    grid += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>
             <text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v ? `${v / 1000}L` : '0'}</text>`;
  }

  const todayK = dayKey();
  const cols = days.map((d, i) => {
    const cx = padL + slot * i + slot / 2;
    const top = y(d.ml);
    const h = padT + ih - top;
    const r = Math.min(4, h);
    const x0 = cx - bw / 2;
    // Cột bo góc 4px ở đầu, phẳng ở đáy
    const bar = d.ml > 0
      ? `<path class="bar" d="M${x0},${padT + ih} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${padT + ih} Z"/>`
      : '';
    const isToday = d.key === todayK;
    const lbl = isToday && d.ml > 0 ? `<text class="val" x="${cx}" y="${top - 6}" text-anchor="middle">${fmt(d.ml)}</text>` : '';
    const name = isToday ? 'Nay' : WEEKDAY[d.date.getDay()];
    const full = d.date.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
    const pct = Math.round((d.ml / goal()) * 100);
    return `<g class="col" tabindex="0" data-tip="${full}|${fmt(d.ml)} ml · ${pct}% mục tiêu${d.ml >= goal() ? ' ✓' : ''}"
               aria-label="${full}: ${fmt(d.ml)} ml, ${pct}% mục tiêu">
      <rect class="hitbox" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${ih}"/>
      ${bar}${lbl}
      <text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle" ${isToday ? 'font-weight="700"' : ''}>${name}</text>
    </g>`;
  }).join('');

  const gy = y(goal());
  const goalLine = `<line class="goal" x1="${padL}" x2="${W - padR}" y1="${gy}" y2="${gy}"/>
    <text class="goal-label" x="${W - padR}" y="${gy - 5}" text-anchor="end">Mục tiêu ${fmt(goal())} ml</text>`;

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ lượng nước 7 ngày qua">${grid}${goalLine}${cols}</svg>`;

  const tip = $('tooltip');
  box.querySelectorAll('.col').forEach((g) => {
    const show = () => {
      const [a, b] = g.dataset.tip.split('|');
      tip.innerHTML = `<strong>${a}</strong><br>${b}`;
      const bar = g.querySelector('.bar') || g.querySelector('.hitbox');
      const r = bar.getBoundingClientRect();
      const hr = g.querySelector('.hitbox').getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - 90, Math.max(90, hr.left + hr.width / 2))}px`;
      tip.style.top = `${(g.querySelector('.bar') ? r.top : hr.bottom) - 6}px`;
      tip.hidden = false;
    };
    const hide = () => { tip.hidden = true; };
    g.addEventListener('pointerenter', show);
    g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', show);
    g.addEventListener('blur', hide);
  });
}

function badgeList() {
  const all = Object.values(S.logs).flat();
  const lifetime = all.reduce((a, x) => a + x.ml, 0);
  const best = longestStreak();
  const anyGoal = Object.keys(S.logs).some((k) => totalOf(k) >= goal());
  return [
    { id: 'first', ico: '💧', name: 'Giọt đầu tiên', ok: all.length > 0 },
    { id: 'early', ico: '🌅', name: 'Uống trước 8h', ok: all.some((x) => new Date(x.t).getHours() < 8) },
    { id: 'goal', ico: '🏆', name: `Đạt ${fmt(goal())} ml`, ok: anyGoal },
    { id: 's3', ico: '🔥', name: 'Chuỗi 3 ngày', ok: best >= 3 },
    { id: 's7', ico: '🌊', name: 'Chuỗi 7 ngày', ok: best >= 7 },
    { id: 'l10', ico: '🐳', name: 'Tổng 10 lít', ok: lifetime >= 10000 },
  ];
}

function renderBadges() {
  $('badges').innerHTML = badgeList().map((b) =>
    `<div class="badge ${b.ok ? 'got' : 'locked'}" title="${b.ok ? 'Đã đạt' : 'Chưa đạt'}">
       <span class="b-ico">${b.ico}</span>${b.name}${b.ok ? '' : '<br><span class="muted">🔒</span>'}</div>`).join('');
}

function checkNewBadges() {
  S.badges ||= [];
  for (const b of badgeList()) {
    if (b.ok && !S.badges.includes(b.id)) {
      S.badges.push(b.id);
      save();
      setTimeout(() => toast(`🏅 Huy hiệu mới: ${b.ico} ${b.name}`, 3500), 1600);
    }
  }
}

/* ---------------- Thông báo nhỏ ---------------- */
let toastTimer;
function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- Form hồ sơ ---------------- */
const form = $('profileForm');

function fillForm(p) {
  form.name.value = p.name;
  form.goal.value = p.goal;
  form.cup.value = String(p.cup);
  form.wake.value = p.wake;
  form.sleep.value = p.sleep;
  form.interval.value = String(p.interval);
  form.sound.checked = !!p.sound;
}

function readForm() {
  return {
    name: form.name.value.trim(),
    goal: Math.min(4000, Math.max(1000, Number(form.goal.value) || 2000)),
    cup: Number(form.cup.value),
    wake: form.wake.value,
    sleep: form.sleep.value,
    interval: Number(form.interval.value),
    sound: form.sound.checked,
  };
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const profile = readForm();
  if (!profile.name) return;
  if (profile.wake === profile.sleep) { toast('Giờ thức dậy và giờ đi ngủ phải khác nhau'); return; }

  if (!S) {
    S = { profile, logs: {}, nextAt: 0, badges: [], createdAt: Date.now() };
    scheduleNext(Date.now(), 1); // nhắc đầu tiên sau 1 phút để bạn thấy cách hoạt động
    save();
    showApp();
    askPermission().then((p) => { if (p === 'granted') enablePush({ silent: true }); });
  } else {
    S.profile = profile;
    scheduleNext(lastDrinkTime() > Date.now() - profile.interval * 60000 ? lastDrinkTime() : Date.now());
    save();
    renderAll();
    toast('✅ Đã lưu cài đặt');
  }
});

/* ---------------- Điều hướng ---------------- */
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((s) => { s.hidden = s.dataset.tab !== name; });
  document.querySelectorAll('.tabbar button').forEach((b) => {
    const on = b.dataset.go === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('tooltip').hidden = true;
  if (name === 'history') renderHistory();
  if (name === 'settings') fillForm(S.profile);
  window.scrollTo({ top: 0 });
}

function showApp() {
  $('onboarding').hidden = true;
  $('app').hidden = false;
  // Dùng lại form đăng ký làm form cài đặt
  $('settingsMount').appendChild(form);
  form.querySelector('.form-title').textContent = 'Hồ sơ & lịch nhắc';
  form.querySelector('[data-settings-only]').hidden = false;
  $('profileSubmit').textContent = 'Lưu thay đổi';
  renderAll();
  checkNewBadges();
}

/* ---------------- Sự kiện ---------------- */
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-go]');
  if (b) showTab(b.dataset.go);
});

$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ml]');
  if (b) { addWater(b.dataset.ml); checkNewBadges(); }
});

$('customForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = Number($('customMl').value);
  if (v >= 10 && v <= 2000) { addWater(v); checkNewBadges(); $('customMl').value = ''; }
  else toast('Nhập từ 10 đến 2000 ml');
});

$('undoBtn').addEventListener('click', () => {
  if (!lastAdd) return;
  const { day, id } = lastAdd;
  removeEntry(day, id);
  toast('↶ Đã hoàn tác');
});

$('timeline').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (b) removeEntry(dayKey(), b.dataset.del);
});

$('pauseBtn').addEventListener('click', pauseOneHour);
$('enableNotif').addEventListener('click', askPermission);
$('installBtn').addEventListener('click', installApp);
$('remDrink').addEventListener('click', () => { addWater(cup()); checkNewBadges(); });
$('remSnooze').addEventListener('click', () => snooze());
// Đóng hộp nhắc thì đóng luôn thông báo hệ thống cùng lượt và dừng nhấp nháy tiêu đề
$('reminderModal').addEventListener('click', (e) => { if (e.target.id === 'reminderModal') closeReminders(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('reminderModal').hidden) closeReminders(); });

$('testNotif').addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') await askPermission();
  fireReminder({ forceSystem: true });
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `giot-nuoc-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('resetBtn').addEventListener('click', async () => {
  if (!confirm('Xóa toàn bộ hồ sơ và lịch sử uống nước trên thiết bị này? Thao tác không thể hoàn tác.')) return;
  await disablePush({ quiet: true });   // xoá luôn lịch nhắc trên máy chủ
  try { localStorage.removeItem(STORE_KEY); } catch { /* bỏ qua */ }
  location.reload();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    stopBlink();
    drainActions().then(pullPushState).then(() => { tick(); renderAll(); });
  }
});
window.addEventListener('storage', (e) => {
  if (e.key === STORE_KEY) { S = load(); if (S) renderAll(); }
});
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (S && !$('tab-history').hidden) renderHistory(); }, 150);
});

/* ---------------- Thao tác từ nút trên thông báo ----------------
   Service Worker ghi mỗi lần bấm vào hàng đợi (Cache Storage) rồi báo cho trang.
   Trang đọc hàng đợi khi nhận báo, khi mở và khi quay lại – nên không mất thao tác
   dù điện thoại đã đóng băng hoặc tắt trang lúc bấm. Mỗi thao tác có id riêng để không ghi trùng. */
const ACTION_CACHE = 'giotnuoc-actions';
const ACTION_PREFIX = '__action/';
let draining = null;

function drainActions() {
  if (!S || !('caches' in window)) return Promise.resolve();
  draining ||= (async () => {
    try {
      const c = await caches.open(ACTION_CACHE);
      const items = [];
      for (const req of await c.keys()) {
        if (!new URL(req.url).pathname.includes(ACTION_PREFIX)) continue;
        try {
          const res = await c.match(req);
          await c.delete(req);
          if (res) items.push(await res.json());
        } catch { /* mục hỏng – bỏ qua */ }
      }
      items.sort((a, b) => a.t - b.t).forEach(handleAction);
    } catch { /* trình duyệt chặn Cache Storage */ }
    finally { draining = null; }
  })();
  return draining;
}

function handleAction({ id, action, ml, t }) {
  if (!S) return;
  const fresh = load();                  // tab khác có thể vừa ghi thao tác này
  if (fresh && fresh.profile) S = fresh;
  if (action === 'drink') {
    if (id && Object.values(S.logs).some((l) => l.some((x) => x.id === id))) return;
    addWater(Number(ml) || cup(), { t: Number(t), id });
    checkNewBadges();
  } else if (action === 'snooze') {
    snooze(Number(t) || Date.now());
  }
}

/* ---------------- Nhắc qua máy chủ (Web Push – giống Zalo/Facebook) ----------------
   Trang đăng ký một "kênh đẩy" với trình duyệt (pushManager.subscribe) rồi gửi kênh đó
   cùng lịch nhắc lên máy chủ (worker/). Đến giờ, máy chủ gửi tin đẩy → trình duyệt đánh thức
   sw.js để hiện thông báo, kể cả khi đã đóng tab. Cấu hình máy chủ nằm trong push-config.js. */
const PUSH = self.GIOTNUOC_PUSH || {};
const PUSH_SUPPORTED = 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
const PUSH_READY = !!(PUSH.api && PUSH.vapidPublicKey) && PUSH_SUPPORTED;
const PUSH_GRACE = 150000;   // chờ tin đẩy tối đa 2,5 phút rồi mới tự nhắc
let pushDueSince = 0;
let pushSyncTimer = null;
let pushBusy = false;

const pushActive = () => !!(PUSH_READY && S && S.push && S.push.id && Notification.permission === 'granted');
const pushCreds = () => ({ id: S.push.id, token: S.push.token });

async function pushApi(path, body) {
  const res = await fetch(PUSH.api.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Máy chủ trả lỗi ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function pushSnapshot() {
  const { name, goal: g, cup: c, wake, sleep, interval } = S.profile;
  return {
    profile: { name, goal: g, cup: c, wake, sleep, interval },
    tzOffset: new Date().getTimezoneOffset(),
    nextAt: S.nextAt,
    day: dayKey(),
    total: totalOf(),
  };
}

function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
}
function sameServerKey(sub) {
  try {
    const k = new Uint8Array(sub.options.applicationServerKey);
    const want = b64uToBytes(PUSH.vapidPublicKey);
    return k.length === want.length && k.every((v, i) => v === want[i]);
  } catch { return true; }
}

/** Bật nhắc qua máy chủ. `silent`: không hỏi quyền, không báo lỗi (dùng khi tự bật). */
async function enablePush({ silent = false } = {}) {
  if (!PUSH_READY || !S || pushBusy) return false;
  if (Notification.permission !== 'granted') {
    if (silent) return false;
    if ((await askPermission()) !== 'granted') { renderPush(); return false; }
  }
  pushBusy = true;
  renderPush();
  try {
    const reg = await getReg();
    if (!reg) throw new Error('Service Worker chưa sẵn sàng, hãy tải lại trang');
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameServerKey(sub)) { await sub.unsubscribe(); sub = null; }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(PUSH.vapidPublicKey) });
    const r = await pushApi('/subscribe', { subscription: sub.toJSON(), ...pushSnapshot() });
    S.push = { id: r.id, token: r.token, endpoint: sub.endpoint, since: Date.now() };
    save({ sync: false });
    if (!silent) toast('🔔 Đã bật: lời nhắc sẽ đến cả khi bạn đóng trang', 3500);
    return true;
  } catch (e) {
    if (!silent) toast(`Không bật được: ${e.message}`, 4000);
    return false;
  } finally {
    pushBusy = false;
    renderPush();
  }
}

async function disablePush({ quiet = false } = {}) {
  if (!S) return;
  const had = S.push && S.push.id;
  if (had) { try { await pushApi('/unsubscribe', pushCreds()); } catch { /* máy chủ không phản hồi */ } }
  try {
    const reg = await getReg();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* bỏ qua */ }
  S.push = { off: true };              // người dùng chủ động tắt – không tự bật lại
  pushDueSince = 0;
  save({ sync: false });
  renderPush();
  if (!quiet && had) toast('Đã tắt nhắc khi đóng trang');
}

/** Gửi lịch + lượng nước mới lên máy chủ (gom nhiều lần lưu liên tiếp thành một). */
function schedulePushSync() {
  if (!pushActive()) return;
  clearTimeout(pushSyncTimer);
  pushSyncTimer = setTimeout(async () => {
    try {
      await pushApi('/sync', { ...pushCreds(), ...pushSnapshot() });
    } catch (e) {
      if (e.status === 404 || e.status === 401) { S.push = {}; save({ sync: false }); enablePush({ silent: true }); }
    }
  }, 800);
}

/** Lấy lịch từ máy chủ (khi mở lại trang: máy chủ có thể đã nhắc trong lúc trang đóng). */
async function pullPushState() {
  if (!pushActive()) return;
  try {
    const r = await pushApi('/state', pushCreds());
    if (r.nextAt > S.nextAt) { S.nextAt = r.nextAt; save({ sync: false }); renderReminder(); }
  } catch (e) {
    if (e.status === 404 || e.status === 401) { S.push = {}; save({ sync: false }); enablePush({ silent: true }); }
  }
}

/** Trình duyệt đổi kênh đẩy (hoặc người dùng xoá dữ liệu trang) → đăng ký lại cho khớp. */
async function checkPushSubscription() {
  if (!PUSH_READY || !S || Notification.permission !== 'granted') return;
  if (S.push && S.push.off) return;
  try {
    const reg = await getReg();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!S.push || !S.push.id || !sub || sub.endpoint !== S.push.endpoint || !sameServerKey(sub)) {
      await enablePush({ silent: true });
    }
  } catch { /* bỏ qua */ }
}

/** Service Worker báo vừa nhận tin đẩy. `shown=false`: trang đang mở trước mặt → hiện hộp nhắc trong trang. */
function onPushMessage({ shown, payload = {} }) {
  if (!S) return;
  pushDueSince = 0;
  if (payload.test) { if (!shown) showModal(payload.title, payload.body); return; }
  if (Date.now() >= S.nextAt) { scheduleNext(Date.now()); save({ sync: false }); }
  if (!shown) {
    const { title, body } = reminderText();
    showModal(title, body);
  }
  if (S.profile.sound) chime();
  setTimeout(pullPushState, 3000);
  renderReminder();
}

function renderPush() {
  const box = $('pushBox');
  if (!box) return;
  box.hidden = !PUSH_READY || !S;
  $('pcTip').hidden = IS_MOBILE;
  if (box.hidden) return;
  const on = pushActive();
  $('pushToggle').checked = on || pushBusy;
  $('pushToggle').disabled = pushBusy;
  $('testPush').hidden = !on;
  const st = $('pushStatus');
  if (pushBusy) st.textContent = '⏳ Đang kết nối máy chủ…';
  else if (on) st.textContent = `✅ Đang bật. Máy chủ sẽ gửi lời nhắc tiếp theo lúc ${hhmm(S.nextAt)}${dayKey(new Date(S.nextAt)) === dayKey() ? '' : ' ngày mai'}, kể cả khi bạn đã đóng trang.`;
  else if (Notification.permission === 'denied') st.textContent = '🚫 Trình duyệt đang chặn thông báo – hãy cho phép lại rồi bật công tắc.';
  else st.textContent = 'Đang tắt. Bật để nhận lời nhắc như tin nhắn Zalo/Facebook, ngay cả khi không mở trang.';
}

$('pushToggle').addEventListener('change', (e) => {
  if (e.target.checked) enablePush(); else disablePush();
});
$('testPush').addEventListener('click', async () => {
  try {
    await pushApi('/test', pushCreds());
    toast('📡 Đã gửi – thông báo sẽ hiện sau vài giây. Thử đóng tab trước khi bấm để thấy rõ!', 4000);
  } catch (e) {
    toast(`Không gửi được: ${e.message}`, 4000);
    if (e.status === 410 || e.status === 404) { S.push = {}; save({ sync: false }); renderPush(); }
  }
});

/* ---------------- Khởi động ---------------- */
function init() {
  currentDay = dayKey();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // swReg được gán trong getReg() khi Service Worker đã sẵn sàng (active)
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.type === 'reminder-action') drainActions();
      if (e.data.type === 'push-reminder') onPushMessage(e.data);
    });
  }

  if (S && S.profile) {
    showApp();
    if (!S.nextAt) { scheduleNext(); save(); }
  } else {
    $('onboarding').hidden = false;
    form.querySelector('[data-settings-only]').hidden = true;
  }

  // Xử lý thao tác bấm trên thông báo trước, rồi lấy lịch từ máy chủ, rồi mới kiểm tra lịch nhắc
  drainActions()
    .then(pullPushState)
    .then(() => {
      tick();
      setInterval(tick, 1000);
      checkPushSubscription();
    });
}

init();
