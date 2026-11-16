import { framesText, anyVisible, tryClick, tryFill } from './common.js';

/**
 * Zoom — vào bằng Web Client (app.zoom.us/wc/...), không cần cài ứng dụng Zoom.
 * Lưu ý: giao diện Zoom thay đổi theo thời gian; các mẫu chữ/selector dưới đây gom ở một chỗ để dễ chỉnh.
 */

const RX = {
  ended: /(this meeting has been ended by (the )?host|the host has ended (this|the) meeting|(this|the) meeting has (been )?ended|you have been removed|the host (has )?removed you|meeting is end(ed)?)/i,
  notStarted: /(the meeting has not started|meeting has not started|waiting for (the )?host to start|please wait for the host to start|the host will start the (meeting|webinar)|this meeting is scheduled for|webinar has not started)/i,
  waiting: /(host will let you in soon|we've let them know you're here|please wait,? the (meeting|webinar) host will let you in|you are in the waiting room)/i,
  // Người tổ chức/Zoom chặn bot tự động ở phòng này. Đây là chặn có chủ đích: bot dừng lại và báo rõ, không tìm cách vượt qua.
  botBlocked: /automated bots (aren't|are not) allowed to join/i,
  login: /(sign in to join|this meeting is for authorized (attendees|participants) only)/i,
  // Thông báo "buổi họp đang được ghi/phiên âm" — hộp thoại che giữa màn hình cho tới khi bấm OK.
  recordingNotice: /this (meeting|webinar) is being (recorded|transcribed|livestreamed)|recording (is )?in progress/i,
  // Dải gợi ý không liên quan bài học, che phần trên màn hình.
  tipBanner: /hardware acceleration/i,
  invalid: /(invalid meeting id|this meeting link is invalid|meeting (id )?(does not exist|is not valid))/i,
};

const SEL = {
  leave: ['button[aria-label="Leave"]', '.footer__leave-btn', '#wc-footer', { name: /^(Leave|Leave meeting)$/i }],
  nameInput: ['#input-for-name', 'input[placeholder*="Your Name" i]', 'input[placeholder*="name" i]'],
  pwdInput: ['#input-for-pwd', 'input[type="password"]'],
  joinBtn: ['button.preview-join-button', { name: /^Join$/i }],
  // Banner cookie: ưu tiên từ chối; không có nút từ chối thì chỉ đóng banner (không bấm "Accept").
  cookieReject: ['#onetrust-reject-all-handler', { name: /^(Decline Cookies|Reject All)$/i }, 'button.onetrust-close-btn-handler'],
  agree: ['#wc_agree1', { name: /^I Agree$/i }],
  browserJoin: [{ role: 'link', name: /join from (your )?browser/i }, { name: /join from (your )?browser/i }],
  // Hộp thoại "Join Audio by Computer", hoặc nút "Join Audio" trên thanh công cụ khi chưa kết nối âm thanh.
  joinAudio: ['button.join-audio-by-voip__join-btn', { name: /join audio by computer/i }, { name: /^join audio$/i }],
  dismiss: [{ name: /^(Got it|Continue)$/i }],
  dialog: '[role="dialog"], [role="alertdialog"], .zm-modal, .ReactModal__Content',
  mute: [{ name: /^mute( my microphone)?$/i }],
  stopVideo: [{ name: /^stop( my)? video$/i }],
};

function meetingId(u) {
  const m = u.pathname.match(/\/(\d{9,12})(?:\/|$)/);
  return m ? m[1] : null;
}

/** Bấm OK ở hộp thoại "This meeting is being recorded" (chỉ trong hộp thoại có đúng dòng chữ đó, không bấm OK ở nơi khác). */
async function ackRecordingNotice(page) {
  for (const frame of page.frames()) {
    try {
      const btn = frame.locator(SEL.dialog).filter({ hasText: RX.recordingNotice }).getByRole('button', { name: /^(OK|Got it|Continue)$/i }).first();
      if (await btn.isVisible()) {
        await btn.click({ timeout: 1500 });
        return true;
      }
    } catch {
      /* thử frame tiếp theo */
    }
  }
  return false;
}

/** Đóng dải gợi ý "enable hardware acceleration" bằng nút × của chính nó. */
async function closeTipBanner(page) {
  for (const frame of page.frames()) {
    try {
      const done = await frame.evaluate((src) => {
        const rx = new RegExp(src, 'i');
        const shown = (e) => e.getClientRects().length > 0;
        for (const el of document.querySelectorAll('div, span, p')) {
          if (!shown(el) || el.children.length > 3 || !rx.test(el.textContent || '') || (el.textContent || '').length > 300) continue;
          // Tìm nút đóng trong vài cấp bao quanh dòng chữ; chỉ nhận khi vùng đó có đúng một nút (tránh bấm nhầm thanh công cụ).
          let box = el;
          for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
            const btns = Array.from(box.querySelectorAll('button, [role="button"]')).filter(shown);
            if (btns.length === 1 && (box.textContent || '').length < 400) {
              btns[0].click();
              return true;
            }
            if (btns.length > 1) break;
          }
        }
        return false;
      }, RX.tipBanner.source);
      if (done) return true;
    } catch {
      /* bỏ qua */
    }
  }
  return false;
}

export const zoom = {
  id: 'zoom',

  match(u) {
    return /(^|\.)(zoom\.us|zoom\.com|zoomgov\.com|zoom\.com\.cn)$/i.test(u.hostname);
  },

  /** Chuyển link mời (zoom.us/j/123?pwd=...) thành link Web Client. Giữ nguyên tên miền riêng và tham số pwd. */
  joinUrl(raw) {
    const u = new URL(raw);
    const id = meetingId(u);
    if (id) u.pathname = `/wc/join/${id}`;
    return u.toString();
  },

  async detect(page) {
    const inMeeting = await anyVisible(page, SEL.leave);
    if (inMeeting) {
      // Khi đang trong phòng chỉ xét chữ trong hộp thoại, tránh nhầm với tin nhắn chat/phụ đề.
      const dialogText = await framesText(page, '[role="dialog"], .zm-modal, .ReactModal__Content');
      if (RX.ended.test(dialogText)) return 'ended';
      return 'in_meeting';
    }
    const text = await framesText(page);
    if (RX.ended.test(text)) return 'ended';
    if (RX.waiting.test(text)) return 'waiting_room';
    if (RX.notStarted.test(text)) return 'not_started';
    if (RX.botBlocked.test(text)) return 'bot_blocked'; // phải xét trước 'needs_login': trang chặn bot cũng có nút "Sign in to join"
    if (RX.login.test(text) || /\/signin/.test(page.url())) return 'needs_login';
    if (RX.invalid.test(text)) return 'invalid';
    if ((await anyVisible(page, SEL.nameInput)) || (await anyVisible(page, SEL.joinBtn)) || (await anyVisible(page, SEL.browserJoin))) return 'prejoin';
    return 'unknown';
  },

  async join(page, ctx) {
    await tryClick(page, SEL.cookieReject);
    if (ctx.acceptTerms) await tryClick(page, SEL.agree);
    // Trang "Launch Meeting" (link dạng tên riêng): chọn vào bằng trình duyệt.
    if (!(await anyVisible(page, SEL.nameInput))) await tryClick(page, SEL.browserJoin);
    await tryFill(page, SEL.nameInput, ctx.name);
    if (ctx.passcode) await tryFill(page, SEL.pwdInput, ctx.passcode);
    await tryClick(page, SEL.mute);
    await tryClick(page, SEL.stopVideo);
    await tryClick(page, SEL.joinBtn);
  },

  async upkeep(page) {
    await tryClick(page, SEL.joinAudio); // bắt buộc để nghe được tiếng lớp học
    await tryClick(page, SEL.dismiss); // các gợi ý "Got it"
    await ackRecordingNotice(page); // "This meeting is being recorded" → OK
    await closeTipBanner(page);
    await tryClick(page, SEL.mute);
    await tryClick(page, SEL.stopVideo);
  },

  async participantCount(page) {
    for (const frame of page.frames()) {
      try {
        const n = await frame.evaluate(() => {
          const num = (s) => {
            // Phòng đông Zoom viết gọn: "1.1K", "2,345", "1.2M" — phải đọc đủ, không lấy riêng chữ số đầu.
            const m = /(\d[\d.,]*)\s*([KkMm])?(?![A-Za-z])/.exec(s || '');
            if (!m) return null;
            if (m[2]) return Math.round(parseFloat(m[1].replace(',', '.')) * (/k/i.test(m[2]) ? 1e3 : 1e6));
            return parseInt(m[1].replace(/[.,]/g, ''), 10);
          };
          const el = document.querySelector('.footer-button__number-counter span, .footer-button__participants-icon .footer-button__number-counter');
          if (el && num(el.textContent) !== null) return num(el.textContent);
          // Dự phòng khi Zoom đổi tên class: nút "Participants" trên thanh công cụ mang con số trong aria-label hoặc trong chữ.
          for (const b of document.querySelectorAll('button, [role="button"]')) {
            const label = b.getAttribute('aria-label') || '';
            const text = b.textContent || '';
            if (!/particip|particp/i.test(label + ' ' + text)) continue;
            const v = num(label) ?? num(text);
            if (v !== null) return v;
          }
          return null;
        });
        if (n !== null) return n;
      } catch {
        /* bỏ qua */
      }
    }
    return null;
  },
};
