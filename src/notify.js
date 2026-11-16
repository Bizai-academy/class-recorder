import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readJson, writeJsonAtomic } from './util.js';

/**
 * Thông báo của bot (vào được lớp, cần quyết định, kết thúc/lỗi) được lưu vào data/notifications.json.
 * Trang web đọc danh sách này để hiện chuông thông báo và thông báo bật lên của trình duyệt.
 * Nội dung chỉ gồm tên buổi và trạng thái, không có nội dung buổi học. Lỗi ghi không bao giờ làm hỏng buổi ghi.
 */

const KEEP = 100;
const file = () => path.join(config.dataDir, 'notifications.json');

export const publicLink = () => (config.uiPublicHosts[0] ? `https://${config.uiPublicHosts[0]}` : '');

export const listNotifications = () => readJson(file(), []) || [];

export async function notify(text, { log = () => {} } = {}) {
  try {
    const list = listNotifications();
    list.unshift({ id: crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), text: String(text), read: false });
    writeJsonAtomic(file(), list.slice(0, KEEP));
    return true;
  } catch (e) {
    log(`Không lưu được thông báo: ${e.message}`);
    return false;
  }
}

export function markAllRead() {
  const list = listNotifications();
  if (!list.some((n) => !n.read)) return;
  for (const n of list) n.read = true;
  writeJsonAtomic(file(), list);
}
