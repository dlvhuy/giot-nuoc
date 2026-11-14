/* Kiểm thử phần Web Push bằng thư viện độc lập:
   - Mã hoá bằng webpush.js rồi giải mã bằng http_ece (thư viện mà web-push dùng).
   - Xác minh chữ ký VAPID JWT bằng node:crypto.
   - Kiểm tra lịch nhắc theo múi giờ Việt Nam.
   Chạy: npm install --no-save http_ece && npm test */
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { createRequire } from 'node:module';
import { encryptPayload, vapidAuthorization, b64uEncode, b64uDecode } from '../src/webpush.js';
import { dayKey, isAwake, scheduleNext, atTime } from '../src/schedule.js';

const require = createRequire(import.meta.url);
const ece = require('http_ece');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✓', name); };

await test('mã hoá aes128gcm giải mã được bằng http_ece', async () => {
  // "Trình duyệt" giả: cặp khoá p256dh + auth secret
  const ua = nodeCrypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const msg = JSON.stringify({ title: 'Đến giờ uống nước rồi! 💧', body: 'Minh ơi, uống thêm 250 ml nhé' });

  const body = await encryptPayload(msg, b64uEncode(ua.getPublicKey()), b64uEncode(auth));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth.toString('base64url') });
  assert.equal(plain.toString('utf8'), msg);
});

await test('khung bản tin đúng RFC 8188 (salt, rs=4096, keyid 65 byte)', async () => {
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const body = await encryptPayload('x', b64uEncode(ua.getPublicKey()), b64uEncode(nodeCrypto.randomBytes(16)));
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(body[20], 65);
  assert.equal(body[21], 0x04);
});

await test('VAPID JWT ký ES256 hợp lệ, đúng aud/exp/sub', async () => {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = b64uEncode(Buffer.concat([Buffer.from([4]), b64uDecode(jwk.x), b64uDecode(jwk.y)]));
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey: pub, privateKey: jwk.d, subject: 'https://example.com' });

  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, header);
  assert.equal(m[2], pub);
  const [h, p, s] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://example.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  const ok = nodeCrypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(ok, 'chữ ký không hợp lệ');
});

await test('lịch nhắc theo giờ Việt Nam (UTC+7)', async () => {
  const off = -420;
  const p = { name: 'Minh', goal: 2000, cup: 250, wake: '06:30', sleep: '22:30', interval: 60 };
  const vn = (iso) => Date.parse(`${iso}+07:00`);

  assert.equal(dayKey(vn('2026-11-14T00:30:00'), off), '2026-11-14');
  assert.equal(atTime(vn('2026-11-14T15:00:00'), '06:30', off), vn('2026-11-14T06:30:00'));
  assert.ok(isAwake(vn('2026-11-14T10:00:00'), p, off));
  assert.ok(!isAwake(vn('2026-11-14T23:00:00'), p, off));
  assert.ok(!isAwake(vn('2026-11-14T05:00:00'), p, off));

  // 10:00 + 60 phút = 11:00
  assert.equal(scheduleNext(vn('2026-11-14T10:00:00'), 60, p, off, 500, vn('2026-11-14T10:00:00')), vn('2026-11-14T11:00:00'));
  // 22:00 + 60 phút rơi vào giờ ngủ → 06:30 sáng mai
  assert.equal(scheduleNext(vn('2026-11-14T22:00:00'), 60, p, off, 500, vn('2026-11-14T22:00:00')), vn('2026-11-15T06:30:00'));
  // Đã đủ 2 lít lúc 15:00 → chờ 06:30 sáng mai
  assert.equal(scheduleNext(vn('2026-11-14T15:00:00'), 60, p, off, 2000, vn('2026-11-14T15:00:00')), vn('2026-11-15T06:30:00'));
  // Ngủ sau nửa đêm (07:00 → 01:00): 00:30 vẫn là giờ thức
  const owl = { ...p, wake: '07:00', sleep: '01:00' };
  assert.ok(isAwake(vn('2026-11-15T00:30:00'), owl, off));
  assert.ok(!isAwake(vn('2026-11-15T02:00:00'), owl, off));
});

console.log(`\n${passed} bài kiểm thử đạt`);
