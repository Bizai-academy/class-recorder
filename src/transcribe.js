import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, config, paths } from './config.js';
import { t } from './i18n.js';
import { sleep, hms } from './util.js';

/**
 * Phiên âm theo các cách sau (post.js quyết định thứ tự dùng):
 *  - dịch vụ API chính: tương thích OpenAI `/audio/transcriptions` (OpenAI, Groq...) hoặc Fish Audio — STT_BASE_URL / STT_MODEL / STT_API_KEY;
 *  - dịch vụ API dự phòng: dùng khi dịch vụ chính lỗi hoặc hết tiền — STT_BACKUP_BASE_URL / STT_BACKUP_MODEL / STT_BACKUP_API_KEY;
 *  - tại máy (STT_PROVIDER=local, hoặc làm dự phòng cuối cùng): faster-whisper, miễn phí.
 */

export const sttProvider = () => (config.sttProvider === 'local' ? 'local' : 'api');

/** Bộ phiên âm tại máy đã được cài chưa (scripts/setup-stt.mjs). */
export const localSttInstalled = () => fs.existsSync(paths.sttPython());

/** Danh sách dịch vụ API theo thứ tự ưu tiên: chính rồi tới dự phòng. */
export function apiProviders() {
  const make = (label, baseUrl, apiKey, model, kind) => {
    const url = baseUrl.replace(/\/+$/, '');
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* giữ nguyên chuỗi */
    }
    return { label, name: host, baseUrl: url, apiKey, model, kind: kind || (/fish\.audio/i.test(url) ? 'fish' : 'openai') };
  };
  const list = [];
  if (config.sttApiKey && config.sttBaseUrl) {
    list.push(make(t('chính'), config.sttBaseUrl, config.sttApiKey, config.sttModel, ['fish', 'openai'].includes(config.sttProvider) ? config.sttProvider : null));
  }
  if (config.sttBackupApiKey && config.sttBackupBaseUrl) {
    list.push(make(t('dự phòng'), config.sttBackupBaseUrl, config.sttBackupApiKey, config.sttBackupModel || 'whisper-large-v3'));
  }
  return list;
}

/** Gộp các câu thành đoạn ~1 phút, mỗi đoạn mở đầu bằng mốc [hh:mm:ss]. */
export function toText(pieces) {
  const blocks = [];
  for (const p of [...pieces].sort((a, b) => a.t - b.t)) {
    const last = blocks.at(-1);
    if (last && p.t - last.t < 60) last.text += ' ' + p.text;
    else blocks.push({ t: p.t, text: p.text });
  }
  return blocks.map((b) => `[${hms(b.t)}] ${b.text}`).join('\n\n') + '\n';
}

/* ───────────── Tại máy ───────────── */

/**
 * Phiên âm tại máy bằng faster-whisper (stt-local/transcribe.py): không tốn phí API, âm thanh không rời khỏi máy.
 * `wavFile` phải là WAV mono 16 kHz. `offset` (giây) được cộng vào mốc thời gian, dùng khi chỉ phiên âm phần còn lại của buổi học.
 * Trả về danh sách câu { t, text }.
 */
export function transcribeLocalPieces(wavFile, { log, onProgress = () => {}, offset = 0 }) {
  if (!localSttInstalled()) {
    return Promise.reject(new Error(t('Chưa cài bộ phiên âm trên máy. Vào Cài đặt → "Cài bộ phiên âm trên máy" (hoặc chạy: node scripts/setup-stt.mjs)')));
  }
  const args = [path.join(ROOT, 'stt-local', 'transcribe.py'), wavFile, '--model', config.sttLocalModel, '--models-dir', paths.models(), '--device', config.sttLocalDevice];
  if (config.sttLanguage) args.push('--language', config.sttLanguage);
  if (config.sttLocalThreads > 0) args.push('--threads', String(config.sttLocalThreads));
  // Ghi chú về lớp học cũng được dùng làm gợi ý từ vựng để nhận đúng tên riêng, thuật ngữ.
  if (config.summaryContext) args.push('--prompt', config.summaryContext.slice(0, 600));

  return new Promise((resolve, reject) => {
    const child = spawn(paths.sttPython(), args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const pieces = [];
    let meta = null;
    let buf = '';
    let errTail = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const o = JSON.parse(line);
          if (o.done) meta = o;
          else if (o.text) pieces.push({ t: offset + (Number(o.start) || 0), text: o.text });
        } catch {
          /* dòng không phải JSON — bỏ qua */
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      errTail = (errTail + d).slice(-2000);
      for (const line of String(d).split('\n')) {
        const m = line.trim();
        if (!m.startsWith('[stt]')) continue;
        log(m.replace('[stt]', t('Phiên âm tại máy:')));
        if (/đã phiên âm/.test(m)) onProgress(t('Đang phiên âm tại máy ({progress})', { progress: m.replace(/^.*đã phiên âm\s*/, '') }));
      }
    });
    child.on('error', (e) => reject(new Error(t('Không chạy được bộ phiên âm tại máy: {error}', { error: e.message }))));
    child.on('close', (code) => {
      if (code !== 0 || !meta) return reject(new Error(t('Bộ phiên âm tại máy dừng với lỗi: {error}', { error: errTail.trim().split('\n').slice(-2).join(' | ') || t('mã {code}', { code }) })));
      log(t('Phiên âm tại máy xong: {audio}s âm thanh trong {sec}s (nhanh gấp {speed} lần thời gian thực, {device}/{compute})', { audio: Math.round(meta.audioSeconds), sec: Math.round(meta.seconds), speed: meta.speed, device: meta.device, compute: meta.compute }));
      resolve(pieces);
    });
  });
}

export const transcribeLocal = async (wavFile, opts) => toText(await transcribeLocalPieces(wavFile, opts));

/* ───────────── Qua dịch vụ API ───────────── */

function request(buf, name, format, prov) {
  const form = new FormData();
  if (prov.kind === 'fish') {
    // Fish Audio: POST /v1/asr, model đặt ở HEADER (thiếu header sẽ bị tính theo model cũ), mỗi file tối đa 60 phút.
    form.append('audio', new Blob([buf], { type: 'audio/mpeg' }), name);
    if (config.sttLanguage) form.append('language', config.sttLanguage);
    form.append('ignore_timestamps', format === 'verbose_json' ? 'false' : 'true');
    form.append('diarize', 'false');
    form.append('tag_audio_events', 'false');
    return fetch(`${prov.baseUrl}/asr`, { method: 'POST', headers: { Authorization: `Bearer ${prov.apiKey}`, model: prov.model }, body: form });
  }
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), name);
  form.append('model', prov.model);
  form.append('response_format', format);
  if (config.sttLanguage) form.append('language', config.sttLanguage);
  return fetch(`${prov.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${prov.apiKey}` }, body: form });
}

// Tổng thời gian tối đa chịu chờ hạn mức cho MỘT khúc âm thanh (Groq tính hạn mức theo từng giờ).
const RATE_LIMIT_BUDGET_MS = 75 * 60000;

async function transcribeChunk(file, prov, { log, onProgress }) {
  const buf = await fs.promises.readFile(file);
  const name = path.basename(file);
  let format = 'verbose_json'; // có mốc thời gian từng câu; model không hỗ trợ thì lùi về 'json'
  let attempt = 0;
  let waited = 0;
  for (;;) {
    attempt++;
    let res;
    try {
      res = await request(buf, name, format, prov);
    } catch (e) {
      if (attempt >= 4) throw new Error(t('Không kết nối được {name}: {error}', { name: prov.name, error: e.message }));
      await sleep(3000 * attempt);
      continue;
    }
    if (res.ok) return res.json();
    const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 240);
    if (res.status === 400 && format === 'verbose_json') {
      format = 'json';
      continue;
    }
    if (res.status === 429) {
      // Hết hạn mức theo thời gian: dịch vụ báo cần chờ bao lâu (Retry-After) → chờ đúng chừng đó rồi gửi tiếp.
      const retryAfter = Number(res.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        const wait = Math.min(retryAfter * 1000 + 1000, 15 * 60000);
        if (waited + wait <= RATE_LIMIT_BUDGET_MS) {
          waited += wait;
          const msg = t('Dịch vụ phiên âm {name} báo hết hạn mức — chờ {mins} phút rồi gửi tiếp', { name: prov.name, mins: Math.ceil(wait / 60000) });
          log(msg);
          onProgress(msg);
          await sleep(wait);
          attempt = 0;
          continue;
        }
      } else if (attempt < 4) {
        await sleep(5000 * attempt);
        continue;
      }
      throw new Error(t('{name} báo hết hạn mức (429): {body}', { name: prov.name, body }));
    }
    if (res.status >= 500 && attempt < 4) {
      log(t('Dịch vụ phiên âm {name} trả {status}, thử lại lần {n}...', { name: prov.name, status: res.status, n: attempt + 1 }));
      await sleep(5000 * attempt);
      continue;
    }
    throw new Error(t('{name} trả lỗi {status}: {body}', { name: prov.name, status: res.status, body }));
  }
}

/**
 * Phiên âm lần lượt các khúc âm thanh qua dịch vụ API. Dịch vụ đang dùng lỗi (hết tiền, hết hạn mức, sập) thì chuyển sang
 * dịch vụ kế tiếp cho khúc đó và các khúc sau; phần đã phiên âm luôn được giữ lại.
 * Trả về { pieces, doneChunks, switchedAtChunk, error }: error khác null nghĩa là dừng giữa chừng sau `doneChunks` khúc.
 */
export async function transcribeChunks(chunks, { chunkSeconds, log, onProgress = () => {}, providers = apiProviders() }) {
  if (!chunks.length) throw new Error(t('Không có file âm thanh để phiên âm'));
  if (!providers.length) throw new Error(t('Chưa đặt API key phiên âm'));
  const pieces = [];
  let active = 0;
  let switchedAtChunk = null;
  for (let i = 0; i < chunks.length; i++) {
    for (;;) {
      const prov = providers[active];
      log(t('Phiên âm {i}/{total} ({name})...', { i: i + 1, total: chunks.length, name: prov.name }));
      onProgress(t('Đang phiên âm {i}/{total}', { i: i + 1, total: chunks.length }));
      try {
        const data = await transcribeChunk(chunks[i], prov, { log, onProgress });
        const offset = i * chunkSeconds;
        if (Array.isArray(data.segments) && data.segments.length) {
          for (const s of data.segments) {
            const text = String(s.text || '').trim();
            if (text) pieces.push({ t: offset + (Number(s.start) || 0), text });
          }
        } else {
          const text = String(data.text || '').trim();
          if (text) pieces.push({ t: offset, text });
        }
        break;
      } catch (e) {
        if (active + 1 < providers.length) {
          log(t('Dịch vụ phiên âm {label} ({name}) lỗi: {error} — chuyển sang dịch vụ {nextLabel} ({nextName})', { label: prov.label, name: prov.name, error: e.message, nextLabel: providers[active + 1].label, nextName: providers[active + 1].name }));
          active++;
          switchedAtChunk ??= i;
          continue;
        }
        return { pieces, doneChunks: i, switchedAtChunk, error: e };
      }
    }
  }
  return { pieces, doneChunks: chunks.length, switchedAtChunk, error: null };
}

/** Dạng đơn giản cho các công cụ kiểm tra: trả về văn bản, ném lỗi nếu không phiên âm được trọn vẹn. */
export async function transcribe(chunks, opts) {
  const r = await transcribeChunks(chunks, opts);
  if (r.error) throw r.error;
  return toText(r.pieces);
}
