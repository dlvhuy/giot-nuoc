/* Lịch nhắc phía máy chủ – cùng quy tắc với app.js:
   chỉ nhắc trong giờ thức, đã đủ mục tiêu thì chờ đến sáng hôm sau.
   `off` là múi giờ của người dùng theo Date#getTimezoneOffset() (Việt Nam = -420). */

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/** Đổi thời điểm thật sang "đồng hồ địa phương" (đọc bằng getUTC*). */
const toLocal = (t, off) => new Date(t - off * 60000);

export function dayKey(t, off) {
  const d = toLocal(t, off);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Thời điểm hh:mm địa phương của ngày chứa `t`. */
export function atTime(t, hhmm, off) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = toLocal(t, off);
  d.setUTCHours(h, m, 0, 0);
  return d.getTime() + off * 60000;
}

function awakeWindow(t, p, off) {
  const s = atTime(t, p.wake, off);
  let e = atTime(t, p.sleep, off);
  if (e <= s) e += DAY; // ngủ sau 0 giờ
  return [s, e];
}

export function isAwake(t, p, off) {
  for (const k of [0, -1]) {
    const [s, e] = awakeWindow(t + k * DAY, p, off);
    if (t >= s && t < e) return true;
  }
  return false;
}

export function nextWake(t, p, off) {
  const w = atTime(t, p.wake, off);
  return w > t ? w : w + DAY;
}

function tomorrowWake(now, p, off) {
  const midnight = atTime(now, '00:00', off) + DAY;
  return nextWake(midnight - 1, p, off);
}

/** Lần nhắc tiếp theo sau `minutes` phút kể từ `from`. */
export function scheduleNext(from, minutes, p, off, totalToday, now = Date.now()) {
  let t = from + minutes * 60000;
  if (totalToday >= p.goal) t = Math.max(t, tomorrowWake(now, p, off));
  if (!isAwake(t, p, off)) t = nextWake(t, p, off);
  return t;
}

/* ---------------- Chia nhỏ lượng nước (cùng quy tắc với app.js) ----------------
   Mục tiêu được chia đều cho các lần nhắc còn lại trong giờ thức, ngừng nhắc 30 phút trước
   giờ ngủ. Tính lại mỗi lần nhắc: uống thiếu thì các lần sau nhiều hơn một chút và ngược lại. */
const STOP_BEFORE_SLEEP = 30 * 60000;
const MIN_SIP = 30;

/** Khung giờ thức đang chứa `t` (đang ngủ thì lấy khung của ngày chứa `t`). */
function currentWindow(t, p, off) {
  for (const k of [0, -1]) {
    const [s, e] = awakeWindow(t + k * DAY, p, off);
    if (t >= s && t < e) return [s, e];
  }
  return awakeWindow(t, p, off);
}

/** Số lần nhắc còn lại (kể cả lần ở thời điểm `now`) trước giờ ngừng nhắc. */
export function slotsLeft(now, p, off) {
  const [s, e] = currentWindow(now, p, off);
  const last = Math.max(s, e - STOP_BEFORE_SLEEP);
  const start = Math.max(now, s);
  if (start > last) return 1;
  return Math.floor((last - start) / (p.interval * 60000)) + 1;
}

/** Lượng nên uống ở lần nhắc này (ml, làm tròn 10) để đủ mục tiêu trước giờ ngủ. */
export function portion(p, total, now, off) {
  const remain = p.goal - total;
  if (remain <= 0) return 0;
  return Math.min(remain, Math.max(MIN_SIP, Math.ceil(remain / slotsLeft(now, p, off) / 10) * 10));
}

/** Diễn đạt lượng nước theo cốc của người dùng: "khoảng nửa cốc", "1 cốc"… */
export function sipLabel(ml, cup) {
  const r = ml / cup;
  if (r < 0.35) return 'vài ngụm';
  if (r < 0.65) return 'khoảng nửa cốc';
  if (r < 0.85) return 'gần 1 cốc';
  if (r < 1.2) return '1 cốc';
  if (r < 1.4) return 'hơn 1 cốc';
  return `${String(Math.round(r * 2) / 2).replace('.', ',')} cốc`;
}

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
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Nội dung lời nhắc + lượng nên uống lần này (`ml`, dùng cho nút "Đã uống … ml"). */
export function reminderText(p, total, now = Date.now(), off = 0) {
  const ml = portion(p, total, now, off) || p.cup;
  const n = slotsLeft(now, p, off);
  const name = p.name.trim().split(/\s+/).pop();
  const rest = n > 1 ? `còn ${n} lần như vậy là đủ ${fmt(p.goal)} ml trước giờ ngủ` : 'lần cuối hôm nay, uống nốt là đủ';
  return {
    title: pick(TITLES),
    body: `${name} ơi, bạn đã uống ${fmt(total)}/${fmt(p.goal)} ml. Lần này uống khoảng ${fmt(ml)} ml (${sipLabel(ml, p.cup)}) nhé – ${rest}. ${pick(TIPS)}`,
    ml,
  };
}
