/* Web Push cho Cloudflare Workers – chỉ dùng WebCrypto, không cần thư viện.
   - VAPID (RFC 8292): JWT ký ES256 để dịch vụ đẩy (FCM, Mozilla, WNS, Apple) biết máy chủ nào gửi.
   - Mã hoá nội dung aes128gcm (RFC 8188 + RFC 8291): chỉ trình duyệt nhận mới đọc được. */

const te = new TextEncoder();

export function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* ---------------- VAPID ---------------- */
const jwtCache = new Map(); // audience -> { header, exp }

async function signingKey(publicB64u, privateB64u) {
  const pub = b64uDecode(publicB64u); // 0x04 | x(32) | y(32)
  return crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: privateB64u,
    ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const hit = jwtCache.get(aud);
  if (hit && hit.exp - now > 3600) return hit.header;

  const exp = now + 12 * 3600;
  const head = b64uEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEncode(te.encode(JSON.stringify({ aud, exp, sub: subject })));
  const key = await signingKey(publicKey, privateKey);
  // WebCrypto trả chữ ký dạng r||s (64 byte) – đúng định dạng JWT cần
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${head}.${body}`));
  const header = `vapid t=${head}.${body}.${b64uEncode(sig)}, k=${publicKey}`;
  jwtCache.set(aud, { header, exp });
  return header;
}

/* ---------------- Mã hoá nội dung (aes128gcm) ---------------- */
export async function encryptPayload(plaintext, p256dhB64u, authB64u, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = b64uDecode(p256dhB64u);
  const authSecret = b64uDecode(authB64u);

  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  // RFC 8291 §3.4
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(te.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  // Một bản ghi duy nhất: nội dung + 0x02 (dấu kết thúc bản ghi cuối)
  const data = concat(typeof plaintext === 'string' ? te.encode(plaintext) : plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Gửi một tin đẩy. Trả về mã HTTP của dịch vụ đẩy:
 * 201 = đã nhận, 404/410 = đăng ký đã hết hạn (nên xoá), khác = lỗi tạm thời.
 */
export async function sendPush(sub, payload, vapid, { ttl = 1800, topic, urgency = 'high' } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  const headers = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  };
  if (topic) headers.Topic = topic; // tin mới thay tin cũ chưa giao
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  return { status: res.status, text: res.ok ? '' : (await res.text()).slice(0, 200) };
}
