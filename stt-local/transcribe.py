"""Phiên âm tại máy bằng faster-whisper (miễn phí, âm thanh không rời khỏi máy).

Cách dùng:
    python transcribe.py <file.wav mono 16 kHz> [--model large-v3-turbo] [--language vi] [--models-dir DIR] [--device auto|cuda|cpu]

In ra stdout mỗi dòng một JSON: {"start": giây, "end": giây, "text": "..."}; dòng cuối là {"done": true, ...}.
Tiến độ và thông tin máy in ra stderr.
"""
import argparse
import glob
import json
import os
import site
import sys
import time


def add_nvidia_dll_dirs():
    """Windows: thư viện CUDA cài qua pip nằm trong site-packages/nvidia/*/bin — phải khai báo trước khi nạp ctranslate2."""
    if os.name != "nt":
        return
    for sp in site.getsitepackages():
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
            except OSError:
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def read_wav_16k(path):
    """Đọc WAV mono 16 kHz 16-bit bằng thư viện chuẩn (không phụ thuộc PyAV, vốn hay lệch phiên bản với faster-whisper)."""
    import wave

    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit("File âm thanh phải là WAV mono 16 kHz 16-bit (bot tự chuyển bằng ffmpeg trước khi gọi).")
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def load_model(name, models_dir, device, threads=0, compute=""):
    from faster_whisper import WhisperModel

    # Thử lần lượt: GPU (gọn bộ nhớ) → GPU (chính xác hơn, tốn bộ nhớ hơn) → CPU.
    attempts = []
    if device in ("auto", "cuda"):
        attempts += [("cuda", c) for c in ([compute] if compute else ["int8_float16", "int8", "float32"])]
    if device in ("auto", "cpu"):
        attempts += [("cpu", compute if compute and device == "cpu" else "int8")]
    last = None
    for dev, compute in attempts:
        try:
            model = WhisperModel(name, device=dev, compute_type=compute, download_root=models_dir, cpu_threads=threads)
            return model, dev, compute
        except Exception as e:  # thiếu CUDA, hết bộ nhớ GPU, kiểu số không hỗ trợ...
            last = e
            print(f"[stt] không dùng được {dev}/{compute}: {str(e).splitlines()[0][:160]}", file=sys.stderr, flush=True)
    raise SystemExit(f"Không nạp được mô hình {name}: {last}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--language", default="")
    ap.add_argument("--models-dir", default=None)
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--prompt", default="", help="Gợi ý từ vựng: tên riêng, thuật ngữ")
    ap.add_argument("--threads", type=int, default=0, help="Số luồng CPU (0 = tự chọn)")
    ap.add_argument("--compute", default="", help="Kiểu số của mô hình (int8_float16, int8, float32...); để trống = tự chọn")
    args = ap.parse_args()

    add_nvidia_dll_dirs()
    if hasattr(os, "nice"):
        try:
            os.nice(10)  # Linux/VPS: nhường CPU cho việc khác (ví dụ một buổi ghi đang chạy)
        except OSError:
            pass
    t0 = time.time()
    model, dev, compute = load_model(args.model, args.models_dir, args.device, args.threads, args.compute)
    print(f"[stt] mô hình {args.model} trên {dev}/{compute}, nạp trong {time.time() - t0:.1f}s", file=sys.stderr, flush=True)

    audio = read_wav_16k(args.audio)

    # Ngôn ngữ cài đặt chỉ là gợi ý: nếu nghe rõ ràng là tiếng khác (ví dụ lớp tiếng Anh) thì theo tiếng nghe được,
    # vì ép sai ngôn ngữ sẽ cho ra bản phiên âm vô nghĩa.
    language = args.language or None
    if language:
        try:
            detected, prob, _ = model.detect_language(audio[: 30 * 16000])
            if detected != language and prob >= 0.85:
                print(f"[stt] nghe ra tiếng '{detected}' (độ chắc {prob:.0%}) thay vì '{language}' — phiên âm theo tiếng nghe được", file=sys.stderr, flush=True)
                language = detected
        except Exception:
            pass  # bản faster-whisper cũ không có detect_language — giữ ngôn ngữ đã cài

    t1 = time.time()
    segments, info = model.transcribe(
        audio,
        language=language,
        beam_size=5,
        vad_filter=True,  # bỏ qua khoảng lặng: nhanh hơn và tránh "bịa chữ" khi không ai nói
        vad_parameters={"min_silence_duration_ms": 700},
        condition_on_previous_text=False,  # tránh lỗi lặp câu kéo dài
        initial_prompt=args.prompt or None,
    )
    last_report = 0.0
    for s in segments:
        text = s.text.strip()
        if text:
            print(json.dumps({"start": round(s.start, 2), "end": round(s.end, 2), "text": text}, ensure_ascii=False), flush=True)
        if s.end - last_report >= 60:
            last_report = s.end
            print(f"[stt] đã phiên âm {s.end / 60:.0f}/{info.duration / 60:.0f} phút", file=sys.stderr, flush=True)
    took = time.time() - t1
    print(
        json.dumps({"done": True, "device": dev, "compute": compute, "language": info.language, "audioSeconds": round(info.duration, 1), "seconds": round(took, 1), "speed": round(info.duration / took, 1) if took > 0 else None}, ensure_ascii=False),
        flush=True,
    )


if __name__ == "__main__":
    main()
