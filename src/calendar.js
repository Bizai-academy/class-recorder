import ical from 'node-ical';
import { makeSchedule, loadSchedules, saveSchedules, dayKey } from './schedule.js';

/**
 * Đồng bộ Google Calendar → lịch ghi tự động, qua "địa chỉ bí mật ở định dạng iCal" của lịch (chỉ đọc, không cần cấp quyền tài khoản).
 * Sự kiện trong 36 giờ tới có link Zoom/Meet (và có từ khoá trong tên, nếu đặt) → một mục lịch ghi một-lần, bắt đầu sớm vài phút.
 * Mục lịch tạo từ lịch Google mang source:'calendar'; sự kiện bị huỷ/dời thì mục tương ứng (chưa chạy) được gỡ hoặc sửa theo.
 */

const LINK_RX = /https?:\/\/(?:[\w-]+\.)*(?:zoom\.us|zoom\.com|zoomgov\.com)\/(?:j|w|wc\/join|my)\/[^\s"'<>\\,)]+|https?:\/\/meet\.google\.com\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}[^\s"'<>\\,)]*/i;
const pad = (n) => String(n).padStart(2, '0');

function findLink(ev) {
  const fields = [ev.location, ev.description, ev.url, ev['GOOGLE-CONFERENCE'], ev['X-GOOGLE-CONFERENCE']];
  for (const f of fields) {
    const v = typeof f === 'string' ? f : f && typeof f === 'object' ? f.val || f.params?.VALUE || '' : '';
    const m = LINK_RX.exec(String(v).replace(/\\n/g, '\n'));
    if (m) return m[0];
  }
  return null;
}

const textOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.val || '' : '');

/** Các buổi (bắt đầu trong khoảng [from, to]) từ nội dung ICS: { key, title, start, link }. */
export function upcomingFromIcs(icsText, { from, to, keyword = '' }) {
  const data = ical.sync.parseICS(icsText);
  const kw = keyword.trim().toLowerCase();
  const out = [];
  for (const ev of Object.values(data)) {
    if (ev.type !== 'VEVENT' || !ev.start) continue;
    if (String(ev.status || '').toUpperCase() === 'CANCELLED') continue;
    const title = textOf(ev.summary).trim() || 'Buổi học';
    if (kw && !title.toLowerCase().includes(kw)) continue;
    const baseLink = findLink(ev);
    const starts = [];
    if (ev.rrule) {
      // Lịch lặp lại: lấy các lần trong khoảng, bỏ các ngày đã huỷ (EXDATE), dùng bản đã sửa riêng nếu có (RECURRENCE-ID).
      const dur = ev.end ? ev.end - ev.start : 0;
      for (const d of ev.rrule.between(new Date(from - dur - 86400000), new Date(to + 86400000), true)) {
        // node-ical/rrule trả về giờ "nổi": dựng lại đúng giờ địa phương của lần đầu cho từng ngày.
        const occ = new Date(d.getFullYear(), d.getMonth(), d.getDate(), ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds());
        const dk = occ.toISOString().slice(0, 10);
        if (ev.exdate && Object.keys(ev.exdate).some((k) => k.startsWith(dk) || ev.exdate[k]?.toISOString?.().slice(0, 10) === dk)) continue;
        const override = ev.recurrences && Object.entries(ev.recurrences).find(([k]) => k.startsWith(dk))?.[1];
        if (override) {
          if (String(override.status || '').toUpperCase() === 'CANCELLED') continue;
          starts.push({ start: override.start, title: textOf(override.summary).trim() || title, link: findLink(override) || baseLink });
        } else {
          starts.push({ start: occ, title, link: baseLink });
        }
      }
    } else {
      starts.push({ start: ev.start, title, link: baseLink });
    }
    for (const s of starts) {
      const t = s.start.getTime();
      if (!s.link || t < from || t > to) continue;
      out.push({ key: `${ev.uid}@${t}`, title: s.title, start: new Date(t), link: s.link });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Đồng bộ danh sách lịch ghi với các sự kiện sắp tới. Trả về { added, updated, removed, events }.
 * `icsText` cho phép kiểm thử không cần mạng; bình thường để trống để tải từ `url`.
 */
export async function syncCalendar({ url, keyword = '', leadMin = 5, now = new Date(), icsText = null } = {}) {
  if (!icsText) {
    if (!/^https:\/\//i.test(url || '')) throw new Error('Địa chỉ lịch phải bắt đầu bằng https://');
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Không tải được lịch (HTTP ${res.status}). Kiểm tra lại địa chỉ bí mật iCal.`);
    icsText = await res.text();
    if (!/BEGIN:VCALENDAR/.test(icsText)) throw new Error('Địa chỉ này không trả về lịch iCal. Hãy dùng "Địa chỉ bí mật ở định dạng iCal".');
  }
  const events = upcomingFromIcs(icsText, { from: now.getTime(), to: now.getTime() + 36 * 3600000, keyword });
  const list = loadSchedules();
  const want = new Map();
  for (const e of events) {
    const at = new Date(e.start.getTime() - leadMin * 60000);
    want.set(e.key, { e, date: dayKey(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` });
  }
  let added = 0;
  let updated = 0;
  let removed = 0;
  const kept = [];
  for (const s of list) {
    if (s.source !== 'calendar') {
      kept.push(s);
      continue;
    }
    const w = want.get(s.calKey);
    if (w) {
      if (s.url !== w.e.link || s.date !== w.date || s.time !== w.time || s.title !== w.e.title) {
        Object.assign(s, { url: w.e.link, date: w.date, time: w.time, title: w.e.title });
        updated++;
      }
      want.delete(s.calKey);
      kept.push(s);
    } else if (s.lastFired || new Date(`${s.date}T${s.time}`) < now) {
      // Đã chạy hoặc đã qua: giữ lại để thấy lịch sử, dọn sau 7 ngày.
      if (now - new Date(`${s.date}T00:00`) < 7 * 86400000) kept.push(s);
    } else {
      removed++; // sự kiện đã bị huỷ, dời ra ngoài khoảng, hoặc đổi tên không còn khớp từ khoá
    }
  }
  for (const [key, w] of want) {
    try {
      const s = makeSchedule({ url: w.e.link, title: w.e.title, time: w.time, date: w.date });
      kept.push({ ...s, source: 'calendar', calKey: key });
      added++;
    } catch {
      /* link không được hỗ trợ — bỏ qua */
    }
  }
  saveSchedules(kept);
  return { added, updated, removed, events: events.length };
}
