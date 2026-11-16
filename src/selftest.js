import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ROOT, config } from './config.js';
import { stamp } from './util.js';
import { runSession } from './session.js';
import { sessionDir, sendCommand, readStatus } from './control.js';
import { probe, meanVolume, decodeErrors, grabFrame } from './post.js';
import { sttFallbackChecks } from '../test/stt-fallback-check.mjs';
import { featureChecks } from '../test/features-check.mjs';
import { zoomNoticeChecks } from '../test/zoom-notice-check.mjs';
import { parallelChecks } from '../test/parallel-check.mjs';

/**
 * Tự kiểm thử trên chính máy này, không cần lớp học thật:
 * dựng 2 "phòng học" giả lập trên localhost, chờ phòng A mở → vào → ghi → A đóng → nhận lệnh rejoin sang B → ghi → B đóng,
 * rồi kiểm tra file xuất ra có đủ hình + tiếng và đúng thời lượng.
 */
export async function selftest() {
  const html = fs.readFileSync(path.join(ROOT, 'test', 'mock-meeting.html'));
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/mock-meeting')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/mock-meeting`;
  const roomA = `${base}?room=A&open=4&end=10&freq=440`;
  const roomB = `${base}?room=B&open=2&end=8&freq=660`;

  // Rút ngắn các mốc chờ cho bài thử.
  config.waitOpenMin = 1;
  config.graceMin = 0.3;
  config.retrySameLink = false;

  const sessionId = `${stamp()}-selftest`;
  const dir = sessionDir(sessionId);
  let rejoinSent = false;
  let sawAttention = false;
  let keepSent = false;
  let attentionCleared = false;
  let st3;
  let st4;
  let st5;
  let watcher = setInterval(() => {
    const s = readStatus(dir);
    if (!rejoinSent && s && s.segments.length === 1 && s.phase === 'grace') {
      rejoinSent = true;
      sendCommand(dir, { cmd: 'rejoin', url: roomB });
    }
  }, 500);

  let st;
  let st2;
  try {
    st = await runSession({ url: roomA, title: 'selftest', sessionId, summary: false, tickMs: 1000, name: 'Selftest Bot', notify: false });
    clearInterval(watcher);

    // Kịch bản 2: bật "tự thử vào lại link cũ". Phòng C kết thúc, bot vào lại được nhưng phòng trống và im lặng
    // (giống Zoom sau khi host kết thúc) → bot phải tự rời phòng và không đưa đoạn phòng trống vào video.
    config.retrySameLink = true;
    config.graceMin = 0.5;
    st2 = await runSession({ url: `${base}?room=C&open=1&end=6&freq=550`, title: 'selftest-phong-trong', sessionId: `${stamp()}-selftest-b`, summary: false, tickMs: 1000, reentryWaitMs: 8000, name: 'Selftest Bot', notify: false });

    // Kịch bản 3: mọi người rời phòng nhưng phòng không bị kết thúc → bot phải báo "đang một mình", chờ người dùng chọn;
    // chọn "chờ thêm" thì cảnh báo tắt; không ai chọn nữa thì tự kết thúc sau ALONE_MIN.
    config.retrySameLink = false;
    config.aloneMin = 0.2; // 12 giây cho bài thử
    const id3 = `${stamp()}-selftest-c`;
    const dir3 = sessionDir(id3);
    watcher = setInterval(() => {
      const s = readStatus(dir3);
      if (s?.attention?.reason === 'alone') {
        sawAttention = true;
        if (!keepSent) {
          keepSent = true;
          sendCommand(dir3, { cmd: 'keep' });
        }
      } else if (keepSent && s && !s.attention && s.phase === 'recording') {
        attentionCleared = true;
      }
    }, 300);
    st3 = await runSession({ url: `${base}?room=D&open=1&end=600&leave=4`, title: 'selftest-mot-minh', sessionId: id3, summary: false, tickMs: 1000, attentionAfterMs: 3000, trimMarginMs: 2000, name: 'Selftest Bot', notify: false });
    clearInterval(watcher);

    // Kịch bản 4: phòng chặn bot tự động → bot phải dừng ngay, không thử lại, và báo đúng lý do.
    st4 = await runSession({ url: `${base}?room=E&blocked=1`, title: 'selftest-chan-bot', sessionId: `${stamp()}-selftest-d`, summary: false, tickMs: 1000, name: 'Selftest Bot', notify: false });

    // Kịch bản 5: nhiều người nói → đoán giảng viên là người nói lâu nhất.
    st5 = await runSession({ url: `${base}?room=G&open=1&end=14&speakers=${encodeURIComponent('Thầy Nam:3,Lan:1')}`, title: 'selftest-giang-vien', sessionId: `${stamp()}-selftest-e`, summary: false, tickMs: 1000, speakerMinSeconds: 3, name: 'Selftest Bot', notify: false });
  } finally {
    clearInterval(watcher);
    server.close();
  }

  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  check('Đồng hồ âm lượng nhận ra phòng đang có tiếng', st.audio && st.audio.silentSeconds < 20, JSON.stringify(st.audio));
  {
    const log2 = fs.existsSync(path.join(st2.dir, 'session.log')) ? fs.readFileSync(path.join(st2.dir, 'session.log'), 'utf8') : '';
    const left = /phòng trống — rời phòng/.test(log2);
    check('Vào lại phòng đã kết thúc mà trống thì tự rời phòng', left && st2.phase === 'done', `phase=${st2.phase}, endReason=${st2.endReason}`);
    const d2 = st2.outputs.recording ? (await probe(st2.outputs.recording)).duration : null;
    check('Đoạn phòng trống không lọt vào video (mong đợi ~6s)', st2.segments.length === 1 && d2 && d2 < 12, `segments=${st2.segments.length}, ${d2}s`);
  }
  check('Mọi người rời phòng → bot báo "đang một mình" và chờ quyết định', sawAttention, `sawAttention=${sawAttention}`);
  check('Chọn "chờ thêm" thì cảnh báo tắt và bot ghi tiếp', attentionCleared, `attentionCleared=${attentionCleared}`);
  check('Không ai chọn nữa thì bot tự kết thúc (phòng không còn ai)', st3.phase === 'done' && st3.endReason === 'room_empty', `phase=${st3.phase}, endReason=${st3.endReason}`);
  {
    // Bot ngồi một mình thêm ~12 giây trước khi tự kết thúc; đoạn đó phải bị cắt khỏi video.
    const seg = st3.segments[0];
    const wall = seg ? (new Date(seg.endedAt) - new Date(seg.startedAt)) / 1000 : 0;
    const d3 = st3.outputs.recording ? (await probe(st3.outputs.recording)).duration : null;
    check('Phần đuôi phòng trống được cắt khỏi video', d3 && d3 < wall - 6, `ghi ${wall.toFixed(0)}s, video còn ${d3}s`);
  }
  check('Phòng chặn bot: bot dừng ngay và báo đúng lý do', st4.endReason === 'bot_blocked' && st4.phase === 'error' && st4.segments.length === 0 && /không cho bot tự động/.test(st4.message), `endReason=${st4.endReason}, message=${st4.message}`);
  check('Đoán giảng viên = người nói lâu nhất (Thầy Nam nói gấp 3 lần Lan)', st5.instructor === 'Thầy Nam' && st5.instructorAuto === true && st5.speakers && st5.speakers['Thầy Nam'] > st5.speakers['Lan'] && !('Selftest Bot' in st5.speakers), `instructor=${st5.instructor}, speakers=${JSON.stringify(st5.speakers)}`);
  check('Phiên kết thúc bình thường', st.phase === 'done', `phase=${st.phase}, endReason=${st.endReason}`);
  check('Chờ phòng mở rồi mới vào + ghi được 2 đoạn (trước và sau rejoin)', st.segments.length === 2, `segments=${st.segments.length}`);
  check('Đã nhận lệnh rejoin sang phòng B', rejoinSent && /room=B/.test(st.url), st.url);
  const rec = st.outputs.recording;
  check('Có file ghi hình', rec && fs.existsSync(rec), rec || '');
  if (rec && fs.existsSync(rec)) {
    const info = await probe(rec);
    const vol = await meanVolume(rec);
    check('File có hình', info.hasVideo);
    check('File có tiếng', info.hasAudio);
    check('Thời lượng hợp lý (mong đợi ~18s)', info.duration && info.duration > 12 && info.duration < 28, `${info.duration}s`);
    check('Thu được tiếng thật của tab (mong đợi khoảng -15 dB)', vol !== null && vol > -35, `mean_volume=${vol} dB`);
    const errs = await decodeErrors(rec);
    check('Giải mã toàn bộ file không lỗi (cả đoạn sau rejoin)', errs === 0, `${errs} dòng lỗi`);
    const okA = await grabFrame(rec, 4, path.join(dir, 'frame-room-a.png'));
    const okB = await grabFrame(rec, Math.max(1, info.duration - 3), path.join(dir, 'frame-room-b.png'));
    check('Trích được khung hình ở phòng A và phòng B', okA && okB, `A=${okA}, B=${okB}`);
  }
  // Chuỗi phiên âm dự phòng (dịch vụ chính → dự phòng), dùng dịch vụ phiên âm giả trên localhost.
  checks.push(...(await sttFallbackChecks()));
  // Lịch ghi tự động, thông báo, xoá buổi ghi, đổi mật khẩu (dùng dữ liệu tạm).
  checks.push(...(await featureChecks()));
  // Zoom: tự đóng thông báo "đang được ghi" và dải gợi ý che màn hình (trang giả lập).
  checks.push(...(await zoomNoticeChecks()));
  // Ghi hai lớp cùng lúc (hai tiến trình, hai hồ sơ trình duyệt) và điều khiển từng lớp qua giao diện.
  checks.push(...(await parallelChecks()));

  console.log('\n===== KẾT QUẢ TỰ KIỂM THỬ =====');
  for (const c of checks) console.log(`${c.ok ? 'ĐẠT ' : 'LỖI '} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  const pass = checks.every((c) => c.ok);
  console.log(pass ? '\nTất cả đều đạt. Máy này ghi hình được.' : `\nCó mục chưa đạt. Xem log: ${path.join(dir, 'session.log')}`);
  console.log(`Thư mục phiên thử: ${dir}`);
  // Chạy đạt thì dọn hai phiên thử để không lẫn vào danh sách buổi đã ghi; có lỗi thì giữ lại để xem.
  if (pass) for (const d of [dir, st2?.dir, st3?.dir, st4?.dir, st5?.dir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  return pass;
}
