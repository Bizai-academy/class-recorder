// Phòng học giả lập để thử tay:  node test/mock-server.mjs [cổng]
// Rồi:  node src/cli.js start "http://127.0.0.1:8765/mock-meeting?room=A&open=5&end=60" --no-summary
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 8765);
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock-meeting.html');
http
  .createServer((req, res) => {
    if (!req.url.startsWith('/mock-meeting')) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  })
  .listen(port, '127.0.0.1', () => console.log(`Mock meeting: http://127.0.0.1:${port}/mock-meeting?room=A&open=5&end=60`));
