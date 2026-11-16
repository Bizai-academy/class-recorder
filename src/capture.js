import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { sleep } from './util.js';

/**
 * Ghi hình + tiếng của tab đang mở bằng getDisplayMedia + MediaRecorder ngay trong trang,
 * rồi đẩy từng khúc WebM về Node để ghi ra đĩa. Cách này chạy giống nhau trên Windows và Linux
 * (không cần thiết bị âm thanh ảo hay quay cả màn hình).
 */

/* Hàm này chạy TRONG TRANG (được chuyển thành chuỗi). Không dùng biến bên ngoài. */
function pageStart(opts) {
  return (async () => {
    const w = window;
    if (w.__cr && w.__cr.rec && w.__cr.rec.state === 'recording') return { ok: true, already: true };

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: opts.fps, max: opts.fps }, width: { max: opts.width }, height: { max: opts.height } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      systemAudio: 'include',
      surfaceSwitching: 'exclude',
    });

    const wanted = opts.codec === 'vp9' ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'] : ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'];
    const mime = [...wanted, 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: opts.videoKbps * 1000,
      audioBitsPerSecond: opts.audioKbps * 1000,
    });

    let seq = 0;
    let queue = Promise.resolve();
    const toBase64 = (blob) =>
      new Promise((resolve, reject) => {
        const fr = new FileReader();
        // Lưu ý: MIME có thể chứa dấu phẩy ("codecs=vp8,opus") nên phải cắt theo mốc ";base64,".
        fr.onload = () => {
          const s = String(fr.result);
          resolve(s.slice(s.indexOf(';base64,') + 8));
        };
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });

    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const n = seq++;
      queue = queue
        .then(() => toBase64(e.data))
        .then((b64) => w.__crChunk(opts.token, n, b64))
        .catch(() => {});
    };
    rec.start(opts.timesliceMs);

    // Đồng hồ âm lượng: ghi nhận đỉnh âm lượng của tiếng tab, để bên ngoài biết phòng đang có tiếng hay im lặng.
    let peak = 0;
    let meterTimer = null;
    let meterCtx = null;
    if (stream.getAudioTracks().length) {
      try {
        meterCtx = new AudioContext();
        const analyser = meterCtx.createAnalyser();
        analyser.fftSize = 1024;
        meterCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        meterTimer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i]);
            if (v > peak) peak = v;
          }
        }, 200);
      } catch (e) {
        meterCtx = null;
      }
    }

    w.__cr = {
      rec,
      stream,
      // Trả về đỉnh âm lượng (0..1) kể từ lần gọi trước; null nếu không đo được.
      takePeak: () => {
        if (!meterCtx) return null;
        const p = peak;
        peak = 0;
        return p;
      },
      stop: () =>
        new Promise((resolve) => {
          const finish = async () => {
            await queue;
            if (meterTimer) clearInterval(meterTimer);
            if (meterCtx) meterCtx.close().catch(() => {});
            stream.getTracks().forEach((t) => t.stop());
            resolve(true);
          };
          if (rec.state === 'inactive') return void finish();
          rec.onstop = finish;
          rec.stop();
        }),
    };
    const at = stream.getAudioTracks()[0];
    return { ok: true, mime, audioTracks: stream.getAudioTracks().length, videoTracks: stream.getVideoTracks().length, audioLabel: at ? at.label : null };
  })();
}

export class Capture {
  constructor(context, log) {
    this.context = context;
    this.log = log;
    this.current = null; // { token, file, out, nextSeq, pending, bytes, lastChunkAt, startedAt, page }
    this.bound = false;
  }

  async #bind() {
    if (this.bound) return;
    await this.context.exposeFunction('__crChunk', (token, seq, b64) => {
      const c = this.current;
      if (!c || c.token !== token) return;
      c.pending.set(seq, Buffer.from(b64, 'base64'));
      while (c.pending.has(c.nextSeq)) {
        const buf = c.pending.get(c.nextSeq);
        c.pending.delete(c.nextSeq);
        c.out.write(buf);
        c.bytes += buf.length;
        c.nextSeq++;
      }
      c.lastChunkAt = Date.now();
    });
    this.bound = true;
  }

  get active() {
    return !!this.current;
  }

  /** true nếu đang ghi nhưng đã lâu không nhận được dữ liệu (trang bị tải lại, tab treo...). */
  stalled(ms = 20000) {
    return !!this.current && Date.now() - this.current.lastChunkAt > ms;
  }

  async start(page, file) {
    await this.#bind();
    if (this.current) await this.stop();
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const out = fs.createWriteStream(file);
    this.current = { token, file, out, nextSeq: 0, pending: new Map(), bytes: 0, lastChunkAt: Date.now(), startedAt: Date.now(), page };

    const opts = {
      token,
      fps: config.fps,
      width: config.width,
      height: config.height,
      codec: config.videoCodec,
      videoKbps: config.videoKbps,
      audioKbps: config.audioKbps,
      timesliceMs: 2000,
    };

    try {
      // Trang vừa điều hướng có thể chưa có binding __crChunk — đợi một chút.
      for (let i = 0; i < 20; i++) {
        const has = await page.evaluate(() => typeof window.__crChunk === 'function').catch(() => false);
        if (has) break;
        await sleep(250);
      }
      // getDisplayMedia cần "user gesture" → gọi qua CDP với userGesture: true.
      const cdp = await this.context.newCDPSession(page);
      const res = await cdp.send('Runtime.evaluate', {
        expression: `(${pageStart.toString()})(${JSON.stringify(opts)})`,
        awaitPromise: true,
        userGesture: true,
        returnByValue: true,
      });
      await cdp.detach().catch(() => {});
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        throw new Error(d.exception?.description || d.text || 'getDisplayMedia thất bại');
      }
      const info = res.result?.value || {};
      this.log(`Bắt đầu ghi → ${path.basename(file)} (${info.mime || '?'}, video=${info.videoTracks}, audio=${info.audioTracks})`);
      if (!info.audioTracks) this.log('CẢNH BÁO: không lấy được tiếng của tab — file sẽ không có âm thanh.');
      else if (/fake/i.test(info.audioLabel || '')) this.log(`CẢNH BÁO: nguồn tiếng là "${info.audioLabel}" chứ không phải tiếng của tab — file sẽ bị câm.`);
      return { file, ...info };
    } catch (e) {
      out.destroy();
      this.current = null;
      fs.rmSync(file, { force: true });
      throw e;
    }
  }

  /** Đỉnh âm lượng của tab (0..1) kể từ lần hỏi trước; null nếu không đo được. */
  async level() {
    const c = this.current;
    if (!c || c.page.isClosed()) return null;
    try {
      const v = await c.page.evaluate(() => (window.__cr && window.__cr.takePeak ? window.__cr.takePeak() : null));
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  }

  async stop() {
    const c = this.current;
    if (!c) return null;
    try {
      if (!c.page.isClosed()) {
        await Promise.race([c.page.evaluate(() => window.__cr && window.__cr.stop && window.__cr.stop()), sleep(8000)]);
      }
    } catch {
      /* trang đã điều hướng/đóng — giữ những gì đã ghi được */
    }
    await sleep(300);
    this.current = null;
    await new Promise((r) => c.out.end(r));
    const seconds = Math.round((Date.now() - c.startedAt) / 1000);
    this.log(`Dừng ghi ${path.basename(c.file)} — ${(c.bytes / 1e6).toFixed(1)} MB, ~${seconds}s`);
    return { file: c.file, bytes: c.bytes, startedAt: c.startedAt, endedAt: Date.now() };
  }
}
