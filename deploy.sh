#!/usr/bin/env bash
# 构建前端并用 pm2 托管前后端。
# 用法: ./deploy.sh （可选环境变量见 .env.example，默认从 .env 读取）
set -euo pipefail
cd "$(dirname "$0")"

# ---- 读取 .env ----
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

APP_NAME="${PM2_APP_NAME:-unnc-room-check}"
API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-8080}"
BACKEND_HOST="${BACKEND_HOST:-http://127.0.0.1:${API_PORT}}"

command -v pm2 >/dev/null 2>&1 || { echo "安装 pm2..."; npm install -g pm2; }

echo "安装依赖..."
npm install --no-audit --no-fund

echo "构建前端（API 地址: ${BACKEND_HOST}）..."
VITE_API_BASE="$BACKEND_HOST" npm run build

echo "重启 pm2 进程..."
pm2 delete "${APP_NAME}-api" >/dev/null 2>&1 || true
pm2 delete "${APP_NAME}-web" >/dev/null 2>&1 || true

PORT="$API_PORT" pm2 start apps/api/src/index.js --name "${APP_NAME}-api" --time
pm2 serve apps/web/dist "$WEB_PORT" --name "${APP_NAME}-web" --spa

pm2 save
echo
echo "部署完成："
echo "  前端  ${FRONTEND_HOST:-http://127.0.0.1:${WEB_PORT}}  (pm2: ${APP_NAME}-web, 端口 ${WEB_PORT})"
echo "  后端  ${BACKEND_HOST}  (pm2: ${APP_NAME}-api, 端口 ${API_PORT})"
pm2 list
