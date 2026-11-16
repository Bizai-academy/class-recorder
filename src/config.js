import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Môi trường gốc, trước khi nạp .env. Giao diện dùng nó để chạy tiến trình con, nhờ vậy tiến trình con
// tự đọc lại .env mới nhất thay vì thừa hưởng giá trị cũ của tiến trình giao diện.
export const baseEnv = { ...process.env };

// Nạp .env (nếu có). Biến môi trường đã đặt sẵn được ưu tiên hơn file .env.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* không có .env — dùng mặc định */
}

const env = (key, fallback) => {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : fallback;
};
const num = (key, fallback) => {
  const v = Number(env(key, ''));
  return Number.isFinite(v) && env(key, '') !== '' ? v : fallback;
};
const bool = (key, fallback) => {
  const v = env(key, '');
  if (v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
};

export const config = {
  dataDir: path.resolve(ROOT, env('CLASSREC_DATA_DIR', 'data')),

  // Giao diện khi truy cập từ xa (VPS): đặt bằng `classrec ui-access`, không sửa tay
  uiPasswordHash: env('UI_PASSWORD_HASH', ''),
  uiPublicHosts: env('UI_PUBLIC_HOSTS', '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),


  // Hiển thị trong phòng học
  botName: env('BOT_NAME', 'Bot ghi hinh buoi hoc'),

  // Trình duyệt
  browserPath: env('BROWSER_PATH', ''), // để trống = tự tìm Chrome/Edge, không có thì dùng Chromium của Playwright
  headless: env('HEADLESS', 'auto'), // auto | true | false
  width: num('VIDEO_WIDTH', 1280),
  height: num('VIDEO_HEIGHT', 720),
  fps: num('VIDEO_FPS', 15),
  videoKbps: num('VIDEO_KBPS', 1200),
  audioKbps: num('AUDIO_KBPS', 96),
  videoCodec: env('VIDEO_CODEC', 'vp8'), // vp8 (nhẹ CPU) | vp9 (file nhỏ hơn)
  outputFormat: env('OUTPUT_FORMAT', 'webm'), // webm (nhanh, không nén lại) | mp4 (nén lại H.264, tốn CPU)

  // Vòng đời buổi học (phút)
  waitOpenMin: num('WAIT_OPEN_MIN', 90), // chờ phòng mở tối đa
  graceMin: num('REJOIN_GRACE_MIN', 5), // sau khi phòng đóng, chờ lệnh rejoin / phòng mở lại
  maxHours: num('MAX_HOURS', 6), // giới hạn an toàn cho cả phiên
  aloneMin: num('ALONE_MIN', 10), // chỉ còn một mình trong phòng quá lâu thì coi như lớp đã tan
  silenceEndMin: num('SILENCE_END_MIN', 30), // phòng im lặng tuyệt đối quá lâu thì coi như lớp đã tan (0 = tắt)
  // Sau khi phòng đóng, có tự thử vào lại link cũ không. Mặc định tắt: Zoom cho vào lại phòng host đã kết thúc,
  // khiến bot ngồi một mình trong phòng trống.
  retrySameLink: bool('RETRY_SAME_LINK', false),
  meetWaitForOthers: bool('MEET_WAIT_FOR_OTHERS', true), // Meet: chỉ vào khi đã có người trong phòng
  acceptTerms: bool('ACCEPT_TERMS', true), // tự bấm "I Agree" điều khoản của Zoom web client khi vào phòng

  // Phiên âm (API tương thích OpenAI /audio/transcriptions)
  sttProvider: env('STT_PROVIDER', 'auto'), // auto | openai | fish | local (auto: nhận theo STT_BASE_URL; local: chạy Whisper tại máy)
  sttLocalModel: env('STT_LOCAL_MODEL', 'large-v3'),
  sttFallbackLocal: bool('STT_FALLBACK_LOCAL', true), // dịch vụ API lỗi/hết hạn mức → tự phiên âm tại máy (nếu đã cài)
  sttLocalDevice: env('STT_LOCAL_DEVICE', 'auto'), // auto | cuda | cpu
  sttLocalThreads: num('STT_LOCAL_THREADS', 0), // số luồng CPU, 0 = tự chọn
  sttBaseUrl: env('STT_BASE_URL', 'https://api.openai.com/v1'),
  sttApiKey: env('STT_API_KEY', ''),
  sttModel: env('STT_MODEL', /fish\.audio/i.test(env('STT_BASE_URL', '')) ? 'transcribe-1-pro' : 'whisper-1'),
  sttLanguage: env('STT_LANGUAGE', 'vi'),
  // Dịch vụ dự phòng: dùng khi dịch vụ chính lỗi hoặc hết tiền (ví dụ Groq miễn phí)
  sttBackupBaseUrl: env('STT_BACKUP_BASE_URL', ''),
  sttBackupApiKey: env('STT_BACKUP_API_KEY', ''),
  sttBackupModel: env('STT_BACKUP_MODEL', ''),

  // Tóm tắt (Claude API)
  summaryModel: env('SUMMARY_MODEL', 'claude-opus-5-5'),
  summaryEffort: env('SUMMARY_EFFORT', 'medium'),
  summaryLanguage: env('SUMMARY_LANGUAGE', 'tiếng Việt'),
  summaryContext: env('SUMMARY_CONTEXT', ''), // ghi chú cho bản tóm tắt: môn học, tên riêng, thuật ngữ hay bị phiên âm sai
  summaryFallbacks: env('SUMMARY_FALLBACKS', 'default'), // default | off
};

export const paths = {
  profile: (name = 'default') => path.join(config.dataDir, 'profiles', name),
  assets: () => path.join(config.dataDir, 'assets'),
  sessions: () => path.join(config.dataDir, 'sessions'),
  models: () => path.join(config.dataDir, 'models'),
  // Python của bộ phiên âm tại máy (môi trường riêng, tạo bằng scripts/setup-stt.mjs)
  sttPython: () => path.join(ROOT, 'stt-local', '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python'),
  active: () => path.join(config.dataDir, 'active.json'),
};
