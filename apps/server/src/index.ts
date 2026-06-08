import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sanitizeHtml from 'sanitize-html';
import * as cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(__dirname, '..', 'data', 'storage');

// 管理后台配置
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'woaishanqian';
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

function verifyAdmin(req: express.Request): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/, '');
  return token === ADMIN_TOKEN;
}

// 确保存储目录存在
const snapshotsDir = path.join(STORAGE_DIR, 'snapshots');
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir, { recursive: true });
}

// 确保下载目录存在
const publicDir = path.resolve(__dirname, '..', 'public');
const downloadsDir = path.join(publicDir, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

/**
 * 辅助：对密码进行 SHA-256 加密保存
 */
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * 辅助：下载文件（具有 4 秒超时限制，下载失败不阻断，降级返回 false）
 */
async function downloadFile(url: string, destPath: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) return false;
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (e) {
    console.warn(`[Web Snapshot] 离线转存失败: ${url}, 原因:`, e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 核心：异步转存 HTML 内的 CSS 样式和图片，改写为本地静态路径
 */
async function localizeAssets(snapshotId: string, htmlContent: string): Promise<string> {
  try {
    const $ = cheerio.load(htmlContent);
    
    // 注入 Content-Security-Policy (CSP) 限制，仅允许加载来自本站的图片、样式和字体（不支持任何第三方外链），connect-src 彻底为 none 防止数据交互与追踪
    const cspMeta = $(`<meta http-equiv="Content-Security-Policy" content="default-src 'self' ${PUBLIC_BASE_URL} data: blob: 'unsafe-inline' 'unsafe-eval'; img-src 'self' ${PUBLIC_BASE_URL} data: blob:; style-src 'self' ${PUBLIC_BASE_URL} 'unsafe-inline'; connect-src 'none'; font-src 'self' ${PUBLIC_BASE_URL} data:; media-src 'none'; object-src 'none'; frame-src 'none';">`);
    $('head').prepend(cspMeta);

    const assetsSubDir = path.join(snapshotsDir, snapshotId, 'assets');
    
    if (!fs.existsSync(assetsSubDir)) {
      fs.mkdirSync(assetsSubDir, { recursive: true });
    }

    const downloadTasks: Promise<void>[] = [];

    // 1. 转存外部 CSS 样式表
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        let ext = path.extname(new URL(href).pathname) || '.css';
        if (ext.includes('?')) ext = ext.split('?')[0];
        if (ext.length > 6) ext = '.css';
        
        const filename = `${crypto.randomUUID()}${ext}`;
        const destPath = path.join(assetsSubDir, filename);

        const task = downloadFile(href, destPath)
          .then((success) => {
            if (success) {
              $(el).attr('href', `/storage/snapshots/${snapshotId}/assets/${filename}`);
            }
          });
        downloadTasks.push(task);
      }
    });

    // 2. 转存图片
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http')) {
        let ext = path.extname(new URL(src).pathname) || '.png';
        if (ext.includes('?')) ext = ext.split('?')[0];
        if (ext.length > 6) ext = '.png';
        
        const filename = `${crypto.randomUUID()}${ext}`;
        const destPath = path.join(assetsSubDir, filename);

        const task = downloadFile(src, destPath)
          .then((success) => {
            if (success) {
              $(el).attr('src', `/storage/snapshots/${snapshotId}/assets/${filename}`);
            } else {
              // 物理离线化防漏：如果服务器端下载失败，直接替换为 1 像素透明 GIF 的 Base64，杜绝外部图片链接
              $(el).attr('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            }
          });
        downloadTasks.push(task);
      }
    });

    // 并发运行所有资源的本地化下载任务
    await Promise.allSettled(downloadTasks);
    return $.html();
  } catch (err) {
    console.error('转存 HTML 资源失败:', err);
    return htmlContent; // 降级直接返回原内容
  }
}

/**
 * 清洗 HTML 安全标签
 */
function sanitizeContent(htmlContent: string): string {
  return sanitizeHtml(htmlContent, {
    allowedTags: [
      'html', 'head', 'body', 'meta', 'title', 'link', 'style',
      'main', 'article', 'section', 'div', 'span',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'strong', 'b', 'em', 'i', 'u',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img', 'a',
      'figure', 'figcaption'
    ],
    allowedAttributes: {
      'a': ['href', 'name', 'target', 'class', 'id', 'style'],
      'img': ['src', 'alt', 'title', 'class', 'id', 'style'],
      'meta': ['charset', 'name', 'content'],
      'link': ['rel', 'href', 'type', 'media'],
      '*': ['class', 'id', 'style']
    },
    allowedSchemes: ['http', 'https', 'data'],
    nonTextTags: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'noscript']
  });
}

// 1. 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// 2. 创建快照 (升级版)
app.post('/api/snapshots', async (req, res) => {
  try {
    const { sourceUrl, title, description, faviconUrl, html, text, screenshotDataUrl, password, expireDays } = req.body;

    if (!sourceUrl || typeof sourceUrl !== 'string' || !sourceUrl.startsWith('http')) {
      return res.status(400).json({ error: '无效或缺失 sourceUrl' });
    }

    const snapshotId = crypto.randomUUID();
    const deleteKey = crypto.randomUUID(); // 生成管理删除密钥

    // 生成唯一 shareCode
    let shareCode = '';
    let codeExists = true;
    while (codeExists) {
      shareCode = Math.random().toString(36).substring(2, 8);
      const existing = await prisma.snapshot.findUnique({ where: { shareCode } });
      if (!existing) {
        codeExists = false;
      }
    }

    // 运行安全清洗
    let processedHtml = html ? sanitizeContent(html) : '';

    // 本地转存 CSS 外链和图片，进行 HTML 路径改写
    if (processedHtml) {
      processedHtml = await localizeAssets(snapshotId, processedHtml);
    }

    // 写入物理磁盘
    const itemDir = path.join(snapshotsDir, snapshotId);
    if (!fs.existsSync(itemDir)) {
      fs.mkdirSync(itemDir, { recursive: true });
    }

    fs.writeFileSync(path.join(itemDir, 'content.html'), processedHtml, 'utf-8');
    fs.writeFileSync(path.join(itemDir, 'content.txt'), text || '', 'utf-8');

    const htmlPath = `/storage/snapshots/${snapshotId}/content.html`;
    const textPath = `/storage/snapshots/${snapshotId}/content.txt`;

    let screenshotPath: string | null = null;
    if (screenshotDataUrl && typeof screenshotDataUrl === 'string' && screenshotDataUrl.startsWith('data:image/')) {
      const matches = screenshotDataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const ext = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        const imgName = `screenshot.${ext}`;
        fs.writeFileSync(path.join(itemDir, imgName), buffer);
        screenshotPath = `/storage/snapshots/${snapshotId}/${imgName}`;
      }
    }

    // 计算过期时间
    let expiresAt: Date | null = null;
    const days = parseInt(expireDays);
    if (!isNaN(days) && days > 0) {
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    // 处理分享密码
    let sharePassword: string | null = null;
    if (password && typeof password === 'string' && password.trim() !== '') {
      sharePassword = hashPassword(password);
    }

    // 保存至 SQLite
    const snapshot = await prisma.snapshot.create({
      data: {
        id: snapshotId,
        shareCode,
        sourceUrl,
        title: title || '无标题',
        description: description || null,
        faviconUrl: faviconUrl || null,
        htmlPath,
        textPath,
        screenshotPath,
        deleteKey,
        sharePassword,
        expiresAt
      },
    });

    const shareUrl = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/s/${shareCode}`;

    res.status(201).json({
      id: snapshot.id,
      shareCode: snapshot.shareCode,
      shareUrl,
      deleteKey // 返回删除凭证供客户端保存
    });
  } catch (error) {
    console.error('创建快照失败:', error);
    res.status(500).json({ error: '创建快照时服务器发生错误' });
  }
});

// 3. 查询快照 (未升级)
app.get('/api/snapshots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const snapshot = await prisma.snapshot.findUnique({ where: { id } });

    if (!snapshot) {
      return res.status(404).json({ error: '找不到该快照' });
    }

    let html = '';
    let text = '';

    const snapshotDir = path.join(snapshotsDir, snapshot.id);
    const htmlFile = path.join(snapshotDir, 'content.html');
    const textFile = path.join(snapshotDir, 'content.txt');

    if (fs.existsSync(htmlFile)) {
      html = fs.readFileSync(htmlFile, 'utf-8');
    }
    if (fs.existsSync(textFile)) {
      text = fs.readFileSync(textFile, 'utf-8');
    }

    res.json({
      ...snapshot,
      html,
      text,
    });
  } catch (error) {
    console.error('获取快照元数据失败:', error);
    res.status(500).json({ error: '获取快照失败' });
  }
});

// 4. 分享页数据接口 (升级密码与过期逻辑)
app.get('/api/share/:shareCode', async (req, res) => {
  try {
    const { shareCode } = req.params;
    const reqPassword = req.query.password as string;

    const snapshot = await prisma.snapshot.findUnique({ where: { shareCode } });

    if (!snapshot) {
      return res.status(404).json({ error: '分享页面不存在' });
    }

    // 1. 验证是否过期
    if (snapshot.expiresAt && new Date(snapshot.expiresAt) < new Date()) {
      return res.status(410).json({ error: '此快照已过期失效' });
    }

    // 2. 验证访问密码
    if (snapshot.sharePassword) {
      if (!reqPassword || hashPassword(reqPassword) !== snapshot.sharePassword) {
        // 密码不正确，防御性地仅返回最少元数据，隐匿大文本和截图
        return res.json({
          requirePassword: true,
          title: snapshot.title,
          faviconUrl: snapshot.faviconUrl
        });
      }
    }

    // 验证通过，读取大文件内容
    let html = '';
    let text = '';

    const snapshotDir = path.join(snapshotsDir, snapshot.id);
    const htmlFile = path.join(snapshotDir, 'content.html');
    const textFile = path.join(snapshotDir, 'content.txt');

    if (fs.existsSync(htmlFile)) {
      html = fs.readFileSync(htmlFile, 'utf-8');
    }
    if (fs.existsSync(textFile)) {
      text = fs.readFileSync(textFile, 'utf-8');
    }

    res.json({
      id: snapshot.id,
      shareCode: snapshot.shareCode,
      sourceUrl: snapshot.sourceUrl,
      title: snapshot.title,
      description: snapshot.description,
      faviconUrl: snapshot.faviconUrl,
      html,
      text,
      screenshotUrl: snapshot.screenshotPath,
      createdAt: snapshot.createdAt,
    });
  } catch (error) {
    console.error('获取分享数据失败:', error);
    res.status(500).json({ error: '获取分享内容失败' });
  }
});

// 5. 最近快照列表 (过滤已过期或密码保护的快照，不公开其敏感标题)
app.get('/api/snapshots', async (req, res) => {
  try {
    const snapshots = await prisma.snapshot.findMany({
      where: {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        shareCode: true,
        sourceUrl: true,
        title: true,
        description: true,
        faviconUrl: true,
        createdAt: true,
        sharePassword: true // 返回密码标识以防前端列表直接进入
      },
    });
    // 如果有密码，前端列表隐去具体标题
    const cleanList = snapshots.map((item: typeof snapshots[number]) => ({
      ...item,
      title: item.sharePassword ? '🔒 密码保护的私有快照' : item.title,
      description: item.sharePassword ? '输入访问密码后才能查看内容' : item.description,
      sourceUrl: item.sharePassword ? 'https://hidden.url' : item.sourceUrl,
    }));
    res.json(cleanList);
  } catch (error) {
    console.error('获取快照列表失败:', error);
    res.status(500).json({ error: '获取快照列表失败' });
  }
});

// 6. 快照删除接口 (支持 deleteKey 校验)
app.delete('/api/snapshots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteKey } = req.query;

    if (!deleteKey || typeof deleteKey !== 'string') {
      return res.status(400).json({ error: '缺失删除密钥凭证' });
    }

    const snapshot = await prisma.snapshot.findUnique({ where: { id } });
    if (!snapshot) {
      return res.status(404).json({ error: '找不到该快照数据' });
    }

    if (snapshot.deleteKey !== deleteKey) {
      return res.status(403).json({ error: '删除凭证不匹配，无权删除' });
    }

    // 物理清理磁盘文件夹
    const itemDir = path.join(snapshotsDir, snapshot.id);
    if (fs.existsSync(itemDir)) {
      fs.rmSync(itemDir, { recursive: true, force: true });
    }

    // 删除 SQLite 记录
    await prisma.snapshot.delete({ where: { id } });

    res.json({ success: true });
  } catch (err) {
    console.error('删除快照失败:', err);
    res.status(500).json({ error: '删除快照时发生服务器错误' });
  }
});

// 7. 定时清理任务：每1小时自动检索并彻底销毁过期快照
setInterval(async () => {
  try {
    const expired = await prisma.snapshot.findMany({
      where: {
        expiresAt: {
          lt: new Date()
        }
      }
    });
    if (expired.length > 0) {
      console.log(`[Cleaner] 开始清理已过期的 ${expired.length} 个快照...`);
      for (const item of expired) {
        const itemDir = path.join(snapshotsDir, item.id);
        if (fs.existsSync(itemDir)) {
          fs.rmSync(itemDir, { recursive: true, force: true });
        }
        await prisma.snapshot.delete({ where: { id: item.id } });
      }
      console.log(`[Cleaner] 清理过期数据完成。`);
    }
  } catch (err) {
    console.error('定时垃圾清理失败:', err);
  }
}, 60 * 60 * 1000); // 1小时周期

// 8. 管理员接口：校验管理员密码
app.post('/api/admin/verify', (req, res) => {
  if (verifyAdmin(req)) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: '管理员身份校验失败' });
  }
});

// 9. 管理员接口：获取所有快照完整列表
app.get('/api/admin/snapshots', async (req, res) => {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: '管理员身份校验失败' });
  }
  try {
    const snapshots = await prisma.snapshot.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(snapshots);
  } catch (err) {
    console.error('管理员获取快照列表失败:', err);
    res.status(500).json({ error: '获取快照列表失败' });
  }
});

// 10. 管理员接口：任意物理销毁快照
app.delete('/api/admin/snapshots/:id', async (req, res) => {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: '管理员身份校验失败' });
  }
  try {
    const { id } = req.params;
    const snapshot = await prisma.snapshot.findUnique({ where: { id } });
    if (!snapshot) {
      return res.status(404).json({ error: '该快照不存在' });
    }

    // 物理清理磁盘文件夹
    const itemDir = path.join(snapshotsDir, snapshot.id);
    if (fs.existsSync(itemDir)) {
      fs.rmSync(itemDir, { recursive: true, force: true });
    }

    // 删除 SQLite 记录
    await prisma.snapshot.delete({ where: { id } });

    res.json({ success: true });
  } catch (err) {
    console.error('管理员删除快照失败:', err);
    res.status(500).json({ error: '删除快照时发生服务器错误' });
  }
});

// 静态文件目录暴露
app.use('/storage', express.static(STORAGE_DIR));
app.use('/downloads', express.static(path.join(publicDir, 'downloads')));

// 前端单页应用
const webDistDir = path.resolve(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/storage') || req.path.startsWith('/downloads')) {
    return next();
  }
  const indexHtmlFile = path.join(webDistDir, 'index.html');
  if (fs.existsSync(indexHtmlFile)) {
    res.sendFile(indexHtmlFile);
  } else {
    res.status(404).send('Web UI frontend is building or not found.');
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
  console.log(`Storage directory is set to: ${STORAGE_DIR}`);
  console.log(`Base URL is set to: ${PUBLIC_BASE_URL}`);
});
