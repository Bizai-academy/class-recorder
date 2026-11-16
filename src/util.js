import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slugify(s, max = 40) {
  return (
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'buoi-hoc'
  );
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function hms(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows: file đích đang bị đọc — ghi đè trực tiếp
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    fs.rmSync(tmp, { force: true });
  }
}

export function makeLogger(dir, { echo = true } = {}) {
  const file = dir ? path.join(dir, 'session.log') : null;
  if (file) fs.mkdirSync(dir, { recursive: true });
  return (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    if (echo) console.log(line);
    if (file) {
      try {
        fs.appendFileSync(file, line + '\n');
      } catch {
        /* bỏ qua lỗi ghi log */
      }
    }
  };
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}
