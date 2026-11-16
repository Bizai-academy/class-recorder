// Kiểm tra phần đăng nhập của giao diện khi mở ra internet:  node test/auth-check.mjs
// Dựng máy chủ giao diện ở một cổng riêng với mật khẩu thử, rồi gọi thử các tình huống.
import http from 'node:http';
import { config } from '../src/config.js';
import { hashPassword } from '../src/auth.js';
import { startServer } from '../src/server.js';

const PORT = 8799;
const PUBLIC = 'rec.test.local';
const PASSWORD = 'mat-khau-thu-123';
config.uiPasswordHash = hashPassword(PASSWORD);
config.uiPublicHosts = [PUBLIC];

function call(method, path, { host = PUBLIC, cookie, body, ip = '203.0.113.9', type = 'application/x-www-form-urlencoded', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers: { Host: host, 'X-Forwarded-For': ip, 'X-Forwarded-Proto': 'https', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const server = await startServer({ port: PORT, open: false });
try {
  let r = await call('GET', '/');
  check('Chưa đăng nhập: trang chính chuyển về trang đăng nhập', r.status === 303 && r.headers.location === '/login', `${r.status} → ${r.headers.location}`);
  r = await call('GET', '/api/state');
  check('Chưa đăng nhập: API từ chối (401)', r.status === 401, String(r.status));
  r = await call('GET', '/files/x/recording.webm');
  check('Chưa đăng nhập: không tải được file ghi hình (401)', r.status === 401, String(r.status));
  r = await call('POST', '/api/stop', { body: '{}', type: 'application/json' });
  check('Chưa đăng nhập: không gửi được lệnh (401)', r.status === 401, String(r.status));
  r = await call('GET', '/login');
  check('Trang đăng nhập hiển thị', r.status === 200 && /Mật khẩu/.test(r.body), String(r.status));
  r = await call('GET', '/', { host: 'evil.example.com' });
  check('Tên miền lạ bị từ chối (403)', r.status === 403, String(r.status));

  r = await call('POST', '/login', { body: 'password=sai-mat-khau', ip: '198.51.100.7' });
  check('Sai mật khẩu: từ chối (401)', r.status === 401 && !r.headers['set-cookie'], String(r.status));
  for (let i = 0; i < 4; i++) await call('POST', '/login', { body: 'password=sai', ip: '198.51.100.7' });
  r = await call('POST', '/login', { body: `password=${PASSWORD}`, ip: '198.51.100.7' });
  check('Sai 5 lần: địa chỉ đó bị khoá kể cả khi nhập đúng (429)', r.status === 429, String(r.status));

  r = await call('POST', '/login', { body: `password=${PASSWORD}` });
  const cookie = (r.headers['set-cookie'] || [])[0] || '';
  check('Đúng mật khẩu: nhận cookie phiên (HttpOnly, Secure, SameSite=Strict)', r.status === 303 && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie), `${r.status} ${cookie.replace(/=[^;]+/, '=…')}`);
  const session = cookie.split(';')[0];

  r = await call('GET', '/api/state', { cookie: session });
  const state = r.status === 200 ? JSON.parse(r.body) : {};
  check('Đã đăng nhập: API trả dữ liệu, có cờ auth', r.status === 200 && state.server?.auth === true && state.server?.canOpenFolder === false, String(r.status));
  r = await call('GET', '/', { cookie: session });
  check('Đã đăng nhập: vào được trang chính', r.status === 200 && /Class Recorder/.test(r.body), String(r.status));
  r = await call('GET', '/api/settings', { cookie: session });
  check('Cài đặt không lộ API key hay mật khẩu', r.status === 200 && !/sk-|scrypt:/.test(r.body), String(r.status));
  r = await call('POST', '/api/stop', { cookie: session, body: '{}', type: 'application/json' });
  check('Đã đăng nhập nhưng thiếu mã của trang: lệnh vẫn bị từ chối (403)', r.status === 403, String(r.status));
  r = await call('GET', '/api/state', { cookie: session.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) });
  check('Cookie bị sửa: từ chối (401)', r.status === 401, String(r.status));
  r = await call('GET', '/logout', { cookie: session });
  check('Đăng xuất: xoá cookie và về trang đăng nhập', r.status === 303 && /Max-Age=0/.test((r.headers['set-cookie'] || [])[0] || ''), String(r.status));
} finally {
  server.close();
}

for (const c of results) console.log(`${c.ok ? 'ĐẠT ' : 'LỖI '} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
const pass = results.every((c) => c.ok);
console.log(pass ? '\nPhần đăng nhập hoạt động đúng.' : '\nCó mục chưa đạt.');
process.exit(pass ? 0 : 1);
