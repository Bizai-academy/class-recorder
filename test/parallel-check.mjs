// Kiểm tra ghi HAI lớp cùng lúc (hai tiến trình, hai hồ sơ trình duyệt, hai phòng giả lập):
//   node test/parallel-check.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/config.js';
import { sessionDir, readStatus } from '../src/control.js';

export async function parallelChecks() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name: `Song song — ${name}`, ok: !!ok, detail });
  const html = fs.readFileSync(path.join(ROOT, 'test', 'mock-meeting.html'));
  const server = http.createServer((req, res) => (req.url.startsWith('/mock-meeting') ? res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html) : res.writeHead(404).end()));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/mock-meeting`;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const runs = [
    { id: `${stamp.slice(0, 8)}-${stamp.slice(8)}-songsong-a`, profile: 'default', url: `${base}?room=PA&open=1&end=15&freq=440` },
    { id: `${stamp.slice(0, 8)}-${stamp.slice(8)}-songsong-b`, profile: 'lop2', url: `${base}?room=PB&open=1&end=15&freq=660` },
  ];
  try {
    let both = false;
    const watch = setInterval(() => {
      if (runs.every((r) => readStatus(sessionDir(r.id))?.phase === 'recording')) both = true;
    }, 300);
    await Promise.all(
      runs.map(
        (r) =>
          new Promise((done) => {
            const p = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'start', r.url, '--title', 'songsong', '--session-id', r.id, '--profile', r.profile, '--no-summary'], { cwd: ROOT, stdio: 'ignore', windowsHide: true, env: { ...process.env, REJOIN_GRACE_MIN: '0.2', RETRY_SAME_LINK: 'false' } });
            const kill = setTimeout(() => p.kill(), 150000);
            p.on('exit', () => (clearTimeout(kill), done()));
          }),
      ),
    );
    clearInterval(watch);
    check('hai lớp cùng ở trạng thái "đang ghi" một lúc', both);
    for (const r of runs) {
      const st = readStatus(sessionDir(r.id)) || {};
      let log = '';
      try {
        log = fs.readFileSync(path.join(sessionDir(r.id), 'session.log'), 'utf8');
      } catch {
        /* không có nhật ký */
      }
      const m = /File ghi hình: .*\((\d+)s, video=(\w+), audio=(\w+)\)/.exec(log);
      check(`lớp dùng hồ sơ "${r.profile}": ghi xong, đủ hình và tiếng, đúng thời lượng`, st.phase === 'done' && m && m[2] === 'true' && m[3] === 'true' && +m[1] >= 11 && +m[1] <= 22, `phase=${st.phase} ${m ? m[0].slice(-40) : 'không có file'}`);
    }
    // Qua máy chủ giao diện: bắt đầu 2 lớp, lớp thứ 3 bị từ chối, lệnh dừng nhắm đúng lớp.
    const { startServer } = await import('../src/server.js');
    const { config } = await import('../src/config.js');
    const savedHash = config.uiPasswordHash;
    const savedHosts = config.uiPublicHosts;
    config.uiPasswordHash = '';
    config.uiPublicHosts = [];
    const PORT = 8796;
    const ui = await startServer({ port: PORT, open: false });
    const made = [];
    try {
      const page = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
      const token = /const TOKEN = '([0-9a-f]+)'/.exec(page)?.[1];
      const post = async (p, body) => {
        const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'x-classrec-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json().catch(() => ({})) };
      };
      const state = async () => (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
      const waitFor = async (fn, ms = 60000) => {
        for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
          const st = await state();
          if (fn(st)) return st;
          await new Promise((r) => setTimeout(r, 500));
        }
        return state();
      };
      const a = await post('/api/start', { url: `${base}?room=UA&open=1&end=300`, title: 'Lop A', summary: false });
      const b = await post('/api/start', { url: `${base}?room=UB&open=1&end=300`, title: 'Lop B', summary: false });
      made.push(a.json.id, b.json.id);
      const c = await post('/api/start', { url: `${base}?room=UC&open=1&end=300`, title: 'Lop C', summary: false });
      if (c.json.id) made.push(c.json.id);
      check('giao diện: bắt đầu được 2 lớp liên tiếp, lớp thứ 3 bị từ chối', a.status === 200 && b.status === 200 && c.status === 409, `${a.status} ${b.status} ${c.status}`);
      let st = await waitFor((x) => (x.runningAll || []).filter((r) => r.phase === 'recording').length === 2);
      const profiles = made.slice(0, 2).map((id) => readStatus(sessionDir(id))?.profile);
      check('giao diện: cả 2 lớp cùng đang ghi, mỗi lớp một hồ sơ trình duyệt', (st.runningAll || []).length === 2 && new Set(profiles).size === 2, JSON.stringify(profiles));
      await post('/api/stop', { id: b.json.id });
      st = await waitFor((x) => (x.runningAll || []).length === 1);
      check('giao diện: dừng đúng lớp B, lớp A vẫn ghi', (st.runningAll || []).length === 1 && st.runningAll[0].id === a.json.id && st.runningAll[0].phase === 'recording', JSON.stringify((st.runningAll || []).map((r) => [r.title, r.phase])));
      await post('/api/stop', { id: a.json.id });
      st = await waitFor((x) => (x.runningAll || []).length === 0);
      check('giao diện: dừng nốt lớp A', (st.runningAll || []).length === 0);
    } finally {
      config.uiPasswordHash = savedHash;
      config.uiPublicHosts = savedHosts;
      await new Promise((r) => ui.close(r));
      for (const id of made) if (id) fs.rmSync(sessionDir(id), { recursive: true, force: true });
    }
  } finally {
    server.close();
    for (const r of runs) fs.rmSync(sessionDir(r.id), { recursive: true, force: true });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await parallelChecks();
  for (const c of r) console.log(`${c.ok ? 'ĐẠT ' : 'LỖI '} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  process.exit(r.every((c) => c.ok) ? 0 : 1);
}
