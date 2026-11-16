import { spawn, execFileSync } from 'node:child_process';
import { config } from './config.js';
import { sleep } from './util.js';

/**
 * Linux/VPS không có màn hình: tự bật màn hình ảo Xvfb và (nếu có) PulseAudio để Chrome có nơi "phát" tiếng.
 * Trên Windows/macOS không làm gì.
 */
export async function ensureDisplay(log) {
  if (process.platform !== 'linux') return { stop() {} };
  let xvfb = null;

  if (!process.env.DISPLAY && config.headless !== 'true') {
    const n = 90 + (process.pid % 400);
    try {
      xvfb = spawn('Xvfb', [`:${n}`, '-screen', '0', `${config.width}x${config.height + 90}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
      let failed = false;
      xvfb.on('error', () => (failed = true));
      xvfb.on('exit', () => (failed = true));
      await sleep(1200);
      if (failed) {
        xvfb = null;
        log('Không bật được Xvfb — sẽ chạy trình duyệt ở chế độ headless. (Cài: apt install xvfb)');
      } else {
        process.env.DISPLAY = `:${n}`;
        log(`Đã bật màn hình ảo Xvfb :${n}`);
      }
    } catch {
      xvfb = null;
    }
  }

  // PulseAudio: tạo "loa ảo" để Chrome phát tiếng (cần cho việc thu tiếng của tab trên máy không có card âm thanh).
  try {
    execFileSync('pactl', ['info'], { stdio: 'ignore', timeout: 4000 });
  } catch {
    try {
      execFileSync('pulseaudio', ['--start', '--exit-idle-time=-1'], { stdio: 'ignore', timeout: 8000 });
      await sleep(800);
      log('Đã bật PulseAudio');
    } catch {
      log('Không bật được PulseAudio (bỏ qua). Nếu file ghi không có tiếng, hãy cài: apt install pulseaudio');
    }
  }
  try {
    const sinks = execFileSync('pactl', ['list', 'short', 'sinks'], { encoding: 'utf8', timeout: 4000 });
    if (!/classrec/.test(sinks)) {
      execFileSync('pactl', ['load-module', 'module-null-sink', 'sink_name=classrec', 'sink_properties=device.description=classrec'], { stdio: 'ignore', timeout: 4000 });
    }
    execFileSync('pactl', ['set-default-sink', 'classrec'], { stdio: 'ignore', timeout: 4000 });
  } catch {
    /* không có pactl — bỏ qua */
  }

  return {
    stop() {
      if (!xvfb) return;
      xvfb.kill();
      // Màn hình ảo đã tắt: xoá DISPLAY để lần ghi sau trong cùng tiến trình (selftest) bật màn hình mới.
      delete process.env.DISPLAY;
    },
  };
}
