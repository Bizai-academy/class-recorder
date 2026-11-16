// In cài đặt phiên âm và tóm tắt (kể cả API key) của máy này ra stdout dạng JSON, để chuyển thẳng sang máy khác
// qua đường ống SSH. Xem scripts/import-settings.mjs. Đừng chạy lệnh này rồi dán kết quả vào đâu: nó chứa API key.
import fs from 'node:fs';
import { ENV_FILE, parseEnv } from '../src/settings.js';

const env = parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
const out = {};
for (const k of ['STT_BASE_URL', 'STT_MODEL', 'STT_API_KEY', 'STT_LANGUAGE', 'STT_BACKUP_BASE_URL', 'STT_BACKUP_MODEL', 'STT_BACKUP_API_KEY', 'ANTHROPIC_API_KEY', 'SUMMARY_MODEL', 'SUMMARY_EFFORT']) {
  if (env[k]) out[k] = env[k];
}
// Máy nhận có thể chưa cài bộ phiên âm tại máy → luôn để chế độ qua dịch vụ API.
out.STT_PROVIDER = 'auto';
process.stdout.write(JSON.stringify(out));
