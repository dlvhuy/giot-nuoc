/* Máy chủ nhắc uống nước – Cloudflare Worker
   - Lưu đăng ký Web Push + lịch nhắc của từng người vào D1.
   - Cron mỗi phút: ai đến giờ thì gửi tin đẩy → thông báo hiện cả khi đã đóng tab
     (giống Zalo/Facebook trên web).

   API (JSON, POST):
     /subscribe   { subscription, profile, tzOffset, nextAt, day, total } → { id, token }
     /sync        { id, token, profile?, tzOffset?, nextAt?, day?, total? }
     /state       { id, token } → { nextAt, day, total }
     /action      { id, token, action: 'drink'|'snooze', ml, t }   (từ nút trên thông báo)
     /test        { id, token }  → gửi ngay một thông báo thử
     /unsubscribe { id, token }
   GET /health → { ok, vapidPublicKey } */

import { sendPush } from './webpush.js';
import { dayKey, isAwake, scheduleNext, reminderText } from './schedule.js';

const SNOOZE_MIN = 10;
const MAX_FAILS = 8;
const BATCH = 20; // tối đa số tin gửi mỗi phút (giữ trong giới hạn CPU gói miễn phí)

/* ---------------- Tiện ích ---------------- */
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function cleanProfile(p) {
  if (!p || typeof p !== 'object') throw new HttpError(400, 'Thiếu hồ sơ');
  const name = String(p.name || '').trim().slice(0, 40);
  if (!name) throw new HttpError(400, 'Thiếu tên');
  if (!isTime(p.wake) || !isTime(p.sleep) || p.wake === p.sleep) throw new HttpError(400, 'Giờ thức/ngủ không hợp lệ');
  return {
    name,
    goal: clamp(Math.round(Number(p.goal) || 2000), 1000, 4000),
    cup: clamp(Math.round(Number(p.cup) || 250), 50, 1000),
    wake: p.wake,
    sleep: p.sleep,
    interval: clamp(Math.round(Number(p.interval) || 60), 15, 240),
  };
}

function cleanSubscription(s, env) {
  const endpoint = s && s.endpoint;
  const keys = (s && s.keys) || {};
  let url;
  try { url = new URL(endpoint); } catch { throw new HttpError(400, 'Đăng ký đẩy không hợp lệ'); }
  // Chỉ khi chạy thử tại máy (.dev.vars): cho phép dịch vụ đẩy giả ở 127.0.0.1
  const devMock = env.DEV_ALLOW_LOCAL_PUSH === '1' && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((url.protocol !== 'https:' && !devMock) || endpoint.length > 1000) throw new HttpError(400, 'Đăng ký đẩy không hợp lệ');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth || '')) {
    throw new HttpError(400, 'Khoá đăng ký không hợp lệ');
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

const cleanOffset = (o) => clamp(Math.round(Number(o)), -840, 720) || 0;
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function readBody(req) {
  const text = await req.text();
  if (text.length > 8000) throw new HttpError(413, 'Dữ liệu quá lớn');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'JSON không hợp lệ'); }
}

async function auth(env, body) {
  if (typeof body.id !== 'string' || typeof body.token !== 'string') throw new HttpError(401, 'Thiếu mã đăng ký');
  const row = await env.DB.prepare('SELECT * FROM subs WHERE id = ?').bind(body.id).first();
  if (!row || row.token !== body.token) throw new HttpError(404, 'Không tìm thấy đăng ký');
  return row;
}

const vapid = (env) => ({
  publicKey: env.VAPID_PUBLIC_KEY,
  privateKey: env.VAPID_PRIVATE_KEY,
  subject: env.VAPID_SUBJECT || 'https://github.com/dlvhuy/giot-nuoc',
});

const todayTotal = (row, now) => (row.day === dayKey(now, row.tz_offset) ? row.total : 0);

/* ---------------- Gửi một lời nhắc ---------------- */
async function remind(env, row, { test = false } = {}) {
  const p = JSON.parse(row.profile);
  const now = Date.now();
  const total = todayTotal(row, now);
  const { title, body } = test
    ? { title: 'Thông báo thử từ máy chủ 🔔', body: `${p.name.trim().split(/\s+/).pop()} ơi, Giọt Nước đã gửi được thông báo tới máy bạn. Lời nhắc sẽ đến cả khi bạn đã đóng trang.` }
    : reminderText(p, total);
  const payload = { title, body, cup: p.cup, sid: row.id, tok: row.token, at: now, test };
  return sendPush(row, payload, vapid(env), { topic: 'giotnuoc', ttl: test ? 600 : 1800 });
}

/* ---------------- Cron: gửi lời nhắc đến hạn ---------------- */
async function runDue(env) {
  const now = Date.now();
  const { results } = await env.DB
    .prepare('SELECT * FROM subs WHERE next_at <= ? ORDER BY next_at LIMIT ?')
    .bind(now, BATCH).all();

  const stmts = [];
  for (const row of results) {
    const p = JSON.parse(row.profile);
    const off = row.tz_offset;
    const total = todayTotal(row, now);

    if (!isAwake(now, p, off) || total >= p.goal) {
      // Ngoài giờ thức hoặc đã đủ nước: dời đến lần hợp lệ kế tiếp, không gửi
      stmts.push(env.DB.prepare('UPDATE subs SET next_at = ? WHERE id = ?')
        .bind(scheduleNext(now, 0, p, off, total, now), row.id));
      continue;
    }

    let res;
    try { res = await remind(env, row); } catch (e) { res = { status: 0, text: String(e) }; }

    console.log('push', new URL(row.endpoint).host, res.status, res.text);
    if (res.status === 404 || res.status === 410) {
      stmts.push(env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(row.id)); // trình duyệt đã huỷ đăng ký
    } else if (res.status >= 200 && res.status < 300) {
      stmts.push(env.DB.prepare('UPDATE subs SET next_at = ?, fails = 0, last_push_at = ? WHERE id = ?')
        .bind(scheduleNext(now, p.interval, p, off, total, now), now, row.id));
    } else if (row.fails + 1 >= MAX_FAILS) {
      stmts.push(env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(row.id));
    } else {
      console.log('push lỗi', res.status, res.text);
      stmts.push(env.DB.prepare('UPDATE subs SET next_at = ?, fails = fails + 1 WHERE id = ?')
        .bind(now + 5 * 60000, row.id)); // thử lại sau 5 phút
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return results.length;
}

/* ---------------- Các API ---------------- */
async function handle(req, env, path) {
  const now = Date.now();
  const body = await readBody(req);

  if (path === '/subscribe') {
    const sub = cleanSubscription(body.subscription, env);
    const profile = cleanProfile(body.profile);
    const off = cleanOffset(body.tzOffset);
    const day = isDay(body.day) ? body.day : dayKey(now, off);
    const total = clamp(Math.round(Number(body.total) || 0), 0, 20000);
    const nextAt = Number(body.nextAt) > now ? Math.round(Number(body.nextAt)) : scheduleNext(now, profile.interval, profile, off, total, now);
    const token = randomToken();
    // Cùng một trình duyệt (cùng endpoint) đăng ký lại → cấp mã mới, giữ nguyên id
    const existing = await env.DB.prepare('SELECT id FROM subs WHERE endpoint = ?').bind(sub.endpoint).first();
    const id = existing ? existing.id : crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO subs (id, token, endpoint, p256dh, auth, profile, tz_offset, next_at, day, total, fails, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?11)
        ON CONFLICT(endpoint) DO UPDATE SET token = ?2, p256dh = ?4, auth = ?5, profile = ?6, tz_offset = ?7,
          next_at = ?8, day = ?9, total = ?10, fails = 0, updated_at = ?11`)
      .bind(id, token, sub.endpoint, sub.p256dh, sub.auth, JSON.stringify(profile), off, nextAt, day, total, now)
      .run();
    return { id, token, nextAt };
  }

  const row = await auth(env, body);

  if (path === '/sync') {
    const profile = body.profile ? cleanProfile(body.profile) : JSON.parse(row.profile);
    const off = body.tzOffset !== undefined ? cleanOffset(body.tzOffset) : row.tz_offset;
    const day = isDay(body.day) ? body.day : row.day;
    const total = body.total !== undefined ? clamp(Math.round(Number(body.total) || 0), 0, 20000) : row.total;
    let nextAt = Number(body.nextAt) > 0 ? Math.round(Number(body.nextAt)) : row.next_at;
    if (nextAt < now - 60000) nextAt = scheduleNext(now, 0, profile, off, total, now);
    await env.DB.prepare('UPDATE subs SET profile = ?, tz_offset = ?, day = ?, total = ?, next_at = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(profile), off, day, total, nextAt, now, row.id).run();
    return { ok: true, nextAt };
  }

  if (path === '/state') {
    return { nextAt: row.next_at, day: row.day, total: row.total, lastPushAt: row.last_push_at || 0 };
  }

  if (path === '/action') {
    const p = JSON.parse(row.profile);
    const off = row.tz_offset;
    const t = Number(body.t) > 0 && Number(body.t) <= now ? Number(body.t) : now;
    let { day, total } = row;
    let nextAt = row.next_at;
    if (body.action === 'drink') {
      const ml = clamp(Math.round(Number(body.ml) || p.cup), 1, 3000);
      const k = dayKey(t, off);
      total = (day === k ? total : 0) + ml;
      day = k;
      nextAt = scheduleNext(t, p.interval, p, off, total, now);
      if (nextAt <= now) nextAt = scheduleNext(now, p.interval, p, off, total, now);
    } else if (body.action === 'snooze') {
      nextAt = Math.max(now + 60000, t + SNOOZE_MIN * 60000);
    } else {
      throw new HttpError(400, 'Thao tác không hợp lệ');
    }
    await env.DB.prepare('UPDATE subs SET day = ?, total = ?, next_at = ?, updated_at = ? WHERE id = ?')
      .bind(day, total, nextAt, now, row.id).run();
    return { ok: true, nextAt, total };
  }

  if (path === '/test') {
    const res = await remind(env, row, { test: true });
    console.log('test push', new URL(row.endpoint).host, res.status, res.text);
    if (res.status === 404 || res.status === 410) {
      await env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(row.id).run();
      throw new HttpError(410, 'Đăng ký đã hết hạn, hãy bật lại thông báo');
    }
    if (res.status < 200 || res.status >= 300) throw new HttpError(502, `Dịch vụ đẩy trả lỗi ${res.status}`);
    return { ok: true };
  }

  if (path === '/unsubscribe') {
    await env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(row.id).run();
    return { ok: true };
  }

  throw new HttpError(404, 'Không có API này');
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return json({ ok: true, service: 'giot-nuoc-push', vapidPublicKey: env.VAPID_PUBLIC_KEY }, 200, cors);
    }
    if (req.method !== 'POST') return json({ error: 'Chỉ hỗ trợ POST' }, 405, cors);
    try {
      return json(await handle(req, env, path), 200, cors);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.log('lỗi', e && e.stack);
      return json({ error: status === 500 ? 'Lỗi máy chủ' : e.message }, status, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDue(env));
  },
};
