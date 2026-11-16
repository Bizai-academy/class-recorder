import { tryClick, tryFill } from './common.js';

/** Phòng học giả lập chạy trên localhost — chỉ dùng cho `classrec selftest`. */
export const mock = {
  id: 'mock',

  match(u) {
    return ['127.0.0.1', 'localhost'].includes(u.hostname) && u.pathname.startsWith('/mock-meeting');
  },

  joinUrl(raw) {
    return raw;
  },

  async detect(page) {
    try {
      return (await page.evaluate(() => document.body && document.body.dataset.state)) || 'unknown';
    } catch {
      return 'unknown';
    }
  },

  async join(page, ctx) {
    await tryFill(page, ['#name'], ctx.name);
    await tryClick(page, ['#join']);
  },

  async upkeep() {},

  // Trang giả lập chỉ báo số người khi có tham số ?leave=N (dùng để thử cảnh báo "bot một mình").
  async participantCount(page) {
    try {
      const v = await page.evaluate(() => document.body.dataset.people || '');
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  },
};
