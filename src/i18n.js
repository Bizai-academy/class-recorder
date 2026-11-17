import './config.js'; // nạp .env trước để đọc APP_LANG
import { EN } from './i18n-en.js';

/**
 * Song ngữ Việt–Anh. Mã nguồn viết thẳng câu tiếng Việt; câu đó chính là "khoá" tra bản tiếng Anh trong i18n-en.js.
 * Chỗ cần chèn giá trị thì viết {ten} trong câu và truyền vars: t('Đã ghi {n} phút', { n: 5 }).
 * Thiếu bản dịch thì hiện nguyên câu tiếng Việt (không bao giờ hỏng giao diện).
 *
 * Ngôn ngữ lấy từ APP_LANG trong .env (vi | en), đổi được ở giao diện. Tiến trình ghi hình đọc khi khởi động.
 */

const norm = (v) => (String(v || '').toLowerCase().startsWith('en') ? 'en' : 'vi');
let current = norm(process.env.APP_LANG);

export const getLang = () => current;
export const setLang = (v) => (current = norm(v));
export const LANGS = ['vi', 'en'];

export function t(text, vars) {
  let s = current === 'en' && Object.hasOwn(EN, text) ? EN[text] : text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
  return s;
}

/** Từ điển gửi cho trang web (trang tự dịch phần chữ của nó bằng cùng quy tắc). */
export const dictionaryFor = (lang) => (norm(lang) === 'en' ? EN : {});
