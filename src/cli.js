#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config, paths } from './config.js';
import { sleep, slugify, stamp, makeLogger } from './util.js';
import { sessionDir, listSessions, resolveSession, sendCommand, readStatus } from './control.js';
import { pickPlatform } from './platforms/index.js';

const HELP = `classrec — bot ghi hình lớp học online (Zoom / Google Meet)

  classrec ui [--port 8787] [--no-open]
                                      Mở giao diện trong trình duyệt: ghi hình, xem lại, chỉnh cài đặt (không cần gõ lệnh)

  classrec ui-access [--public-host tên-miền] [--password xxx | --new-password] [--off]
                                      Bật/tắt truy cập giao diện từ xa: đặt mật khẩu đăng nhập và tên miền công khai (dùng trên VPS)
  classrec start <link> [tuỳ chọn]   Chờ phòng mở, vào lớp, ghi hình đến khi phòng đóng, rồi xuất file + tóm tắt
      --title "Tên buổi học"          Tên dùng cho thư mục và bản tóm tắt
      --name "Tên hiển thị"           Tên bot trong phòng (mặc định: BOT_NAME trong .env)
      --passcode 123456               Mật khẩu phòng Zoom (nếu link không kèm sẵn)
      --wait-open 90                  Số phút tối đa chờ phòng mở
      --grace 5                       Số phút chờ lệnh rejoin sau khi phòng đóng (0 = kết thúc ngay)
      --max-hours 6                   Giới hạn thời lượng cả phiên
      --no-summary                    Chỉ ghi hình, không phiên âm/tóm tắt
      --detach                        Chạy nền và trả về ngay (dùng cho bot/agent)
      --profile ten                   Dùng hồ sơ trình duyệt khác (mặc định: default)
  classrec rejoin <link-mới> [--session id] [--passcode x]
                                      Lớp đổi phòng: rời phòng cũ, vào phòng mới, ghi tiếp vào cùng buổi học
  classrec stop [--session id]        Dừng ghi và xuất file ngay
  classrec keep [--session id]        Bot báo đang một mình/phòng im lặng: chọn tiếp tục chờ thay vì dừng
  classrec status [--session id] [--json]
  classrec list                       Liệt kê các phiên đã ghi
  classrec process <id|thư-mục>       Chạy lại bước ghép file / phiên âm / tóm tắt cho một phiên
  classrec login [--profile ten]      Mở trình duyệt để bạn tự đăng nhập Google/Zoom một lần (bot dùng lại phiên đăng nhập đó)
  classrec selftest                   Tự kiểm thử ghi hình trên máy này (không cần lớp học thật)
`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    name: { type: 'string' },
    passcode: { type: 'string' },
    'wait-open': { type: 'string' },
    grace: { type: 'string' },
    'max-hours': { type: 'string' },
    'no-summary': { type: 'boolean' },
    detach: { type: 'boolean' },
    profile: { type: 'string' },
    session: { type: 'string' },
    'session-id': { type: 'string' },
    json: { type: 'boolean' },
    port: { type: 'string' },
    'public-host': { type: 'string' },
    password: { type: 'string' },
    'new-password': { type: 'boolean' },
    off: { type: 'boolean' },
    'no-open': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command, arg] = positionals;

function applyOverrides() {
  if (opt['wait-open']) config.waitOpenMin = Number(opt['wait-open']);
  if (opt.grace !== undefined) config.graceMin = Number(opt.grace);
  if (opt['max-hours']) config.maxHours = Number(opt['max-hours']);
}

function printStatus(s) {
  if (opt.json) return console.log(JSON.stringify(s, null, 2));
  console.log(`Phiên      : ${s.sessionId}${s.running ? ' (đang chạy)' : ''}`);
  console.log(`Buổi học   : ${s.title}`);
  console.log(`Phòng      : [${s.platform ?? '?'}] ${s.url}`);
  console.log(`Giai đoạn  : ${s.phase} — ${s.message}`);
  if (s.attention) {
    const what = s.attention.reason === 'alone' ? 'Bot đang ở một mình trong phòng' : 'Phòng im lặng hoàn toàn';
    console.log(`CẦN QUYẾT ĐỊNH: ${what} từ ${s.attention.since}. Chọn "classrec stop" (dừng và xuất file) hoặc "classrec keep" (chờ thêm).${s.attention.autoEndAt ? ` Không chọn thì tự dừng lúc ${s.attention.autoEndAt}.` : ''}`);
  }
  console.log(`Đoạn đã ghi: ${s.segments.length}${s.running && s.phase === 'recording' ? ` (đang ghi đoạn ${s.segments.length + 1})` : ''}`);
  if (s.outputs?.recording) console.log(`Ghi hình   : ${s.outputs.recording}`);
  if (s.outputs?.transcript) console.log(`Phiên âm   : ${s.outputs.transcript}`);
  if (s.outputs?.summary) console.log(`Tóm tắt    : ${s.outputs.summary}`);
  for (const n of s.outputs?.notes ?? []) console.log(`Ghi chú    : ${n}`);
  console.log(`Thư mục    : ${s.dir}`);
}

async function main() {
  if (opt.help || !command) return console.log(HELP);

  switch (command) {
    case 'start': {
      if (!arg) throw new Error('Thiếu link phòng học. Ví dụ: classrec start https://zoom.us/j/123456789?pwd=...');
      pickPlatform(arg); // báo lỗi sớm nếu link không được hỗ trợ
      const running = listSessions()
        .map((id) => readStatus(sessionDir(id)))
        .find((s) => s?.running && (opt.profile || 'default') === (s.profile || 'default'));
      if (running) throw new Error(`Đang có phiên chạy (${running.sessionId}). Dùng "classrec rejoin <link>" để đổi phòng, hoặc "classrec stop" trước khi bắt đầu phiên mới.`);

      const sessionId = opt['session-id'] || `${stamp()}-${slugify(opt.title || 'buoi-hoc')}`;
      if (opt.detach) {
        const dir = sessionDir(sessionId);
        fs.mkdirSync(dir, { recursive: true });
        const out = fs.openSync(path.join(dir, 'stdout.log'), 'a');
        const args = process.argv.slice(2).filter((a) => a !== '--detach');
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--session-id', sessionId], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
        child.unref();
        for (let i = 0; i < 40 && !readStatus(dir); i++) await sleep(250);
        const s = readStatus(dir) || { sessionId, dir, phase: 'starting', message: 'Đang khởi động', segments: [], outputs: {}, url: arg, title: opt.title || 'Buổi học' };
        return printStatus(s);
      }
      applyOverrides();
      const { runSession } = await import('./session.js');
      const s = await runSession({ url: arg, title: opt.title, name: opt.name, passcode: opt.passcode, profile: opt.profile, sessionId, summary: !opt['no-summary'] });
      console.log('');
      printStatus({ ...s, running: false });
      process.exitCode = s.phase === 'done' ? 0 : 1;
      return;
    }

    case 'rejoin': {
      if (!arg) throw new Error('Thiếu link phòng mới. Ví dụ: classrec rejoin https://meet.google.com/abc-defg-hij');
      pickPlatform(arg);
      const dir = resolveSession(opt.session);
      const s = readStatus(dir);
      if (!s?.running) throw new Error(`Phiên ${path.basename(dir)} không còn chạy. Hãy bắt đầu phiên mới: classrec start "${arg}"`);
      sendCommand(dir, { cmd: 'rejoin', url: arg, ...(opt.passcode !== undefined ? { passcode: opt.passcode } : {}) });
      console.log(`Đã gửi lệnh rejoin tới phiên ${s.sessionId}. Bot sẽ rời phòng cũ và vào phòng mới trong vài giây.`);
      return;
    }

    case 'stop': {
      const dir = resolveSession(opt.session);
      const s = readStatus(dir);
      if (!s?.running) return console.log(`Phiên ${path.basename(dir)} không còn chạy.`);
      sendCommand(dir, { cmd: 'stop' });
      console.log(`Đã gửi lệnh stop tới phiên ${s.sessionId}. File sẽ được xuất trong ít phút — xem bằng: classrec status`);
      return;
    }

    case 'keep': {
      const dir = resolveSession(opt.session);
      const s = readStatus(dir);
      if (!s?.running) return console.log(`Phiên ${path.basename(dir)} không còn chạy.`);
      sendCommand(dir, { cmd: 'keep' });
      console.log(`Đã báo phiên ${s.sessionId} tiếp tục chờ trong phòng.`);
      return;
    }

    case 'status': {
      const dir = resolveSession(opt.session || arg);
      const s = readStatus(dir);
      if (!s) throw new Error(`Phiên ${path.basename(dir)} chưa có trạng thái.`);
      return printStatus(s);
    }

    case 'list': {
      const all = listSessions();
      if (!all.length) return console.log('Chưa có phiên nào.');
      for (const id of all) {
        const s = readStatus(sessionDir(id));
        console.log(`${id}  ${s ? `${s.running ? 'ĐANG CHẠY' : s.phase}  ${s.outputs?.durationSeconds ? Math.round(s.outputs.durationSeconds / 60) + ' phút' : ''}  ${s.outputs?.summary ? '(có tóm tắt)' : ''}` : ''}`);
      }
      return;
    }

    case 'process': {
      const dir = resolveSession(arg || opt.session);
      const s = readStatus(dir);
      if (s?.running) throw new Error('Phiên đang chạy — chờ kết thúc hoặc dùng "classrec stop" trước.');
      const { postprocess } = await import('./post.js');
      const { writeJsonAtomic } = await import('./util.js');
      const partsDir = path.join(dir, 'parts');
      const parts = fs.existsSync(partsDir)
        ? fs.readdirSync(partsDir).filter((f) => /^part-\d+\.webm$/.test(f)).sort().map((f) => path.join(partsDir, f))
        : [];
      const log = makeLogger(dir);
      const outputs = await postprocess(dir, { parts, title: s?.title || path.basename(dir), startedAt: s?.startedAt, instructor: s?.instructor || null, log, withSummary: !opt['no-summary'] });
      if (s) {
        delete s.running;
        writeJsonAtomic(path.join(dir, 'status.json'), { ...s, outputs, phase: outputs.recording ? 'done' : s.phase, updatedAt: new Date().toISOString() });
      }
      console.log('');
      printStatus({ ...(s || { sessionId: path.basename(dir), dir, title: path.basename(dir), url: '', phase: 'done', message: '', segments: parts }), outputs, running: false });
      return;
    }

    case 'login': {
      const { findBrowserExecutable } = await import('./browser.js');
      const exe = findBrowserExecutable();
      if (!exe) throw new Error('Không tìm thấy Chrome/Edge. Cài Google Chrome hoặc đặt BROWSER_PATH trong .env.');
      if (process.platform === 'linux' && !process.env.DISPLAY) {
        // Máy không có màn hình (VPS): mở trình duyệt trên màn hình ảo, người dùng thao tác qua giao diện web (/vnc/).
        // Phần này là tuỳ chọn: bản cài không kèm src/remote-login.js thì báo như máy không có màn hình.
        const mod = await import('./remote-login.js').catch(() => null);
        if (!mod) throw new Error('Máy không có màn hình nên không mở được trình duyệt để đăng nhập.');
        await mod.remoteLogin({ profile: opt.profile || 'default', url: arg || undefined });
        return;
      }
      const profileDir = paths.profile(opt.profile || 'default');
      fs.mkdirSync(profileDir, { recursive: true });
      const args = [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check'];
      if (process.platform === 'linux') args.push('--password-store=basic');
      args.push(arg || 'https://accounts.google.com/');
      console.log('Đang mở trình duyệt. Hãy tự đăng nhập tài khoản dùng để vào lớp, rồi ĐÓNG cửa sổ trình duyệt để hoàn tất.');
      const child = spawn(exe, args, { stdio: 'ignore' });
      await new Promise((r) => child.on('exit', r));
      console.log('Đã lưu phiên đăng nhập vào hồ sơ:', profileDir);
      return;
    }

    case 'ui': {
      const { startServer } = await import('./server.js');
      await startServer({ port: Number(opt.port) || 8787, open: !opt['no-open'] });
      return;
    }

    case 'ui-access': {
      // Bật truy cập giao diện từ xa: đặt mật khẩu và (tuỳ chọn) khai báo tên miền công khai đi qua proxy HTTPS.
      const { hashPassword, generatePassword } = await import('./auth.js');
      const { writeEnv } = await import('./settings.js');
      if (opt.off) {
        writeEnv({ UI_PASSWORD_HASH: '', UI_PUBLIC_HOSTS: '' });
        return console.log('Đã tắt truy cập từ xa: giao diện chỉ còn mở được trên chính máy này, không cần mật khẩu. Khởi động lại giao diện để áp dụng.');
      }
      const updates = {};
      let shown = null;
      if (opt.password || !config.uiPasswordHash || opt['new-password']) {
        shown = opt.password || generatePassword();
        if (shown.length < 10) throw new Error('Mật khẩu cần ít nhất 10 ký tự.');
        updates.UI_PASSWORD_HASH = hashPassword(shown);
      }
      if (opt['public-host']) {
        // Nhận một hoặc nhiều tên miền, cách nhau bằng dấu phẩy.
        const list = opt['public-host']
          .split(',')
          .map((h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase())
          .filter(Boolean);
        for (const host of list) if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) throw new Error(`Tên miền không hợp lệ: ${host}`);
        updates.UI_PUBLIC_HOSTS = list.join(',');
      }
      writeEnv(updates);
      if (updates.UI_PUBLIC_HOSTS) console.log(`Tên miền công khai: ${updates.UI_PUBLIC_HOSTS}`);
      if (shown && !opt.password) console.log(`Mật khẩu đăng nhập giao diện (chỉ hiện một lần, hãy lưu lại): ${shown}`);
      else if (shown) console.log('Đã đặt mật khẩu mới.');
      console.log('Khởi động lại giao diện để áp dụng.');
      return;
    }

    case 'selftest': {
      const { selftest } = await import('./selftest.js');
      process.exitCode = (await selftest()) ? 0 : 1;
      return;
    }

    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`Lỗi: ${e.message}`);
  process.exitCode = 1;
});
