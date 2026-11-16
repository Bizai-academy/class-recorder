import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { sleep, slugify, stamp, makeLogger, writeJsonAtomic, readJson } from './util.js';
import { launchBrowser } from './browser.js';
import { Capture } from './capture.js';
import { ensureDisplay } from './display.js';
import { pickPlatform } from './platforms/index.js';
import { sessionDir, drainCommands } from './control.js';
import { postprocess } from './post.js';
import { notify, publicLink } from './notify.js';
import { detectSpeakers, pickInstructor } from './speakers.js';

const roundSpeakers = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)]).sort((a, b) => b[1] - a[1]));

const min = (m) => m * 60000;

const END_TEXT = {
  stopped: 'Dừng theo lệnh',
  room_closed: 'Phòng học đã đóng',
  room_empty: 'Phòng không còn ai',
  room_silent: 'Phòng im lặng quá lâu',
  never_opened: 'Hết thời gian chờ mà phòng không mở',
  needs_login: 'Phòng yêu cầu đăng nhập — chạy `classrec login` rồi thử lại',
  bot_blocked: 'Phòng này không cho bot tự động tham gia — hãy xin bản ghi hoặc xin phép người tổ chức',
  max_duration: 'Chạm giới hạn thời lượng tối đa',
  browser_closed: 'Trình duyệt bị đóng',
  error: 'Lỗi',
};

/**
 * Chạy trọn một buổi học: chờ phòng mở → vào → ghi → (rejoin nếu có lệnh) → phòng đóng → xuất file + tóm tắt.
 * Trả về nội dung status.json cuối cùng.
 */
export async function runSession(o) {
  const title = o.title || 'Buổi học';
  const sessionId = o.sessionId || `${stamp()}-${slugify(title)}`;
  const dir = sessionDir(sessionId);
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'debug'), { recursive: true });
  const log = makeLogger(dir, { echo: o.echo !== false });
  // Thông báo hiện trên trình duyệt. Bài tự kiểm thử truyền notify: false để không lẫn vào chuông thông báo thật.
  const tell = (text) => (o.notify === false ? Promise.resolve(false) : notify(text, { log }));

  const st = {
    sessionId,
    dir,
    pid: process.pid,
    title,
    profile: o.profile || 'default',
    platform: null,
    url: o.url,
    phase: 'starting',
    state: null,
    message: 'Đang khởi động',
    startedAt: new Date().toISOString(),
    updatedAt: null,
    segments: [],
    outputs: {},
    endReason: null,
  };
  const save = (patch = {}) => {
    Object.assign(st, patch, { updatedAt: new Date().toISOString() });
    writeJsonAtomic(path.join(dir, 'status.json'), st);
  };
  const setPhase = (phase, message) => {
    if (st.phase !== phase || st.message !== message) save({ phase, message });
  };
  save();
  writeJsonAtomic(paths.active(), { sessionId, dir, pid: process.pid });

  let stopSignal = false;
  const onSignal = () => {
    stopSignal = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const segments = [];
  const speakerSec = {}; // tên → số giây được giao diện phòng họp đánh dấu là đang nói
  const tickSec = (o.tickMs || 3000) / 1000;
  let trimFrom = null; // mốc thời gian bot bắt đầu ngồi một mình / phòng bắt đầu im lặng → cắt bỏ phần đuôi video từ đây
  let display = null;
  let context = null;
  let endReason = null;
  let failure = null;

  try {
    display = await ensureDisplay(log);
    const b = await launchBrowser({ profile: o.profile, log });
    context = b.context;
    let page = b.page;
    const capture = new Capture(context, log);

    const ctx = {
      name: o.name || config.botName,
      passcode: o.passcode || '',
      acceptTerms: config.acceptTerms,
      meetWaitForOthers: config.meetWaitForOthers,
    };
    const hardDeadline = Date.now() + config.maxHours * 3600000;
    let platform = null;
    let room = null;
    let lastState = null;
    let lastNav = 0;
    let unknownSince = null;
    let aloneSince = null;
    let joinAttempts = 0;
    let snapN = 0;
    let lastLive = 0;
    let notifiedJoin = false;
    let lastSpeakerAt = 0;
    let lastSpeakerSave = 0;
    let soundTicks = 0;
    let keepUntil = 0;
    let silenceFloor = 0;
    let attnKey = null;
    let lastSoundAt = Date.now();
    let silentLogged = false;
    let lastPeople;
    let lastAudioKey = '';

    const snapshot = async (label) => {
      if (snapN >= 80 || page.isClosed()) return;
      snapN++;
      await page.screenshot({ path: path.join(dir, 'debug', `${String(snapN).padStart(3, '0')}-${label}.png`), timeout: 5000 }).catch(() => {});
    };
    const navigate = async () => {
      lastNav = Date.now();
      await page.goto(platform.joinUrl(room.url), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log(`Không tải được trang: ${e.message.split('\n')[0]}`));
    };
    const openRoom = async (url) => {
      platform = pickPlatform(url);
      room = { url, deadline: Date.now() + min(config.waitOpenMin), closedAt: null, graceUntil: null, reentryAt: null, noRetry: false, enteredAt: null, sawOthers: false, heardSound: false };
      keepUntil = 0;
      silenceFloor = 0;
      lastState = null;
      unknownSince = null;
      aloneSince = null;
      joinAttempts = 0;
      save({ platform: platform.id, url, phase: 'waiting_open', message: 'Đang chờ phòng mở' });
      log(`Mở phòng [${platform.id}] ${url}`);
      await navigate();
    };
    const endSegment = async () => {
      const seg = await capture.stop();
      if (seg) {
        segments.push(seg);
        save({ segments: segments.map((s) => ({ file: path.basename(s.file), startedAt: new Date(s.startedAt).toISOString(), endedAt: new Date(s.endedAt).toISOString(), bytes: s.bytes })) });
      }
    };
    const startSegment = async () => {
      const file = path.join(dir, 'parts', `part-${String(segments.length + 1).padStart(3, '0')}.webm`);
      try {
        await capture.start(page, file);
        lastSoundAt = Date.now();
        silentLogged = false;
        return true;
      } catch (e) {
        log(`Chưa bắt đầu ghi được: ${e.message.split('\n')[0]}`);
        return false;
      }
    };

    await openRoom(o.url);

    while (!endReason) {
      await sleep(o.tickMs || 3000);
      if (stopSignal) {
        endReason = 'stopped';
        break;
      }

      // 1) Lệnh điều khiển
      for (const cmd of drainCommands(dir)) {
        if (cmd.cmd === 'stop') {
          log('Nhận lệnh stop');
          endReason = 'stopped';
          // Dừng trong lúc bot đang báo "một mình / im lặng" → phần đuôi từ lúc đó là phòng trống, cắt bỏ.
          if (st.attention) trimFrom = Date.parse(st.attention.since);
        } else if (cmd.cmd === 'rejoin' && cmd.url) {
          try {
            pickPlatform(cmd.url);
          } catch (e) {
            log(`Bỏ qua lệnh rejoin: ${e.message}`);
            continue;
          }
          log(`Nhận lệnh rejoin → ${cmd.url}`);
          await endSegment();
          if (cmd.passcode !== undefined) ctx.passcode = cmd.passcode;
          await openRoom(cmd.url);
        } else if (cmd.cmd === 'keep') {
          const mins = config.aloneMin > 0 ? config.aloneMin : 1;
          keepUntil = Date.now() + min(mins);
          log(`Người dùng chọn chờ thêm ${mins} phút`);
        }
      }
      if (endReason) break;
      if (Date.now() > hardDeadline) {
        endReason = 'max_duration';
        break;
      }

      // 2) Tab bị đóng → mở lại
      if (page.isClosed()) {
        try {
          await endSegment();
          page = await context.newPage();
          await navigate();
        } catch {
          endReason = 'browser_closed';
          break;
        }
        continue;
      }

      // 3) Nhận diện trạng thái phòng
      const state = await platform.detect(page, ctx).catch(() => 'unknown');
      const now = Date.now();
      if (state !== lastState) {
        log(`Trạng thái: ${lastState ?? '-'} → ${state}`);
        await snapshot(state);
        lastState = state;
        save({ state });
      }
      if (state !== 'unknown') unknownSince = null;

      // Ảnh "bot đang thấy gì" cho giao diện: chụp lại mỗi 10 giây (ảnh trong debug/ chỉ chụp khi đổi trạng thái).
      if (now - lastLive > 10000) {
        lastLive = now;
        const tmp = path.join(dir, 'live.tmp.jpg');
        await page
          .screenshot({ path: tmp, type: 'jpeg', quality: 60, timeout: 5000 })
          .then(() => fs.renameSync(tmp, path.join(dir, 'live.jpg')))
          .catch(() => {});
      }

      if (state === 'in_meeting') {
        if (room.closedAt) {
          // Vào lại được cùng link sau khi phòng đã đóng. Chưa chắc lớp mở lại: Zoom cho vào cả phòng host đã kết thúc.
          room.reentryAt = now;
          room.closedAt = null;
        }
        joinAttempts = 0;
        if (capture.stalled()) {
          log('Luồng ghi bị đứng — tạo đoạn ghi mới');
          await endSegment();
        }
        if (!capture.active && (await startSegment())) {
          setPhase('recording', 'Đang ghi hình');
          if (!notifiedJoin) {
            notifiedJoin = true;
            tell(`🎥 Bot đã vào lớp "${title}" và đang ghi hình.`);
          }
        }
        await platform.upkeep(page, ctx).catch(() => {});

        // Theo dõi số người và tiếng trong phòng.
        const people = await platform.participantCount(page).catch(() => null);
        if (people !== lastPeople) {
          if (people !== null) log(`Số người trong phòng: ${people}`);
          lastPeople = people;
        }
        const level = await capture.level();
        const hasSound = level !== null && level > 0.003;
        if (hasSound) {
          if (silentLogged) log('Phòng có tiếng trở lại');
          silentLogged = false;
          lastSoundAt = now;
          // Ai đang nói (đọc từ giao diện phòng họp). Nhiều hơn 2 người cùng "đang nói" thì bỏ qua lượt này cho khỏi nhiễu.
          const names = await detectSpeakers(page, ctx.name).catch(() => []);
          if (names.length && names.length <= 2) {
            const step = (now - (lastSpeakerAt || now - tickSec * 1000)) / 1000;
            for (const n of names) {
              if (!(n in speakerSec)) log(`Nhận diện người nói: ${n}`);
              speakerSec[n] = (speakerSec[n] || 0) + Math.min(step, tickSec * 3);
            }
          }
          lastSpeakerAt = now;
          soundTicks++;
          if (soundTicks === 200 && !Object.keys(speakerSec).length) log('Chưa nhận diện được người đang nói trên giao diện phòng này — sẽ không đoán được giảng viên');
          if (now - lastSpeakerSave > 30000 && Object.keys(speakerSec).length) {
            lastSpeakerSave = now;
            save({ speakers: roundSpeakers(speakerSec) });
          }
        } else {
          lastSpeakerAt = 0;
        }
        const silentSec = level === null ? null : Math.max(0, Math.round((now - lastSoundAt) / 1000));
        if (silentSec !== null && silentSec > 120 && !silentLogged) {
          log('Phòng im lặng hơn 2 phút');
          silentLogged = true;
        }
        if (room.reentryAt) {
          if ((people !== null && people >= 2) || hasSound) {
            room.reentryAt = null;
            log('Phòng đã mở lại và có người — ghi tiếp');
          } else if (now - room.reentryAt > (o.reentryWaitMs || 60000)) {
            log('Vào lại được link cũ nhưng phòng trống — rời phòng và chờ lệnh đổi phòng');
            const seg = await capture.stop();
            if (seg) fs.rmSync(seg.file, { force: true }); // đoạn ghi phòng trống, không đưa vào video
            room.noRetry = true;
            room.reentryAt = null;
            room.closedAt = now;
            room.deadline = Math.max(room.graceUntil || 0, now + 10000);
            await page.goto('about:blank').catch(() => {});
            lastState = null;
            setPhase('grace', 'Phòng đã đóng. Chờ lệnh đổi phòng');
            continue;
          }
        }

        // Phòng đã từng có người / có tiếng chưa — để phân biệt "lớp chưa bắt đầu" với "lớp đã tan".
        room.enteredAt ??= now;
        if (people !== null && people >= 2) room.sawOthers = true;
        if (hasSound) room.heardSound = true;

        // Hết khoảng "chờ thêm" mà người dùng đã chọn → đếm lại từ đầu.
        if (keepUntil && now >= keepUntil) {
          keepUntil = 0;
          aloneSince = null;
          silenceFloor = now;
        }
        const keeping = now < keepUntil;
        let attention = null; // tình huống cần người dùng quyết định: { reason, since, autoEndAt }

        // (a) Chỉ còn một mình sau khi phòng đã từng có người: báo cho người dùng, quá ALONE_MIN không ai chọn thì tự kết thúc.
        if (people === 1 && room.sawOthers) {
          aloneSince ??= now;
          const autoEndAt = aloneSince + min(config.aloneMin);
          if (!keeping) {
            if (now > autoEndAt) {
              log(`Chỉ còn một mình trong phòng hơn ${config.aloneMin} phút — coi như lớp đã tan`);
              endReason = 'room_empty';
              trimFrom = aloneSince;
            } else if (now - aloneSince > (o.attentionAfterMs || 60000)) {
              attention = { reason: 'alone', since: aloneSince, autoEndAt };
            }
          }
        } else {
          aloneSince = null;
        }

        // (b) Không đếm được số người → dựa vào sự im lặng tuyệt đối (sau khi phòng đã từng có tiếng).
        if (!endReason && !keeping && people === null && room.heardSound && silentSec !== null) {
          const from = Math.max(lastSoundAt, silenceFloor);
          const autoEndAt = config.silenceEndMin > 0 ? from + min(config.silenceEndMin) : null;
          if (autoEndAt && now > autoEndAt) {
            log(`Phòng im lặng tuyệt đối hơn ${config.silenceEndMin} phút — coi như lớp đã tan`);
            endReason = 'room_silent';
            trimFrom = from;
          } else if (now - from > 5 * 60000) {
            attention = { reason: 'silent', since: from, autoEndAt };
          }
        }

        // (c) Vào phòng đã lâu mà chưa từng thấy ai hay nghe thấy gì → lớp không diễn ra.
        if (!endReason && !room.sawOthers && !room.heardSound && now - room.enteredAt > min(config.waitOpenMin)) {
          log(`Ở trong phòng hơn ${config.waitOpenMin} phút mà không có ai — kết thúc`);
          endReason = 'room_empty';
        }

        const attnNow = attention ? `${attention.reason}|${attention.since}` : null;
        if (attnNow !== attnKey) {
          attnKey = attnNow;
          if (attention) {
            const what = attention.reason === 'alone' ? 'Bot đang ở một mình trong phòng' : 'Phòng im lặng hơn 5 phút';
            log(`${what} — chờ người dùng quyết định`);
            const until = attention.autoEndAt ? ` Không chọn thì bot tự dừng lúc ${new Date(attention.autoEndAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.` : '';
            tell(`⚠️ Lớp "${title}": ${what.toLowerCase()}, có vẻ lớp đã tan. Mở Class Recorder để chọn dừng ghi hay chờ tiếp.${until}${publicLink() ? `\n${publicLink()}` : ''}`);
          }
        }
        const audioKey = `${people}|${silentSec === null ? 'x' : silentSec < 20 ? 's' : Math.floor(silentSec / 60)}|${attnNow}`;
        if (audioKey !== lastAudioKey) {
          lastAudioKey = audioKey;
          save({
            participants: people,
            audio: silentSec === null ? null : { silentSeconds: silentSec },
            attention: attention ? { reason: attention.reason, since: new Date(attention.since).toISOString(), autoEndAt: attention.autoEndAt ? new Date(attention.autoEndAt).toISOString() : null } : null,
          });
        }
        continue;
      }

      // Không còn ở trong phòng → không còn gì cần người dùng quyết định.
      if (st.attention) {
        attnKey = null;
        lastAudioKey = '';
        save({ attention: null });
      }

      // 4) Không (còn) ở trong phòng
      if (capture.active) {
        if (state === 'unknown') {
          // Có thể giao diện chỉ đổi tạm thời — cứ ghi tiếp một lúc rồi mới kết luận.
          unknownSince ??= now;
          if (now - unknownSince < 90000) continue;
        }
        await endSegment();
        room.closedAt = now;
        if (state === 'ended' && config.graceMin <= 0) {
          endReason = 'room_closed';
          break;
        }
        room.deadline = now + min(Math.max(config.graceMin, state === 'ended' ? 0 : 2));
        room.graceUntil = room.deadline;
        const mins = Math.round((room.deadline - now) / 60000);
        setPhase('grace', `Đã rời phòng (${state}). Chờ lệnh rejoin hoặc phòng mở lại trong ~${mins} phút`);
        log(st.message);
      }

      if (now > room.deadline) {
        endReason = segments.length ? 'room_closed' : 'never_opened';
        break;
      }

      const waitingPhase = room.closedAt ? 'grace' : 'waiting_open';
      switch (state) {
        case 'prejoin':
          joinAttempts++;
          if (joinAttempts > 8 && now - lastNav > 30000) {
            joinAttempts = 0;
            await navigate();
            break;
          }
          if (!room.closedAt) setPhase('joining', 'Đang vào phòng');
          await platform.join(page, ctx).catch((e) => log(`Lỗi khi vào phòng: ${e.message.split('\n')[0]}`));
          break;
        case 'waiting_room':
          if (!room.closedAt) setPhase('waiting_admit', 'Đã xin vào, đang chờ được duyệt');
          break;
        case 'bot_blocked':
          // Chặn có chủ đích: kết thúc ngay, không thử lại, không tìm cách vượt qua.
          log('Phòng chặn bot tự động — dừng lại');
          endReason = 'bot_blocked';
          break;
        case 'needs_login':
          endReason = 'needs_login';
          break;
        case 'ended':
          if (!room.closedAt) setPhase(waitingPhase, 'Phòng đang đóng — chờ mở');
          // Trước khi vào được lần đầu: luôn thử lại (đang chờ phòng mở). Sau khi phòng đóng: chỉ thử lại nếu được bật.
          if ((!room.closedAt || (config.retrySameLink && !room.noRetry)) && now - lastNav > 30000) await navigate();
          break;
        case 'not_started':
        case 'denied':
        case 'invalid':
          if (!room.closedAt) {
            setPhase(waitingPhase, state === 'not_started' ? 'Phòng chưa mở — đang chờ' : state === 'denied' ? 'Bị từ chối/không ai duyệt — sẽ thử lại' : 'Link có vẻ không hợp lệ — sẽ thử lại (gửi rejoin nếu có link đúng)');
          }
          if (now - lastNav > 30000) await navigate();
          break;
        default:
          unknownSince ??= now;
          if (!room.noRetry && now - unknownSince > 45000 && now - lastNav > 45000) {
            unknownSince = null;
            await navigate();
          }
      }
    }

    await endSegment();
    await context.close().catch(() => {});
    context = null;
  } catch (e) {
    failure = e;
    endReason = 'error';
    log(`LỖI: ${e.stack || e.message}`);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (context) await context.close().catch(() => {});
    if (display) display.stop();
  }

  for (const f of ['live.jpg', 'live.tmp.jpg']) fs.rmSync(path.join(dir, f), { force: true });

  // Hậu kỳ: luôn cố xuất những gì đã ghi được, kể cả khi phiên kết thúc do lỗi.
  log(`Kết thúc phiên: ${END_TEXT[endReason] || endReason}`);
  save({ phase: 'finalizing', endReason, message: 'Đang xử lý file ghi hình', attention: null });
  // Lớp tan mà phòng không đóng: đoạn cuối video là phòng trống → chỉ giữ tới lúc mọi người rời đi (cộng một ít dư).
  let trimLastSeconds = null;
  const lastSeg = segments.at(-1);
  if (trimFrom && lastSeg && trimFrom > lastSeg.startedAt) {
    const keep = (trimFrom - lastSeg.startedAt + (o.trimMarginMs ?? 20000)) / 1000;
    if (keep < (lastSeg.endedAt - lastSeg.startedAt) / 1000 - 8) {
      trimLastSeconds = Math.round(keep);
      log(`Cắt bỏ phần đuôi phòng trống: giữ ${trimLastSeconds}s đầu của đoạn ghi cuối`);
    }
  }

  // Đoán giảng viên = người nói lâu nhất trong buổi.
  let instructor = null;
  if (Object.keys(speakerSec).length) {
    const pick = pickInstructor(speakerSec, { minSeconds: o.speakerMinSeconds ?? 60 });
    instructor = pick ? pick.name : null;
    save({ speakers: roundSpeakers(speakerSec), instructor, instructorAuto: !!instructor });
    log(pick ? `Đoán giảng viên: ${pick.name} (nói ${Math.round(pick.seconds / 60)} phút, ${Math.round(pick.share * 100)}% thời gian có người nói)` : 'Không đủ dữ liệu để đoán giảng viên');
  }

  let outputs = {};
  try {
    outputs = await postprocess(dir, {
      instructor,
      trimLastSeconds,
      parts: segments.map((s) => s.file),
      title,
      startedAt: st.startedAt,
      log,
      withSummary: o.summary !== false,
      onProgress: (message) => save({ message }),
    });
  } catch (e) {
    log(`LỖI hậu kỳ: ${e.stack || e.message}`);
    failure = failure || e;
  }

  const lostRecording = segments.length > 0 && !outputs.recording;
  if (lostRecording) failure = failure || new Error('Đã ghi nhưng không xuất được file — các đoạn gốc vẫn nằm trong thư mục parts/');
  const ok = !failure && !['never_opened', 'needs_login', 'bot_blocked'].includes(endReason);
  save({
    phase: ok ? 'done' : 'error',
    outputs,
    message: failure ? `${END_TEXT[endReason] || endReason}: ${failure.message.split('\n')[0]}` : END_TEXT[endReason] || endReason,
  });
  {
    // Thông báo kết quả: chỉ tên buổi, trạng thái và những gì đã tạo được — không kèm nội dung buổi học.
    const mins = outputs.durationSeconds ? `${Math.round(outputs.durationSeconds / 60)} phút` : null;
    const got = [outputs.recording && 'video', outputs.transcript && 'phiên âm', outputs.summary && 'tóm tắt'].filter(Boolean).join(', ');
    const lines = [`${ok ? '✅' : '❌'} Buổi "${title}": ${st.message}.`, got ? `Đã có: ${got}${mins ? ` (${mins})` : ''}.` : 'Không ghi được gì.', ...(outputs.notes || []).map((n) => `Lưu ý: ${n}`), publicLink()].filter(Boolean);
    await tell(lines.join('\n'));
  }
  const active = readJson(paths.active());
  if (active?.sessionId === sessionId) fs.rmSync(paths.active(), { force: true });
  return st;
}
