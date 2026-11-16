// Kiểm thử chuỗi phiên âm dự phòng bằng hai "dịch vụ phiên âm giả" trên localhost (không tốn tiền, không cần mạng):
//   node test/stt-fallback-check.mjs
// Dịch vụ chính (kiểu Fish) trả đúng 2 khúc rồi báo hết tiền (402). Dịch vụ dự phòng (kiểu OpenAI/Groq) báo hết hạn mức
// (429 + Retry-After) một lần rồi mới trả kết quả. Kiểm tra: chuyển đúng chỗ, giữ phần đã xong, chờ hạn mức, dừng đúng khi hết cách.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { transcribeChunks, apiProviders, toText } from '../src/transcribe.js';

function fakeService(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls.push(req.url);
      const r = handler(calls.length, req);
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers || {}) });
      res.end(JSON.stringify(r.body || {}));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}/v1` })));
}

/** Chạy các kịch bản và trả về danh sách { name, ok, detail }. `selftest` cũng gọi hàm này. */
export async function sttFallbackChecks() {
const results = [];
const check = (name, ok, detail = '') => results.push({ name: `Phiên âm dự phòng — ${name}`, ok: !!ok, detail });
// Bài thử đổi cấu hình phiên âm trong bộ nhớ → lưu lại để trả về như cũ khi xong.
const KEYS = ['sttProvider', 'sttBaseUrl', 'sttApiKey', 'sttModel', 'sttBackupBaseUrl', 'sttBackupApiKey', 'sttBackupModel'];
const saved = Object.fromEntries(KEYS.map((k) => [k, config[k]]));

// Dịch vụ chính: 2 khúc đầu thành công, từ lần gọi thứ 3 báo hết tiền.
const primary = await fakeService((n) => (n <= 2 ? { status: 200, body: { text: `chinh ${n}`, segments: [{ start: 5, text: `chinh khuc ${n}` }] } } : { status: 402, body: { message: 'insufficient balance' } }));
// Dịch vụ dự phòng: lần đầu báo hết hạn mức (chờ 1 giây), sau đó thành công.
let backupOk = 0;
const backup = await fakeService((n) => (n === 1 ? { status: 429, headers: { 'retry-after': '1' }, body: { error: 'rate limit' } } : { status: 200, body: { text: `du phong ${++backupOk}`, segments: [{ start: 7, text: `du phong khuc ${backupOk}` }] } }));
// Dịch vụ dự phòng hỏng hẳn (cho kịch bản không còn cách nào).
const dead = await fakeService(() => ({ status: 401, body: { error: 'invalid key' } }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classrec-stt-'));
const chunks = [0, 1, 2, 3].map((i) => {
  const f = path.join(dir, `chunk-${i}.mp3`);
  fs.writeFileSync(f, Buffer.alloc(2048, i));
  return f;
});
const logs = [];
const log = (m) => logs.push(m);

try {
  // Kịch bản A: chính (Fish) hết tiền ở khúc 3 → dự phòng làm khúc 3 và 4.
  Object.assign(config, { sttProvider: 'auto', sttBaseUrl: primary.url.replace('/v1', '/fish.audio/v1'), sttApiKey: 'k1', sttModel: 'm1', sttBackupBaseUrl: backup.url, sttBackupApiKey: 'k2', sttBackupModel: 'm2' });
  const provs = apiProviders();
  check('Nhận đủ 2 dịch vụ: chính kiểu Fish, dự phòng kiểu OpenAI', provs.length === 2 && provs[0].kind === 'fish' && provs[1].kind === 'openai', provs.map((p) => `${p.label}:${p.kind}`).join(', '));
  const t0 = Date.now();
  const a = await transcribeChunks(chunks, { chunkSeconds: 600, log });
  const took = Date.now() - t0;
  check('A: phiên âm trọn 4 khúc, không lỗi', a.error === null && a.doneChunks === 4, `doneChunks=${a.doneChunks}, error=${a.error?.message}`);
  check('A: chuyển sang dự phòng đúng từ khúc thứ 3', a.switchedAtChunk === 2, `switchedAtChunk=${a.switchedAtChunk}`);
  check('A: giữ nguyên 2 khúc đầu của dịch vụ chính', a.pieces.filter((p) => /chinh/.test(p.text)).length === 2, a.pieces.map((p) => p.text).join(' | '));
  check('A: 2 khúc sau do dự phòng, đúng mốc thời gian (20 phút, 30 phút)', a.pieces.filter((p) => /du phong/.test(p.text)).map((p) => p.t).join(',') === '1207,1807', a.pieces.map((p) => p.t).join(','));
  check('A: gặp 429 thì chờ theo Retry-After rồi gửi tiếp', took >= 1900 && logs.some((l) => /hết hạn mức/.test(l)), `${took} ms`);
  check('A: dịch vụ chính gọi đúng đường /asr, dự phòng gọi /audio/transcriptions', primary.calls.every((u) => u.endsWith('/asr')) && backup.calls.every((u) => u.endsWith('/audio/transcriptions')), `${primary.calls[0]} · ${backup.calls[0]}`);
  const text = toText(a.pieces);
  check('A: bản phiên âm ghép đúng thứ tự thời gian', /^\[00:00:05\]/.test(text) && text.indexOf('chinh khuc 2') < text.indexOf('du phong khuc 1'), text.replace(/\n+/g, ' ').slice(0, 120));

  // Kịch bản B: không có dự phòng → dừng ở khúc 3 nhưng vẫn trả về 2 khúc đã xong.
  primary.calls.length = 0;
  Object.assign(config, { sttBackupBaseUrl: '', sttBackupApiKey: '' });
  const p2 = await fakeService((n) => (n <= 2 ? { status: 200, body: { text: `chinh ${n}` } } : { status: 402, body: { message: 'insufficient balance' } }));
  config.sttBaseUrl = p2.url;
  const b = await transcribeChunks(chunks, { chunkSeconds: 600, log });
  check('B: không có dự phòng → dừng sau 2 khúc, báo lỗi 402, vẫn giữ phần đã xong', b.error && /402/.test(b.error.message) && b.doneChunks === 2 && b.pieces.length === 2, `doneChunks=${b.doneChunks}, pieces=${b.pieces.length}, error=${b.error?.message}`);
  p2.server.close();

  // Kịch bản C: cả hai dịch vụ đều hỏng ngay từ đầu → báo lỗi, không có phần nào.
  Object.assign(config, { sttBaseUrl: dead.url, sttBackupBaseUrl: dead.url, sttBackupApiKey: 'k2' });
  const c = await transcribeChunks(chunks, { chunkSeconds: 600, log });
  check('C: cả hai dịch vụ hỏng → báo lỗi rõ, không bịa nội dung', c.error && c.doneChunks === 0 && c.pieces.length === 0, `error=${c.error?.message}`);
} finally {
  for (const s of [primary, backup, dead]) s.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  Object.assign(config, saved);
}
return results;
}

// Chạy trực tiếp: node test/stt-fallback-check.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await sttFallbackChecks();
  for (const r of results) console.log(`${r.ok ? 'ĐẠT ' : 'LỖI '} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const pass = results.every((r) => r.ok);
  console.log(pass ? '\nChuỗi phiên âm dự phòng hoạt động đúng.' : '\nCó mục chưa đạt.');
  process.exit(pass ? 0 : 1);
}
