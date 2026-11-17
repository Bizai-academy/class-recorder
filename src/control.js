import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { t } from './i18n.js';
import { readJson, isAlive } from './util.js';

/**
 * Kênh điều khiển bằng file: tiến trình ghi hình đọc lệnh trong <phiên>/control/*.json.
 * Nhờ vậy lệnh `rejoin` / `stop` có thể gửi từ bất kỳ tiến trình nào (người dùng, Mausbot, cron...).
 */

export function sessionDir(id) {
  return path.join(paths.sessions(), id);
}

export function listSessions() {
  try {
    return fs
      .readdirSync(paths.sessions(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** id có thể là mã phiên, đường dẫn thư mục phiên, hoặc bỏ trống (= phiên đang chạy, nếu không có thì phiên mới nhất). */
export function resolveSession(id) {
  if (id) {
    const dir = fs.existsSync(id) && fs.statSync(id).isDirectory() ? path.resolve(id) : sessionDir(id);
    if (!fs.existsSync(dir)) throw new Error(t('Không tìm thấy phiên: {id}', { id }));
    return dir;
  }
  const active = readJson(paths.active());
  if (active?.dir && fs.existsSync(active.dir)) return active.dir;
  const all = listSessions();
  if (!all.length) throw new Error(t('Chưa có phiên ghi hình nào.'));
  return sessionDir(all[0]);
}

export function sendCommand(dir, cmd) {
  const d = path.join(dir, 'control');
  fs.mkdirSync(d, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmp = path.join(d, `${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ ...cmd, at: new Date().toISOString() }));
  fs.renameSync(tmp, path.join(d, `${name}.json`));
}

export function drainCommands(dir) {
  const d = path.join(dir, 'control');
  let files;
  try {
    files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const full = path.join(d, f);
    const cmd = readJson(full);
    fs.rmSync(full, { force: true });
    if (cmd && cmd.cmd) out.push(cmd);
  }
  return out;
}

export function readStatus(dir) {
  const s = readJson(path.join(dir, 'status.json'));
  if (!s) return null;
  s.running = isAlive(s.pid) && !['done', 'error'].includes(s.phase);
  return s;
}
