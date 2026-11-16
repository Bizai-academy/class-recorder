// Kiểm tra nhanh cấu hình phiên âm trong .env:  node test/stt-check.mjs [file-âm-thanh]
// Thử LẦN LƯỢT từng cách đã cài đặt: dịch vụ chính → dịch vụ dự phòng → bộ phiên âm trên máy, và in kết quả từng cách.
// Không đưa file thì dùng câu mẫu tiếng Việt có sẵn (test/sample-vi.mp3) để so với câu gốc.
// Lưu ý: mỗi lần chạy tốn một ít phí của dịch vụ chính (câu mẫu dài vài giây).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, config } from '../src/config.js';
import { runFfmpeg } from '../src/post.js';
import { transcribe, transcribeLocal, sttProvider, localSttInstalled, apiProviders } from '../src/transcribe.js';

const SAMPLE_TEXT = 'Xin chào các bạn. Hôm nay chúng ta học về đạo hàm của hàm số. Bài tập về nhà là bài số ba và bài số năm, hạn nộp vào thứ sáu tuần này.';
const sample = path.join(ROOT, 'test', 'sample-vi.mp3');
const file = process.argv[2] || sample;

if (!fs.existsSync(file)) {
  console.error(`Không tìm thấy file âm thanh: ${file}`);
  process.exit(1);
}

const local = sttProvider() === 'local';
const methods = [];
if (!local) {
  for (const prov of apiProviders()) {
    methods.push({
      name: `Dịch vụ ${prov.label} (${prov.name} · model ${prov.model})`,
      run: () => transcribe([file], { chunkSeconds: 600, log: console.log, providers: [prov] }),
    });
  }
  if (!config.sttApiKey) console.log('Dịch vụ chính: chưa đặt API key — bỏ qua.');
  if (!config.sttBackupApiKey || !config.sttBackupBaseUrl) console.log('Dịch vụ dự phòng: chưa đặt — bỏ qua.');
}
if (local || config.sttFallbackLocal) {
  if (localSttInstalled()) {
    methods.push({
      name: `Phiên âm trên máy (mô hình ${config.sttLocalModel})`,
      run: async () => {
        // Bộ phiên âm tại máy nhận WAV mono 16 kHz → chuyển trước bằng ffmpeg.
        const wav = path.join(os.tmpdir(), `classrec-stt-check-${process.pid}.wav`);
        const r = await runFfmpeg(['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav]);
        if (r.code !== 0) throw new Error('Không đọc được file âm thanh');
        try {
          return await transcribeLocal(wav, { log: console.log });
        } finally {
          fs.rmSync(wav, { force: true });
        }
      },
    });
  } else {
    console.log('Phiên âm trên máy: chưa cài — bỏ qua (cài ở tab Cài đặt hoặc: node scripts/setup-stt.mjs).');
  }
}

if (!methods.length) {
  console.error('Chưa có cách phiên âm nào dùng được. Thêm API key ở tab Cài đặt, hoặc cài bộ phiên âm trên máy.');
  process.exit(1);
}

console.log(`Ngôn ngữ: ${config.sttLanguage || 'tự nhận diện'}`);
if (file === sample) console.log(`Câu mẫu : ${SAMPLE_TEXT}`);

let failed = 0;
for (const m of methods) {
  console.log(`\n── ${m.name} ──`);
  try {
    const t0 = Date.now();
    const text = await m.run();
    console.log(`ĐẠT (${((Date.now() - t0) / 1000).toFixed(1)} giây):\n${text}`);
  } catch (e) {
    failed++;
    console.error(`LỖI: ${e.message}`);
  }
}
console.log(`\n${methods.length - failed}/${methods.length} cách phiên âm chạy được.`);
process.exitCode = failed ? 1 : 0;
