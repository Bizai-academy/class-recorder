import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { listSessions, sessionDir, readStatus } from './control.js';
import { writeJsonAtomic } from './util.js';

/**
 * Dọn buổi ghi cũ và theo dõi dung lượng đĩa.
 *  - Buổi cũ hơn N ngày: mặc định chỉ xoá video và file trung gian (giữ phiên âm, tóm tắt để vẫn tìm kiếm/hỏi đáp được);
 *    hoặc xoá hẳn cả buổi nếu người dùng chọn.
 *  - Đĩa còn ít hơn ngưỡng (GB) thì báo.
 */

const VIDEO_FILES = ['recording.webm', 'recording.mp4', 'audio.wav', 'live.jpg'];
const VIDEO_DIRS = ['parts', 'audio', 'debug'];

const dirSize = (p) => {
  let total = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      total += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
    }
  } catch {
    /* không đọc được — bỏ qua */
  }
  return total;
};

/** Dung lượng còn trống (byte) của ổ chứa dữ liệu, hoặc null nếu không đo được. */
export function diskFree(dir = config.dataDir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** Dọn các buổi cũ hơn `days` ngày. Trả về { cleaned: [{id,title,freed}], freed }. days <= 0 → không làm gì. */
export function cleanupOldSessions({ days, keepText = true, now = Date.now() } = {}) {
  const cleaned = [];
  if (!(days > 0)) return { cleaned, freed: 0 };
  const cutoff = now - days * 86400000;
  for (const id of listSessions()) {
    const dir = sessionDir(id);
    const st = readStatus(dir);
    if (!st || st.running || !st.startedAt || Date.parse(st.startedAt) > cutoff) continue;
    if (keepText) {
      if (st.videoRemoved) continue;
      let freed = 0;
      for (const f of VIDEO_FILES) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) {
          freed += fs.statSync(p).size;
          fs.rmSync(p, { force: true });
        }
      }
      for (const d of VIDEO_DIRS) {
        const p = path.join(dir, d);
        if (fs.existsSync(p)) {
          freed += dirSize(p);
          fs.rmSync(p, { recursive: true, force: true });
        }
      }
      delete st.running;
      st.videoRemoved = new Date(now).toISOString();
      if (st.outputs) st.outputs.recording = null;
      writeJsonAtomic(path.join(dir, 'status.json'), st);
      cleaned.push({ id, title: st.title || id, freed });
    } else {
      const freed = dirSize(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      cleaned.push({ id, title: st.title || id, freed });
    }
  }
  return { cleaned, freed: cleaned.reduce((s, c) => s + c.freed, 0) };
}
