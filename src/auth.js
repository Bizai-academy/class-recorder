import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { t, getLang } from './i18n.js';

/**
 * Đăng nhập cho giao diện khi mở ra internet (VPS): một mật khẩu, lưu dạng băm scrypt trong .env (UI_PASSWORD_HASH).
 * Phiên đăng nhập là cookie có chữ ký HMAC, sống 30 ngày, không lưu trên máy chủ nên khởi động lại không bị đăng xuất.
 */

const COOKIE = 'classrec_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const m = /^scrypt:([0-9a-f]+):([0-9a-f]+)$/.exec(stored || '');
  if (!m) return false;
  const expected = Buffer.from(m[2], 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(m[1], 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function generatePassword() {
  // 16 ký tự dễ gõ (bỏ các ký tự dễ nhầm như 0/O, 1/l)
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]).join('');
}

function secret() {
  const file = path.join(config.dataDir, 'ui-secret');
  try {
    return fs.readFileSync(file);
  } catch {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const s = crypto.randomBytes(32);
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('hex');

export function sessionCookie({ secure }) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const value = `${exp}.${sign(String(exp))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export function hasSession(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})`).exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  const expected = Buffer.from(sign(m[1]), 'hex');
  const actual = Buffer.from(m[2], 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Chống dò mật khẩu: sai 5 lần từ một địa chỉ thì khoá địa chỉ đó 10 phút.
const attempts = new Map();
export function loginAllowed(ip) {
  const a = attempts.get(ip);
  return !a || a.count < 5 || Date.now() > a.until;
}
export function recordLogin(ip, ok) {
  if (ok) return void attempts.delete(ip);
  const a = attempts.get(ip);
  const fresh = !a || Date.now() > a.until;
  attempts.set(ip, { count: fresh ? 1 : a.count + 1, until: Date.now() + 10 * 60000 });
  if (attempts.size > 5000) attempts.clear();
}

export function loginPage(message = '') {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html>
<html lang="${getLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t('Đăng nhập')} — Class Recorder</title>
<style>
  :root { --bg: #f5f6f8; --card: #fff; --text: #1b2130; --muted: #5f6b7e; --border: #dfe3ea; --accent: #2456d6; --danger: #c0271b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #12151c; --card: #1b202b; --text: #e7eaf0; --muted: #9aa4b5; --border: #2d3442; --accent: #6d95f5; --danger: #ff8a7d; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
  form { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 28px; width: min(360px, 92vw); }
  h1 { font-size: 1.2rem; margin: 0 0 18px; }
  label { display: block; font-weight: 550; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px 12px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
  button { margin-top: 16px; width: 100%; padding: 10px; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
  p { color: var(--danger); margin: 12px 0 0; }
</style></head>
<body><form method="post" action="/login">
  <h1>Class Recorder</h1>
  <label>${t('Mật khẩu')}<input type="password" name="password" autofocus autocomplete="current-password" required></label>
  <button type="submit">${t('Đăng nhập')}</button>
  ${message ? `<p>${esc(message)}</p>` : ''}
</form></body></html>`;
}
