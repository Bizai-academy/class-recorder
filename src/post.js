import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { config } from './config.js';
import { transcribeChunks, transcribeLocalPieces, apiProviders, toText, sttProvider, localSttInstalled } from './transcribe.js';
import { summarize } from './summarize.js';

const CHUNK_SECONDS = 600;

export function ffmpegPath() {
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
}

export function runFfmpeg(args) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    p.on('error', (e) => resolve({ code: -1, stderr: String(e) }));
    p.on('close', (code) => resolve({ code, stderr }));
  });
}

/** Đọc thông tin cơ bản của file media (không cần ffprobe). */
export async function probe(file) {
  const { stderr } = await runFfmpeg(['-i', file]);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    duration: m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null,
    hasVideo: /Stream #\d+:\d+.*Video:/.test(stderr),
    hasAudio: /Stream #\d+:\d+.*Audio:/.test(stderr),
  };
}

export async function meanVolume(file) {
  const { stderr } = await runFfmpeg(['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const m = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/);
  if (!m) return null;
  return m[1] === '-inf' ? -Infinity : Number(m[1]);
}

/** Giải mã toàn bộ file và đếm số dòng lỗi (0 = file lành lặn). Dùng cho selftest. */
export async function decodeErrors(file) {
  const { stderr } = await runFfmpeg(['-loglevel', 'error', '-i', file, '-f', 'null', '-']);
  // "non monotonically increasing dts" chỉ là cảnh báo của bộ ghi null khi khung hình có nhịp không đều — không phải lỗi dữ liệu.
  return stderr.split('\n').filter((l) => l.trim() && !/non monotonically increasing dts/.test(l)).length;
}

/** Trích một khung hình tại giây thứ `at` ra file PNG. Trả về true nếu thành công. */
export async function grabFrame(file, at, outPng) {
  const r = await runFfmpeg(['-loglevel', 'error', '-y', '-i', file, '-ss', String(at), '-frames:v', '1', outPng]);
  return r.code === 0 && fs.existsSync(outPng) && fs.statSync(outPng).size > 1000;
}

/** Ghép các đoạn ghi thành một file. Đoạn quá nhỏ (ghi hỏng) bị bỏ qua. */
async function buildRecording(dir, parts, log, trimLastSeconds = null) {
  const good = parts.filter((f) => fs.existsSync(f) && fs.statSync(f).size > 20000);
  if (!good.length) return null;
  const ext = config.outputFormat === 'mp4' ? 'mp4' : 'webm';
  const out = path.join(dir, `recording.${ext}`);
  const codec = ext === 'mp4' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'] : ['-c', 'copy'];

  // Chuẩn hoá từng đoạn trước khi ghép: MediaRecorder không cố định thứ tự luồng (đoạn này hình trước,
  // đoạn kia tiếng trước) — ghép thẳng sẽ làm hỏng hình của các đoạn sau. Ép thứ tự: hình rồi tới tiếng.
  const normalized = [];
  for (const f of good) {
    const n = f.replace(/\.webm$/, '.norm.webm');
    // Đoạn cuối có thể cần cắt bỏ phần đuôi phòng trống (bản gốc trong parts/ vẫn giữ nguyên).
    const cut = trimLastSeconds && f === parts.at(-1) ? ['-t', String(trimLastSeconds)] : [];
    const r = await runFfmpeg(['-y', '-i', f, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', ...cut, n]);
    if (r.code === 0 && fs.existsSync(n) && fs.statSync(n).size > 20000) normalized.push(n);
    else log(`Bỏ qua đoạn không đọc được: ${path.basename(f)}`);
  }
  const cleanup = () => normalized.forEach((n) => fs.rmSync(n, { force: true }));
  if (!normalized.length) return null;

  let input;
  if (normalized.length === 1) {
    input = ['-i', normalized[0]];
  } else {
    const list = path.join(dir, 'parts', 'concat.txt');
    fs.writeFileSync(list, normalized.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    input = ['-f', 'concat', '-safe', '0', '-i', list];
  }
  log(`Ghép ${normalized.length} đoạn → ${path.basename(out)}`);
  const r = await runFfmpeg(['-y', ...input, ...codec, out]);
  cleanup();
  if (r.code !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 20000) {
    log(`Ghép file thất bại (giữ nguyên các đoạn trong parts/): ${r.stderr.split('\n').slice(-4).join(' | ')}`);
    fs.rmSync(out, { force: true });
    if (good.length === 1) {
      const fallback = path.join(dir, 'recording.webm');
      fs.copyFileSync(good[0], fallback);
      return fallback;
    }
    return null;
  }
  return out;
}

async function extractAudio(dir, recording, log) {
  const audioDir = path.join(dir, 'audio');
  fs.rmSync(audioDir, { recursive: true, force: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const r = await runFfmpeg(['-y', '-i', recording, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), path.join(audioDir, 'chunk-%03d.mp3')]);
  if (r.code !== 0) {
    log(`Tách âm thanh thất bại: ${r.stderr.split('\n').slice(-3).join(' | ')}`);
    return [];
  }
  return fs
    .readdirSync(audioDir)
    .filter((f) => f.endsWith('.mp3'))
    .sort()
    .map((f) => path.join(audioDir, f));
}

/**
 * Hậu kỳ một phiên: ghép video → tách tiếng → phiên âm → tóm tắt.
 * Mỗi bước hỏng không làm mất kết quả của bước trước; có thể chạy lại bằng `classrec process`.
 */
export async function postprocess(dir, { parts, title, startedAt, log, withSummary = true, onProgress = () => {}, trimLastSeconds = null, instructor = null }) {
  const outputs = {};
  const notes = [];

  let recording = await buildRecording(dir, parts, log, trimLastSeconds);
  if (!recording) {
    // Chạy lại `process` trên phiên đã có sẵn file ghép.
    recording = ['recording.webm', 'recording.mp4'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f)) || null;
  }
  if (!recording) {
    log('Không có đoạn ghi hình nào để xuất.');
    outputs.notes = ['Không ghi được hình (chưa vào được phòng).'];
    return outputs;
  }
  const info = await probe(recording);
  outputs.recording = recording;
  outputs.durationSeconds = info.duration ? Math.round(info.duration) : null;
  log(`File ghi hình: ${recording} (${info.duration ? Math.round(info.duration) + 's' : '?'}, video=${info.hasVideo}, audio=${info.hasAudio})`);

  if (!withSummary) return outputs;
  if (!info.hasAudio) {
    notes.push('File ghi không có âm thanh nên không thể phiên âm/tóm tắt.');
    outputs.notes = notes;
    return outputs;
  }

  // Phiên âm
  let transcript = null;
  const transcriptFile = path.join(dir, 'transcript.txt');
  const local = sttProvider() === 'local';
  const providers = apiProviders();
  const canLocal = localSttInstalled() && (local || config.sttFallbackLocal);
  if (local ? !localSttInstalled() : !providers.length && !canLocal) {
    notes.push(
      local
        ? 'Đã chọn phiên âm trên máy nhưng chưa cài bộ phiên âm, nên bỏ qua phiên âm và tóm tắt. Cài ở tab Cài đặt rồi chạy lại: classrec process ' + path.basename(dir)
        : 'Chưa đặt API key phiên âm nên bỏ qua phiên âm và tóm tắt. Thêm key (hoặc chọn phiên âm trên máy) trong Cài đặt rồi chạy lại: classrec process ' + path.basename(dir),
    );
    log(notes.at(-1));
  } else {
    try {
      onProgress(local ? 'Đang phiên âm tại máy' : 'Đang phiên âm');
      // Tại máy: đưa thẳng một file tiếng (WAV mono 16 kHz) cho mô hình, không cần cắt khúc.
      // fromSec > 0: chỉ phiên âm phần còn lại của buổi học (khi dịch vụ API dừng giữa chừng).
      const runLocal = async (fromSec = 0) => {
        const wav = path.join(dir, 'audio.wav');
        const r = await runFfmpeg(['-y', ...(fromSec ? ['-ss', String(fromSec)] : []), '-i', recording, '-vn', '-ac', '1', '-ar', '16000', wav]);
        if (r.code !== 0) throw new Error('Không tách được âm thanh từ video');
        try {
          return await transcribeLocalPieces(wav, { log, onProgress, offset: fromSec });
        } finally {
          fs.rmSync(wav, { force: true });
        }
      };

      let pieces;
      if (local || !providers.length) {
        pieces = await runLocal();
      } else {
        const chunks = await extractAudio(dir, recording, log);
        const r = await transcribeChunks(chunks, { chunkSeconds: CHUNK_SECONDS, log, onProgress, providers });
        pieces = r.pieces;
        const minute = (chunk) => Math.round((chunk * CHUNK_SECONDS) / 60);
        if (r.switchedAtChunk !== null && r.doneChunks > r.switchedAtChunk) {
          notes.push(`Dịch vụ phiên âm chính bị lỗi từ phút ${minute(r.switchedAtChunk)}; phần sau đó do dịch vụ dự phòng phiên âm.`);
        }
        if (r.error) {
          // Mọi dịch vụ API đều dừng (hết tiền, hết hạn mức, mất mạng). Phần đã phiên âm vẫn được giữ.
          const reason = r.error.message.split('\n')[0];
          if (canLocal) {
            log(`Dịch vụ phiên âm dừng ở phút ${minute(r.doneChunks)} (${reason}) — phần còn lại phiên âm tại máy`);
            notes.push(`Dịch vụ phiên âm qua API dừng ở phút ${minute(r.doneChunks)} (${reason}); phần còn lại được phiên âm tại máy.`);
            onProgress('Đang phiên âm tại máy');
            pieces.push(...(await runLocal(r.doneChunks * CHUNK_SECONDS)));
          } else if (pieces.length) {
            log(`Dịch vụ phiên âm dừng ở phút ${minute(r.doneChunks)}: ${reason}`);
            notes.push(`Phiên âm dừng ở phút ${minute(r.doneChunks)} (${reason}). Bản phiên âm và tóm tắt chỉ gồm phần trước đó; sửa xong thì bấm "Phiên âm và tóm tắt lại".`);
          } else {
            throw r.error;
          }
        }
      }
      transcript = toText(pieces);
      fs.writeFileSync(transcriptFile, transcript);
      outputs.transcript = transcriptFile;
      log(`Bản phiên âm: ${transcriptFile} (${transcript.length} ký tự)`);
    } catch (e) {
      notes.push(`Phiên âm thất bại: ${e.message.split('\n')[0]}`);
      log(notes.at(-1));
    }
  }

  // Tóm tắt
  if (transcript && transcript.trim().length > 200) {
    try {
      onProgress('Đang tạo bản tóm tắt');
      const md = await summarize({ transcript, title, startedAt, durationSeconds: outputs.durationSeconds, instructor, log });
      const summaryFile = path.join(dir, 'summary.md');
      fs.writeFileSync(summaryFile, md);
      outputs.summary = summaryFile;
      log(`Bản tóm tắt: ${summaryFile}`);
    } catch (e) {
      notes.push(`Tóm tắt thất bại: ${e.message.split('\n')[0]} — bản phiên âm vẫn có ở transcript.txt`);
      log(notes.at(-1));
    }
  } else if (transcript) {
    notes.push('Bản phiên âm quá ngắn (gần như không có lời nói) nên không tạo tóm tắt.');
  }

  if (notes.length) outputs.notes = notes;
  return outputs;
}
