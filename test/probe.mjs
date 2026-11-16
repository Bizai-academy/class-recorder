// Công cụ soi trang (KHÔNG vào phòng, không bấm gì): mở link, in trạng thái bot nhận diện được, chữ trên trang,
// các nút/ô nhập đang hiển thị, và lưu ảnh chụp. Dùng khi Zoom/Meet đổi giao diện và cần chỉnh src/platforms/*.js.
//   node test/probe.mjs <link> [giây-chờ]
import path from 'node:path';
import { config } from '../src/config.js';
import { launchBrowser } from '../src/browser.js';
import { pickPlatform } from '../src/platforms/index.js';
import { framesText } from '../src/platforms/common.js';

const url = process.argv[2];
const waitSec = Number(process.argv[3] || 8);
if (!url) {
  console.error('Cách dùng: node test/probe.mjs <link> [giây-chờ]');
  process.exit(1);
}
const platform = pickPlatform(url);
const { context, page } = await launchBrowser({ profile: 'probe', log: console.log });
try {
  const target = platform.joinUrl(url);
  console.log('Mở:', target);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(waitSec * 1000);
  const state = await platform.detect(page, { meetWaitForOthers: config.meetWaitForOthers });
  console.log('\nURL hiện tại :', page.url());
  console.log('Số frame     :', page.frames().length);
  console.log('TRẠNG THÁI   :', state);
  const text = (await framesText(page)).replace(/\s+/g, ' ').trim();
  console.log('\nChữ trên trang (600 ký tự đầu):\n', text.slice(0, 600));
  for (const frame of page.frames()) {
    const items = await frame
      .evaluate(() => {
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return Array.from(document.querySelectorAll('button, [role="button"], input, a[role="link"]'))
          .filter(vis)
          .slice(0, 40)
          .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} | aria="${e.getAttribute('aria-label') || ''}" | placeholder="${e.getAttribute('placeholder') || ''}" | text="${(e.innerText || '').trim().slice(0, 40)}"`);
      })
      .catch(() => []);
    if (items.length) console.log(`\nNút/ô nhập trong frame ${frame.url().slice(0, 80)}:\n  ` + items.join('\n  '));
  }
  const shot = path.join(config.dataDir, 'probe.png');
  await page.screenshot({ path: shot });
  console.log('\nẢnh chụp:', shot);
} finally {
  await context.close();
}
