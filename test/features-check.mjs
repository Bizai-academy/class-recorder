// Kiểm thử các tính năng quản lý: lịch ghi tự động, thông báo webhook, xoá buổi ghi, đổi mật khẩu.
//   node test/features-check.mjs
// Dùng thư mục dữ liệu tạm và file .env tạm nên không đụng tới dữ liệu hay cài đặt thật.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { makeSchedule, dueSchedules, markFired } from '../src/schedule.js';
import { notify, listNotifications, markAllRead } from '../src/notify.js';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { searchSessions } from '../src/search.js';
import { cleanupOldSessions, diskFree } from '../src/cleanup.js';
import { pickInstructor, cleanName } from '../src/speakers.js';

export async function featureChecks() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name: `Quản lý — ${name}`, ok: !!ok, detail });

  /* ── Lịch ghi ── */
  const mk = (o) => makeSchedule({ url: 'https://meet.google.com/abc-defg-hij', title: 'Lớp thử', ...o });
  const mon1925 = new Date(2026, 10, 16, 19, 25, 30); // thứ Hai 16/11/2026 19:25:30
  const weekly = mk({ time: '19:25', days: [1, 3] });
  check('lịch theo thứ: tới giờ thì chạy', dueSchedules([weekly], mon1925).length === 1);
  check('lịch theo thứ: trước giờ thì chưa chạy', dueSchedules([weekly], new Date(2026, 10, 16, 19, 24, 59)).length === 0);
  check('lịch theo thứ: sai thứ thì không chạy', dueSchedules([weekly], new Date(2026, 10, 17, 19, 25, 30)).length === 0);
  check('lịch: trễ trong 10 phút vẫn chạy (máy chủ vừa khởi động lại)', dueSchedules([weekly], new Date(2026, 10, 16, 19, 33)).length === 1);
  check('lịch: trễ quá 10 phút thì bỏ qua', dueSchedules([weekly], new Date(2026, 10, 16, 19, 40)).length === 0);
  const list = [weekly];
  markFired(list, weekly.id, mon1925);
  check('lịch: mỗi ngày chỉ chạy một lần', dueSchedules(list, new Date(2026, 10, 16, 19, 26)).length === 0);
  check('lịch theo thứ: tuần sau chạy lại', dueSchedules(list, new Date(2026, 10, 18, 19, 25, 5)).length === 1);
  const once = mk({ time: '08:00', date: '2026-11-20', days: [1] });
  check('lịch một ngày: chỉ chạy đúng ngày đó', dueSchedules([once], new Date(2026, 10, 20, 8, 1)).length === 1 && dueSchedules([once], new Date(2026, 10, 16, 8, 1)).length === 0);
  const l2 = [once];
  markFired(l2, once.id, new Date(2026, 10, 20, 8, 1));
  check('lịch một ngày: chạy xong tự tắt', once.enabled === false);
  check('lịch tắt thì không chạy', dueSchedules([{ ...weekly, lastFired: null, enabled: false }], mon1925).length === 0);
  const bad = (o) => {
    try {
      mk(o);
      return false;
    } catch {
      return true;
    }
  };
  check('lịch: từ chối giờ sai, thiếu ngày, link không hỗ trợ', bad({ time: '25:00', days: [1] }) && bad({ time: '19:00', days: [] }) && bad({ time: '19:00', days: [1], url: 'https://example.com/x' }));

  /* ── Thông báo (lưu trên máy chủ, hiện trên trình duyệt) ── */
  {
    const tmpN = fs.mkdtempSync(path.join(os.tmpdir(), 'classrec-notif-'));
    const savedDir = config.dataDir;
    config.dataDir = tmpN;
    try {
      check('thông báo: chưa có gì thì danh sách rỗng', listNotifications().length === 0);
      const ok = await notify('Bot đã vào lớp "A"');
      await notify('Buổi "A" kết thúc');
      const l = listNotifications();
      check('thông báo: lưu được, mới nhất nằm đầu, chưa đọc', ok && l.length === 2 && l[0].text === 'Buổi "A" kết thúc' && l.every((n) => !n.read && n.id && n.at));
      markAllRead();
      check('thông báo: đánh dấu đã đọc', listNotifications().every((n) => n.read));
      for (let i = 0; i < 120; i++) await notify(`tb ${i}`);
      check('thông báo: chỉ giữ 100 thông báo gần nhất', listNotifications().length === 100 && listNotifications()[0].text === 'tb 119');
    } finally {
      config.dataDir = savedDir;
      fs.rmSync(tmpN, { recursive: true, force: true });
    }
  }

  /* ── Xoá buổi ghi và đổi mật khẩu (qua máy chủ giao diện, dữ liệu tạm) ── */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'classrec-feat-'));
  const savedData = config.dataDir;
  const savedHash = config.uiPasswordHash;
  const savedHosts = config.uiPublicHosts;
  const settings = await import('../src/settings.js');
  config.dataDir = tmp;
  config.uiPasswordHash = hashPassword('mat-khau-cu-123');
  config.uiPublicHosts = [];
  const sid = '20260101-000000-buoi-thu';
  fs.mkdirSync(path.join(tmp, 'sessions', sid), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sessions', sid, 'status.json'), JSON.stringify({ sessionId: sid, title: 'Buổi thử', phase: 'done', pid: 0, segments: [], outputs: {} }));
  fs.writeFileSync(path.join(tmp, 'sessions', sid, 'recording.webm'), 'x');

  const { startServer } = await import('../src/server.js');
  const PORT = 8798;
  const server = await startServer({ port: PORT, open: false });
  const call = async (method, p, { cookie, token, body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(token ? { 'x-classrec-token': token } : {}), ...(body ? { 'content-type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) }, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
  // writeEnv ghi vào .env thật → trong bài thử, đổi mật khẩu được kiểm tra qua giá trị trong bộ nhớ và khôi phục .env sau đó.
  const envBefore = fs.existsSync(settings.ENV_FILE) ? fs.readFileSync(settings.ENV_FILE) : null;
  try {
    let r = await call('POST', '/login', { body: 'password=mat-khau-cu-123' });
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    r = await call('GET', '/', { cookie });
    const token = /const TOKEN = '([0-9a-f]+)'/.exec(r.text)?.[1];
    check('đăng nhập và lấy được mã của trang', !!cookie && !!token);

    r = await call('POST', '/api/delete-session', { cookie, token, body: { id: '../../x' } });
    check('xoá buổi: từ chối mã buổi không hợp lệ', r.status === 404, String(r.status));
    r = await call('POST', '/api/delete-session', { token, body: { id: sid } });
    check('xoá buổi: chưa đăng nhập thì từ chối', r.status === 401, String(r.status));
    r = await call('POST', '/api/delete-session', { cookie, token, body: { id: sid } });
    check('xoá buổi: xoá được và thư mục buổi biến mất', r.status === 200 && !fs.existsSync(path.join(tmp, 'sessions', sid)), String(r.status));

    r = await call('POST', '/api/schedules', { cookie, token, body: { url: 'https://zoom.us/j/1234567890', title: 'Lịch thử', time: '07:55', days: [2, 4] } });
    const id = r.status === 200 ? JSON.parse(r.text).schedule.id : null;
    r = await call('GET', '/api/schedules', { cookie });
    check('lịch: thêm qua giao diện và đọc lại được', !!id && JSON.parse(r.text).schedules.some((s) => s.id === id && s.time === '07:55'));
    r = await call('POST', '/api/schedules/delete', { cookie, token, body: { id } });
    r = await call('GET', '/api/schedules', { cookie });
    check('lịch: xoá được', JSON.parse(r.text).schedules.length === 0);

    r = await call('POST', '/api/change-password', { cookie, token, body: { current: 'sai', next: 'mat-khau-moi-456' } });
    check('đổi mật khẩu: sai mật khẩu hiện tại thì từ chối', r.status === 403, String(r.status));
    r = await call('POST', '/api/change-password', { cookie, token, body: { current: 'mat-khau-cu-123', next: 'ngan' } });
    check('đổi mật khẩu: mật khẩu mới quá ngắn thì từ chối', r.status === 400, String(r.status));
    r = await call('POST', '/api/change-password', { cookie, token, body: { current: 'mat-khau-cu-123', next: 'mat-khau-moi-456' } });
    check('đổi mật khẩu: thành công, mật khẩu mới dùng được ngay, mật khẩu cũ hết hiệu lực', r.status === 200 && verifyPassword('mat-khau-moi-456', config.uiPasswordHash) && !verifyPassword('mat-khau-cu-123', config.uiPasswordHash), String(r.status));
  } finally {
    server.close();
    if (envBefore) fs.writeFileSync(settings.ENV_FILE, envBefore);
    config.dataDir = savedData;
    config.uiPasswordHash = savedHash;
    config.uiPublicHosts = savedHosts;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  /* ── Tìm kiếm và dọn dẹp (dữ liệu tạm) ── */
  {
    const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), 'classrec-search-'));
    const savedDir = config.dataDir;
    config.dataDir = tmpS;
    const mkSession = (id, daysAgo, transcript, summary) => {
      const d = path.join(tmpS, 'sessions', id);
      fs.mkdirSync(path.join(d, 'parts'), { recursive: true });
      fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({ sessionId: id, title: `Buổi ${id}`, phase: 'done', pid: 0, startedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(), segments: [], outputs: { recording: path.join(d, 'recording.webm') } }));
      fs.writeFileSync(path.join(d, 'recording.webm'), Buffer.alloc(5000));
      fs.writeFileSync(path.join(d, 'parts', 'part-001.webm'), Buffer.alloc(3000));
      fs.writeFileSync(path.join(d, 'transcript.txt'), transcript);
      fs.writeFileSync(path.join(d, 'summary.md'), summary);
    };
    try {
      mkSession('20260101-000000-cu', 40, '[00:00:05] Hôm nay học về Đạo Hàm của hàm số\n\n[00:12:30] Bài tập về nhà là bài số ba', '# Tóm tắt\n- Đạo hàm cơ bản');
      mkSession('20260201-000000-moi', 2, '[00:01:00] Hôm nay học tích phân', '# Tóm tắt\n- Tích phân');
      let r = searchSessions('dao ham');
      check('tìm kiếm: không cần dấu, tìm cả phiên âm lẫn tóm tắt', r.results.length === 1 && r.total === 2 && r.results[0].hits.some((h) => h.source === 'transcript' && h.t === 5 && h.match === 'Đạo Hàm') && r.results[0].hits.some((h) => h.source === 'summary'), JSON.stringify(r.results[0]?.hits?.map((h) => [h.source, h.t, h.match])));
      r = searchSessions('BÀI TẬP');
      check('tìm kiếm: không phân biệt hoa thường, trả đúng mốc thời gian', r.total === 1 && r.results[0].hits[0].t === 750);
      check('tìm kiếm: không có thì trả rỗng', searchSessions('lượng giác').total === 0);
      let threw = false;
      try {
        searchSessions('a');
      } catch {
        threw = true;
      }
      check('tìm kiếm: từ khoá quá ngắn thì báo lỗi', threw);

      check('dọn dẹp: 0 ngày thì không làm gì', cleanupOldSessions({ days: 0 }).cleaned.length === 0);
      const c1 = cleanupOldSessions({ days: 30, keepText: true });
      const oldDir = path.join(tmpS, 'sessions', '20260101-000000-cu');
      check('dọn dẹp: chỉ buổi cũ hơn 30 ngày bị dọn', c1.cleaned.length === 1 && c1.cleaned[0].id === '20260101-000000-cu' && fs.existsSync(path.join(tmpS, 'sessions', '20260201-000000-moi', 'recording.webm')));
      check('dọn dẹp (giữ chữ): xoá video và đoạn ghi, giữ phiên âm + tóm tắt', !fs.existsSync(path.join(oldDir, 'recording.webm')) && !fs.existsSync(path.join(oldDir, 'parts')) && fs.existsSync(path.join(oldDir, 'transcript.txt')) && fs.existsSync(path.join(oldDir, 'summary.md')) && c1.freed === 8000, `freed=${c1.freed}`);
      check('dọn dẹp (giữ chữ): vẫn tìm kiếm được buổi đã dọn video', searchSessions('dao ham').results.length === 1);
      check('dọn dẹp: chạy lại không dọn lại buổi đã dọn', cleanupOldSessions({ days: 30, keepText: true }).cleaned.length === 0);
      const c2 = cleanupOldSessions({ days: 30, keepText: false });
      check('dọn dẹp (xoá hẳn): xoá cả thư mục buổi cũ', c2.cleaned.length === 1 && !fs.existsSync(oldDir) && fs.existsSync(path.join(tmpS, 'sessions', '20260201-000000-moi')));
      check('đo được dung lượng đĩa còn trống', diskFree() > 0);
    } finally {
      config.dataDir = savedDir;
      fs.rmSync(tmpS, { recursive: true, force: true });
    }
  }

  /* ── Đồng bộ lịch Google (lịch mẫu test/fixtures/calendar.ics) ── */
  {
    const { syncCalendar } = await import('../src/calendar.js');
    const { loadSchedules, saveSchedules, makeSchedule: mkS } = await import('../src/schedule.js');
    const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'classrec-cal-'));
    const savedDir = config.dataDir;
    config.dataDir = tmpC;
    try {
      const ics = fs.readFileSync(new URL('./fixtures/calendar.ics', import.meta.url), 'utf8');
      const manual = mkS({ url: 'https://zoom.us/j/1234567890', title: 'Lịch tay', time: '07:00', days: [1] });
      saveSchedules([manual]);
      const now = new Date('2026-11-16T01:00:00Z'); // 08:00 thứ Hai giờ Việt Nam
      let r = await syncCalendar({ icsText: ics, keyword: 'lớp', leadMin: 5, now });
      let cal = loadSchedules().filter((s) => s.source === 'calendar');
      const pad = (n) => String(n).padStart(2, '0');
      const local = new Date(Date.parse('2026-11-16T12:00:00Z') - 5 * 60000); // 19:00 VN trừ 5 phút
      check('lịch Google: thêm đúng buổi lớp sắp tới, sớm 5 phút, lọc theo từ khoá', r.added === 1 && cal.length === 1 && cal[0].title === 'Lớp Toán cao cấp' && cal[0].time === `${pad(local.getHours())}:${pad(local.getMinutes())}` && cal[0].url.includes('meet.google.com'), JSON.stringify(cal.map((s) => [s.title, s.date, s.time])));
      r = await syncCalendar({ icsText: ics, keyword: 'lớp', now });
      check('lịch Google: đồng bộ lại không tạo trùng', r.added === 0 && loadSchedules().filter((s) => s.source === 'calendar').length === 1);
      r = await syncCalendar({ icsText: ics, keyword: '', now });
      check('lịch Google: không đặt từ khoá thì lấy mọi sự kiện có link (bỏ sự kiện không link)', loadSchedules().filter((s) => s.source === 'calendar').length === 2);
      const noClass = ics.replace(/BEGIN:VEVENT\r\nDTSTART;TZID[\s\S]*?END:VEVENT\r\n/, '');
      r = await syncCalendar({ icsText: noClass, keyword: '', now });
      check('lịch Google: sự kiện bị xoá khỏi lịch thì gỡ lịch ghi tương ứng', r.removed === 1 && !loadSchedules().some((s) => s.title === 'Lớp Toán cao cấp'));
      check('lịch Google: không đụng tới lịch ghi đặt tay', loadSchedules().some((s) => s.id === manual.id));
    } finally {
      config.dataDir = savedDir;
      fs.rmSync(tmpC, { recursive: true, force: true });
    }
  }

  /* ── Đoán giảng viên ── */
  check('giảng viên: người nói lâu nhất, đủ lâu và đủ tỉ lệ', pickInstructor({ 'Thầy Nam': 1800, Lan: 300, Huy: 200 })?.name === 'Thầy Nam');
  check('giảng viên: không ai nói đủ lâu thì không đoán', pickInstructor({ A: 30, B: 20 }) === null);
  check('giảng viên: không ai áp đảo thì không đoán', pickInstructor({ A: 400, B: 390, C: 380 }) === null);
  check('giảng viên: bỏ nhãn (Host) khỏi tên', cleanName('Nguyễn Văn A (Host)') === 'Nguyễn Văn A' && cleanName('Lan (Chủ trì)') === 'Lan');

  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await featureChecks();
  for (const r of results) console.log(`${r.ok ? 'ĐẠT ' : 'LỖI '} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const pass = results.every((r) => r.ok);
  console.log(pass ? '\nCác tính năng quản lý hoạt động đúng.' : '\nCó mục chưa đạt.');
  process.exit(pass ? 0 : 1);
}
