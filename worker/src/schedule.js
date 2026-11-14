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

export function reminderText(p, total) {
  const remain = Math.max(0, p.goal - total);
  const cups = Math.ceil(remain / p.cup);
  const name = p.name.trim().split(/\s+/).pop();
  return {
    title: pick(TITLES),
    body: `${name} ơi, bạn đã uống ${fmt(total)}/${fmt(p.goal)} ml. Uống thêm một cốc ${p.cup} ml nhé (còn ${cups} cốc). ${pick(TIPS)}`,
  };
}
