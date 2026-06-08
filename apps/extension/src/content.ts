import html2canvas from 'html2canvas';

// 监听来自 popup 的抓取指令
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'scrape') {
    // 异步执行抓取和渲染长截图
    (async () => {
      try {
        // 提取标题与链接
        const title = document.title || '';
        const sourceUrl = window.location.href;
        
        // 提取元描述
        let description = '';
        const descMeta = document.querySelector('meta[name="description"]') || 
                            document.querySelector('meta[property="og:description"]') ||
                            document.querySelector('meta[name="twitter:description"]');
        if (descMeta) {
          description = descMeta.getAttribute('content') || '';
        }
        
        // 提取 favicon
        let faviconUrl = '';
        const faviconLink = document.querySelector('link[rel~="icon"]') || 
                             document.querySelector('link[rel="shortcut icon"]');
        if (faviconLink) {
          faviconUrl = (faviconLink as HTMLLinkElement).href;
        } else {
          faviconUrl = `${window.location.origin}/favicon.ico`;
        }

        // 克隆当前 document 以免影响原网页
        const docClone = document.cloneNode(true) as Document;

        // 0. 遍历当前页面 CSSOM 并将动态插入的样式表序列化注入克隆 DOM，解决 CSS-in-JS (如 TailwindCSS, styled-components) 样式丢失、排版不一致问题
        try {
          const styleSheets = Array.from(document.styleSheets);
          const dynamicRules: string[] = [];
          styleSheets.forEach((sheet) => {
            try {
              const rules = sheet.cssRules || sheet.rules;
              if (rules) {
                const sheetRules = Array.from(rules).map(r => r.cssText).join('\n');
                dynamicRules.push(sheetRules);
              }
            } catch (e) {
              // 跨域外部样式表由于安全同源限制无法直接读取，后面有 link 标签转存机制兜底
            }
          });
          if (dynamicRules.length > 0) {
            const styleTag = docClone.createElement('style');
            styleTag.setAttribute('id', 'web-snapshot-dynamic-styles');
            styleTag.textContent = dynamicRules.join('\n');
            docClone.head?.appendChild(styleTag);
          }
        } catch (styleErr) {
          console.warn('[Web Snapshot] CSSOM 动态样式提取失败:', styleErr);
        }

        // 1. 将所有相对 href 的样式表转换为绝对路径
        const links = docClone.querySelectorAll('link[rel="stylesheet"]');
        links.forEach((link) => {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('data:') && !href.startsWith('blob:')) {
            try {
              link.setAttribute('href', new URL(href, document.baseURI).href);
            } catch (e) {
              console.warn('[Web Snapshot] 样式绝对路径转换失败:', href, e);
            }
          }
        });

        // 2. 遍历并利用 Chrome 扩展 Background 的跨域特权，在前端将所有图片下载并转换为 Base64 编码，实现 100% 离线
        const imgs = Array.from(docClone.querySelectorAll('img'));
        await Promise.all(imgs.map(async (img) => {
          const src = img.getAttribute('src');
          if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
            try {
              const absoluteUrl = new URL(src, document.baseURI).href;
              // 通过 chrome.runtime.sendMessage 发给 Background 下载，绕过原网页 CSP 与 CORS 同源策略限制
              const base64 = await new Promise<string>((resolve, reject) => {
                chrome.runtime.sendMessage(
                  { action: 'fetchImageBase64', url: absoluteUrl },
                  (response) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.ok) {
                      resolve(response.dataUrl);
                    } else {
                      reject(new Error(response ? response.error : '未知中转错误'));
                    }
                  }
                );
              });
              img.setAttribute('src', base64);
            } catch (e) {
              console.warn('[Web Snapshot] 图片前端中转 Base64 失败，降级为透明占位图:', src, e);
              // 失败后降级为 1 像素透明 GIF 的 Base64，彻底避免向外部第三方域名发起请求
              img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            }
          }
        }));

        // 2.1 移除所有 picture 中的 source 元素，迫使浏览器只渲染已转换为 Base64 的 img 元素，杜绝外部 responsive 图片的外链请求
        docClone.querySelectorAll('picture source').forEach((source) => {
          source.remove();
        });

        // 3. 将所有相对 href 的超链接转换为绝对路径
        const anchors = docClone.querySelectorAll('a');
        anchors.forEach((a) => {
          const href = a.getAttribute('href');
          if (href && !href.startsWith('data:') && !href.startsWith('blob:') && !href.startsWith('#') && !href.startsWith('javascript:')) {
            try {
              a.setAttribute('href', new URL(href, document.baseURI).href);
            } catch (e) {
              console.warn('[Web Snapshot] 超链接绝对路径转换失败:', href, e);
            }
          }
        });
        
        // 提取转换后的 HTML 和 纯文本
        const html = docClone.documentElement.outerHTML || '';
        const text = document.body ? document.body.innerText : '';

        // 4. 使用 html2canvas 在客户端渲染网页的长截图
        console.log('[Web Snapshot] 正在进行长网页 Canvas 渲染截图...');
        let screenshotDataUrl = '';
        try {
          // 在截图前如果页面很大的话，限制高宽以防内存溢出崩溃
          const canvas = await html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            logging: false,
            scale: 1, // 1倍比例以节省封包体积
            backgroundColor: '#ffffff'
          });
          screenshotDataUrl = canvas.toDataURL('image/png');
        } catch (err) {
          console.warn('[Web Snapshot] html2canvas 长截图生成失败，降级无截图状态:', err);
        }

        // 响应消息
        sendResponse({
          ok: true,
          data: {
            sourceUrl,
            title,
            description,
            faviconUrl,
            html,
            text,
            screenshotDataUrl
          }
        });
      } catch (err) {
        console.error('[Web Snapshot] 采集内容失败:', err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return true; // 维持消息异步开启
  }
  return false;
});

