import { zoom } from './zoom.js';
import { meet } from './meet.js';
import { mock } from './mock.js';

const PLATFORMS = [zoom, meet, mock];

export function pickPlatform(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`Link không hợp lệ: ${rawUrl}`);
  }
  const p = PLATFORMS.find((x) => x.match(u));
  if (!p) throw new Error(`Chưa hỗ trợ nền tảng của link này (${u.hostname}). Hiện hỗ trợ: Zoom, Google Meet.`);
  return p;
}
