// Dựng bản đóng gói cho Windows:  node scripts/build-windows.mjs
//   dist/ClassRecorder/                 thư mục chạy ngay (bấm đúp "Class Recorder.bat"), kèm sẵn Node và thư viện
//   dist/ClassRecorder-<bản>-win-x64.zip
//   dist/ClassRecorder-Setup-<bản>.exe  (chỉ khi máy có Inno Setup 6)
// Không kèm: .env (key), data (buổi ghi), ghi chú nội bộ, src/remote-login.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

if (process.platform !== 'win32') {
  console.error('Lệnh này dựng bản Windows nên phải chạy trên Windows.');
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const dist = path.join(ROOT, 'dist');
const stage = path.join(dist, 'ClassRecorder');
const step = (m) => console.log(`\n==> ${m}`);
const die = (m) => {
  console.error(`LỖI: ${m}`);
  process.exit(1);
};

step('Gom file chương trình');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
if (ls.status !== 0) die('Không đọc được danh sách file từ git.');
const SKIP = [/^CLAUDE\.md$/, /^\.git/, /^installer\//, /^scripts\/(deploy|build-windows|install-vps)/, /^HUONG-DAN-VPS\.md$/, /remote-login/];
const files = ls.stdout.split('\0').filter((f) => f && !SKIP.some((rx) => rx.test(f)));
for (const f of files) {
  const to = path.join(stage, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), to);
}
console.log(`${files.length} file`);

step('Kèm Node và thư viện');
fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(stage, 'runtime', 'node.exe'));
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'playwright'))) die('Chưa có node_modules. Chạy "npm install" trước.');
fs.cpSync(path.join(ROOT, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true });
console.log(`Node ${process.version}`);

step('Kiểm tra bản đóng gói tự chạy được');
const t = spawnSync(path.join(stage, 'runtime', 'node.exe'), ['src/cli.js', 'list'], { cwd: stage, encoding: 'utf8' });
if (t.status !== 0) die(`Bản đóng gói không chạy được:\n${t.stderr}`);
for (const leak of ['.env', 'data', 'src/remote-login.js', 'CLAUDE.md', 'CLAUDE.local.md']) {
  if (fs.existsSync(path.join(stage, leak))) die(`Bản đóng gói lẫn "${leak}" — dừng lại.`);
}
console.log('Chạy được; không lẫn key, dữ liệu hay ghi chú nội bộ.');

step('Nén zip');
const zip = path.join(dist, `ClassRecorder-${version}-win-x64.zip`);
const tar = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe');
if (spawnSync(tar, ['-a', '-cf', zip, '-C', dist, 'ClassRecorder'], { stdio: 'inherit' }).status !== 0) die('Nén zip thất bại.');
console.log(`${path.relative(ROOT, zip)}  ${(fs.statSync(zip).size / 1e6).toFixed(0)} MB`);

step('Tạo file cài đặt');
const innoIn = (base, ...sub) => (base ? path.join(base, ...sub, 'Inno Setup 6', 'ISCC.exe') : null);
const iscc = [process.env.ISCC, innoIn(process.env['PROGRAMFILES(X86)']), innoIn(process.env.PROGRAMFILES), innoIn(process.env.LOCALAPPDATA, 'Programs')].find((p) => p && fs.existsSync(p));
if (!iscc) {
  console.log('Máy chưa có Inno Setup 6 nên bỏ qua bước này (đã có thư mục chạy ngay và file zip).');
} else {
  const r = spawnSync(iscc, ['/Qp', `/DAppVersion=${version}`, `/DSourceDir=${stage}`, path.join(ROOT, 'installer', 'class-recorder.iss')], { stdio: 'inherit' });
  if (r.status !== 0) die('Inno Setup báo lỗi.');
  const exe = path.join(dist, `ClassRecorder-Setup-${version}.exe`);
  console.log(`${path.relative(ROOT, exe)}  ${(fs.statSync(exe).size / 1e6).toFixed(0)} MB`);
}
console.log('\nXong.');
