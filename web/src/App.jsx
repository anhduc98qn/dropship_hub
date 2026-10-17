import React, { useCallback, useEffect, useState } from 'react';
import { configured, supabase, q } from './lib/supabase.js';
import { ROLE_LABEL } from './lib/format.js';
import { ToastProvider } from './components/Toast.jsx';
import Login from './pages/Login.jsx';
import Board from './pages/Board.jsx';
import Performance from './pages/Performance.jsx';
import Admin from './pages/Admin.jsx';

function NotConfigured() {
  return (
    <div className="login"><div className="login-box">
      <h1>Dropship Hub</h1>
      <p>Chưa cấu hình kết nối. Mở file <code>config.js</code> cạnh <code>index.html</code>, điền <b>supabaseUrl</b> và <b>supabaseAnonKey</b> (Supabase › Project Settings › API), rồi tải lại trang.</p>
    </div></div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [settings, setSettings] = useState({});
  const [tab, setTab] = useState('board');
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadMe = useCallback(async () => {
    if (!session) return setMe(null);
    try {
      const [p] = await q(supabase.from('profiles').select('*').eq('id', session.user.id));
      const [s] = await q(supabase.from('app_settings').select('*'));
      setMe(p || null);
      setSettings(s || {});
    } catch (e) { setErr(e.message); }
  }, [session]);
  useEffect(() => { loadMe(); }, [loadMe]);

  if (!configured) return <NotConfigured />;
  if (session === undefined) return <div className="center muted">Đang tải…</div>;
  if (!session) return <Login />;
  if (err) return <div className="center error">{err}</div>;
  if (!me) return <div className="center muted">Đang tải…</div>;
  if (!me.active || !me.role) {
    return (
      <div className="login"><div className="login-box">
        <h1>Dropship Hub</h1>
        <p>Tài khoản <b>{me.email}</b> chưa được quản lý kích hoạt.</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </div></div>
    );
  }
  const manager = me.role === 'manager';
  return (
    <ToastProvider>
      <div className="app">
        <header className="topbar">
          <div className="brand"><img src="favicon.png" alt="" />Dropship Hub</div>
          <nav>
            <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>Bảng mẫu</button>
            {manager && <button className={tab === 'perf' ? 'on' : ''} onClick={() => setTab('perf')}>Hiệu suất</button>}
            {manager && <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>Quản trị</button>}
          </nav>
          <div className="me">
            <span>{me.full_name} · {ROLE_LABEL[me.role]}</span>
            <button className="link" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
          </div>
        </header>
        <main>
          {tab === 'board' && <Board me={me} settings={settings} />}
          {tab === 'perf' && manager && <Performance settings={settings} />}
          {tab === 'admin' && manager && <Admin me={me} settings={settings} onSaved={loadMe} />}
        </main>
      </div>
    </ToastProvider>
  );
}
