// Triển khai bản trên máy này lên VPS bằng một lệnh:
//   node scripts/deploy.mjs                 (đọc DEPLOY_HOST trong .env, ví dụ root@1.2.3.4)
//   node scripts/deploy.mjs --host root@1.2.3.4 [--skip-selftest]
// Các bước: kiểm tra VPS không đang ghi → đóng gói (không kèm key, dữ liệu, thư viện) → chép lên → giải nén →
// cài thư viện → tự kiểm thử trên VPS → khởi động lại giao diện → kiểm tra trang phản hồi.
// File .env và dữ liệu buổi ghi trên VPS được giữ nguyên.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const host = value('--host') || process.env.DEPLOY_HOST;
const dir = value('--dir') || process.env.DEPLOY_DIR || '/opt/class-recorder';
const runAs = value('--user') || process.env.DEPLOY_USER || 'maus';
const skipSelftest = flag('--skip-selftest');

const die = (m) => {
  console.error(`\nLỖI: ${m}`);
  process.exit(1);
};
if (!host) die('Chưa biết VPS nào. Thêm DEPLOY_HOST=root@<IP> vào .env, hoặc chạy kèm --host root@<IP>.');
if (!/^[\w.-]+@[\w.-]+$/.test(host)) die(`Địa chỉ VPS không hợp lệ: ${host}`);
if (!/^\/[\w./-]+$/.test(dir) || !/^[a-z_][\w-]*$/.test(runAs)) die('DEPLOY_DIR hoặc DEPLOY_USER không hợp lệ.');

const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const step = (m) => console.log(`\n==> ${m}`);
function ssh(script, { quiet = false } = {}) {
  const r = spawnSync('ssh', [...SSH, host, 'bash -s'], { input: script, encoding: 'utf8', stdio: ['pipe', quiet ? 'pipe' : 'inherit', 'inherit'] });
  return { ok: r.status === 0, out: r.stdout || '' };
}
const asUser = (cmd) => `runuser -u ${runAs} -- env HOME=$(getent passwd ${runAs} | cut -d: -f6) ${cmd}`;

// 0. Mã chưa lưu git: vẫn triển khai, nhưng báo để biết bản trên VPS khác bản trong git.
const git = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
if (git.status === 0 && git.stdout.trim()) console.log('Lưu ý: có thay đổi chưa commit — bản triển khai sẽ gồm cả các thay đổi đó.');

step(`Kiểm tra ${host} không đang ghi buổi nào`);
const busy = ssh(`cd ${dir} 2>/dev/null && ${asUser('node src/cli.js list')} | grep -c 'ĐANG CHẠY' || true`, { quiet: true });
if (!busy.ok) die('Không kết nối được VPS qua SSH (cần khoá SSH, không dùng mật khẩu).');
if (Number(busy.out.trim()) > 0) die('VPS đang ghi một buổi học. Chờ buổi đó xong rồi chạy lại.');

step('Đóng gói mã nguồn');
const pkg = path.join(os.tmpdir(), `classrec-deploy-${process.pid}.tar.gz`);
const parent = path.dirname(ROOT);
const name = path.basename(ROOT);
const excludes = ['node_modules', 'data', '.venv', '.env', '.git', '__pycache__', '*.tar.gz', 'remote-login.js', 'dist', 'runtime', 'CLAUDE.local.md'].flatMap((e) => ['--exclude', e]);
// Windows: dùng tar của hệ thống (bsdtar). tar của Git Bash (GNU) hiểu nhầm "C:\..." thành địa chỉ máy khác.
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const tarBin = process.platform === 'win32' && fs.existsSync(winTar) ? winTar : 'tar';
const tar = spawnSync(tarBin, ['-czf', pkg, ...excludes, '-C', parent, name], { stdio: 'inherit' });
if (tar.status !== 0 || !fs.existsSync(pkg)) die('Đóng gói thất bại.');
console.log(`${(fs.statSync(pkg).size / 1024).toFixed(0)} KB`);

try {
  step('Chép lên VPS');
  const remotePkg = `/tmp/classrec-deploy-${Date.now()}.tar.gz`;
  if (spawnSync('scp', ['-q', ...SSH, pkg, `${host}:${remotePkg}`], { stdio: 'inherit' }).status !== 0) die('Chép gói lên VPS thất bại.');

  step('Giải nén, cài thư viện' + (skipSelftest ? '' : ', tự kiểm thử (khoảng 4 phút)') + ' và khởi động lại');
  const remoteParent = path.posix.dirname(dir);
  const remoteName = path.posix.basename(dir);
  const script = `set -e
mkdir -p ${remoteParent}
tmpx=$(mktemp -d)
tar -xzf ${remotePkg} -C "$tmpx"
rm -f ${remotePkg}
mkdir -p ${dir}
cp -a "$tmpx/${name}/." ${dir}/
rm -rf "$tmpx"
chown -R ${runAs}:${runAs} ${dir}
chmod -R u=rwX,go=rX ${dir}
[ -f ${dir}/.env ] && chmod 600 ${dir}/.env
cd ${dir}
${asUser('npm install --omit=dev --no-fund --no-audit --silent')}
${
  skipSelftest
    ? 'echo "Bỏ qua tự kiểm thử (--skip-selftest)"'
    : `${asUser('node src/cli.js selftest')} > /tmp/classrec-selftest.out 2>&1 || true
echo "Tự kiểm thử: ĐẠT=$(grep -c '^ĐẠT' /tmp/classrec-selftest.out) LỖI=$(grep -c '^LỖI ' /tmp/classrec-selftest.out)"
if ! grep -q '^ĐẠT' /tmp/classrec-selftest.out; then echo "Tự kiểm thử bị hỏng giữa chừng (không có mục nào chạy xong):"; tail -8 /tmp/classrec-selftest.out; echo "CHƯA khởi động lại giao diện."; rm -f /tmp/classrec-selftest.out; exit 3; fi
if grep -q '^LỖI ' /tmp/classrec-selftest.out; then grep '^LỖI ' /tmp/classrec-selftest.out | head -10; echo "CHƯA khởi động lại giao diện vì có mục chưa đạt."; rm -f /tmp/classrec-selftest.out; exit 3; fi
rm -f /tmp/classrec-selftest.out`
}
systemctl restart class-recorder
sleep 3
echo "Dịch vụ: $(systemctl is-active class-recorder)"
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/login || true)
[ "$code" = "200" ] || code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/ || true)
echo "Giao diện trả lời: HTTP $code"
`;
  const r = ssh(script);
  if (!r.ok) die('Triển khai chưa xong — xem thông báo ở trên. Bản cũ trên VPS vẫn đang chạy nếu chưa tới bước khởi động lại.');
  console.log('\nXong.');
} finally {
  fs.rmSync(pkg, { force: true });
}
