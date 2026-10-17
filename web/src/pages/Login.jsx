import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function Login() {
  const [mode, setMode] = useState('in');
  const [f, setF] = useState({ email: '', password: '', full_name: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password })
      : await supabase.auth.signUp({ email: f.email.trim(), password: f.password, options: { data: { full_name: f.full_name.trim() } } });
    setBusy(false);
    if (error) return setMsg({ err: true, text: error.message });
    if (mode === 'up' && !data.session) setMsg({ text: 'Đã tạo tài khoản. Mở email để xác nhận rồi đăng nhập.' });
  }

  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <h1>Dropship Hub</h1>
        <p className="muted">{mode === 'in' ? 'Đăng nhập để vào bảng mẫu.' : 'Tài khoản đầu tiên là Quản lý; các tài khoản sau do Quản lý phân vai trò.'}</p>
        {mode === 'up' && <label>Họ tên<input value={f.full_name} onChange={set('full_name')} required /></label>}
        <label>Email<input type="email" autoComplete="username" value={f.email} onChange={set('email')} required /></label>
        <label>Mật khẩu<input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} value={f.password} onChange={set('password')} required /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
        {msg && <p className={msg.err ? 'error' : 'ok'}>{msg.text}</p>}
        <button type="button" className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
          {mode === 'in' ? 'Chưa có tài khoản? Tạo tài khoản' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
