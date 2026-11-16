#!/usr/bin/env bash
# Cài đặt class-recorder trên VPS Ubuntu/Debian (chạy một lần, cần quyền sudo/root).
#   bash scripts/setup-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

echo "==> Cài gói hệ thống (màn hình ảo, âm thanh ảo, phông chữ tiếng Việt/CJK)"
$SUDO apt-get update -y
$SUDO apt-get install -y curl ca-certificates gnupg xvfb pulseaudio fonts-liberation fonts-noto-core fonts-noto-cjk

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Cài Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

if ! command -v google-chrome-stable >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  echo "==> Cài Google Chrome"
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  $SUDO apt-get install -y /tmp/chrome.deb
  rm -f /tmp/chrome.deb
fi

echo "==> Cài thư viện Node"
npm install --no-fund --no-audit

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Đã tạo .env — hãy điền STT_API_KEY và ANTHROPIC_API_KEY"
fi

echo "==> Tự kiểm thử ghi hình"
node src/cli.js selftest

cat <<'EOF'

Tuỳ chọn — phiên âm miễn phí ngay trên VPS (không cần API key, chạy bằng CPU nên chậm hơn thời gian thực):
  sudo apt-get install -y python3 python3-venv
  node scripts/setup-stt.mjs
rồi đặt STT_PROVIDER=local trong .env (hoặc chọn "Chạy trên máy này" trong giao diện).
EOF
