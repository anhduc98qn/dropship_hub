import React, { useEffect, useState } from 'react';
import { supabase, q, rpc } from '../lib/supabase.js';
import { ROLE_LABEL } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';

const NUM_FIELDS = [
  ['tracking_days', 'Số ngày theo dõi', 'Đọc số mỗi ngày trong N ngày rồi tự chấm'],
  ['growth_threshold_pct', 'Ngưỡng tăng (%)', 'Mỗi chỉ số cần tăng ít nhất bấy nhiêu %'],
  ['growth_min_metrics', 'Số chỉ số cần đạt', 'Trên 3 chỉ số Like / Comment / Share'],
  ['entry_ratio', 'Hệ số đầu vào', '(Share + Comment) × hệ số ≥ Like'],
  ['review_hours', 'Hạn duyệt (giờ)', 'Quá hạn thì Telegram nhắc quản lý'],
  ['daily_target', 'Chỉ tiêu mẫu/ngày', 'Dùng cho tab Hiệu suất và báo cáo'],
  ['campaign_eval_days', 'Nhắc đánh giá camp sau (ngày)', 'Tính từ lúc chuyển Up Campaign'],
  ['day_start_hour', 'Giờ đổi ngày làm việc', 'Giờ Việt Nam'],
];

function Settings({ settings, onSaved }) {
  const toast = useToast();
  const [s, setS] = useState(settings);
  const [tg, setTg] = useState({ token: '', status: null });
  useEffect(() => { rpc('telegram_status').then((r) => setTg((t) => ({ ...t, status: r?.[0] || null }))).catch(() => {}); }, []);

  async function save(e) {
    e.preventDefault();
    try {
      const patch = { entry_required: !!s.entry_required, telegram_chat_id: (s.telegram_chat_id || '').trim() || null, updated_at: new Date().toISOString() };
      for (const [k] of NUM_FIELDS) patch[k] = Number(s[k]);
      await q(supabase.from('app_settings').update(patch).eq('id', 1));
      toast('Đã lưu cài đặt');
      onSaved();
    } catch (err) { toast(err.message, { error: true }); }
  }
  async function saveToken() {
    try {
      await rpc('set_telegram_token', { p_token: tg.token });
      const r = await rpc('telegram_status');
      setTg({ token: '', status: r?.[0] || null });
      toast('Đã lưu token bot');
    } catch (err) { toast(err.message, { error: true }); }
  }
  async function test() {
    try { await rpc('telegram_test'); toast('Đã gửi tin thử, kiểm tra nhóm Telegram'); } catch (err) { toast(err.message, { error: true }); }
  }

  return (
    <form className="panel" onSubmit={save}>
      <h3>Quy tắc tự động</h3>
      <div className="grid-fields">
        {NUM_FIELDS.map(([k, label, hint]) => (
          <label key={k}>{label}<input type="number" step="any" value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} /><small className="muted">{hint}</small></label>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={!!s.entry_required} onChange={(e) => setS({ ...s, entry_required: e.target.checked })} />
        Bắt buộc đạt tiêu chí đầu vào mới cho lưu mẫu</label>
      <h3>Telegram</h3>
      <p className="muted small">Tạo bot với @BotFather, thêm bot vào nhóm, lấy Chat ID của nhóm (dạng -100…). Token chỉ ghi được, không ai đọc lại được.
        {tg.status && <> Trạng thái: {tg.status.has_token ? 'đã có token' : 'chưa có token'}.</>}</p>
      <div className="g2">
        <label>Chat ID nhóm<input value={s.telegram_chat_id || ''} onChange={(e) => setS({ ...s, telegram_chat_id: e.target.value })} placeholder="-100…" /></label>
        <label>Token bot (để trống = giữ nguyên)<input type="password" autoComplete="off" value={tg.token} onChange={(e) => setTg({ ...tg, token: e.target.value })} placeholder="123456:ABC…" /></label>
      </div>
      <div className="row">
        <button className="btn primary">Lưu cài đặt</button>
        <button type="button" className="btn" disabled={!tg.token} onClick={saveToken}>Lưu token</button>
        <button type="button" className="btn" onClick={test}>Gửi tin thử</button>
      </div>
    </form>
  );
}

function Users({ me }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const load = () => q(supabase.from('profiles').select('*').order('created_at')).then(setRows, (e) => toast(e.message, { error: true }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function patch(u, data) {
    try {
      const r = await q(supabase.from('profiles').update(data).eq('id', u.id).select());
      setRows((xs) => xs.map((x) => (x.id === u.id ? r[0] : x)));
    } catch (e) { toast(e.message, { error: true }); load(); }
  }
  if (!rows) return <p className="muted">Đang tải…</p>;
  return (
    <div className="panel">
      <h3>Nhân viên</h3>
      <p className="muted small">Người mới tự đăng ký trên trang đăng nhập, mặc định là Tìm mẫu. Mã nhân viên dùng trong tên campaign; Telegram để nhắc tên (@username).</p>
      <table className="table">
        <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Mã NV</th><th>Telegram</th><th>Hoạt động</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td><input defaultValue={u.full_name} onBlur={(e) => e.target.value !== u.full_name && patch(u, { full_name: e.target.value })} /></td>
              <td className="muted">{u.email}</td>
              <td><select value={u.role || ''} disabled={u.id === me.id} onChange={(e) => patch(u, { role: e.target.value || null })}>
                <option value="">Chưa phân</option>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></td>
              <td><input className="short" defaultValue={u.staff_code || ''} onBlur={(e) => e.target.value.toUpperCase() !== (u.staff_code || '') && patch(u, { staff_code: e.target.value })} /></td>
              <td><input className="short" defaultValue={u.telegram_username || ''} placeholder="username" onBlur={(e) => e.target.value !== (u.telegram_username || '') && patch(u, { telegram_username: e.target.value.replace(/^@/, '') || null })} /></td>
              <td><input type="checkbox" checked={u.active} disabled={u.id === me.id} onChange={(e) => patch(u, { active: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Admin({ me, settings, onSaved }) {
  return (
    <div className="page">
      <h2>Quản trị</h2>
      <Settings settings={settings} onSaved={onSaved} />
      <Users me={me} />
    </div>
  );
}
