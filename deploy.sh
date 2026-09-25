#!/usr/bin/env bash
# 构建前端，由 API 进程同端口托管（同源 /api，无需跨源配置）。
# 用法: ./deploy.sh （可选环境变量见 .env.example，默认从 .env 读取）
set -euo pipefail
cd "$(dirname "$0")"

# ---- 读取 .env ----
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

APP_NAME="${PM2_APP_NAME:-unnc-room-check}"
PORT="${PORT:-3001}"

command -v pm2 >/dev/null 2>&1 || { echo "安装 pm2..."; npm install -g pm2; }

echo "安装依赖..."
npm install --no-audit --no-fund

echo "构建前端（同源模式，走 /api）..."
npm run build

echo "重启 pm2 进程..."
pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true

PORT="$PORT" pm2 start npx --name "${APP_NAME}" --time -- tsx apps/api/src/index.ts

pm2 save
echo
echo "部署完成："
echo "  入口  http://127.0.0.1:${PORT}  (pm2: ${APP_NAME})"
pm2 list
