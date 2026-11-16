import { framesText, anyVisible, tryClick, tryFill } from './common.js';

/**
 * Google Meet. Ép giao diện tiếng Anh (?hl=en) để nhận diện trạng thái ổn định.
 * Lưu ý: giao diện Meet thay đổi theo thời gian; các mẫu chữ/selector gom ở một chỗ để dễ chỉnh.
 */

const RX = {
  ended:
    // Không dùng "Return to home screen" làm dấu hiệu: nút đó cũng có ở trang sai mã phòng / bị từ chối.
    /(you left the (meeting|call)|you've left the (meeting|call)|the (call|meeting) (has )?ended|ended the (call|meeting) for everyone|you('ve| have) been removed from the (meeting|call)|removed you from the (meeting|call)|call ended because everyone left)/i,
  waiting: /(asking to (be let in|join)|you'll join the call when someone lets you in|please wait until a meeting host brings you into the call|waiting for (the|a) host)/i,
  lobby: /(please wait until a meeting host brings you into the call|asking to be let in|you'll join the call when someone lets you in)/i,
  denied: /(you can't join this (video )?call|denied your request to join|no one responded to your request|your request to join was denied)/i,
  invalid: /(check your meeting code|invalid video call name|couldn't find the meeting)/i,
  noOne: /no one else is here/i,
};

const SEL = {
  leave: ['button[aria-label*="Leave call" i]', '[role="button"][aria-label*="Leave call" i]'],
  joinBtn: [{ name: /^(Join now|Ask to join|Join here too)$/i }],
  nameInput: ['input[aria-label="Your name"]', 'input[placeholder="Your name"]'],
  micOff: ['[aria-label*="Turn off microphone" i]'],
  camOff: ['[aria-label*="Turn off camera" i]'],
  dismiss: [{ name: /^(Got it|Dismiss)$/i }],
  noMedia: [{ name: /continue without (microphone|mic)/i }],
};

export const meet = {
  id: 'meet',

  match(u) {
    return /^meet\.google\.com$/i.test(u.hostname);
  },

  joinUrl(raw) {
    const u = new URL(raw);
    u.searchParams.set('hl', 'en');
    return u.toString();
  },

  async detect(page, ctx = {}) {
    if (/accounts\.google\.com/.test(page.url())) return 'needs_login';
    const text = await framesText(page);
    if (await anyVisible(page, SEL.leave)) {
      // Phòng chờ của Meet cũng có nút gác máy ("Leave call") nên phải xét chữ của phòng chờ trước.
      // Chỉ dùng các câu đặc trưng của phòng chờ để không nhầm với lời thoại/phụ đề trong lớp.
      if (RX.lobby.test(text)) return 'waiting_room';
      return 'in_meeting';
    }
    if (RX.invalid.test(text)) return 'invalid';
    if (RX.denied.test(text)) return 'denied';
    if (RX.ended.test(text)) return 'ended';
    if (RX.waiting.test(text)) return 'waiting_room';
    if (await anyVisible(page, SEL.joinBtn)) {
      if (ctx.meetWaitForOthers && RX.noOne.test(text)) return 'not_started';
      return 'prejoin';
    }
    return 'unknown';
  },

  async join(page, ctx) {
    await tryClick(page, SEL.dismiss);
    await tryClick(page, SEL.noMedia);
    await tryFill(page, SEL.nameInput, ctx.name); // chỉ xuất hiện khi vào ẩn danh (chưa đăng nhập)
    await tryClick(page, SEL.micOff);
    await tryClick(page, SEL.camOff);
    await tryClick(page, SEL.joinBtn);
  },

  async upkeep(page) {
    await tryClick(page, SEL.dismiss);
    await tryClick(page, SEL.micOff);
    await tryClick(page, SEL.camOff);
    // Không bấm "Stay in the call" khi Meet hỏi "Are you still there?" — để Meet tự kết thúc khi lớp đã tan.
  },

  async participantCount(page) {
    try {
      const n = await page.evaluate(() => {
        const ids = new Set(Array.from(document.querySelectorAll('[data-participant-id]')).map((e) => e.getAttribute('data-participant-id')));
        return ids.size || null;
      });
      return n;
    } catch {
      return null;
    }
  },
};
