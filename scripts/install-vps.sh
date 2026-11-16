#!/usr/bin/env bash
# Cài Class Recorder lên VPS Ubuntu/Debian và mở giao diện qua HTTPS có mật khẩu.
#
#   sudo bash scripts/install-vps.sh rec.tenmien.com   # đã có tên miền (bản ghi A trỏ về IP của VPS)
#   sudo bash scripts/install-vps.sh                   # chưa có tên miền → dùng địa chỉ <IP>.sslip.io
#
# Chạy lại được nhiều lần (ví dụ sau khi cập nhật mã nguồn): bước nào xong rồi sẽ được bỏ qua.
# Biến tuỳ chọn: SKIP_SERVICE=1 (không tạo dịch vụ), SKIP_PROXY=1 (không cài HTTPS), SKIP_SELFTEST=1.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
DOMAIN="${1:-}"
PORT=8787

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nLỖI: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Hãy chạy bằng quyền root: sudo bash scripts/install-vps.sh"
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) die "Script này chỉ hỗ trợ Ubuntu/Debian (máy này: ${PRETTY_NAME:-không rõ}).";; esac

# Dịch vụ chạy bằng tài khoản chỉ định qua RUN_USER (ví dụ RUN_USER=maus), mặc định là tài khoản đã gọi sudo;
# nếu đăng nhập thẳng bằng root và không chỉ định thì chạy bằng root.
RUN_USER="${RUN_USER:-${SUDO_USER:-root}}"
id "$RUN_USER" >/dev/null 2>&1 || die "Không có tài khoản $RUN_USER trên máy này."
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
as_user() { if [ "$RUN_USER" = root ]; then "$@"; else runuser -u "$RUN_USER" -- env HOME="$RUN_HOME" "$@"; fi; }

export DEBIAN_FRONTEND=noninteractive
# Không để apt tự khởi động lại các dịch vụ đang chạy trên máy (Ubuntu 22.04+ có needrestart).
export NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l

say "Cài gói hệ thống (màn hình ảo, âm thanh ảo, phông chữ tiếng Việt/CJK)"
apt-get update -y
apt-get install -y curl ca-certificates gnupg xvfb pulseaudio fonts-liberation fonts-noto-core fonts-noto-cjk

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Cài Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v google-chrome-stable >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  say "Cài Google Chrome"
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/chrome.deb
  rm -f /tmp/chrome.deb
fi

say "Cài thư viện Node"
chown -R "$RUN_USER" "$APP_DIR"
as_user npm install --no-fund --no-audit

if [ ! -f .env ]; then
  as_user cp .env.example .env
  chmod 600 .env
fi

if [ "${SKIP_SELFTEST:-}" != 1 ]; then
  say "Tự kiểm thử ghi hình (khoảng 3 phút)"
  as_user node src/cli.js selftest || die "Tự kiểm thử chưa đạt — xem nhật ký ở trên. Chưa mở giao diện ra internet."
fi

if [ "${SKIP_PROXY:-}" != 1 ]; then
  if [ -z "$DOMAIN" ]; then
    IP="$(curl -fsS https://api.ipify.org || true)"
    [ -n "$IP" ] || die "Không tự tìm được IP công khai. Hãy chạy lại kèm tên miền: sudo bash scripts/install-vps.sh rec.tenmien.com"
    DOMAIN="$(echo "$IP" | tr . -).sslip.io"
    echo "Chưa có tên miền → dùng $DOMAIN (tên miền miễn phí tự trỏ về IP $IP)"
  fi

  say "Đặt mật khẩu đăng nhập giao diện"
  ACCESS_OUT="$(as_user node src/cli.js ui-access --public-host "$DOMAIN")"
  echo "$ACCESS_OUT"
fi

if [ "${SKIP_SERVICE:-}" != 1 ]; then
  say "Tạo dịch vụ tự chạy khi VPS khởi động (class-recorder.service)"
  cat > /etc/systemd/system/class-recorder.service <<EOF
[Unit]
Description=Class Recorder (giao dien web)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=HOME=$RUN_HOME
ExecStart=$(command -v node) src/cli.js ui --no-open --port $PORT
Restart=always
RestartSec=3
# Chỉ dừng tiến trình giao diện khi restart; buổi đang ghi (tiến trình con) vẫn chạy tiếp.
KillMode=process

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable class-recorder.service >/dev/null
  systemctl restart class-recorder.service
  sleep 2
  systemctl is-active --quiet class-recorder.service || die "Dịch vụ không khởi động được. Xem: journalctl -u class-recorder -n 50"
fi

if [ "${SKIP_PROXY:-}" != 1 ]; then
  # Có thể truyền nhiều tên miền cách nhau bằng dấu phẩy: "rec.tenmien.com,1-2-3-4.sslip.io"
  SITE_BLOCK="${DOMAIN//,/, } {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}"
  if command -v caddy >/dev/null 2>&1; then
    say "Caddy đã có sẵn — thêm trang $DOMAIN"
    if ! grep -qF "$DOMAIN" /etc/caddy/Caddyfile 2>/dev/null; then printf '\n%s\n' "$SITE_BLOCK" >> /etc/caddy/Caddyfile; fi
    systemctl reload caddy || systemctl restart caddy
  elif ss -ltn 2>/dev/null | grep -qE ':(80|443)\s'; then
    say "Cổng 80/443 đang do một máy chủ web khác giữ — KHÔNG cài Caddy để tránh xung đột"
    cat <<EOF
Hãy thêm vào máy chủ web đang có một trang HTTPS cho $DOMAIN chuyển tiếp về http://127.0.0.1:$PORT.
Ví dụ với nginx (sau đó cấp chứng chỉ bằng: certbot --nginx -d $DOMAIN):

  server {
      server_name $DOMAIN;
      client_max_body_size 1m;
      location / {
          proxy_pass http://127.0.0.1:$PORT;
          proxy_set_header Host \$host;
          proxy_set_header X-Forwarded-For \$remote_addr;
          proxy_set_header X-Forwarded-Proto \$scheme;
          proxy_buffering off;
      }
  }
EOF
  else
    say "Cài Caddy (máy chủ HTTPS, tự xin và gia hạn chứng chỉ)"
    apt-get install -y caddy
    printf '%s\n' "$SITE_BLOCK" > /etc/caddy/Caddyfile
    systemctl enable caddy >/dev/null
    systemctl restart caddy
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    echo "Đã mở cổng 80 và 443 trên tường lửa ufw."
  fi
fi

cat <<EOF

================ HOÀN TẤT ================
EOF
if [ "${SKIP_PROXY:-}" != 1 ]; then
  cat <<EOF
Mở trên trình duyệt (máy tính hoặc điện thoại):   https://${DOMAIN//,/  hoặc  https://}
$(echo "${ACCESS_OUT:-}" | grep -i "mật khẩu" || echo "Mật khẩu: giữ nguyên mật khẩu đã đặt trước đó. Đổi mật khẩu: node src/cli.js ui-access --new-password")

Lần đầu vào có thể phải chờ khoảng 1 phút để chứng chỉ HTTPS được cấp.
Nếu nhà cung cấp VPS có tường lửa riêng (Security Group), hãy mở cổng 80 và 443 ở đó.
EOF
fi
cat <<EOF
Việc tiếp theo: vào tab Cài đặt để nhập API key phiên âm và API key Claude.

Lệnh hay dùng:
  systemctl status class-recorder      xem dịch vụ có chạy không
  journalctl -u class-recorder -n 50   xem nhật ký dịch vụ
  systemctl restart class-recorder     khởi động lại giao diện (không làm dừng buổi đang ghi)
EOF
