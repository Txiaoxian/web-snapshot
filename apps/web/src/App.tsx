import { useState, useEffect } from 'react';

interface SnapshotMeta {
  id: string;
  shareCode: string;
  sourceUrl: string;
  title: string;
  description?: string;
  faviconUrl?: string;
  createdAt: string;
  requirePassword?: boolean;
}

interface SnapshotDetail extends SnapshotMeta {
  html: string;
  text: string;
  screenshotUrl?: string;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // 全局主页访问密码管理
  const [token, setToken] = useState<string | null>(localStorage.getItem('admin_token'));
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // 监听路由改变
  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 辅助函数：路由跳转
  const navigate = (toPath: string) => {
    window.history.pushState({}, '', toPath);
    setPath(toPath);
  };

  // 检测健康状态
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setHealthOk(data.ok === true))
      .catch(() => setHealthOk(false));
  }, []);

  // 校验登录
  const handleLogin = async () => {
    if (password.trim() === '') return;
    setVerifying(true);
    setLoginError(null);
    try {
      const computedHash = await sha256(password);
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${computedHash}`
        }
      });
      if (!res.ok) {
        throw new Error('访问密码不正确，请重试');
      }
      localStorage.setItem('admin_token', computedHash);
      setToken(computedHash);
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '校验时发生网络异常');
    } finally {
      setVerifying(false);
    }
  };

  // 登出/锁定
  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setToken(null);
  };

  // 全局快照物理删除方法 (无需 deleteKey，因为使用了已授权管理员的 token)
  const handleDeleteSnapshot = async (id: string) => {
    if (!token) return;
    if (!window.confirm('🚨 确定要彻底销毁该快照吗？这将永久清除服务器上的所有快照文件及数据库记录，此操作不可逆！')) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/snapshots/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error('物理销毁失败');
      }
      alert('快照已彻底销毁！');
      // 刷新列表
      fetchSnapshotsList();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除请求发生异常');
    }
  };

  const fetchSnapshotsList = () => {
    if (!token) return;
    setLoadingList(true);
    fetch('/api/snapshots')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSnapshots(data);
        }
      })
      .catch((err) => console.error('获取快照列表失败:', err))
      .finally(() => setLoadingList(false));
  };

  // 获取最近列表 (仅在首页加载且校验通过后拉取)
  useEffect(() => {
    if ((path === '/' || path === '/index.html') && token) {
      fetchSnapshotsList();
    }
  }, [path, token]);

  // 判断渲染哪个页面 (分享页面无需拦截，供所有人无碍查看)
  const shareCodeMatch = path.match(/^\/s\/([a-zA-Z0-9]+)/);
  if (shareCodeMatch) {
    const shareCode = shareCodeMatch[1];
    return <SharePage shareCode={shareCode} goHome={() => navigate('/')} />;
  }
  
  if (path === '/admin') {
    navigate('/');
    return null;
  }

  // 1. 如果没有 Token，阻断渲染首页列表，强制要求输入密码
  if (!token) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div className="glass-card" style={{ maxWidth: '400px', width: '90%', textAlign: 'center', padding: '2.5rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔑</div>
          <h2 style={{ marginBottom: '0.5rem' }}>系统访问校验</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            请输入访问密码以进入网页快照分享工具
          </p>

          <div className="input-group" style={{ marginBottom: '1.25rem' }}>
            <input
              type="password"
              className="text-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLogin();
              }}
              placeholder="请输入密码"
              style={{ textAlign: 'center', fontSize: '1rem', padding: '0.6rem' }}
              disabled={verifying}
            />
          </div>

          {loginError && (
            <div style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem' }}>
              ❌ {loginError}
            </div>
          )}

          <button 
            className="btn btn-primary" 
            style={{ width: '100%', padding: '0.6rem' }} 
            onClick={handleLogin} 
            disabled={verifying}
          >
            {verifying ? '正在校验...' : '确认进入'}
          </button>
        </div>
      </div>
    );
  }

  // 2. 正常进入首页 (展示快照网格与一键删除按钮)
  return (
    <div className="container">
      {/* 头部区域 */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>网页快照分享工具</h1>
          <p style={{ color: '#94a3b8', margin: '0.2rem 0 0 0', fontSize: '1rem' }}>
            快速保存已渲染 of 网页内容，随时复制分享，解决朋友无法访问的问题。
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={() => setIsGuideOpen(true)} style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem' }}>
            🔌 安装插件
          </button>
          <button className="btn btn-secondary" onClick={handleLogout} style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem' }}>
            🔒 锁定退出
          </button>
          <div className={`status-badge ${healthOk === true ? 'status-online' : 'status-offline'}`} style={{ margin: 0, padding: '0.4rem 0.7rem' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor', marginRight: '4px' }}></span>
            {healthOk === true ? '服务在线' : '连接失败'}
          </div>
        </div>
      </header>

      {/* 插件安装指南 Modal */}
      {isGuideOpen && (
        <div className="iframe-fullscreen-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="glass-card" style={{ maxWidth: '650px', width: '90%', maxHeight: '90vh', overflowY: 'auto', padding: '2rem', position: 'relative', border: '1px solid rgba(255,255,255,0.1)' }}>
            <button 
              className="fullscreen-close-btn" 
              onClick={() => setIsGuideOpen(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(255,255,255,0.05)', border: 'none', padding: '0.3rem 0.6rem', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
            >
              关闭
            </button>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', marginTop: 0 }}>
              <span>🔌</span> 浏览器插件安装指南
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              您需要安装我们的浏览器扩展插件来采集网页。此工具仅保存您当前浏览器中<b>已经成功渲染出来</b>的页面内容，不需要原网页的帐号密码，也不会破解任何权限。
            </p>

            <div className="steps-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="step-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px' }}>
                <span className="step-number" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#6366f1' }}>01</span>
                <div>
                  <div className="step-title" style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '0.2rem' }}>下载插件压缩包</div>
                  <div className="step-desc" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>点击下方按钮下载插件压缩包文件，并保存到本地。</div>
                </div>
              </div>
              <div className="step-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px' }}>
                <span className="step-number" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#6366f1' }}>02</span>
                <div>
                  <div className="step-title" style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '0.2rem' }}>解压文件</div>
                  <div className="step-desc" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>在本地将下载的 <code>extension.zip</code> 解压到一个专属目录。</div>
                </div>
              </div>
              <div className="step-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px' }}>
                <span className="step-number" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#6366f1' }}>03</span>
                <div>
                  <div className="step-title" style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '0.2rem' }}>加载扩展程序</div>
                  <div className="step-desc" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    在 Chrome 地址栏打开 <code>chrome://extensions/</code>，开启右上角的<b>「开发者模式」</b>，点击<b>「加载已解压的扩展程序」</b>并选择刚才的解压目录。
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.2rem' }}>
              <a href="/downloads/extension.zip" className="btn btn-primary" download style={{ textDecoration: 'none' }}>
                📥 下载 Chrome 插件 (.zip)
              </a>
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                插件默认后端配置地址：<code style={{ color: '#a5b4fc' }}>http://localhost:3000</code>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 快照列表展示 */}
      <section className="glass-card">
        <h2 style={{ marginBottom: '1.2rem' }}>📸 最近保存的分享快照</h2>
        
        {loadingList ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: '#64748b' }}>正在加载最近快照列表...</div>
        ) : snapshots.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
            <div>暂无公开快照，快去使用插件保存第一个网页吧！</div>
          </div>
        ) : (
          <div className="snapshot-grid">
            {snapshots.map((item) => (
              <div
                key={item.id}
                className="snapshot-card"
                onClick={() => navigate(`/s/${item.shareCode}`)}
                style={{ position: 'relative' }}
              >
                <div>
                  <div className="snapshot-title" title={item.title}>
                    {item.title}
                  </div>
                  {item.description && (
                    <div className="snapshot-desc">
                      {item.description}
                    </div>
                  )}
                </div>
                <div className="snapshot-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', marginTop: 'auto' }}>
                  {item.faviconUrl ? (
                    <img
                      className="snapshot-favicon"
                      src={item.faviconUrl}
                      alt="favicon"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span>📄</span>
                  )}
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100px' }}>
                    {new URL(item.sourceUrl).hostname}
                  </span>
                  
                  {/* 快照卡片上的一键删除按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // 阻止卡片点击跳转到详情页
                      handleDeleteSnapshot(item.id);
                    }}
                    className="btn"
                    style={{
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.75rem',
                      background: '#ef4444',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginLeft: 'auto',
                      zIndex: 10
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 页脚 */}
      <footer style={{ marginTop: '4rem', textAlign: 'center', color: '#475569', fontSize: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '2rem 0' }}>
        网页快照分享工具 MVP &copy; {new Date().getFullYear()} - 纯净、安全、无多余依赖
      </footer>
    </div>
  );
}

// 分享页面组件
function SharePage({ shareCode, goHome }: { shareCode: string; goHome: () => void }) {
  const [data, setData] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'content' | 'screenshot' | 'text'>('content');
  const [copied, setCopied] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // 新增的高级属性状态
  const [inputPassword, setInputPassword] = useState('');
  const [isPasswordIncorrect, setIsPasswordIncorrect] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  
  // 管理销毁凭证状态
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  // 1. 监听 URL 中的 deleteKey 并将其存入本地 LocalStorage 绑定授权，随后抹去 URL 参数
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const dKey = urlParams.get('deleteKey');
    if (dKey) {
      localStorage.setItem(`delete_key_${shareCode}`, dKey);
      setDeleteKey(dKey);
      // 抹去 URL 上的 deleteKey 参数
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    } else {
      // 尝试从本地 LocalStorage 读取已绑定的凭证
      const savedKey = localStorage.getItem(`delete_key_${shareCode}`);
      setDeleteKey(savedKey);
    }
  }, [shareCode]);

  // 读取已授权的全局管理 Token
  const adminToken = localStorage.getItem('admin_token');

  // 2. 物理销毁删除请求 (兼容普通用户的 deleteKey 与已授权管理员的 adminToken 双轨销毁)
  const handleDeleteSnapshot = async () => {
    if (!data) return;
    const dKey = deleteKey;
    const isAdmin = !!adminToken;
    if (!dKey && !isAdmin) return;

    if (!window.confirm('🚨 确定要彻底销毁该快照吗？这将永久清除服务器上的所有快照文件及数据库记录，此操作不可逆！')) {
      return;
    }
    try {
      setLoading(true);
      const url = isAdmin
        ? `/api/admin/snapshots/${data.id}`
        : `/api/snapshots/${data.id}?deleteKey=${dKey}`;
      const headers: HeadersInit = isAdmin
        ? { 'Authorization': `Bearer ${adminToken}` }
        : {};

      const res = await fetch(url, {
        method: 'DELETE',
        headers
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `删除失败: ${res.status}`);
      }
      alert('快照销毁成功！');
      if (!isAdmin) {
        localStorage.removeItem(`delete_key_${shareCode}`);
      }
      goHome();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除请求失败');
      setLoading(false);
    }
  };

  // 监听 Escape 按键以退出全屏沉浸式阅读
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const fetchShareData = (pwd?: string) => {
    setLoading(true);
    const url = pwd ? `/api/share/${shareCode}?password=${encodeURIComponent(pwd)}` : `/api/share/${shareCode}`;
    
    fetch(url)
      .then(async (res) => {
        if (res.status === 410) {
          setIsExpired(true);
          throw new Error('此网页快照已超过有效期，被系统自动销毁');
        }
        if (res.status === 404) {
          setIsNotFound(true);
          throw new Error('未找到对应快照，可能已被所有者主动销毁');
        }
        if (!res.ok) {
          throw new Error('拉取快照数据失败，请检查网络或配置');
        }
        return res.json();
      })
      .then((json) => {
        if (json.requirePassword) {
          // 只包含最基础元数据（仅 title 和 faviconUrl），提示输入密码
          setData(json);
          if (pwd) {
            setIsPasswordIncorrect(true);
          }
        } else {
          // 获取到了完整数据
          setData(json);
          setIsPasswordIncorrect(false);
        }
      })
      .catch((err) => {
        setError(err.message || '数据解析失败');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchShareData();
  }, [shareCode]);

  const handleVerifyPassword = () => {
    if (inputPassword.trim() === '') return;
    fetchShareData(inputPassword);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div style={{ fontSize: '1.2rem', color: '#94a3b8' }}>正在调取网页快照数据，请稍后...</div>
      </div>
    );
  }

  // 1. 已过期状态提示
  if (isExpired) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div className="glass-card" style={{ maxWidth: '450px', width: '100%', textAlign: 'center', padding: '2.5rem 2rem' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>⌛</div>
          <h2 style={{ color: '#f59e0b', marginBottom: '0.75rem' }}>网页快照已过期失效</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
            根据所有者在创建时设置的时限配置，该快照已超出其保存期限，文件和元数据已被服务器的自动 Scheduler 安全彻底销毁。
          </p>
          <button className="btn btn-primary" onClick={goHome}>返回工具首页</button>
        </div>
      </div>
    );
  }

  // 2. 找不到或已主动删除状态提示
  if (isNotFound) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div className="glass-card" style={{ maxWidth: '450px', width: '100%', textAlign: 'center', padding: '2.5rem 2rem' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🗑️</div>
          <h2 style={{ color: '#f87171', marginBottom: '0.75rem' }}>快照不存在或已被销毁</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
            您访问的网页快照在服务器端不存在。可能已被所有者使用 deleteKey 密钥一键彻底删除，或者您拼写了错误的分享码。
          </p>
          <button className="btn btn-primary" onClick={goHome}>返回工具首页</button>
        </div>
      </div>
    );
  }

  // 3. 需要访问密码校验拦截
  if (data?.requirePassword) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div className="glass-card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center', padding: '2.5rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
          <h2 style={{ marginBottom: '0.5rem' }}>私有加密快照</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.5rem', wordBreak: 'break-all' }}>
            快照【{data.title}】受访问密码保护，请输入分享者设定的密码以解锁内容。
          </p>
          
          <div className="input-group" style={{ marginBottom: '1.25rem' }}>
            <input
              type="password"
              className="text-input"
              value={inputPassword}
              onChange={(e) => {
                setInputPassword(e.target.value);
                setIsPasswordIncorrect(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleVerifyPassword();
              }}
              placeholder="请输入快照访问密码"
              style={{ textAlign: 'center', letterSpacing: '2px', fontSize: '1rem', padding: '0.6rem' }}
            />
          </div>

          {isPasswordIncorrect && (
            <div style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: '1rem' }}>
              ❌ 密码错误，请重新输入
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={goHome}>返回首页</button>
            <button className="btn btn-primary" style={{ flex: 1.5 }} onClick={handleVerifyPassword}>验证密码</button>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
        <div style={{ fontSize: '1.2rem', color: '#f87171', marginBottom: '1.5rem' }}>{error || '快照加载异常'}</div>
        <button className="btn btn-secondary" onClick={goHome}>返回工具首页</button>
      </div>
    );
  }

  return (
    <div className="container">
      {/* 顶部提醒横幅 */}
      <div className="alert-info">
        <span>💡</span>
        <span>这是用户于 {new Date(data.createdAt).toLocaleString()} 保存的网页静态快照，内容可能与原网页当前最新状态不同。</span>
      </div>

      {/* 头部信息 */}
      <div className="glass-card share-header" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          {data.faviconUrl && (
            <img
              src={data.faviconUrl}
              alt="favicon"
              style={{ width: 28, height: 28, borderRadius: 4, marginTop: '0.3rem' }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.3, marginBottom: '0.5rem', background: 'none', WebkitTextFillColor: 'initial', color: '#f8fafc' }}>
              {data.title}
            </h1>
            {data.description && (
              <p style={{ color: '#94a3b8', margin: '0 0 1rem 0', fontSize: '0.95rem' }}>
                {data.description}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
              <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                🔗 原始链接
              </a>
              <button onClick={handleCopyLink} className="btn btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                {copied ? '✅ 已复制分享链接' : '📋 复制分享链接'}
              </button>
              <button onClick={goHome} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                🏠 返回首页
              </button>
              {(deleteKey || adminToken) && (
                <button
                  onClick={handleDeleteSnapshot}
                  className="btn"
                  style={{
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.8rem',
                    background: '#f87171',
                    color: '#000000',
                    fontWeight: 'bold',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  🔥 销毁此快照
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="tab-container">
        <button
          className={`tab-button ${activeTab === 'content' ? 'active' : ''}`}
          onClick={() => setActiveTab('content')}
        >
          📄 阅读内容
        </button>
        <button
          className={`tab-button ${activeTab === 'screenshot' ? 'active' : ''}`}
          onClick={() => setActiveTab('screenshot')}
          disabled={!data.screenshotUrl}
          style={{ opacity: data.screenshotUrl ? 1 : 0.5, cursor: data.screenshotUrl ? 'pointer' : 'not-allowed' }}
        >
          🖼️ 页面截图 {!data.screenshotUrl && '(未生成)'}
        </button>
        <button
          className={`tab-button ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
          📝 纯文本视图
        </button>
      </div>

      {/* 渲染区域 */}
      <div className="glass-card" style={{ padding: '1rem' }}>
        {activeTab === 'content' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                onClick={() => setIsFullScreen(true)}
              >
                🖥️ 全屏沉浸式阅读
              </button>
            </div>
            <div className="iframe-container">
              <iframe
                className="iframe-render"
                title="快照内容沙箱"
                sandbox="allow-same-origin"
                srcDoc={data.html || '<html><body><div style="padding: 20px; color:#333;">快照 HTML 为空</div></body></html>'}
              />
            </div>
          </div>
        )}

        {activeTab === 'screenshot' && data.screenshotUrl && (
          <div className="screenshot-container">
            <img
              src={data.screenshotUrl}
              alt="网页视图截图"
              className="screenshot-view"
            />
          </div>
        )}

        {activeTab === 'text' && (
          <pre className="text-content-pre">
            {data.text || '暂无网页正文文本内容。'}
          </pre>
        )}
      </div>

      {/* 全屏沉浸式阅读遮罩渲染 */}
      {isFullScreen && (
        <div className="iframe-fullscreen-container">
          <button className="fullscreen-close-btn" onClick={() => setIsFullScreen(false)}>
            ❌ 退出全屏 (Esc)
          </button>
          <iframe
            className="iframe-render"
            title="快照内容沙箱全屏"
            sandbox="allow-same-origin"
            srcDoc={data.html || ''}
          />
        </div>
      )}

      {/* 页脚 */}
      <footer style={{ marginTop: '3rem', textAlign: 'center', color: '#475569', fontSize: '0.85rem' }}>
        此快照由网页快照分享工具在沙箱环境下安全托管
      </footer>
    </div>
  );
}

// ==========================================
// 管理后台组件与辅助函数
// ==========================================

function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  
  const lengthProperty = 'length';
  let i, j;
  
  const result: string[] = [];
  const words: number[] = [];
  const asciiLength = ascii[lengthProperty];
  
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  
  let asciiBitLength = asciiLength * 8;
  const wordsLength = ((asciiBitLength + 64) >>> 9 << 4) + 15;
  
  for (i = 0; i < wordsLength; i++) {
    words[i] = 0;
  }
  
  for (i = 0; i < asciiLength; i++) {
    words[i >>> 2] |= (ascii.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  }
  
  words[asciiLength >>> 2] |= 0x80 << (24 - (asciiLength % 4) * 8);
  words[wordsLength] = asciiBitLength;
  
  for (i = 0; i < wordsLength; i += 16) {
    const w: number[] = [];
    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
    
    for (j = 0; j < 64; j++) {
      if (j < 16) {
        w[j] = words[i + j];
      } else {
        const s0: number = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1: number = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      
      const ch = (e & f) ^ (~e & g);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const temp2 = (S0 + maj) | 0;
      
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  
  for (i = 0; i < 8; i++) {
    const value = hash[i];
    result.push((value >>> 24).toString(16).padStart(2, '0'));
    result.push(((value >>> 16) & 0xff).toString(16).padStart(2, '0'));
    result.push(((value >>> 8) & 0xff).toString(16).padStart(2, '0'));
    result.push((value & 0xff).toString(16).padStart(2, '0'));
  }
  
  return result.join('');
}


