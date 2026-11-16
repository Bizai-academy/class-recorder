# Cài Class Recorder lên VPS để dùng qua trình duyệt ở bất cứ đâu

Làm theo hướng dẫn này, bạn sẽ có một địa chỉ `https://…` mở được trên máy tính hoặc điện thoại, đăng nhập bằng mật khẩu, để ra lệnh cho bot ghi lớp học, xem lại video, bản phiên âm và bản tóm tắt. Bot chạy trên VPS nên máy của bạn không cần bật.

Toàn bộ quá trình mất khoảng 15 phút. Các bước đã được chạy thật trên VPS Ubuntu 24.04 (6 vCPU, 8 GB RAM).

## Cần chuẩn bị

| Thứ cần có | Ghi chú |
|---|---|
| VPS Ubuntu 22.04/24.04 hoặc Debian 12 | Tối thiểu 2 vCPU, 4 GB RAM, 20 GB đĩa trống. Mỗi giờ ghi chiếm khoảng 0,2–0,6 GB |
| Quyền đăng nhập SSH bằng `root` (hoặc tài khoản có `sudo`) | Ví dụ: `ssh root@<IP-của-VPS>` |
| File `class-recorder-vps.tar.gz` | Gói mã nguồn. Không chứa API key hay dữ liệu |
| (Tuỳ chọn) một tên miền con | Ví dụ `rec.tenmien.com`. Không có cũng được: script tự dùng địa chỉ miễn phí dạng `1-2-3-4.sslip.io` |

Nếu dùng tên miền riêng: vào trang quản lý DNS của tên miền, tạo bản ghi **A** cho tên miền con (ví dụ `rec`) trỏ về IP của VPS. Đừng trỏ tên miền gốc đang chạy trang web khác.

## Bước 1 — Chép gói lên VPS

Chạy trên máy tính của bạn (Windows PowerShell, macOS hay Linux đều dùng được), thay `<IP>` bằng IP của VPS:

```bash
scp class-recorder-vps.tar.gz root@<IP>:/tmp/
```

## Bước 2 — Giải nén

Đăng nhập VPS rồi giải nén vào `/opt`:

```bash
ssh root@<IP>
```

```bash
tar -xzf /tmp/class-recorder-vps.tar.gz -C /opt && chmod -R u=rwX,go=rX /opt/class-recorder && cd /opt/class-recorder
```

## Bước 3 — Chạy script cài đặt

Có tên miền riêng (đã tạo bản ghi A ở phần chuẩn bị):

```bash
bash scripts/install-vps.sh rec.tenmien.com
```

Chưa có tên miền:

```bash
bash scripts/install-vps.sh
```

Script tự làm các việc sau, theo thứ tự:

1. Cài Google Chrome, màn hình ảo, âm thanh ảo, phông chữ tiếng Việt và Node.js (nếu chưa có).
2. Chạy **tự kiểm thử**: dựng phòng học giả lập, ghi thử, kiểm tra video có hình và tiếng. Phải ra "Tất cả đều đạt" thì script mới đi tiếp.
3. Đặt **mật khẩu đăng nhập** và in ra màn hình một lần duy nhất. Hãy lưu lại ngay.
4. Tạo dịch vụ `class-recorder` tự chạy khi VPS khởi động.
5. Cài Caddy để có HTTPS (tự xin và tự gia hạn chứng chỉ), mở cổng 80 và 443 trên tường lửa `ufw`.

Muốn dịch vụ chạy bằng một tài khoản thường thay vì `root` (nên làm nếu VPS đã có sẵn tài khoản đó, ví dụ tài khoản của một bot khác cần điều khiển Class Recorder), thêm `RUN_USER=<tên>` phía trước:

```bash
RUN_USER=maus bash scripts/install-vps.sh rec.tenmien.com
```

## Bước 4 — Mở giao diện và nhập API key

1. Mở địa chỉ script in ra ở cuối (`https://…`) trên trình duyệt. Lần đầu có thể phải chờ khoảng 1 phút để chứng chỉ HTTPS được cấp.
2. Nhập mật khẩu ở bước 3.
3. Vào tab **Cài đặt**:
   - Mục *Phiên âm*: chọn dịch vụ, dán API key phiên âm.
   - Mục *Tóm tắt (Claude)*: dán API key Claude.
   - Bấm **Lưu cài đặt**, rồi bấm **Kiểm tra phiên âm** và **Kiểm tra tóm tắt** để chắc chắn hai key hoạt động.

## Bước 5 — Ghi thử một buổi

Vào tab **Ghi hình**, dán link Zoom hoặc Google Meet, bấm **Bắt đầu ghi**. Trên VPS bot vào phòng dạng khách, nên chủ phòng cần bấm cho vào. Xem ô "Bot đang thấy gì" để biết bot đang ở màn hình nào.

## Việc thường làm sau khi cài

| Việc | Lệnh (chạy trên VPS, trong `/opt/class-recorder`) |
|---|---|
| Xem dịch vụ có chạy không | `systemctl status class-recorder` |
| Xem nhật ký dịch vụ | `journalctl -u class-recorder -n 50` |
| Khởi động lại giao diện (không làm dừng buổi đang ghi) | `systemctl restart class-recorder` |
| Đổi mật khẩu (in ra mật khẩu mới) | `node src/cli.js ui-access --new-password` rồi khởi động lại giao diện |
| Đổi hoặc thêm tên miền | `bash scripts/install-vps.sh ten-moi.com,ten-cu.com` |
| Tắt truy cập từ internet | `node src/cli.js ui-access --off`, `systemctl restart class-recorder`, `systemctl disable --now caddy` |

Nếu script được chạy với `RUN_USER=<tên>`, các lệnh `node src/cli.js …` cần chạy bằng tài khoản đó: `runuser -u <tên> -- node src/cli.js …`.

**Cập nhật phiên bản mới:** chép gói mới lên, giải nén đè như bước 1–2, rồi chạy lại script ở bước 3. File `.env` (cài đặt, API key, mật khẩu) và thư mục `data/` (các buổi đã ghi) được giữ nguyên.

## Khi gặp trục trặc

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Trình duyệt báo không kết nối được | Nhà cung cấp VPS có tường lửa riêng (Security Group) chặn cổng 80/443 | Mở hai cổng đó trong trang quản lý VPS |
| Báo lỗi chứng chỉ với tên miền riêng | Bản ghi A chưa có hoặc chưa kịp lan | Kiểm tra DNS, chờ vài phút, rồi chạy `systemctl reload caddy` |
| Script báo cổng 80/443 đang do máy chủ web khác giữ | VPS đã chạy nginx/apache | Script in ra đoạn cấu hình nginx mẫu; thêm đoạn đó vào máy chủ web đang có |
| Tự kiểm thử không đạt | Thiếu thư viện hệ thống, hoặc VPS quá yếu | Xem file nhật ký script chỉ ra; chạy lại `node src/cli.js selftest` |
| Vào Google Meet bị đưa sang trang đăng nhập | Phòng không nhận khách ẩn danh | Nhờ chủ phòng cho phép khách vào. Đăng nhập tài khoản Google cho bot cần màn hình nên trên VPS phải làm qua VNC hoặc `ssh -X` rồi chạy `node src/cli.js login` |
| Quên mật khẩu giao diện | | Đăng nhập SSH, chạy lệnh đổi mật khẩu ở bảng trên |

## Về bảo mật

- Giao diện chỉ nghe ở địa chỉ nội bộ `127.0.0.1:8787`. Người ngoài chỉ vào được qua Caddy (HTTPS) và phải đăng nhập.
- Mật khẩu được lưu dạng băm. Nhập sai 5 lần thì địa chỉ đó bị khoá 10 phút. Phiên đăng nhập sống 30 ngày trên mỗi trình duyệt.
- API key đã lưu không bao giờ hiện lại trên trang, chỉ hiện 4 ký tự cuối.
- Ai có mật khẩu thì xem được mọi buổi đã ghi và ra lệnh được cho bot. Chỉ chia sẻ mật khẩu cho người bạn tin; nghi bị lộ thì đổi ngay.
- Không cần mở cổng thì vẫn dùng được qua đường hầm SSH: `ssh -L 8790:127.0.0.1:8787 root@<IP>` rồi mở `http://127.0.0.1:8790`.
