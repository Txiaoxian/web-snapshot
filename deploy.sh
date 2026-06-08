#!/bin/bash
# 网页快照分享工具 - 目标服务器一键拉源码编译与部署脚本
set -e

echo "================================================="
echo "   正在服务器上启动网页快照工具部署 (X86_64)   "
echo "================================================="

# 确保在项目根目录
cd "$(dirname "$0")"

# 1. 停止并移除已有容器
echo "停止并清理旧容器..."
docker compose down --remove-orphans || true

# 2. 启动 Docker Compose 一键构建与后台运行
echo "正在基于服务器本地架构 (X86_64) 进行 Docker 构建并拉起服务..."
docker compose up -d --build

# 3. 检查容器运行状态
echo "检查服务状态中..."
sleep 3
docker compose ps

echo "================================================="
echo "   🎉 部署完成！"
echo "   服务访问地址：http://<your-server-ip>:35128"
echo "   健康检查接口：http://<your-server-ip>:35128/api/health"
echo "================================================="
