import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, baseEnv, config } from './config.js';
import { verifyPassword, sessionCookie, clearCookie, hasSession, loginAllowed, recordLogin, loginPage } from './auth.js';
import { sessionDir, listSessions, readStatus, sendCommand } from './control.js';
import { pickPlatform } from './platforms/index.js';
import { slugify, stamp } from './util.js';
import { readSettings, saveSettings, keyStatus } from './settings.js';
import { verifyPassword as checkPassword, hashPassword } from './auth.js';
import { loadSchedules, saveSchedules, makeSchedule, dueSchedules, markFired } from './schedule.js';
import { notify, listNotifications, markAllRead } from './notify.js';
import { askSessions } from './ask.js';
import { searchSessions } from './search.js';
import { cleanupOldSessions, diskFree } from './cleanup.js';
import { syncCalendar } from './calendar.js';
import { t, getLang, setLang, dictionaryFor } from './i18n.js';

let calendarState = { configured: false };
let calendarSyncNow = async () => calendarState;
import { ENV_FILE, parseEnv } from './settings.js';

const readEnvValues = () => {
  try {
    return parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
  } catch {
    return {};
  }
};
import { writeEnv } from './settings.js';

// Đăng nhập từ xa là phần tuỳ chọn: bản cài không kèm file src/remote-login.js thì tính năng này tắt hẳn.
let remoteLoginPort = () => null;
let remoteLoginAvailable = false;
try {
  ({ remoteLoginPort } = await import('./remote-login.js'));
  remoteLoginAvailable = true;
} catch {
  /* không có mô-đun đăng nhập từ xa */
}

/** Bắt đầu một buổi ghi ở tiến trình riêng (dùng chung cho nút "Bắt đầu ghi" và lịch ghi tự động). Trả về mã phiên. */
// Ghi song song: mỗi buổi đang chạy cần một hồ sơ trình duyệt riêng (Chrome không cho hai tiến trình dùng chung một hồ sơ).
const PROFILES = ['default', 'lop2', 'lop3'];
const recentStarts = new Map(); // id → { profile, at } — buổi vừa khởi chạy, chưa kịp ghi status.json
const maxParallel = () => Math.min(PROFILES.length, Math.max(1, Number(readEnvValues().MAX_PARALLEL || 2) || 2));
function freeProfile() {
  const used = new Set();
  for (const id of listSessions()) {
    const st = readStatus(sessionDir(id));
    if (st?.running) used.add(st.profile || 'default');
  }
  for (const [id, r] of recentStarts) {
    if (Date.now() - r.at > 60000) recentStarts.delete(id);
    else used.add(r.profile);
  }
  return PROFILES.find((p) => !used.has(p)) || null;
}

function startSession({ url, title, passcode, name, summary }) {
  const profile = freeProfile();
  if (!profile) throw new Error(t('Đã đủ số buổi ghi cùng lúc.'));
  const ttl = String(title || '').trim() || t('Buổi học');
  const id = `${stamp()}-${slugify(ttl)}`;
  const dir = sessionDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const args = [CLI, 'start', url, '--title', ttl, '--session-id', id, '--profile', profile];
  recentStarts.set(id, { profile, at: Date.now() });
  if (passcode) args.push('--passcode', String(passcode));
  if (name) args.push('--name', String(name));
  if (summary === false) args.push('--no-summary');
  const out = fs.openSync(path.join(dir, 'stdout.log'), 'a');
  spawn(process.execPath, args, { cwd: ROOT, env: baseEnv, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  fs.closeSync(out);
  return id;
}

/**
 * Giao diện web chạy trên chính máy này (chỉ nghe ở 127.0.0.1).
 * Mọi việc nặng (ghi hình, hậu kỳ, kiểm thử) chạy ở tiến trình con qua CLI, nên đóng giao diện không làm dừng buổi ghi.
 */

const CLI = path.join(ROOT, 'src', 'cli.js');
const UI_FILE = path.join(ROOT, 'ui', 'index.html');
const TYPES = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };
const FILE_RX = /^(recording\.(webm|mp4)|transcript\.txt|summary\.md|session\.log|live\.jpg|debug\/[\w.-]+\.png)$/;
const ID_RX = /^[\w.-]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sessionInfo(id) {
  const dir = sessionDir(id);
  const s = readStatus(dir);
  if (!s) return { id, title: id, phase: 'unknown', running: false, startedAt: null, outputs: {}, segments: 0 };
  const base = (p) => (p ? path.basename(p) : null);
  return {
    id,
    title: s.title,
    platform: s.platform,
    url: s.url,
    phase: s.phase,
    state: s.state,
    message: s.message,
    running: s.running,
    endReason: s.endReason,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    segments: s.segments.length,
    participants: s.participants ?? null,
    audio: s.audio ?? null,
    attention: s.attention ?? null,
    durationSeconds: s.outputs?.durationSeconds ?? null,
    files: { recording: base(s.outputs?.recording), transcript: base(s.outputs?.transcript), summary: base(s.outputs?.summary) },
    notes: s.outputs?.notes ?? [],
    instructor: s.instructor ?? null,
    instructorAuto: !!s.instructorAuto,
    videoRemoved: s.videoRemoved ?? null,
    speakers: s.speakers ?? null,
  };
}

function sessionDetail(id) {
  const dir = sessionDir(id);
  const info = sessionInfo(id);
  let log = '';
  for (const f of ['session.log', 'stdout.log']) {
    try {
      log = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(-80).join('\n');
      if (log.trim()) break;
    } catch {
      /* thử file tiếp theo */
    }
  }
  let shots = [];
  try {
    shots = fs.readdirSync(path.join(dir, 'debug')).filter((f) => f.endsWith('.png')).sort();
  } catch {
    /* chưa có ảnh */
  }
  let liveAt = null;
  try {
    liveAt = Math.round(fs.statSync(path.join(dir, 'live.jpg')).mtimeMs);
  } catch {
    /* chưa có ảnh trực tiếp */
  }
  return { ...info, log, lastShot: shots.at(-1) || null, liveAt };
}

const allSessions = () => listSessions().map(sessionInfo);
const runningSessions = () => allSessions().filter((s) => s.running);
const runningSession = () => runningSessions()[0] || null;
/** Buổi đang chạy mà lệnh nhắm tới: theo id nếu giao diện gửi kèm, không thì buổi đang chạy duy nhất/đầu tiên. */
const targetRunning = (body) => {
  const all = runningSessions();
  const id = String(body?.id || '');
  return (id ? all.find((s) => s.id === id) : all[0]) || null;
};
const atCapacity = () => {
  // Tính cả buổi vừa bấm bắt đầu (trong 15 giây) nhưng chưa kịp hiện là "đang chạy".
  const ids = new Set(runningSessions().map((x) => x.id));
  for (const [id, r] of recentStarts) if (Date.now() - r.at < 15000) ids.add(id);
  return ids.size >= maxParallel();
};

// ── Việc chạy nền (xử lý lại, tự kiểm thử, kiểm tra phiên âm, đăng nhập) ─────────────────────────────
const jobs = new Map();
const jobChildren = new Map(); // tên việc → tiến trình, để dừng được việc đang chạy (vd phiên đăng nhập từ xa)
function startJob(name, label, args) {
  for (const j of jobs.values()) if (j.name === name && !j.done) throw new HttpError(409, t('"{label}" đang chạy rồi.', { label }));
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, name, label, output: '', done: false, code: null };
  jobs.set(id, job);
  const child = spawn(process.execPath, args, { cwd: ROOT, env: baseEnv, windowsHide: true });
  const add = (d) => {
    job.output = (job.output + d).slice(-60000);
  };
  jobChildren.set(name, child);
  child.stdout.on('data', add);
  child.stderr.on('data', add);
  child.on('error', (e) => {
    add(`\n${e.message}`);
    job.done = true;
    job.code = -1;
  });
  child.on('close', (code) => {
    job.done = true;
    job.code = code;
  });
  return job;
}

function sendFile(req, res, file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new HttpError(404, t('Không tìm thấy file.'));
  }
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    // Hỗ trợ tua video: trả về đúng khoảng byte trình duyệt yêu cầu.
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (d) => {
      data += d;
      if (data.length > 200000) reject(new HttpError(413, t('Dữ liệu gửi lên quá lớn.')));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readBody(req) {
  const data = await readRaw(req);
  try {
    return data ? JSON.parse(data) : {};
  } catch {
    throw new HttpError(400, t('Dữ liệu gửi lên không hợp lệ.'));
  }
}

function openInOS(target) {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    /* không mở được — bỏ qua */
  }
}

export async function startServer({ port = 8787, open = true } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  // Địa chỉ được phép gọi: máy này, và (trên VPS) tên miền công khai đi qua proxy HTTPS.
  // 127.0.0.1/localhost được nhận ở mọi cổng, để dùng được qua đường hầm SSH (ssh -L <cổng-bất-kỳ>:127.0.0.1:8787).
  const publicHosts = new Set(config.uiPublicHosts);
  const hosts = { has: (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h) || publicHosts.has(h) };
  const authOn = !!config.uiPasswordHash;
  if (config.uiPublicHosts.length && !authOn) {
    throw new Error(t('Đã khai báo tên miền công khai (UI_PUBLIC_HOSTS) nhưng chưa đặt mật khẩu. Chạy: node src/cli.js ui-access --public-host <tên-miền>'));
  }
  // Mở thư mục bằng trình quản lý file chỉ có nghĩa khi giao diện chạy trên chính máy người dùng.
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const canOpenFolder = !authOn && !headless;

  const routes = {
    'GET /api/state': () => ({
      lang: getLang(),
      running: runningSession(),
      runningAll: runningSessions(),
      maxParallel: maxParallel(),
      sessions: allSessions(),
      keys: keyStatus(),
      jobs: [...jobs.values()].filter((j) => !j.done).map((j) => ({ id: j.id, name: j.name, label: j.label })),
      notifications: listNotifications().slice(0, 30),
      // remoteLogin: máy không có màn hình → nút đăng nhập cho bot mở trình duyệt từ xa ngay trong trang (/vnc/).
      server: { auth: authOn, canOpenFolder, remoteLogin: headless && remoteLoginAvailable, remoteLoginActive: headless && !!remoteLoginPort(), diskFree: diskFree() },
    }),

    'POST /api/login-stop': () => {
      const child = jobChildren.get('login');
      if (child && child.exitCode === null) child.kill('SIGTERM');
      return { ok: true };
    },

    'GET /api/settings': () => ({ groups: readSettings() }),

    // Đổi ngôn ngữ giao diện: ghi APP_LANG vào .env (tiến trình ghi hình mới tự đọc lại) và áp dụng ngay cho máy chủ.
    'POST /api/lang': (body) => {
      const lang = String(body.lang || '');
      if (!['vi', 'en'].includes(lang)) throw new HttpError(400, t('Ngôn ngữ không hợp lệ.'));
      writeEnv({ APP_LANG: lang });
      setLang(lang);
      return { lang };
    },

    'POST /api/settings': (body) => {
      try {
        return { saved: saveSettings(body.values || {}) };
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    },

    'POST /api/start': (body) => {
      const url = String(body.url || '').trim();
      if (!url) throw new HttpError(400, t('Hãy dán link phòng học.'));
      try {
        pickPlatform(url);
      } catch (e) {
        throw new HttpError(400, e.message);
      }
      if (atCapacity()) throw new HttpError(409, maxParallel() === 1 ? t('Đang có một buổi ghi chạy. Hãy dùng "Đổi phòng" hoặc dừng buổi đó trước.') : t('Đang ghi đủ {n} buổi cùng lúc. Hãy chờ hoặc dừng bớt một buổi.', { n: maxParallel() }));
      return { id: startSession({ url, title: body.title, passcode: body.passcode, name: body.name, summary: body.summary }) };
    },

    // ── Xoá một buổi đã ghi (video, phiên âm, tóm tắt). Không hoàn tác được; giao diện hỏi lại trước khi gọi. ──
    'POST /api/delete-session': (body) => {
      const id = String(body.id || '');
      if (!ID_RX.test(id) || !listSessions().includes(id)) throw new HttpError(404, t('Không tìm thấy buổi ghi.'));
      if (sessionInfo(id).running) throw new HttpError(409, t('Buổi này đang chạy — hãy dừng ghi trước.'));
      fs.rmSync(sessionDir(id), { recursive: true, force: true });
      return { ok: true };
    },

    // ── Đổi mật khẩu đăng nhập giao diện (chỉ khi giao diện đang bật đăng nhập). ──
    'POST /api/change-password': (body) => {
      if (!authOn) throw new HttpError(400, t('Giao diện này không bật đăng nhập nên không có mật khẩu để đổi.'));
      if (!checkPassword(String(body.current || ''), config.uiPasswordHash)) throw new HttpError(403, t('Mật khẩu hiện tại không đúng.'));
      const next = String(body.next || '');
      if (next.length < 10) throw new HttpError(400, t('Mật khẩu mới cần ít nhất 10 ký tự.'));
      const hash = hashPassword(next);
      writeEnv({ UI_PASSWORD_HASH: hash });
      config.uiPasswordHash = hash; // áp dụng ngay, không cần khởi động lại
      return { ok: true };
    },

    // ── Lịch ghi tự động ──
    'GET /api/schedules': () => ({ schedules: loadSchedules(), now: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, calendar: calendarState }),
    'POST /api/calendar-sync': async () => ({ calendar: await calendarSyncNow() }),
    'POST /api/schedules': (body) => {
      let s;
      try {
        s = makeSchedule(body);
      } catch (e) {
        throw new HttpError(400, e.message);
      }
      const list = loadSchedules();
      list.push(s);
      saveSchedules(list);
      return { schedule: s };
    },
    'POST /api/schedules/toggle': (body) => {
      const list = loadSchedules();
      const s = list.find((x) => x.id === body.id);
      if (!s) throw new HttpError(404, t('Không tìm thấy lịch.'));
      s.enabled = !!body.enabled;
      saveSchedules(list);
      return { ok: true };
    },
    'POST /api/schedules/delete': (body) => {
      const list = loadSchedules();
      if (!list.some((x) => x.id === body.id)) throw new HttpError(404, t('Không tìm thấy lịch.'));
      saveSchedules(list.filter((x) => x.id !== body.id));
      return { ok: true };
    },

    // Tìm kiếm toàn văn trong phiên âm và tóm tắt (miễn phí).
    'POST /api/search': (body) => {
      try {
        return searchSessions(body.q);
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    },

    // Sửa tên giảng viên của một buổi (ghi đè tên bot đoán).
    'POST /api/session-meta': (body) => {
      const id = String(body.id || '');
      if (!ID_RX.test(id) || !listSessions().includes(id)) throw new HttpError(404, t('Không tìm thấy buổi ghi.'));
      const file = path.join(sessionDir(id), 'status.json');
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      const name = String(body.instructor ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      s.instructor = name || null;
      s.instructorAuto = false;
      fs.writeFileSync(file, JSON.stringify(s, null, 2));
      return { ok: true };
    },

    // Hỏi đáp về các buổi đã ghi (gọi Claude, tốn vài xu mỗi câu hỏi).
    'POST /api/ask': async (body) => {
      try {
        return await askSessions(body.question);
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    },

    // Thông báo hiện trên trình duyệt: đánh dấu đã đọc khi người dùng mở chuông.
    'POST /api/notifications/read': () => {
      markAllRead();
      return { ok: true };
    },

    'POST /api/rejoin': (body) => {
      const url = String(body.url || '').trim();
      try {
        pickPlatform(url);
      } catch (e) {
        throw new HttpError(400, url ? e.message : t('Hãy dán link phòng mới.'));
      }
      const running = targetRunning(body);
      if (!running) throw new HttpError(409, t('Không có buổi ghi nào đang chạy.'));
      sendCommand(sessionDir(running.id), { cmd: 'rejoin', url, ...(body.passcode ? { passcode: String(body.passcode) } : {}) });
      return { ok: true };
    },

    'POST /api/stop': (body) => {
      const running = targetRunning(body);
      if (!running) throw new HttpError(409, t('Không có buổi ghi nào đang chạy.'));
      sendCommand(sessionDir(running.id), { cmd: 'stop' });
      return { ok: true };
    },

    'POST /api/keep': (body) => {
      const running = targetRunning(body);
      if (!running) throw new HttpError(409, t('Không có buổi ghi nào đang chạy.'));
      sendCommand(sessionDir(running.id), { cmd: 'keep' });
      return { ok: true };
    },

    'POST /api/process': (body) => {
      const id = String(body.id || '');
      if (!ID_RX.test(id) || !listSessions().includes(id)) throw new HttpError(404, t('Không tìm thấy buổi ghi.'));
      if (sessionInfo(id).running) throw new HttpError(409, t('Buổi này đang chạy.'));
      const job = startJob(`process:${id}`, t('Xử lý lại'), [CLI, 'process', id]);
      return { job: job.id };
    },

    'POST /api/tool': (body) => {
      const tools = {
        selftest: [t('Tự kiểm thử'), [CLI, 'selftest']],
        stt: [t('Kiểm tra phiên âm'), [path.join(ROOT, 'test', 'stt-check.mjs')]],
        summary: [t('Kiểm tra tóm tắt'), [path.join(ROOT, 'test', 'summary-check.mjs')]],
        'setup-stt': [t('Cài bộ phiên âm trên máy'), [path.join(ROOT, 'scripts', 'setup-stt.mjs')]],
        login: [t('Đăng nhập tài khoản'), [CLI, 'login']],
      };
      const tool = tools[body.name];
      if (!tool) throw new HttpError(400, t('Công cụ không tồn tại.'));
      if (!['stt', 'summary', 'setup-stt'].includes(body.name) && runningSession()) throw new HttpError(409, t('Đang có buổi ghi chạy — hãy chờ buổi đó xong (trình duyệt của bot đang bận).'));
      const job = startJob(body.name, tool[0], tool[1]);
      return { job: job.id };
    },

    'POST /api/open-folder': (body) => {
      const id = String(body.id || '');
      if (!ID_RX.test(id) || !listSessions().includes(id)) throw new HttpError(404, t('Không tìm thấy buổi ghi.'));
      openInOS(sessionDir(id));
      return { ok: true };
    },
  };

  const server = http.createServer(async (req, res) => {
    const send = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    try {
      // Chỉ phục vụ khi được gọi bằng đúng địa chỉ máy này (chặn trang web lạ trỏ tên miền về 127.0.0.1).
      if (!hosts.has(String(req.headers.host || '').toLowerCase())) throw new HttpError(403, t('Địa chỉ không hợp lệ.'));
      const url = new URL(req.url, `http://${req.headers.host}`);
      const p = decodeURIComponent(url.pathname);

      // Đăng nhập (chỉ khi đã đặt mật khẩu — tức là giao diện được mở ra internet).
      if (authOn) {
        const viaHttps = req.headers['x-forwarded-proto'] === 'https';
        // Proxy chạy cùng máy nên kết nối luôn từ 127.0.0.1; địa chỉ thật của người dùng nằm trong X-Forwarded-For.
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const page = (status, html, headers = {}) => {
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
          res.end(html);
        };
        if (p === '/login' && req.method === 'GET') return page(200, loginPage());
        if (p === '/login' && req.method === 'POST') {
          const origin = req.headers.origin;
          if (origin && !hosts.has(origin.replace(/^https?:\/\//, '').toLowerCase())) throw new HttpError(403, t('Nguồn yêu cầu không hợp lệ.'));
          if (!loginAllowed(ip)) return page(429, loginPage(t('Sai mật khẩu quá nhiều lần. Hãy thử lại sau 10 phút.')));
          const form = new URLSearchParams(await readRaw(req));
          const ok = verifyPassword(form.get('password') || '', config.uiPasswordHash);
          recordLogin(ip, ok);
          if (!ok) return page(401, loginPage(t('Mật khẩu không đúng.')));
          res.writeHead(303, { Location: '/', 'Set-Cookie': sessionCookie({ secure: viaHttps }) });
          return res.end();
        }
        if (p === '/logout') {
          res.writeHead(303, { Location: '/login', 'Set-Cookie': clearCookie() });
          return res.end();
        }
        if (!hasSession(req)) {
          if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
            res.writeHead(303, { Location: '/login' });
            return res.end();
          }
          throw new HttpError(401, t('Chưa đăng nhập.'));
        }
      }

      if (req.method === 'POST') {
        // Thao tác thay đổi dữ liệu phải kèm mã bí mật của trang — trang web khác không thể giả lệnh.
        if (req.headers['x-classrec-token'] !== token) throw new HttpError(403, t('Phiên giao diện đã cũ — hãy tải lại trang.'));
        const origin = req.headers.origin;
        if (origin && !hosts.has(origin.replace(/^https?:\/\//, '').toLowerCase())) throw new HttpError(403, t('Nguồn yêu cầu không hợp lệ.'));
      } else if (req.method !== 'GET') {
        throw new HttpError(405, t('Không hỗ trợ.'));
      }

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        const html = fs.readFileSync(UI_FILE, 'utf8').replace('__LANG__', getLang()).replace('__TOKEN__', token).replace('__I18N__', () => JSON.stringify({ lang: getLang(), dict: dictionaryFor(getLang()) }).replace(/</g, '\\u003c'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      }

      let m;
      // Màn hình trình duyệt của bot khi đăng nhập từ xa (noVNC): chuyển tiếp tới cổng nội bộ. Đã qua bước kiểm tra đăng nhập ở trên.
      if (req.method === 'GET' && p.startsWith('/vnc/')) {
        const vncPort = remoteLoginPort();
        if (!vncPort) throw new HttpError(404, t('Không có phiên đăng nhập từ xa nào đang mở.'));
        const up = http.request({ host: '127.0.0.1', port: vncPort, method: 'GET', path: req.url.slice(4), headers: { ...req.headers, host: `127.0.0.1:${vncPort}` } }, (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        });
        up.on('error', () => {
          if (!res.headersSent) send(502, { error: t('Màn hình từ xa chưa sẵn sàng.') });
          else res.end();
        });
        return up.end();
      }
      if (req.method === 'GET' && (m = /^\/api\/session\/([^/]+)$/.exec(p))) {
        if (!ID_RX.test(m[1]) || !listSessions().includes(m[1])) throw new HttpError(404, t('Không tìm thấy buổi ghi.'));
        return send(200, sessionDetail(m[1]));
      }
      if (req.method === 'GET' && (m = /^\/api\/job\/([0-9a-f]+)$/.exec(p))) {
        const job = jobs.get(m[1]);
        if (!job) throw new HttpError(404, t('Không tìm thấy tác vụ.'));
        return send(200, job);
      }
      if (req.method === 'GET' && (m = /^\/files\/([^/]+)\/(.+)$/.exec(p))) {
        if (!ID_RX.test(m[1]) || !FILE_RX.test(m[2]) || !listSessions().includes(m[1])) throw new HttpError(404, t('Không tìm thấy file.'));
        return sendFile(req, res, path.join(sessionDir(m[1]), m[2]));
      }

      const handler = routes[`${req.method} ${p}`];
      if (!handler) throw new HttpError(404, t('Không tìm thấy.'));
      const body = req.method === 'POST' ? await readBody(req) : null;
      send(200, await handler(body));
    } catch (e) {
      if (!res.headersSent) send(e.status || 500, { error: e.message });
      else res.end();
    }
  });

  // Kênh WebSocket của màn hình từ xa (/vnc/websockify): cùng các bước kiểm tra như yêu cầu thường rồi nối thẳng tới cổng nội bộ.
  server.on('upgrade', (req, socket, head) => {
    const deny = () => socket.destroy();
    try {
      if (!hosts.has(String(req.headers.host || '').toLowerCase())) return deny();
      const origin = req.headers.origin;
      if (origin && !hosts.has(origin.replace(/^https?:\/\//, '').toLowerCase())) return deny();
      if (authOn && !hasSession(req)) return deny();
      const vncPort = remoteLoginPort();
      if (!vncPort || !req.url.startsWith('/vnc/')) return deny();
      const up = net.connect(vncPort, '127.0.0.1', () => {
        const headers = Object.entries({ ...req.headers, host: `127.0.0.1:${vncPort}` })
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n');
        up.write(`GET ${req.url.slice(4)} HTTP/1.1\r\n${headers}\r\n\r\n`);
        if (head && head.length) up.write(head);
        socket.pipe(up);
        up.pipe(socket);
      });
      up.on('error', deny);
      socket.on('error', () => up.destroy());
    } catch {
      deny();
    }
  });

  // Lịch ghi tự động: mỗi 20 giây xem có lớp nào tới giờ. Chỉ chạy khi giao diện đang chạy (trên VPS là dịch vụ luôn bật).
  const scheduleTick = () => {
    try {
      const list = loadSchedules();
      const due = dueSchedules(list);
      if (!due.length) return;
      for (const s of due) {
        markFired(list, s.id);
        if (atCapacity()) {
          notify(t('⏰ Tới giờ ghi "{title}" nhưng đã đủ {n} buổi ghi cùng lúc nên bỏ qua.', { title: s.title, n: maxParallel() }));
          continue;
        }
        const id = startSession({ url: s.url, title: s.title, passcode: s.passcode, summary: s.summary });
        console.log(t('Lịch ghi tự động: bắt đầu "{title}" ({id})', { title: s.title, id }));
      }
      saveSchedules(list);
    } catch (e) {
      console.error(t('Lỗi lịch ghi tự động: {error}', { error: e.message }));
    }
  };
  // Dọn buổi cũ và theo dõi dung lượng đĩa: mỗi giờ một lần (lần đầu sau 1 phút). Đọc cài đặt mới nhất từ .env mỗi lần.
  let lastDiskWarnDay = '';
  const maintenanceTick = () => {
    try {
      const env = readEnvValues();
      const days = Number(env.RETENTION_DAYS || 0);
      const r = cleanupOldSessions({ days, keepText: env.RETENTION_KEEP_TEXT !== 'false' });
      if (r.cleaned.length) {
        const gb = (r.freed / 1e9).toFixed(1);
        notify(t('🧹 Đã dọn {n} buổi ghi cũ hơn {days} ngày ({how}), giải phóng {gb} GB.', { n: r.cleaned.length, days, how: env.RETENTION_KEEP_TEXT !== 'false' ? t('xoá video, giữ phiên âm và tóm tắt') : t('xoá hẳn'), gb }));
      }
      const warnGb = Number(env.DISK_WARN_GB ?? 5);
      const free = diskFree();
      const today = new Date().toDateString();
      if (warnGb > 0 && free !== null && free < warnGb * 1e9 && lastDiskWarnDay !== today) {
        lastDiskWarnDay = today;
        notify(t('💾 Đĩa máy chủ chỉ còn {gb} GB trống. Hãy xoá bớt buổi ghi cũ hoặc bật tự dọn ở tab Cài đặt.', { gb: (free / 1e9).toFixed(1) }));
      }
    } catch (e) {
      console.error(t('Lỗi dọn dẹp: {error}', { error: e.message }));
    }
  };
  // Đồng bộ lịch Google (nếu đã dán địa chỉ iCal): mỗi 10 phút, và khi bấm "Đồng bộ ngay".
  const calendarSync = async () => {
    const env = readEnvValues();
    if (!env.CALENDAR_ICS_URL) {
      calendarState = { configured: false };
      return calendarState;
    }
    try {
      const r = await syncCalendar({ url: env.CALENDAR_ICS_URL, keyword: env.CALENDAR_KEYWORD || '', leadMin: Number(env.CALENDAR_LEAD_MIN ?? 5) });
      calendarState = { configured: true, at: new Date().toISOString(), ...r };
      if (r.added) notify(t('📅 Đã thêm {n} lịch ghi từ lịch Google.', { n: r.added }));
    } catch (e) {
      const first = !calendarState.error;
      calendarState = { configured: true, at: new Date().toISOString(), error: e.message };
      if (first) notify(t('📅 Không đồng bộ được lịch Google: {error}', { error: e.message }));
    }
    return calendarState;
  };
  calendarSyncNow = calendarSync;
  const calendarTimer = setInterval(calendarSync, 10 * 60000);
  const calendarFirst = setTimeout(calendarSync, 15000);
  calendarTimer.unref();
  calendarFirst.unref();
  server.on('close', () => {
    clearInterval(calendarTimer);
    clearTimeout(calendarFirst);
  });

  const maintenanceTimer = setInterval(maintenanceTick, 3600000);
  const maintenanceFirst = setTimeout(maintenanceTick, 60000);
  maintenanceTimer.unref();
  maintenanceFirst.unref();
  server.on('close', () => {
    clearInterval(maintenanceTimer);
    clearTimeout(maintenanceFirst);
  });

  const scheduleTimer = setInterval(scheduleTick, 20000);
  scheduleTimer.unref();
  server.on('close', () => clearInterval(scheduleTimer));

  const address = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch((e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.log(t('Giao diện đã chạy sẵn ở {address} — mở lại trang đó.', { address }));
    if (open) openInOS(address);
    return 'already';
  }).then((r) => {
    if (r === 'already') return;
    console.log(t('Class Recorder đang chạy tại {address}', { address }));
    for (const h of config.uiPublicHosts) console.log(t('Truy cập từ xa (qua proxy HTTPS, cần mật khẩu): https://{h}', { h }));
    console.log(t('Giữ cửa sổ này mở trong lúc dùng giao diện. Đóng cửa sổ không làm dừng buổi đang ghi.'));
    if (open) openInOS(address);
  });
  return server;
}
