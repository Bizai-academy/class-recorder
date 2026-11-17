// Đóng gói Class Recorder cho hệ điều hành đang chạy lệnh này:  node scripts/build.mjs
//   Windows → dist/ClassRecorder-<bản>-win-x64.zip   (+ ClassRecorder-Setup-<bản>.exe nếu máy có Inno Setup 6)
//   macOS   → dist/ClassRecorder-<bản>-mac-<arm64|x64>.zip
//   Linux   → dist/ClassRecorder-<bản>-linux-x64.tar.gz
// Mỗi gói kèm sẵn Node và thư viện của đúng hệ điều hành đó (ffmpeg là file chạy riêng cho từng hệ), nên phải dựng
// trên chính hệ điều hành đó — quy trình GitHub Actions (.github/workflows/release.yml) dựng cả ba cùng lúc.
// Không kèm: .env (key), data (buổi ghi), ghi chú nội bộ, src/remote-login.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

const OS = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
if (!OS) {
  console.error(`Chưa hỗ trợ đóng gói cho ${process.platform}.`);
  process.exit(1);
}
const arch = process.arch;
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const dist = path.join(ROOT, 'dist');
const stage = path.join(dist, 'ClassRecorder');
const step = (m) => console.log(`\n==> ${m}`);
const die = (m) => {
  console.error(`LỖI: ${m}`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...opts }).status === 0;

step(`Gom file chương trình (${OS}-${arch})`);
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
if (ls.status !== 0) die('Không đọc được danh sách file từ git.');
// Mỗi gói chỉ kèm file khởi động của hệ điều hành mình.
const LAUNCHERS = { win: 'Class Recorder.bat', mac: 'Class Recorder.command', linux: 'class-recorder.sh' };
const otherLaunchers = Object.entries(LAUNCHERS).filter(([os]) => os !== OS).map(([, f]) => f);
const SKIP = [/^CLAUDE\.md$/, /^\.git/, /^\.github\//, /^installer\//, /^scripts\/(deploy|build)/, /^HUONG-DAN-VPS\.md$/, /remote-login/];
const files = ls.stdout.split('\0').filter((f) => f && !SKIP.some((rx) => rx.test(f)) && !otherLaunchers.includes(f));
for (const f of files) {
  const to = path.join(stage, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), to);
}
if (OS !== 'win') for (const f of [LAUNCHERS[OS], 'scripts/setup-vps.sh', 'scripts/install-vps.sh']) if (fs.existsSync(path.join(stage, f))) fs.chmodSync(path.join(stage, f), 0o755);
console.log(`${files.length} file`);

step('Kèm Node và thư viện');
const nodeName = OS === 'win' ? 'node.exe' : 'node';
fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(stage, 'runtime', nodeName));
if (OS !== 'win') fs.chmodSync(path.join(stage, 'runtime', nodeName), 0o755);
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'playwright'))) die('Chưa có node_modules. Chạy "npm ci" trước.');
// cpSync giữ quyền chạy của ffmpeg; trên macOS/Linux dùng cp -a để giữ cả liên kết mềm trong node_modules.
if (OS === 'win') fs.cpSync(path.join(ROOT, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true });
else if (!run('cp', ['-a', path.join(ROOT, 'node_modules'), path.join(stage, 'node_modules')])) die('Chép node_modules thất bại.');
console.log(`Node ${process.version}`);

step('Kiểm tra bản đóng gói tự chạy được');
const t = spawnSync(path.join(stage, 'runtime', nodeName), ['src/cli.js', 'list'], { cwd: stage, encoding: 'utf8' });
if (t.status !== 0) die(`Bản đóng gói không chạy được:\n${t.stderr}`);
const ffmpeg = spawnSync(path.join(stage, 'runtime', nodeName), ['-e', "const f=require('ffmpeg-static');const r=require('child_process').spawnSync(f,['-version']);process.exit(r.status)"], { cwd: stage });
if (ffmpeg.status !== 0) die('ffmpeg kèm theo không chạy được trên hệ điều hành này.');
for (const leak of ['.env', 'data', 'src/remote-login.js', 'CLAUDE.md', 'CLAUDE.local.md']) {
  if (fs.existsSync(path.join(stage, leak))) die(`Bản đóng gói lẫn "${leak}" — dừng lại.`);
}
console.log('Chạy được, ffmpeg chạy được; không lẫn key, dữ liệu hay ghi chú nội bộ.');

step('Nén');
const base = `ClassRecorder-${version}-${OS}-${arch}`;
let archive;
if (OS === 'win') {
  archive = path.join(dist, `${base}.zip`);
  const tar = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe');
  if (!run(tar, ['-a', '-cf', archive, '-C', dist, 'ClassRecorder'])) die('Nén zip thất bại.');
} else if (OS === 'mac') {
  // ditto giữ quyền chạy và liên kết mềm, đúng kiểu zip mà Finder giải nén được.
  archive = path.join(dist, `${base}.zip`);
  if (!run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stage, archive])) die('Nén zip thất bại.');
} else {
  archive = path.join(dist, `${base}.tar.gz`);
  if (!run('tar', ['-czf', archive, '-C', dist, 'ClassRecorder'])) die('Nén tar.gz thất bại.');
}
console.log(`${path.relative(ROOT, archive)}  ${(fs.statSync(archive).size / 1e6).toFixed(0)} MB`);

if (OS === 'win') {
  step('Tạo file cài đặt');
  const innoIn = (dir, ...sub) => (dir ? path.join(dir, ...sub, 'Inno Setup 6', 'ISCC.exe') : null);
  const iscc = [process.env.ISCC, innoIn(process.env['PROGRAMFILES(X86)']), innoIn(process.env.PROGRAMFILES), innoIn(process.env.LOCALAPPDATA, 'Programs')].find((p) => p && fs.existsSync(p));
  if (!iscc) {
    console.log('Máy chưa có Inno Setup 6 nên bỏ qua bước này (đã có file zip).');
  } else {
    if (!run(iscc, ['/Qp', `/DAppVersion=${version}`, `/DSourceDir=${stage}`, path.join(ROOT, 'installer', 'class-recorder.iss')])) die('Inno Setup báo lỗi.');
    const exe = path.join(dist, `ClassRecorder-Setup-${version}.exe`);
    console.log(`${path.relative(ROOT, exe)}  ${(fs.statSync(exe).size / 1e6).toFixed(0)} MB`);
  }
}
console.log('\nXong.');
