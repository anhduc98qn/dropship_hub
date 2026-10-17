import React, { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { ROLE_LABEL } from '../lib/format.js';

// Hiệu suất từng người: số mẫu so với chỉ tiêu, ngày đi làm, ngày đã đọc số, tỉ lệ duyệt
export default function Performance({ settings }) {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const target = settings.daily_target || 8;
  useEffect(() => { setRows(null); rpc('kpi', { p_days: days }).then(setRows, (e) => setErr(e.message)); }, [days]);
  if (err) return <div className="center error">{err}</div>;
  return (
    <div className="page">
      <div className="row">
        <h2>Hiệu suất</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 7, 14, 30].map((d) => <option key={d} value={d}>{d === 1 ? 'Hôm nay' : `${d} ngày gần nhất`}</option>)}
        </select>
        <span className="muted small">Chỉ tiêu {target} mẫu/ngày · ngày làm việc đổi lúc {settings.day_start_hour ?? 7}:00</span>
      </div>
      {!rows ? <p className="muted">Đang tải…</p> : (
        <table className="table">
          <thead><tr><th>Nhân viên</th><th>Mã</th><th>Vai trò</th><th>Hôm nay</th><th>Đã đọc số hôm nay</th><th>Mẫu trong kỳ</th>
            <th>TB/ngày đi làm</th><th>Ngày đọc số</th><th>Approve</th><th>Fails</th><th>Đang chờ duyệt</th><th>Tỉ lệ duyệt</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const avg = r.worked_days ? r.found / r.worked_days : 0;
              const decided = r.approved + r.failed;
              return (
                <tr key={r.user_id}>
                  <td>{r.full_name}</td><td>{r.staff_code || '–'}</td><td>{ROLE_LABEL[r.role]}</td>
                  <td className={r.today_found >= target ? 'ok' : 'warn'}>{r.today_found}/{target}</td>
                  <td>{r.today_updated ? '✓' : <span className="warn">Chưa</span>}</td>
                  <td>{r.found}</td>
                  <td className={avg >= target ? 'ok' : ''}>{avg.toFixed(1)}</td>
                  <td>{r.updated_days}</td><td>{r.approved}</td><td>{r.failed}</td><td>{r.pending}</td>
                  <td>{decided ? `${Math.round((r.approved * 100) / decided)}%` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
