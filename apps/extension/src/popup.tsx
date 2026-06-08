import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './popup.css';

interface ScrapeResult {
  sourceUrl: string;
  title: string;
  description: string;
  faviconUrl: string;
  html: string;
  text: string;
  screenshotDataUrl?: string;
}

interface HistoryItem {
  id: string;
  title: string;
  shareUrl: string;
  deleteKey: string;
}

export default function Popup() {
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null);
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  
  // 新增安全管理属性
  const [password, setPassword] = useState('');
  const [expireDays, setExpireDays] = useState('0'); // 默认永久
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);

  // 运行状态：'idle' | 'scraping' | 'capturing' | 'uploading' | 'success' | 'error'
  const [status, setStatus] = useState<'idle' | 'scraping' | 'capturing' | 'uploading' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [activeDeleteKey, setActiveDeleteKey] = useState('');
  const [copied, setCopied] = useState(false);

  // 初始化获取 Tab 信息、后端地址和本地快照历史
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        setCurrentTab(tabs[0]);
      }
    });

    chrome.storage.local.get(['serverUrl', 'historyList'], (result) => {
      if (result.serverUrl) {
        setServerUrl(result.serverUrl);
      }
      if (result.historyList && Array.isArray(result.historyList)) {
        setHistoryList(result.historyList);
      }
    });
  }, []);

  // 修改并同步后端地址到 storage
  const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setServerUrl(value);
    chrome.storage.local.set({ serverUrl: value });
  };

  // 核心：快照上传与转存
  const handleSaveSnapshot = async () => {
    if (!currentTab || !currentTab.id) {
      setError('无法获取当前标签页');
      return;
    }

    const url = currentTab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url.startsWith('edge://')) {
      setError('无法在浏览器系统特权页面上创建快照');
      return;
    }

    setStatus('scraping');
    setProgress(30);
    setErrorMessage('');

    // 向 content script 发送抓取长截图和 outerHTML 的请求
    chrome.tabs.sendMessage(currentTab.id, { action: 'scrape' }, async (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : '页面抓取无响应';
        console.error('[Web Snapshot] Content script error:', errMsg);
        setError('内容抓取未就绪，请刷新当前网页后重试。');
        return;
      }

      const scrapedData: ScrapeResult = response.data;
      
      // html2canvas 长截图已在内容脚本生成好
      setStatus('uploading');
      setProgress(70);

      try {
        const uploadPayload = {
          sourceUrl: scrapedData.sourceUrl,
          title: scrapedData.title,
          description: scrapedData.description,
          faviconUrl: scrapedData.faviconUrl,
          html: scrapedData.html,
          text: scrapedData.text,
          screenshotDataUrl: scrapedData.screenshotDataUrl || null,
          password: password.trim() !== '' ? password : null,
          expireDays: parseInt(expireDays) > 0 ? parseInt(expireDays) : null
        };

        const cleanServerUrl = serverUrl.replace(/\/$/, '');
        const postResponse = await fetch(`${cleanServerUrl}/api/snapshots`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(uploadPayload)
        });

        if (!postResponse.ok) {
          const errBody = await postResponse.json().catch(() => ({}));
          throw new Error(errBody.error || `服务器错误: ${postResponse.status}`);
        }

        const result = await postResponse.json();
        
        // 成功，更新展示并记入本地历史
        setShareUrl(result.shareUrl);
        setActiveDeleteKey(result.deleteKey);
        setStatus('success');
        setProgress(100);

        // 更新并裁剪本地历史记录 (只存最近 5 条以防容量溢出)
        const updatedHistory = [
          {
            id: result.id,
            title: scrapedData.title,
            shareUrl: result.shareUrl,
            deleteKey: result.deleteKey
          },
          ...historyList
        ].slice(0, 5);

        setHistoryList(updatedHistory);
        chrome.storage.local.set({ historyList: updatedHistory });
        setPassword(''); // 重置密码框
      } catch (uploadErr) {
        console.error('上传快照失败:', uploadErr);
        setError(uploadErr instanceof Error ? uploadErr.message : '上传至后端失败，请检查服务地址是否连通');
      }
    });
  };

  // 删除已保存快照
  const handleDeleteSnapshot = async (id: string, deleteKey: string) => {
    if (!window.confirm('确定要从服务器彻底销毁该网页快照及所有文件吗？此操作不可撤销。')) {
      return;
    }

    try {
      const cleanServerUrl = serverUrl.replace(/\/$/, '');
      const response = await fetch(`${cleanServerUrl}/api/snapshots/${id}?deleteKey=${deleteKey}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `删除失败: ${response.status}`);
      }

      alert('快照已在服务器端彻底销毁！');
      
      // 更新本地历史列表
      const updatedHistory = historyList.filter(item => item.id !== id);
      setHistoryList(updatedHistory);
      chrome.storage.local.set({ historyList: updatedHistory });
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除请求失败');
    }
  };

  const setError = (msg: string) => {
    setStatus('error');
    setErrorMessage(msg);
    setProgress(0);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabTitle = currentTab?.title || '未知页面';
  const tabUrl = currentTab?.url || '未知链接';

  return (
    <div>
      <div className="popup-header">
        <span className="logo-icon">📸</span>
        <h1 className="popup-title">网页快照分享 (高级版)</h1>
      </div>

      <div>
        <div className="info-label">待保存页面标题</div>
        <div className="info-value" title={tabTitle}>{tabTitle}</div>

        <div className="info-label">待保存页面网址</div>
        <div className="info-value" title={tabUrl}>{tabUrl}</div>

        {/* 访问密码配置 */}
        <div className="input-group">
          <label className="input-label" htmlFor="share-password-input">🔑 访问密码 (可选，输入后即加密分享)</label>
          <input
            id="share-password-input"
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="留空则公开访问"
            disabled={status === 'scraping' || status === 'capturing' || status === 'uploading'}
          />
        </div>

        {/* 选项配置与后端配置并行排版 */}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <label className="input-label" htmlFor="expire-select">⏳ 快照有效期</label>
            <select
              id="expire-select"
              className="text-input"
              value={expireDays}
              onChange={(e) => setExpireDays(e.target.value)}
              disabled={status === 'scraping' || status === 'capturing' || status === 'uploading'}
              style={{ height: '31px', padding: '0.2rem' }}
            >
              <option value="0">永久有效</option>
              <option value="1">1 天后过期</option>
              <option value="7">7 天后过期</option>
              <option value="30">30 天后过期</option>
            </select>
          </div>
          <div style={{ flex: 1.2 }}>
            <label className="input-label" htmlFor="server-url-input">后端服务地址</label>
            <input
              id="server-url-input"
              className="text-input"
              type="text"
              value={serverUrl}
              onChange={handleServerUrlChange}
              placeholder="http://localhost:3000"
              disabled={status === 'scraping' || status === 'capturing' || status === 'uploading'}
            />
          </div>
        </div>

        {/* 一键保存 */}
        <div style={{ marginTop: '1.25rem' }}>
          <button
            className="btn btn-primary"
            onClick={handleSaveSnapshot}
            disabled={
              !currentTab || 
              status === 'scraping' || 
              status === 'capturing' || 
              status === 'uploading'
            }
          >
            {status === 'scraping' && '正在生成长网页 Canvas 截图...'}
            {status === 'capturing' && '正在保存...'}
            {status === 'uploading' && '本地转存与上传中...'}
            {status === 'idle' && '📸 一键保存并转存网页 (长截图)'}
            {status === 'success' && '📸 重新保存当前网页'}
            {status === 'error' && '📸 重试保存当前网页'}
          </button>
        </div>

        {/* 进度条 */}
        {(status === 'scraping' || status === 'capturing' || status === 'uploading' || status === 'success') && (
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
          </div>
        )}

        {/* 上传成功显示 */}
        {status === 'success' && (
          <div className="status-box">
            <div className="status-text success-text">🎉 离线转存与长截图成功！分享链接：</div>
            <div className="share-link-box">{shareUrl}</div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button className="btn btn-primary" style={{ flex: 1.2, padding: '0.4rem 0.2rem', fontSize: '0.8rem' }} onClick={handleCopyLink}>
                {copied ? '✅ 已复制链接' : '📋 复制分享链接'}
              </button>
              <a
                href={`${shareUrl}?deleteKey=${activeDeleteKey}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ flex: 1, padding: '0.4rem 0.2rem', fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                👁️ 网页管理
              </a>
            </div>
          </div>
        )}

        {/* 上传失败显示 */}
        {status === 'error' && (
          <div className="status-box" style={{ border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div className="status-text error-text">❌ 保存失败：</div>
            <div style={{ fontSize: '0.75rem', color: '#cbd5e1', wordBreak: 'break-all' }}>{errorMessage}</div>
          </div>
        )}

        {/* 新增：历史已存快照管理面板 */}
        {historyList.length > 0 && (
          <div className="history-section">
            <div className="info-label" style={{ marginBottom: '0.4rem', fontWeight: 600 }}>🛠️ 已存快照管理器 (保存在本地)</div>
            {historyList.map((item) => (
              <div className="history-item" key={item.id}>
                <a
                  className="history-title"
                  href={`${item.shareUrl}?deleteKey=${item.deleteKey}`}
                  target="_blank"
                  rel="noreferrer"
                  title="点击在网页端打开并管理"
                  style={{ textDecoration: 'none', color: '#60a5fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
                >
                  {item.title}
                </a>
                <div className="history-actions">
                  <button
                    className="mini-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(item.shareUrl);
                      alert('已复制链接');
                    }}
                  >
                    复制
                  </button>
                  <button
                    className="mini-btn mini-btn-del"
                    onClick={() => handleDeleteSnapshot(item.id, item.deleteKey)}
                  >
                    销毁
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
}
