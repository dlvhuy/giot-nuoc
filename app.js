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
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* bộ nhớ bị chặn */ }
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

function addWater(ml, silent = false) {
  ml = Math.round(Number(ml));
  if (!ml || ml < 1 || ml > 3000) return;
  const k = dayKey();
  const before = totalOf(k);
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), ml };
  (S.logs[k] ||= []).push(entry);
  lastAdd = { day: k, id: entry.id };
  scheduleNext();
  save();
  closeReminders();
  renderAll();

  const after = before + ml;
  if (before < goal() && after >= goal()) {
    toast(`🎉 Tuyệt vời ${firstName()}! Bạn đã uống đủ ${fmt(goal())} ml hôm nay!`, 4000);
  } else if (!silent) {
    toast(`+${fmt(ml)} ml 💧 Còn ${fmt(Math.max(0, goal() - after))} ml nữa`);
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

function snooze() {
  S.nextAt = Date.now() + SNOOZE_MIN * 60000;
  save();
  closeReminders();
  renderReminder();
  toast(`⏰ Mình sẽ nhắc lại sau ${SNOOZE_MIN} phút`);
}

function pauseOneHour() {
  scheduleNext(Date.now(), PAUSE_MIN);
  save();
  renderReminder();
  toast('⏸ Đã tạm dừng nhắc trong 1 giờ');
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

async function fireReminder() {
  const { title, body } = reminderText();
  const shown = await systemNotify(title, body);
  if (!shown || document.visibilityState === 'visible') showModal(title, body);
  if (S.profile.sound) chime();
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* bỏ qua */ }
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
    data: { cup: cup() },
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

function chime() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
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
  blinkTimer.base = base;
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
  const H = 210;
  const padL = 34, padR = 6, padT = 18, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(goal() * 1.2, ...days.map((d) => d.ml));
  const yMax = Math.ceil(max / 500) * 500;
  const y = (v) => padT + ih - (v / yMax) * ih;
  const slot = iw / days.length;
  const bw = Math.min(30, slot * 0.55);
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
    askPermission();
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
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.go === name));
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
$('remSnooze').addEventListener('click', snooze);
$('reminderModal').addEventListener('click', (e) => { if (e.target.id === 'reminderModal') $('reminderModal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('reminderModal').hidden = true; });

$('testNotif').addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') await askPermission();
  fireReminder();
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `giot-nuoc-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('resetBtn').addEventListener('click', () => {
  if (!confirm('Xóa toàn bộ hồ sơ và lịch sử uống nước trên thiết bị này? Thao tác không thể hoàn tác.')) return;
  try { localStorage.removeItem(STORE_KEY); } catch { /* bỏ qua */ }
  location.reload();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { stopBlink(); tick(); renderAll(); }
});
window.addEventListener('storage', (e) => {
  if (e.key === STORE_KEY) { S = load(); if (S) renderAll(); }
});
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (S && !$('tab-history').hidden) renderHistory(); }, 150);
});

/* Nhận thao tác từ nút trên thông báo (qua Service Worker) */
function handleAction(action, ml) {
  if (!S) return;
  if (action === 'drink') { addWater(ml || cup()); checkNewBadges(); }
  else if (action === 'snooze') snooze();
}

/* ---------------- Khởi động ---------------- */
function init() {
  currentDay = dayKey();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // swReg được gán trong getReg() khi Service Worker đã sẵn sàng (active)
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'reminder-action') handleAction(e.data.action, e.data.ml);
    });
  }

  if (S && S.profile) {
    showApp();
    // Mở từ thông báo khi trang đang đóng: ?action=drink&ml=250
    const q = new URLSearchParams(location.search);
    if (q.get('action')) {
      handleAction(q.get('action'), Number(q.get('ml')));
      history.replaceState(null, '', location.pathname);
    }
    if (!S.nextAt) { scheduleNext(); save(); }
  } else {
    $('onboarding').hidden = false;
    form.querySelector('[data-settings-only]').hidden = true;
  }

  setInterval(tick, 1000);
  tick();
}

init();
