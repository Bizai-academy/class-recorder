import { t } from '../i18n.js';
import { zoom } from './zoom.js';
import { meet } from './meet.js';
import { mock } from './mock.js';

const PLATFORMS = [zoom, meet, mock];

export function pickPlatform(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(t('Link không hợp lệ: {rawUrl}', { rawUrl }));
  }
  const p = PLATFORMS.find((x) => x.match(u));
  if (!p) throw new Error(t('Chưa hỗ trợ nền tảng của link này ({host}). Hiện hỗ trợ: Zoom, Google Meet.', { host: u.hostname }));
  return p;
}
