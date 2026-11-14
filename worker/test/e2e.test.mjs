/* Kiểm thử trọn vòng với máy chủ chạy tại máy (`npm run dev`, cần DEV_ALLOW_LOCAL_PUSH=1 trong .dev.vars):
   dịch vụ đẩy giả ở 127.0.0.1 nhận tin, giải mã bằng http_ece và kiểm tra chữ ký VAPID.
   Chạy: node test/e2e.test.mjs */
import assert from 'node:assert/strict';
import http from 'node:http';
import nodeCrypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ece = require('http_ece');
const API = process.env.API || 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:5173';

// ---- Dịch vụ đẩy giả ----
const received = [];
let replyStatus = 201;
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(replyStatus).end();
  });
});
await new Promise((r) => mock.listen(9911, '127.0.0.1', r));

const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('quá thời gian chờ');
};
const post = async (path, body) => {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), data: await res.json() };
};
const cron = () => fetch(`${API}/__scheduled?cron=*+*+*+*+*`);

// ---- "Trình duyệt" giả ----
const ua = nodeCrypto.createECDH('prime256v1');
ua.generateKeys();
const authSecret = nodeCrypto.randomBytes(16);
const subscription = {
  endpoint: `http://127.0.0.1:9911/push/${nodeCrypto.randomUUID()}`,
  keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
};
const decrypt = (buf) => JSON.parse(ece.decrypt(buf, { version: 'aes128gcm', privateKey: ua, authSecret: authSecret.toString('base64url') }).toString());

const health = await (await fetch(`${API}/health`)).json();
const vapidKey = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256',
  x: Buffer.from(health.vapidPublicKey, 'base64url').subarray(1, 33).toString('base64url'),
  y: Buffer.from(health.vapidPublicKey, 'base64url').subarray(33, 65).toString('base64url') }, format: 'jwk' });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✓', name); };
const profile = { name: 'Nguyễn Minh', goal: 2000, cup: 250, wake: '00:00', sleep: '23:59', interval: 60 };
let id, token;

try {
  await test('đăng ký kênh đẩy, có CORS cho trang', async () => {
    const r = await post('/subscribe', { subscription, profile, tzOffset: -420, total: 500 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.cors, ORIGIN);
    ({ id, token } = r.data);
    assert.ok(id && token);
  });

  await test('từ chối mã sai', async () => {
    const r = await post('/state', { id, token: 'sai' });
    assert.equal(r.status, 404);
  });

  await test('cron gửi tin đẩy khi đến hạn: giải mã được, chữ ký VAPID đúng', async () => {
    await post('/sync', { id, token, nextAt: Date.now(), total: 500 });
    await cron();
    await waitFor(() => received.length === 1);
    const { headers, body } = received[0];
    assert.equal(headers['content-encoding'], 'aes128gcm');
    assert.equal(headers.topic, 'giotnuoc');
    const [, jwt] = headers.authorization.match(/^vapid t=([^,]+), k=/);
    const [h, p, s] = jwt.split('.');
    assert.ok(nodeCrypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: vapidKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'http://127.0.0.1:9911');
    const msg = decrypt(body);
    assert.match(msg.body, /Minh ơi, bạn đã uống 500\/2\.000 ml/);
    assert.equal(msg.cup, 250);
    assert.equal(msg.sid, id);
  });

  await test('sau khi gửi, lần nhắc kế tiếp dời ~60 phút; cron chạy lại không gửi trùng', async () => {
    const s = (await post('/state', { id, token })).data;
    assert.ok(Math.abs(s.nextAt - (Date.now() + 3600000)) < 120000, `nextAt=${new Date(s.nextAt).toISOString()}`);
    await cron();
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(received.length, 1);
  });

  await test('bấm "Đã uống" trên thông báo → máy chủ cộng lượng nước', async () => {
    const r = await post('/action', { id, token, action: 'drink', ml: 250, t: Date.now() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.total, 750);
  });

  await test('bấm "Nhắc lại sau 10 phút" → lịch dời 10 phút', async () => {
    const r = await post('/action', { id, token, action: 'snooze', t: Date.now() });
    assert.ok(Math.abs(r.data.nextAt - (Date.now() + 600000)) < 5000);
  });

  await test('đã uống đủ mục tiêu → cron không gửi, dời sang ngày mai', async () => {
    await post('/sync', { id, token, total: 2000, nextAt: Date.now() });
    await cron();
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(received.length, 1);
    const s = (await post('/state', { id, token })).data;
    assert.ok(s.nextAt > Date.now() + 3600000);
  });

  await test('nút "Gửi thử từ máy chủ" gửi ngay', async () => {
    const r = await post('/test', { id, token });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await waitFor(() => received.length === 2);
    assert.equal(decrypt(received[1].body).test, true);
  });

  await test('dịch vụ đẩy báo 410 (trình duyệt huỷ đăng ký) → máy chủ xoá đăng ký', async () => {
    replyStatus = 410;
    await post('/sync', { id, token, total: 0, nextAt: Date.now() });
    await cron();
    await waitFor(() => received.length === 3);
    await new Promise((r) => setTimeout(r, 500));
    const r = await post('/state', { id, token });
    assert.equal(r.status, 404);
  });

  console.log(`\n${passed} bài kiểm thử trọn vòng đạt`);
} finally {
  mock.close();
}
