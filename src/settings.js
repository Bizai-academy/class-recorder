import fs from 'node:fs';
import path from 'node:path';
import { ROOT, paths } from './config.js';

/** Đọc/ghi cài đặt trong file .env cho giao diện. Giá trị mặc định ở đây phải khớp với src/config.js. */

export const ENV_FILE = path.join(ROOT, '.env');

export const SCHEMA = [
  {
    title: 'Trong phòng học',
    fields: [{ key: 'BOT_NAME', label: 'Tên hiển thị của bot', type: 'text', default: 'Bot ghi hinh buoi hoc', help: 'Giảng viên và các bạn học sẽ thấy tên này trong danh sách người tham dự.' }],
  },
  {
    title: 'Phiên âm (chuyển tiếng nói thành chữ)',
    id: 'stt',
    fields: [
      { key: 'STT_PROVIDER', label: 'Cách phiên âm', type: 'select', default: 'auto', options: [['auto', 'Qua dịch vụ API (điền bên dưới)'], ['local', 'Chạy trên máy này — miễn phí']], help: 'Chạy trên máy: không tốn phí, âm thanh không rời khỏi máy. Cần bấm "Cài bộ phiên âm trên máy" ở cuối trang một lần.' },
      { key: 'STT_LOCAL_MODEL', label: 'Mô hình khi chạy trên máy', type: 'select', default: 'large-v3', options: [['large-v3', 'large-v3 — chính xác nhất (khuyên dùng)'], ['large-v3-turbo', 'large-v3-turbo — nhanh gấp đôi, kém chính xác hơn'], ['mad1999/pho-whisper-large-ct2', 'PhoWhisper-large — chuyên tiếng Việt, từ tiếng Anh bị viết kiểu Việt'], ['medium', 'medium — cho máy yếu'], ['small', 'small — nhanh nhất, kém chính xác']], help: 'Đổi mô hình thì bấm lại "Cài bộ phiên âm trên máy" để tải mô hình mới (large-v3 khoảng 3 GB).' },
      { key: 'STT_FALLBACK_LOCAL', label: 'Dịch vụ API lỗi hoặc hết hạn mức thì tự phiên âm trên máy', type: 'bool', default: 'true', help: 'Chỉ có tác dụng khi đã cài bộ phiên âm trên máy.' },
      { key: 'STT_BASE_URL', label: 'Địa chỉ dịch vụ API', type: 'text', default: 'https://api.openai.com/v1', help: 'Bấm một nút ở trên để điền sẵn, hoặc nhập địa chỉ API tương thích OpenAI.' },
      { key: 'STT_MODEL', label: 'Model của dịch vụ API', type: 'text', default: 'whisper-1' },
      { key: 'STT_API_KEY', label: 'API key phiên âm', type: 'secret', default: '', help: 'Chỉ cần khi phiên âm qua dịch vụ API.' },
      { key: 'STT_BACKUP_BASE_URL', label: 'Dịch vụ dự phòng: địa chỉ API', type: 'text', default: '', help: 'Dùng khi dịch vụ chính lỗi hoặc hết tiền: bot giữ phần đã phiên âm và gửi phần còn lại sang đây. Bấm "Groq làm dự phòng" ở trên để điền sẵn.' },
      { key: 'STT_BACKUP_MODEL', label: 'Dịch vụ dự phòng: model', type: 'text', default: '' },
      { key: 'STT_BACKUP_API_KEY', label: 'Dịch vụ dự phòng: API key', type: 'secret', default: '', help: 'Key miễn phí của Groq lấy ở console.groq.com.' },
      { key: 'STT_LANGUAGE', label: 'Ngôn ngữ lớp học', type: 'select', default: 'vi', options: [['vi', 'Tiếng Việt'], ['en', 'Tiếng Anh'], ['zh', 'Tiếng Trung'], ['ja', 'Tiếng Nhật'], ['ko', 'Tiếng Hàn'], ['', 'Tự nhận diện']] },
    ],
  },
  {
    title: 'Tóm tắt (Claude)',
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'API key Claude', type: 'secret', default: '', help: 'Để trống thì bot vẫn ghi hình và phiên âm, chỉ không tạo file tóm tắt.' },
      { key: 'SUMMARY_MODEL', label: 'Model tóm tắt', type: 'select', default: 'claude-opus-5-5', options: [['claude-opus-5-5', 'Claude Opus 5.5 — kỹ nhất'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — cân bằng'], ['claude-haiku-5-5', 'Claude Haiku 5.5 — rẻ nhất']] },
      { key: 'SUMMARY_EFFORT', label: 'Mức độ suy nghĩ', type: 'select', default: 'medium', options: [['low', 'Thấp — nhanh, rẻ'], ['medium', 'Vừa'], ['high', 'Cao — kỹ hơn, tốn hơn']] },
      { key: 'SUMMARY_LANGUAGE', label: 'Ngôn ngữ bản tóm tắt', type: 'text', default: 'tiếng Việt' },
      { key: 'SUMMARY_CONTEXT', label: 'Ghi chú về lớp học', type: 'text', default: '', help: 'Môn học, tên giảng viên, tên riêng và thuật ngữ hay bị phiên âm sai. Ví dụ: "Lớp về AI agent. Tên đúng: Mausbot, Gemini, Antigravity, Twilio." Claude dùng ghi chú này để sửa tên trong bản tóm tắt.' },
    ],
  },
  {
    title: 'Lịch Google',
    fields: [
      { key: 'CALENDAR_ICS_URL', label: 'Địa chỉ bí mật iCal của lịch', type: 'secret', default: '', help: 'Google Calendar trên máy tính → Cài đặt → chọn lịch → "Tích hợp lịch" → sao chép "Địa chỉ bí mật ở định dạng iCal". Bot đọc lịch mỗi 10 phút và tự tạo lịch ghi cho sự kiện có link Zoom/Meet trong 36 giờ tới. Ai có địa chỉ này đều xem được lịch, nên đừng chia sẻ nó.' },
      { key: 'CALENDAR_KEYWORD', label: 'Chỉ ghi sự kiện có chữ này trong tên', type: 'text', default: '', help: 'Ví dụ "Lớp" hoặc "[ghi]". Để trống = ghi MỌI sự kiện có link Zoom/Meet, kể cả các cuộc họp khác.' },
      { key: 'CALENDAR_LEAD_MIN', label: 'Bắt đầu ghi sớm hơn giờ sự kiện (phút)', type: 'number', default: '5', min: 0, max: 60 },
    ],
  },
  {
    title: 'Dọn dẹp và dung lượng',
    fields: [
      { key: 'RETENTION_DAYS', label: 'Tự dọn buổi ghi cũ hơn (ngày)', type: 'number', default: '0', min: 0, help: '0 = không tự dọn. Bot kiểm tra mỗi giờ.' },
      { key: 'DISK_WARN_GB', label: 'Báo khi đĩa còn trống dưới (GB)', type: 'number', default: '5', min: 0, help: 'Hiện thông báo ở chuông 🔔 tối đa một lần mỗi ngày. 0 = tắt.' },
      { key: 'RETENTION_KEEP_TEXT', label: 'Khi dọn, chỉ xoá video — giữ phiên âm và tóm tắt', type: 'bool', default: 'true', help: 'Giữ lại thì vẫn tìm kiếm và hỏi đáp được về buổi đó. Tắt đi thì xoá hẳn cả buổi.' },
    ],
  },
  {
    title: 'Vòng đời buổi học',
    fields: [
      { key: 'MAX_PARALLEL', label: 'Số lớp ghi cùng lúc tối đa', type: 'number', default: '2', min: 1, max: 3, help: 'Mỗi lớp cần một trình duyệt riêng, khá nặng máy. VPS 6 nhân / 8 GB: nên để 2.' },
      { key: 'WAIT_OPEN_MIN', label: 'Chờ phòng mở tối đa (phút)', type: 'number', default: '90', min: 1, help: 'Quá thời gian này mà phòng chưa mở thì bot dừng.' },
      { key: 'REJOIN_GRACE_MIN', label: 'Chờ rejoin sau khi phòng đóng (phút)', type: 'number', default: '5', min: 0, help: 'Khoảng thời gian bot chờ bạn gửi link mới hoặc phòng mở lại. 0 = kết thúc ngay.' },
      { key: 'MAX_HOURS', label: 'Thời lượng tối đa một buổi (giờ)', type: 'number', default: '6', min: 0.1 },
      { key: 'ALONE_MIN', label: 'Tự kết thúc khi chỉ còn một mình (phút)', type: 'number', default: '10', min: 1 },
      { key: 'SILENCE_END_MIN', label: 'Tự kết thúc khi phòng im lặng tuyệt đối (phút)', type: 'number', default: '30', min: 0, help: 'Không một ai phát ra tiếng trong ngần này phút thì coi như lớp đã tan. 0 = tắt.' },
      { key: 'RETRY_SAME_LINK', label: 'Sau khi phòng đóng, tự thử vào lại link cũ', type: 'bool', default: 'false', help: 'Chỉ bật nếu lớp hay bị ngắt rồi mở lại đúng link cũ. Nếu vào lại mà phòng trống, bot tự rời sau 1 phút.' },
      { key: 'MEET_WAIT_FOR_OTHERS', label: 'Google Meet: chỉ vào khi phòng đã có người', type: 'bool', default: 'true' },
      { key: 'ACCEPT_TERMS', label: 'Zoom: tự bấm đồng ý điều khoản khi vào phòng', type: 'bool', default: 'true', help: 'Tắt đi thì bot sẽ dừng ở màn hình điều khoản của Zoom.' },
    ],
  },
  {
    title: 'Chất lượng ghi',
    fields: [
      { key: 'VIDEO_SIZE', label: 'Độ phân giải', type: 'select', default: '1280x720', virtual: ['VIDEO_WIDTH', 'VIDEO_HEIGHT'], options: [['960x540', '540p — nhẹ nhất'], ['1280x720', '720p — khuyên dùng'], ['1920x1080', '1080p — nét, nặng máy']] },
      { key: 'VIDEO_FPS', label: 'Số khung hình mỗi giây', type: 'number', default: '15', min: 5, max: 30 },
      { key: 'VIDEO_KBPS', label: 'Chất lượng hình (kbps)', type: 'number', default: '1200', min: 200, help: '1200 kbps chiếm khoảng 0,6 GB mỗi giờ.' },
      { key: 'VIDEO_CODEC', label: 'Bộ mã hoá hình', type: 'select', default: 'vp8', options: [['vp8', 'VP8 — nhẹ máy'], ['vp9', 'VP9 — file nhỏ hơn, nặng máy hơn']] },
      { key: 'OUTPUT_FORMAT', label: 'Định dạng file xuất', type: 'select', default: 'webm', options: [['webm', 'WebM — xuất nhanh'], ['mp4', 'MP4 — mở được ở mọi nơi, xuất chậm hơn']] },
    ],
  },
  {
    title: 'Trình duyệt',
    fields: [
      { key: 'HEADLESS', label: 'Cửa sổ trình duyệt của bot', type: 'select', default: 'auto', options: [['auto', 'Tự động'], ['false', 'Luôn hiện cửa sổ'], ['true', 'Chạy ẩn (không hiện cửa sổ)']] },
      { key: 'BROWSER_PATH', label: 'Đường dẫn Chrome/Edge', type: 'text', default: '', help: 'Để trống để bot tự tìm.' },
    ],
  },
];

const FIELDS = SCHEMA.flatMap((g) => g.fields);

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
    if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) v = v.slice(1, v.indexOf(q, 1));
    else v = v.replace(/(^|\s+)#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

function readEnv() {
  try {
    return parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function formatValue(v) {
  if (v === '') return '';
  if (/#|^\s|\s$/.test(v)) return v.includes('"') ? `'${v}'` : `"${v}"`;
  return v;
}

/** Trả về cấu trúc cho giao diện. Key bí mật không bao giờ được gửi ra — chỉ báo đã đặt hay chưa và 4 ký tự cuối. */
export function readSettings() {
  const env = readEnv();
  return SCHEMA.map((g) => ({
    title: g.title,
    id: g.id || null,
    fields: g.fields.map((f) => {
      const base = { key: f.key, label: f.label, type: f.type, help: f.help || '', options: f.options || null, min: f.min ?? null, max: f.max ?? null };
      if (f.type === 'secret') {
        const v = env[f.key] || '';
        return { ...base, isSet: !!v, hint: v ? v.slice(-4) : '' };
      }
      if (f.virtual) {
        const [w, h] = f.virtual.map((k) => env[k]);
        return { ...base, value: w && h ? `${w}x${h}` : f.default };
      }
      return { ...base, value: env[f.key] !== undefined ? env[f.key] : f.default };
    }),
  }));
}

export function keyStatus() {
  const env = readEnv();
  const local = env.STT_PROVIDER === 'local';
  const localInstalled = fs.existsSync(paths.sttPython());
  // stt = phiên âm đã sẵn sàng: có key API, hoặc chọn chạy tại máy và đã cài bộ phiên âm.
  const hasApi = !!env.STT_API_KEY || (!!env.STT_BACKUP_API_KEY && !!env.STT_BACKUP_BASE_URL);
  const fallbackLocal = localInstalled && env.STT_FALLBACK_LOCAL !== 'false';
  return { stt: local ? localInstalled : hasApi || fallbackLocal, sttLocal: local, sttLocalInstalled: localInstalled, sttBackup: !!env.STT_BACKUP_API_KEY && !!env.STT_BACKUP_BASE_URL, anthropic: !!env.ANTHROPIC_API_KEY };
}

/** Kiểm tra và ghi cài đặt vào .env. Giữ nguyên các dòng khác (chú thích, biến không thuộc giao diện). */
export function saveSettings(values) {
  const updates = {};
  for (const f of FIELDS) {
    if (!(f.key in values)) continue;
    let v = String(values[f.key] ?? '').replace(/[\r\n]/g, ' ').trim();
    if (f.type === 'secret') {
      if (v === '') continue; // để trống = giữ nguyên key đang lưu
      if (v === '__clear__') v = '';
      updates[f.key] = v;
    } else if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
        throw new Error(`"${f.label}" phải là số${f.min !== undefined ? ` từ ${f.min}` : ''}${f.max !== undefined ? ` đến ${f.max}` : ''}.`);
      }
      updates[f.key] = String(n);
    } else if (f.type === 'bool') {
      updates[f.key] = v === 'true' ? 'true' : 'false';
    } else if (f.type === 'select') {
      if (!f.options.some(([o]) => o === v)) throw new Error(`Giá trị không hợp lệ cho "${f.label}".`);
      if (f.virtual) {
        const [w, h] = v.split('x');
        updates[f.virtual[0]] = w;
        updates[f.virtual[1]] = h;
      } else {
        updates[f.key] = v;
      }
    } else {
      updates[f.key] = v;
    }
  }
  for (const k of ['STT_BASE_URL', 'STT_BACKUP_BASE_URL']) {
    if (updates[k] !== undefined && updates[k] !== '' && !/^https?:\/\//i.test(updates[k])) {
      throw new Error('Địa chỉ dịch vụ phiên âm phải bắt đầu bằng http:// hoặc https://');
    }
  }

  writeEnv(updates);
  return Object.keys(updates).length;
}

/** Ghi các cặp KEY=giá-trị vào .env, giữ nguyên những dòng khác. */
export function writeEnv(updates) {
  let lines = [];
  try {
    lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  } catch {
    /* chưa có .env — tạo mới */
  }
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${formatValue(value)}`;
    const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
}
