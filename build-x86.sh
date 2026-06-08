#!/bin/bash
# 网页快照分享工具 - 本地交叉编译 X86_64 镜像并导出 tar 归档包脚本
set -e

echo "================================================="
echo "   正在使用 Buildx 交叉编译 linux/amd64 镜像...   "
echo "================================================="

# 确保在项目根目录
cd "$(dirname "$0")"

# 1. 启用 Buildx 编译 X86 架构镜像并加载到本地 Docker daemon 缓存中
echo "开始编译 (这可能需要一些时间，请耐心等待)..."
docker buildx build --platform linux/amd64 -t web-snapshot:latest --load .

# 2. 导出为离线 tar 包
echo "正在将编译完成的 X86_64 镜像保存为离线归档包..."
docker save -o web-snapshot-x86.tar web-snapshot:latest

echo "================================================="
echo "   🎉 镜像编译并导出成功！"
echo "   生成的离线镜像路径：$(pwd)/web-snapshot-x86.tar"
echo ""
echo "   部署至目标服务器 (<your-server-ip>) 的步骤："
echo "   1. 将 web-snapshot-x86.tar 和 docker-compose.yml 拷贝上传到服务器的同一目录下"
echo "   2. 在服务器上导入该离线镜像："
echo "      docker load -i web-snapshot-x86.tar"
echo "   3. 修改服务器上的 docker-compose.yml 配置文件："
echo "      - 将 'build: .' 这行删掉"
echo "      - 加上 'image: web-snapshot:latest' 以直接使用刚才导入的镜像"
echo "   4. 在服务器上运行启动命令："
echo "      docker compose up -d"
echo "================================================="
