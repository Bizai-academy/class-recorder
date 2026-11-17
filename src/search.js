import { t } from './i18n.js';
import fs from 'node:fs';
import path from 'node:path';
import { listSessions, sessionDir, readStatus } from './control.js';

/**
 * Tìm kiếm toàn văn trong bản phiên âm và bản tóm tắt của mọi buổi đã ghi. Không phân biệt hoa thường và dấu
 * ("dao ham" tìm ra "đạo hàm"). Miễn phí, chạy ngay trên máy chủ.
 */

// Bỏ dấu nhưng giữ đúng số ký tự (mỗi ký tự gốc ↔ một ký tự), để vị trí tìm được dùng lại trên văn bản gốc.
const fold = (s) =>
  Array.from(String(s), (ch) => {
    if (ch === 'đ') return 'd';
    if (ch === 'Đ') return 'd';
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return (base.length === 1 ? base : ch).toLowerCase();
  }).join('');

const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

function snippets(text, needle, { source, max }) {
  const out = [];
  // Mỗi đoạn phiên âm mở đầu bằng [hh:mm:ss]; tóm tắt thì tách theo dòng (mốc thời gian lấy từ dòng nếu có).
  const blocks = source === 'transcript' ? text.split(/\n\s*\n/) : text.split('\n');
  for (const block of blocks) {
    const f = fold(block);
    let i = f.indexOf(needle);
    while (i >= 0 && out.length < max) {
      const m = /\[(\d{1,2}):(\d{2}):(\d{2})\]/.exec(block);
      const t = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
      const start = Math.max(0, i - 80);
      const end = Math.min(block.length, i + needle.length + 80);
      out.push({
        source,
        t,
        before: (start > 0 ? '…' : '') + block.slice(start, i).replace(/^\[\d{1,2}:\d{2}:\d{2}\]\s*/, '').replace(/^#+\s*/, ''),
        match: block.slice(i, i + needle.length),
        after: block.slice(i + needle.length, end) + (end < block.length ? '…' : ''),
      });
      i = f.indexOf(needle, i + needle.length);
    }
    if (out.length >= max) break;
  }
  return out;
}

export function searchSessions(query, { perSession = 5, maxSessions = 30 } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (q.length < 2) throw new Error(t('Nhập ít nhất 2 ký tự để tìm.'));
  if (q.length > 100) throw new Error(t('Từ khoá quá dài.'));
  const needle = fold(q);
  const results = [];
  let total = 0;
  for (const id of listSessions()) {
    const dir = sessionDir(id);
    const st = readStatus(dir) || {};
    const hits = [...snippets(read(path.join(dir, 'transcript.txt')), needle, { source: 'transcript', max: perSession }), ...snippets(read(path.join(dir, 'summary.md')), needle, { source: 'summary', max: perSession })];
    if (!hits.length) continue;
    total += hits.length;
    results.push({ id, title: st.title || id, startedAt: st.startedAt || null, hits: hits.slice(0, perSession) });
    if (results.length >= maxSessions) break;
  }
  return { query: q, total, results };
}
