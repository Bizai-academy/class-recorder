import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config, paths } from './config.js';

/** Tìm Chrome/Edge đã cài. Trả về '' nếu không thấy (khi đó dùng Chromium của Playwright). */
export function findBrowserExecutable() {
  if (config.browserPath) return config.browserPath;
  const candidates =
    process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
}

/**
 * Tạo thiết bị mic/camera giả: tiếng im lặng + hình đen.
 * Dù thao tác tắt mic/camera trong phòng có thất bại, lớp học cũng không nghe/thấy gì từ bot.
 */
export function ensureFakeMedia() {
  const dir = paths.assets();
  fs.mkdirSync(dir, { recursive: true });
  const wav = path.join(dir, 'silence.wav');
  const y4m = path.join(dir, 'black.y4m');

  if (!fs.existsSync(wav)) {
    const rate = 48000;
    const samples = rate; // 1 giây
    const data = Buffer.alloc(samples * 2);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + data.length, 4);
    h.write('WAVEfmt ', 8);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); // PCM
    h.writeUInt16LE(1, 22); // mono
    h.writeUInt32LE(rate, 24);
    h.writeUInt32LE(rate * 2, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36);
    h.writeUInt32LE(data.length, 40);
    fs.writeFileSync(wav, Buffer.concat([h, data]));
  }

  if (!fs.existsSync(y4m)) {
    const w = 320;
    const hgt = 180;
    const header = Buffer.from(`YUV4MPEG2 W${w} H${hgt} F15:1 Ip A1:1 C420jpeg\n`);
    const frame = Buffer.concat([
      Buffer.from('FRAME\n'),
      Buffer.alloc(w * hgt, 16), // Y = đen
      Buffer.alloc((w * hgt) / 2, 128), // U, V = trung tính
    ]);
    fs.writeFileSync(y4m, Buffer.concat([header, frame, frame]));
  }
  return { wav, y4m };
}

export function resolveHeadless() {
  if (config.headless === 'true') return true;
  if (config.headless === 'false') return false;
  // auto: có màn hình (Windows/macOS, hoặc Linux có DISPLAY/Xvfb) thì chạy có cửa sổ — ổn định nhất cho việc ghi tab.
  if (process.platform === 'linux' && !process.env.DISPLAY) return true;
  return false;
}

export async function launchBrowser({ profile = 'default', headless = resolveHeadless(), log = () => {} } = {}) {
  const { wav, y4m } = ensureFakeMedia();
  const profileDir = paths.profile(profile);
  fs.mkdirSync(profileDir, { recursive: true });
  const executablePath = findBrowserExecutable();

  const args = [
    '--auto-accept-this-tab-capture', // tự chấp nhận hộp thoại "chia sẻ tab này" để ghi hình tab
    '--autoplay-policy=no-user-gesture-required',
    // KHÔNG dùng --use-fake-ui-for-media-stream: cờ đó làm getDisplayMedia trả về "Fake audio" thay vì tiếng thật của tab.
    // Quyền mic/camera được cấp qua `permissions` bên dưới; thiết bị là đồ giả (im lặng + hình đen).
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    `--use-file-for-fake-video-capture=${y4m}`,
    '--disable-blink-features=AutomationControlled',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=en-US',
    `--window-size=${config.width},${config.height + 90}`,
  ];
  if (process.platform === 'linux') args.push('--password-store=basic', '--disable-dev-shm-usage');
  // Bật sandbox của Chrome (mặc định Playwright tắt, khiến Chrome hiện thanh cảnh báo "--no-sandbox" và ăn mất
  // một phần khung hình). Riêng Linux chạy bằng root thì Chrome không cho bật sandbox.
  const isLinuxRoot = process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;

  log(`Mở trình duyệt: ${executablePath || 'Chromium (Playwright)'} · headless=${headless} · profile=${profileDir}`);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    executablePath: executablePath || undefined,
    // BROWSER_SANDBOX=off: lối thoát cho máy Linux không cho tài khoản thường tạo sandbox (Chrome báo "No usable sandbox").
    chromiumSandbox: !isLinuxRoot && process.env.BROWSER_SANDBOX !== 'off',
    args,
    ignoreDefaultArgs: ['--enable-automation', '--mute-audio'],
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: 1,
    locale: 'en-US',
    permissions: ['microphone', 'camera'],
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}
