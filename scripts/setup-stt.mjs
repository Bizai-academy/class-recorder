// Cài bộ phiên âm chạy tại máy (faster-whisper) vào stt-local/.venv và tải mô hình về data/models.
//   node scripts/setup-stt.mjs [tên-mô-hình]
// Chạy lại được nhiều lần: bước nào xong rồi sẽ được bỏ qua nhanh.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, config, paths } from '../src/config.js';

const model = process.argv[2] || config.sttLocalModel;
const venvDir = path.join(ROOT, 'stt-local', '.venv');
const py = paths.sttPython();

function run(cmd, args, { quiet = false } = {}) {
  const r = spawnSync(cmd, args, { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function step(msg) {
  console.log(`\n==> ${msg}`);
}
function fail(msg) {
  console.error(`\nLỖI: ${msg}`);
  process.exit(1);
}

step('Tìm Python');
const sysPython = ['python', 'python3', 'py'].find((c) => run(c, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'], { quiet: true }).ok);
if (!sysPython) fail('Cần Python 3.9 trở lên. Windows: tải tại https://www.python.org/downloads/ (tích "Add python.exe to PATH"). Ubuntu: sudo apt install python3 python3-venv');
console.log(run(sysPython, ['--version'], { quiet: true }).out.trim());

if (!fs.existsSync(py)) {
  step('Tạo môi trường Python riêng (stt-local/.venv)');
  if (!run(sysPython, ['-m', 'venv', venvDir]).ok) fail('Không tạo được môi trường Python. Ubuntu/Debian: sudo apt install python3-venv rồi chạy lại.');
}

step('Cài faster-whisper (lần đầu tải vài trăm MB)');
run(py, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
if (!run(py, ['-m', 'pip', 'install', '--quiet', 'faster-whisper']).ok) fail('Cài faster-whisper thất bại — kiểm tra kết nối mạng rồi chạy lại.');

const hasNvidia = run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { quiet: true });
if (hasNvidia.ok) {
  step(`Có card NVIDIA (${hasNvidia.out.trim().split('\n')[0]}) — cài thư viện để chạy trên GPU (khoảng 1 GB)`);
  // Ghim phiên bản: để pip tự chọn thì nó tải thử rất nhiều bản nặng hàng trăm MB và có thể chạy cả giờ.
  if (!run(py, ['-m', 'pip', 'install', '--quiet', 'nvidia-cublas-cu12==12.4.5.8', 'nvidia-cudnn-cu12==9.1.0.70']).ok) {
    console.log('Không cài được thư viện GPU — bộ phiên âm sẽ chạy trên CPU (chậm hơn).');
  }
} else {
  step('Không thấy card NVIDIA — bộ phiên âm sẽ chạy trên CPU (chậm hơn nhưng vẫn dùng được)');
}

step(`Tải mô hình ${model} về ${paths.models()} (large-v3 khoảng 3 GB; đã có sẵn thì bỏ qua)`);
fs.mkdirSync(paths.models(), { recursive: true });
const dl = run(py, ['-c', 'import sys; from faster_whisper import download_model; print(download_model(sys.argv[1], cache_dir=sys.argv[2]))', model, paths.models()]);
if (!dl.ok) fail('Tải mô hình thất bại — kiểm tra kết nối mạng rồi chạy lại.');

console.log('\nXong. Vào Cài đặt, chọn "Chạy trên máy này" ở mục Phiên âm, bấm Lưu, rồi bấm "Kiểm tra phiên âm".');
