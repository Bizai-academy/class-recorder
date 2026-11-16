import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJsonAtomic } from './util.js';
import { pickPlatform } from './platforms/index.js';

/**
 * Lịch ghi tự động: mỗi mục là một lớp học lặp lại theo thứ trong tuần, hoặc một buổi vào một ngày cụ thể.
 * Giờ tính theo đồng hồ của máy đang chạy giao diện. Máy chủ giao diện kiểm tra lịch mỗi 20 giây (xem server.js).
 */

const FILE = () => path.join(config.dataDir, 'schedules.json');
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const loadSchedules = () => readJson(FILE(), []) || [];
export const saveSchedules = (list) => writeJsonAtomic(FILE(), list);

/** Kiểm tra dữ liệu người dùng nhập và trả về một mục lịch hợp lệ. Ném lỗi (tiếng Việt) nếu sai. */
export function makeSchedule(input) {
  const url = String(input.url || '').trim();
  if (!url) throw new Error('Hãy dán link phòng học.');
  pickPlatform(url);
  const time = String(input.time || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Giờ bắt đầu phải có dạng HH:MM, ví dụ 19:25.');
  const date = String(input.date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày phải có dạng YYYY-MM-DD.');
  const days = [...new Set((input.days || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  if (!date && !days.length) throw new Error('Hãy chọn ít nhất một thứ trong tuần, hoặc một ngày cụ thể.');
  return {
    id: crypto.randomBytes(5).toString('hex'),
    title: String(input.title || '').trim().slice(0, 120) || 'Buổi học',
    url,
    passcode: String(input.passcode || '').trim(),
    time,
    days: date ? [] : days, // 0 = Chủ nhật … 6 = Thứ bảy
    date, // khác rỗng = chỉ ghi một lần vào ngày này
    summary: input.summary !== false,
    enabled: true,
    lastFired: null, // ngày (YYYY-MM-DD) gần nhất đã kích hoạt, để không chạy hai lần trong một ngày
  };
}

/**
 * Các mục tới giờ chạy tại thời điểm `now`: đúng ngày, đã tới giờ, chưa trễ quá `graceMin` phút (phòng khi máy chủ
 * vừa khởi động lại), và hôm nay chưa chạy.
 */
export function dueSchedules(list, now = new Date(), graceMin = 10) {
  const today = dayKey(now);
  return list.filter((s) => {
    if (!s.enabled || s.lastFired === today) return false;
    if (s.date ? s.date !== today : !s.days.includes(now.getDay())) return false;
    const [h, m] = s.time.split(':').map(Number);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    const late = now - target;
    return late >= 0 && late <= graceMin * 60000;
  });
}

/** Đánh dấu một mục đã chạy hôm nay; mục một-lần thì tắt luôn. */
export function markFired(list, id, now = new Date()) {
  const s = list.find((x) => x.id === id);
  if (!s) return;
  s.lastFired = dayKey(now);
  if (s.date) s.enabled = false;
}
