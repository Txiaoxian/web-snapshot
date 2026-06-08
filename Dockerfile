# 阶段 1: 基础环境与 pnpm 准备
FROM docker.m.daocloud.io/library/node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apk add --no-cache zip openssl libc6-compat
WORKDIR /app

# 阶段 2: 依赖安装
FROM base AS deps
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/extension/package.json ./apps/extension/
RUN pnpm install

# 阶段 3: 源码复制、编译与插件打包
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/extension/node_modules ./apps/extension/node_modules

COPY . .

# 生成 Prisma 客户端
RUN pnpm prisma:generate

# 编译所有子应用 (server, web, extension)
RUN pnpm build

# 创建下载存储目录，并将 extension 构建产物打包为 zip 存入后端静态目录
RUN mkdir -p apps/server/public/downloads && \
    cd apps/extension/dist && \
    zip -r /app/apps/server/public/downloads/extension.zip .

# 裁剪所有开发依赖，仅保留生产运行所必需的依赖，极大缩减镜像体积
RUN pnpm prune --prod

# 阶段 4: 运行容器部署，最大化缩小体积并保持稳定运行
FROM base AS runner
ENV NODE_ENV=production

# 直接拷贝完整的构建后目录，保留所有 symlinks
COPY --from=builder /app /app

# 配置持久化挂载区
RUN mkdir -p /app/data/storage

EXPOSE 3000

# 切换工作目录到后端
WORKDIR /app/apps/server

# 容器启动时自动执行 SQLite 迁移推送，并运行后端服务
CMD ["sh", "-c", "npx prisma db push --schema=prisma/schema.prisma && node dist/index.js"]
