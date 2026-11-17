# Class Recorder — ghi chú cho trợ lý AI

Luôn trả lời bằng tiếng Việt. Bot tự vào lớp Zoom/Google Meet, ghi hình + tiếng, phiên âm, tóm tắt; có giao diện web. Chi tiết tính năng: `README.vi.md` (bản tiếng Anh: `README.md`, sửa tính năng thì cập nhật cả hai). Điều khiển bằng dòng lệnh: `AGENT.md`. Cài VPS: `HUONG-DAN-VPS.md`.

## Nơi chạy
- **Máy cá nhân (Windows):** thư mục này, git nhánh `main`. Mở giao diện: `Class Recorder.bat`.
- **VPS (nếu có):** địa chỉ và cách đăng nhập ghi ở `CLAUDE.local.md` (file riêng từng máy, không vào git). Mã ở `/opt/class-recorder`, dịch vụ systemd `class-recorder` (nội bộ `127.0.0.1:8787`), Caddy HTTPS. Không đụng các dịch vụ khác trên máy chủ.

## Kiểm thử và triển khai
- Kiểm thử đầy đủ (52 mục, ~4 phút): `node src/cli.js selftest`. Nhanh hơn: `node test/features-check.mjs`, `node test/stt-fallback-check.mjs`, `node test/auth-check.mjs`. Kiểm tra key thật: `node test/stt-check.mjs`, `node test/summary-check.mjs` (tốn vài xu).
- Triển khai: commit git → `node scripts/deploy.mjs` (đọc DEPLOY_HOST trong .env; tự loại remote-login.js, cài thư viện, chạy selftest trên VPS rồi mới restart).
- Script `.sh` phải giữ xuống dòng LF (đã có `.gitattributes`).

## Cấu hình hiện tại
- Phiên âm trên VPS: Groq `whisper-large-v3` (chính, miễn phí) → Fish Audio (dự phòng, số dư rất thấp) → giữ phần đã xong nếu cả hai hỏng. Tóm tắt: Claude `claude-opus-5-5`.
- Có: ghi song song tối đa MAX_PARALLEL lớp (mặc định 2; mỗi lớp một hồ sơ trình duyệt default/lop2/lop3; test/parallel-check.mjs), tìm kiếm toàn văn (src/search.js), tự dọn buổi cũ + cảnh báo đĩa (src/cleanup.js), đồng bộ Google Calendar qua iCal (src/calendar.js), hỏi đáp về các buổi đã ghi (src/ask.js), đoán giảng viên theo người nói lâu nhất (src/speakers.js — chưa kiểm chứng trên Zoom/Meet thật), lịch ghi tự động, thông báo trên trình duyệt (chuông 🔔), xoá buổi ghi, đổi mật khẩu, cảnh báo bot còn một mình, cắt đuôi phòng trống.

## Đóng gói
- Đóng gói: `node scripts/build.mjs` dựng gói cho hệ điều hành đang chạy (Windows: zip + file cài Inno Setup; macOS: zip; Linux: tar.gz) vào `dist/`. Ba hệ cùng lúc: GitHub Actions `.github/workflows/release.yml` (chạy khi đẩy tag `v*`). `src/remote-login.js` không nằm trong git và không được đóng gói.
