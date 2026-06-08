// 监听来自 Content Script 的消息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'fetchImageBase64') {
    (async () => {
      try {
        const res = await fetch(request.url);
        if (!res.ok) {
          throw new Error(`HTTP 状态异常: ${res.status}`);
        }
        const blob = await res.blob();
        
        // 将 Blob 转换为 ArrayBuffer，在 Service Worker 环境下转换为 Base64
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const contentType = blob.type || 'image/png';
        const dataUrl = `data:${contentType};base64,${base64}`;
        
        sendResponse({ ok: true, dataUrl });
      } catch (err) {
        console.error('[Web Snapshot Background] 抓取图片失败:', request.url, err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return true; // 保持通道异步开启
  }
  return false;
});
