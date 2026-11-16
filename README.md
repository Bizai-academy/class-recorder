# class-recorder — bot ghi hình lớp học online

Bot tự vào lớp học trên **Zoom** hoặc **Google Meet** bằng trình duyệt, ghi lại hình + tiếng từ lúc phòng mở đến lúc phòng đóng, hỗ trợ **rejoin** khi lớp đổi sang link khác, rồi tạo **bản phiên âm** và **file tóm tắt**. Chạy được trên máy cá nhân (Windows) và trên VPS Linux — do người hoặc do một agent như Mausbot điều khiển qua dòng lệnh.

> Hãy báo với giảng viên/đơn vị tổ chức rằng bạn dùng bot ghi hình. Bot xuất hiện trong phòng như một người tham dự với tên đặt ở `BOT_NAME`; mic luôn tắt, camera là hình đen.

## Cách hoạt động

```
classrec start <link>
   │  chờ phòng mở (tối đa WAIT_OPEN_MIN phút, tự tải lại trang mỗi 30 giây)
   ▼
vào phòng (điền tên, tắt mic/camera, bấm Join / Ask to join, chờ được duyệt)
   ▼
ghi hình tab (WebM: VP8 + Opus) ──► parts/part-001.webm
   │                 ▲
   │  classrec rejoin <link-mới> ──► rời phòng cũ, vào phòng mới ──► parts/part-002.webm ...
   ▼
phòng đóng → chờ thêm REJOIN_GRACE_MIN phút (đề phòng lớp mở lại / bạn gửi link mới)
   ▼
ghép các đoạn → recording.webm → tách tiếng → phiên âm → transcript.txt → Claude → summary.md
```

Kết quả mỗi buổi nằm trong `data/sessions/<ngày-giờ>-<tên-buổi>/`:

| File | Nội dung |
|---|---|
| `recording.webm` | Video cả buổi (các đoạn trước/sau rejoin đã ghép) |
| `transcript.txt` | Bản phiên âm kèm mốc `[hh:mm:ss]` |
| `summary.md` | Tóm tắt: tổng quan, nội dung chính theo mốc thời gian, thuật ngữ, bài tập/việc cần làm, câu hỏi ôn tập |
| `parts/` | Các đoạn ghi gốc (giữ lại để phòng khi cần ghép lại) |
| `status.json`, `session.log`, `debug/*.png` | Trạng thái, nhật ký và ảnh chụp mỗi lần phòng đổi trạng thái |

## Cài đặt

### Máy cá nhân (Windows)

Cần Node.js ≥ 20.12 và Google Chrome (hoặc Edge).

```powershell
cd class-recorder
npm install
copy .env.example .env      # rồi điền STT_API_KEY và ANTHROPIC_API_KEY
node src/cli.js selftest    # tự kiểm thử: phải ra "Tất cả đều đạt"
```

### VPS (Ubuntu/Debian)

```bash
bash scripts/setup-vps.sh   # cài Node, Chrome, Xvfb, PulseAudio, phông chữ, rồi chạy selftest
```

VPS nên có ≥ 2 vCPU và 4 GB RAM. Mỗi giờ ghi ở cấu hình mặc định chiếm khoảng 0,6 GB.

## Giao diện (không cần gõ lệnh)

Trên Windows, bấm đúp file **`Class Recorder.bat`**. Trình duyệt mở trang `http://127.0.0.1:8787` với ba màn hình:

| Màn hình | Làm được gì |
|---|---|
| **Ghi hình** | Dán link, bấm *Bắt đầu ghi*; theo dõi bot đang ở bước nào và đang thấy gì; dán link mới rồi bấm *Đổi phòng*; *Dừng ghi và xuất file* |
| **Buổi đã ghi** | Xem lại video, bản tóm tắt, bản phiên âm (bấm vào mốc `[hh:mm:ss]` để tua video tới đó); chạy lại phiên âm/tóm tắt; mở thư mục chứa file |
| **Cài đặt** | Mọi thông số: tên bot, dịch vụ phiên âm và API key, model tóm tắt, thời gian chờ, chất lượng ghi. Có nút kiểm tra phiên âm, tự kiểm thử ghi hình, và đăng nhập Google/Zoom cho bot |

Các tính năng quản lý trên giao diện:

- **Lịch ghi tự động** (tab Ghi hình): đặt lớp lặp theo thứ trong tuần hoặc một ngày cụ thể; tới giờ bot tự bắt đầu ghi. Giờ tính theo đồng hồ của máy chạy app, và lịch chỉ chạy khi app đang chạy (trên VPS là luôn chạy). Nếu lúc đó đang có buổi ghi khác thì lịch bị bỏ qua.
- **Thông báo** (chuông 🔔 trên thanh trên cùng): bot báo khi vào được lớp, khi cần bạn quyết định, và khi buổi ghi kết thúc hoặc lỗi. Bấm "Bật thông báo bật lên" để trình duyệt hiện cả thông báo nổi khi trang đang mở ở tab khác. Chỉ gồm tên buổi và trạng thái.
- **Hỏi về các buổi học** (đầu tab Buổi đã ghi): hỏi bằng tiếng Việt, Claude trả lời dựa trên bản tóm tắt và phiên âm, kèm trích dẫn dạng `[B2 00:12:30]`; bấm vào trích dẫn để mở đúng buổi và tua tới đó. Mỗi câu hỏi tốn vài xu tiền Claude (dùng model ở mục Tóm tắt).
- **Giảng viên tự đoán:** trong lúc ghi, bot đọc ai đang được Zoom/Meet đánh dấu là đang nói và cộng dồn thời gian; người nói lâu nhất được ghi là giảng viên và đưa vào bản tóm tắt. Sửa tên bằng nút **Sửa** trong chi tiết buổi. Phần đọc người đang nói dựa vào giao diện Zoom/Meet nên có thể cần chỉnh khi giao diện đổi; nhật ký buổi ghi có dòng "Nhận diện người nói: …" khi chạy được.
- **Xoá buổi ghi** (tab Buổi đã ghi): xoá hẳn video, phiên âm và tóm tắt của một buổi; không khôi phục được.
- **Đổi mật khẩu** (tab Cài đặt, chỉ hiện khi giao diện bật đăng nhập).

Cài đặt được lưu vào file `.env` và áp dụng từ buổi ghi tiếp theo. API key đã lưu không bao giờ hiện lại trên trang, chỉ hiện 4 ký tự cuối. Cửa sổ đen đi kèm là máy chủ của giao diện: giữ nó mở khi dùng giao diện; đóng nó không làm dừng buổi đang ghi.

Giao diện chỉ nghe ở `127.0.0.1` nên máy khác trong mạng không truy cập được. Muốn dùng giao diện của bot chạy trên VPS, chạy `node src/cli.js ui --no-open` trên VPS rồi mở đường hầm từ máy cá nhân: `ssh -L 8787:127.0.0.1:8787 <user>@<vps>`, sau đó vào `http://127.0.0.1:8787`.

## Sử dụng bằng dòng lệnh

```bash
node src/cli.js ui                # mở giao diện
node src/cli.js start "https://zoom.us/j/123456789?pwd=xxxx" --title "Toán cao cấp - buổi 5"
node src/cli.js start "https://meet.google.com/abc-defg-hij" --title "Tiếng Anh" --detach   # chạy nền
node src/cli.js status            # đang ở giai đoạn nào, file nằm đâu
node src/cli.js rejoin "https://zoom.us/j/987654321?pwd=yyyy"   # lớp đổi phòng
node src/cli.js stop              # dừng và xuất file ngay
node src/cli.js list              # các buổi đã ghi
node src/cli.js process <mã-phiên>   # chạy lại ghép file / phiên âm / tóm tắt
```

Xem toàn bộ tuỳ chọn: `node src/cli.js --help`. Mọi mặc định chỉnh trong `.env` (xem `.env.example`).

### Phòng yêu cầu đăng nhập

Nhiều lớp Google Meet chỉ cho tài khoản Google vào. Chạy một lần:

```bash
node src/cli.js login
```

Trình duyệt mở ra, **bạn tự đăng nhập**, rồi đóng cửa sổ. Bot dùng lại phiên đăng nhập đó (lưu ở `data/profiles/default`). Trên VPS không có màn hình, chạy lệnh này qua VNC/remote desktop hoặc `ssh -X`.

### Khi nào bot coi là "phòng mở" / "phòng đóng"

| | Zoom | Google Meet |
|---|---|---|
| Phòng chưa mở | Trang báo host chưa bắt đầu | Chưa có ai trong phòng (`MEET_WAIT_FOR_OTHERS=true`) hoặc chưa ai duyệt |
| Phòng đóng | Host kết thúc / bot bị mời ra | Cuộc gọi kết thúc / bot bị mời ra / Meet tự ngắt khi không còn ai |
| Chung | Chỉ còn một mình hơn `ALONE_MIN` phút, phòng im lặng tuyệt đối hơn `SILENCE_END_MIN` phút, hoặc chạm `MAX_HOURS` | |

**Khi host chỉ rời phòng mà không kết thúc cuộc họp**, phòng vẫn mở và bot còn lại một mình. Sau 1 phút, bot báo "đang ở một mình trong phòng": giao diện hiện bảng cảnh báo với hai nút *Dừng ghi và xuất file* và *Chờ thêm*, kèm thông báo trên màn hình máy tính (nếu bạn đã cho phép trình duyệt hiện thông báo). Không ai chọn thì bot tự dừng sau `ALONE_MIN` phút. Bằng dòng lệnh: `classrec stop` hoặc `classrec keep`.

Sau khi phòng đóng, bot mặc định **không** tự quay lại link cũ (Zoom cho vào lại cả phòng host đã kết thúc, khiến bot ngồi ghi phòng trống). Nếu lớp của bạn hay bị ngắt rồi mở lại đúng link cũ, bật `RETRY_SAME_LINK`: khi đó bot vào lại, và nếu sau 1 phút phòng vẫn trống và im lặng thì tự rời, không đưa đoạn đó vào video.

## Phiên âm và tóm tắt

- **Phiên âm** có hai cách, chọn ở Cài đặt (`STT_PROVIDER`):
  - *Qua dịch vụ API* (`auto`): OpenAI, Groq (tương thích `/audio/transcriptions`) hoặc Fish Audio; đổi bằng `STT_BASE_URL`, `STT_MODEL`, `STT_API_KEY`. Âm thanh được cắt thành khúc 10 phút trước khi gửi.
  - *Chạy trên máy* (`local`): mô hình Whisper chạy bằng faster-whisper, không tốn phí và âm thanh không rời khỏi máy. Cài một lần bằng nút **Cài bộ phiên âm trên máy** (hoặc `node scripts/setup-stt.mjs`): cần Python ≥ 3.9, khoảng 5 GB đĩa. Có card NVIDIA thì chạy trên GPU, không có thì chạy trên CPU.
  - Khi dịch vụ API lỗi hoặc hết hạn mức, bot tự chuyển sang phiên âm trên máy nếu đã cài (`STT_FALLBACK_LOCAL`).
  - Ngôn ngữ cài đặt là gợi ý: nếu lớp rõ ràng nói tiếng khác (ví dụ tiếng Anh), bộ phiên âm trên máy tự theo tiếng nghe được.

  Số đo trên máy thử (Ryzen 5 5600H, GTX 1650 4 GB), với một đoạn họp tiếng Việt nhiều người nói chen nhau:

  | Cách phiên âm | Tốc độ so với thời gian thực | Độ chính xác trên đoạn thử |
  |---|---|---|
  | Fish Audio `transcribe-1-pro` (API, 0,36 USD/giờ) | rất nhanh | cao nhất |
  | `large-v3` trên GPU | nhanh gấp 3,4 lần | khá, sai một số từ và tên riêng |
  | `large-v3` trên CPU 6 luồng | 0,9 lần | như trên |
  | PhoWhisper-large trên GPU | nhanh gấp 3,4 lần | từ tiếng Việt tốt hơn, từ tiếng Anh bị viết kiểu Việt |
  | `large-v3-turbo` trên GPU / CPU 4 luồng | gấp 7,9 lần / 1,2 lần | thấp nhất |
- **Tóm tắt** gọi Claude API (`ANTHROPIC_API_KEY`), model mặc định `claude-opus-5-5`; đổi bằng `SUMMARY_MODEL` (ví dụ `claude-sonnet-5-5` hoặc `claude-haiku-5-5` để tiết kiệm).
- Thiếu key nào thì bước đó được bỏ qua, video vẫn xuất bình thường; điền key rồi chạy `process` để làm bù.

## Kiểm thử và xử lý sự cố

- `node src/cli.js selftest` dựng hai phòng học giả lập trên localhost và chạy trọn luồng: chờ mở → vào → ghi → rejoin → đóng → ghép file, rồi kiểm tra file có hình, có tiếng thật, đúng thời lượng, giải mã không lỗi. Chạy lệnh này trước tiên trên mỗi máy mới.
- `node test/probe.mjs <link>` mở link và in ra trạng thái bot nhận diện được cùng các nút trên trang, **không vào phòng**. Dùng khi bot kẹt ở một màn hình: Zoom/Meet thỉnh thoảng đổi giao diện, khi đó chỉnh mẫu chữ/selector ở đầu file `src/platforms/zoom.js` hoặc `meet.js`.
- Mỗi lần phòng đổi trạng thái, bot chụp một ảnh vào `debug/` của phiên — xem ảnh đó cùng `session.log` để biết bot đang thấy gì.
- File ghi không có tiếng trên VPS: kiểm tra `pulseaudio` đã cài và `selftest` đạt mục "Thu được tiếng thật của tab".

## Cấu trúc mã

```
Class Recorder.bat   bấm đúp để mở giao diện (Windows)
ui/index.html        trang giao diện
src/server.js        máy chủ giao diện (chỉ nghe ở 127.0.0.1) và API cho trang
src/settings.js      đọc/ghi cài đặt trong .env
src/cli.js           lệnh dòng lệnh
src/session.js       vòng đời một buổi học (máy trạng thái: chờ mở → vào → ghi → rejoin → đóng)
src/capture.js       ghi hình + tiếng của tab (getDisplayMedia + MediaRecorder)
src/browser.js       mở Chrome với hồ sơ riêng, mic im lặng + camera đen
src/platforms/       nhận diện trạng thái và thao tác vào phòng cho Zoom, Meet, phòng giả lập
src/control.js       kênh lệnh bằng file (rejoin / stop / status)
src/post.js          ghép đoạn, tách tiếng (ffmpeg)
src/transcribe.js    phiên âm
src/summarize.js     tóm tắt bằng Claude API
AGENT.md             hướng dẫn dành cho agent (Mausbot) điều khiển công cụ này
```

## Cập nhật bản mới lên VPS

Trên máy cá nhân, trong thư mục dự án (cần khoá SSH tới VPS; đặt `DEPLOY_HOST=root@<IP>` trong `.env` một lần):

```bash
node scripts/deploy.mjs
```

Lệnh tự kiểm tra VPS không đang ghi, đóng gói (không kèm `.env`, dữ liệu, thư viện), chép lên, cài thư viện, chạy tự kiểm thử trên VPS, rồi mới khởi động lại giao diện. Tự kiểm thử có mục chưa đạt thì dừng, không khởi động lại. Thêm `--skip-selftest` để bỏ qua bước kiểm thử (nhanh hơn khoảng 4 phút).

## Bản đóng gói cho Windows

Người dùng cuối không cần cài Node hay thư viện: bản đóng gói kèm sẵn tất cả, chỉ cần máy có Chrome hoặc Edge.

- **Dùng:** chạy file cài đặt `ClassRecorder-Setup-<bản>.exe` (hoặc giải nén file zip), rồi bấm đúp **Class Recorder**. Lần đầu vào tab Cài đặt để dán key phiên âm và key tóm tắt.
- **Dựng bản mới** (trên máy phát triển): `node scripts/build-windows.mjs` → kết quả nằm trong `dist/`. Muốn có file cài đặt thì máy cần Inno Setup 6.
- Gỡ cài đặt chỉ xoá chương trình; thư mục `data` (video, phiên âm, tóm tắt) và file `.env` (key) được giữ lại.
