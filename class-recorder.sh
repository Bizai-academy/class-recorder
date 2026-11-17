#!/bin/sh
# Linux: chạy file này để mở giao diện Class Recorder trong trình duyệt.  ./class-recorder.sh
# Linux: run this file to open the Class Recorder dashboard in your browser.
# Máy chủ không có màn hình / headless server:  ./class-recorder.sh --no-open
cd "$(dirname "$0")" || exit 1

if [ -x "./runtime/node" ]; then
  NODE="./runtime/node"
else
  if ! command -v node >/dev/null 2>&1; then
    echo "Chưa cài Node.js / Node.js is not installed: https://nodejs.org"
    exit 1
  fi
  NODE="node"
  [ -d node_modules ] || npm install --no-fund --no-audit
fi

exec "$NODE" src/cli.js ui "$@"
