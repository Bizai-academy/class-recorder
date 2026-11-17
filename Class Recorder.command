#!/bin/bash
# macOS: bấm đúp file này để mở giao diện Class Recorder trong trình duyệt.
# macOS: double-click this file to open the Class Recorder dashboard in your browser.
cd "$(dirname "$0")" || exit 1

if [ -x "./runtime/node" ]; then
  # Bản tải về chưa ký số: macOS gắn cờ "cách ly" cho mọi file giải nén từ mạng, khiến Node và ffmpeg kèm theo bị chặn.
  # Bạn đã chủ động mở file này, nên gỡ cờ đó cho riêng thư mục chương trình (không đụng gì khác trên máy).
  # Unsigned download: macOS quarantines every extracted file, which blocks the bundled Node and ffmpeg.
  # You opened this file yourself, so clear the flag for this app folder only.
  xattr -dr com.apple.quarantine . 2>/dev/null
  NODE="./runtime/node"
else
  if ! command -v node >/dev/null 2>&1; then
    echo "Chưa cài Node.js / Node.js is not installed: https://nodejs.org"
    read -r -p "Enter để đóng / Press Enter to close"
    exit 1
  fi
  NODE="node"
  [ -d node_modules ] || npm install --no-fund --no-audit
fi

"$NODE" src/cli.js ui
