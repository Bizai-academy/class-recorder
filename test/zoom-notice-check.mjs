// Kiểm tra bot tự đóng các thông báo che màn hình của Zoom (trang giả lập, không cần mạng):
//   node test/zoom-notice-check.mjs
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { zoom } from '../src/platforms/zoom.js';
import { findBrowserExecutable } from '../src/browser.js';

const PAGE = `<!doctype html><body>
<div id="tip" style="position:fixed;top:0"><span>For a better meeting experience, enable the option 'Use graphics/hardware acceleration' under browser system settings.<a href="#">Learn more</a></span><button aria-label="close" onclick="document.body.dataset.tip='closed';this.parentElement.remove()">×</button></div>
<div role="dialog" id="rec"><h2>This meeting is being recorded.</h2><p>Anyone with access to the recording may view or share it with others.</p><button onclick="document.body.dataset.rec='ok';this.parentElement.remove()">OK</button></div>
<div role="dialog" id="other"><p>Do you want to leave the meeting?</p><button onclick="document.body.dataset.other='clicked'">OK</button></div>
<div id="bar"><button onclick="document.body.dataset.bar='clicked'">OK</button><button aria-label="Leave">Leave</button></div>
</body>`;

export async function zoomNoticeChecks() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name: `Zoom — ${name}`, ok: !!ok, detail });
  const browser = await chromium.launch({ headless: true, executablePath: findBrowserExecutable() || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    await zoom.upkeep(page);
    const d = await page.evaluate(() => ({ ...document.body.dataset }));
    check('tự bấm OK ở thông báo "This meeting is being recorded"', d.rec === 'ok', JSON.stringify(d));
    check('tự đóng dải gợi ý "hardware acceleration"', d.tip === 'closed', JSON.stringify(d));
    check('không bấm OK ở hộp thoại khác hay nút khác', !d.other && !d.bar, JSON.stringify(d));
    for (const [text, want] of [['1.1K', 1100], ['92', 92], ['2,345', 2345], ['1', 1], ['1.2M', 1200000]]) {
      await page.setContent(`<div class="footer-button__number-counter"><span>${text}</span></div>`);
      const got = await zoom.participantCount(page);
      check(`đếm số người: "${text}" → ${want}`, got === want, `được ${got}`);
    }
  } finally {
    await browser.close();
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await zoomNoticeChecks();
  for (const c of r) console.log(`${c.ok ? 'ĐẠT ' : 'LỖI '} ${c.name}${c.detail && !c.ok ? ' — ' + c.detail : ''}`);
  process.exit(r.every((c) => c.ok) ? 0 : 1);
}
