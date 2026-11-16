// Nhận cài đặt dạng JSON qua stdin và ghi vào .env (dùng để chép cài đặt/API key từ máy khác sang mà không
// để lộ giá trị trên dòng lệnh):   node scripts/export-settings.mjs | ssh <vps> "cd /opt/class-recorder && node scripts/import-settings.mjs"
import { writeEnv } from '../src/settings.js';

const ALLOWED = new Set(['STT_PROVIDER', 'STT_BASE_URL', 'STT_MODEL', 'STT_API_KEY', 'STT_LANGUAGE', 'STT_BACKUP_BASE_URL', 'STT_BACKUP_MODEL', 'STT_BACKUP_API_KEY', 'ANTHROPIC_API_KEY', 'SUMMARY_MODEL', 'SUMMARY_EFFORT']);

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.error('Dữ liệu nhận được không phải JSON hợp lệ.');
  process.exit(1);
}
const updates = {};
for (const [k, v] of Object.entries(data)) {
  if (ALLOWED.has(k) && typeof v === 'string' && !/[\r\n]/.test(v)) updates[k] = v;
}
if (!Object.keys(updates).length) {
  console.error('Không có cài đặt nào hợp lệ để ghi.');
  process.exit(1);
}
writeEnv(updates);
// Chỉ in tên, không in giá trị.
console.log('Đã ghi: ' + Object.keys(updates).map((k) => (/KEY/.test(k) ? `${k} (${updates[k].length} ký tự)` : `${k}=${updates[k]}`)).join(', '));
