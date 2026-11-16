/**
 * Nhận diện người đang nói từ giao diện phòng họp (Zoom/Meet đánh dấu ô của người đang nói) và đoán giảng viên
 * là người nói lâu nhất. Chỉ đọc tên hiển thị trong phòng; không phân tích giọng nói.
 */

/* Chạy TRONG TRANG (được chuyển thành chuỗi). Trả về tên những người đang được đánh dấu là đang nói. */
function speakingNamesInPage() {
  const out = new Set();
  const NAME_SEL = '[data-self-name], [class*="avatar-name"], [class*="avatar-footer"], [class*="participant-name"], [class*="display-name"], [class*="displayName"]';
  const nameOf = (el) => {
    const n = el.querySelector(NAME_SEL);
    const t = String((n && (n.getAttribute('data-self-name') || n.textContent)) || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > 0 && t.length < 60 ? t : '';
  };
  const cls = (el) => String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '');
  const SPEAK = /(^|[\s_-])(speaking|is-speaking|active-speaker|talking)([\s_-]|$)|video-frame--active|speaker-active/i;
  const tiles = document.querySelectorAll('[data-participant-id], [class*="video-frame"], [class*="video-avatar__avatar"]');
  for (const t of tiles) {
    let speaking = SPEAK.test(cls(t)) || /speaking|đang nói/i.test(t.getAttribute('aria-label') || '');
    if (!speaking) speaking = !!t.querySelector('[class*="speaking"], [class*="active-speaker"], [aria-label*="speaking" i]');
    if (speaking) {
      const n = nameOf(t);
      if (n) out.add(n);
    }
  }
  // Zoom, chế độ "Speaker view": ô lớn luôn là người đang nói.
  for (const el of document.querySelectorAll('[class*="speaker-active-container"]')) {
    const n = nameOf(el);
    if (n) out.add(n);
  }
  return [...out];
}

const SELF = /^(you|bạn|me|tôi)$/i;
export const cleanName = (n) =>
  String(n || '')
    .replace(/\s*\((host|co-host|cohost|me|you|guest|chủ trì|đồng chủ trì|bạn|khách)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Tên những người đang nói trên trang (mọi frame), đã bỏ tên của chính bot. */
export async function detectSpeakers(page, botName = '') {
  const names = new Set();
  for (const frame of page.frames()) {
    try {
      for (const n of await frame.evaluate(speakingNamesInPage)) {
        const c = cleanName(n);
        if (c && !SELF.test(c) && c !== cleanName(botName)) names.add(c);
      }
    } catch {
      /* frame đang điều hướng */
    }
  }
  return [...names];
}

/**
 * Đoán giảng viên: người nói lâu nhất, nếu nói đủ lâu (minSeconds) và chiếm đủ phần (minShare) tổng thời gian có người nói.
 * Trả về { name, seconds, share } hoặc null.
 */
export function pickInstructor(speakers, { minSeconds = 60, minShare = 0.35 } = {}) {
  const entries = Object.entries(speakers || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!entries.length || !total) return null;
  const [name, seconds] = entries[0];
  const share = seconds / total;
  return seconds >= minSeconds && share >= minShare ? { name, seconds, share } : null;
}
