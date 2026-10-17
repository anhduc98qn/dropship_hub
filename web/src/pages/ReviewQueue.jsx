import React, { useEffect, useMemo, useState } from 'react';
import { updateProduct } from '../lib/useProducts.js';
import { fmtNum, fmtPct, dueText } from '../lib/format.js';
import { adLibraryFor } from '../lib/adlib.js';
import { useToast } from '../components/Toast.jsx';
import GrowthChart from '../components/GrowthChart.jsx';
import Shot from '../components/Shot.jsx';
import { useSnapshots } from './ProductDrawer.jsx';
import { moveProduct } from './Board.jsx';

// Duyệt lần lượt các mẫu Chờ duyệt. Phím: A = Approve · F = Fails · T = Theo dõi thêm · ← → = mẫu trước/sau
// 1/2/3… = xem ảnh Ngày 1/2/3… · Esc = thoát
export default function ReviewQueue({ products, people, onClose, onChanged }) {
  const toast = useToast();
  // Giữ thứ tự cố định trong lúc duyệt: Ưu tiên trước, hạn gần trước
  const [ids, setIds] = useState(() => products.filter((p) => p.pending_review)
    .sort((a, b) => (b.priority - a.priority) || (new Date(a.due_at || 8e15) - new Date(b.due_at || 8e15))).map((p) => p.id));
  const [i, setI] = useState(0);
  const [day, setDay] = useState(null);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const p = byId[ids[i]];
  const snaps = useSnapshots(p?.id || 'none', p?.updated_at);
  const shots = snaps.filter((s) => s.screenshot_path);
  const shown = (day !== null && shots.find((s) => s.day_index === day)) || shots.at(-1);

  async function act(kind) {
    if (!p || busy) return;
    setBusy(true);
    try {
      let row;
      if (kind === 'extra') {
        row = await updateProduct(p.id, { extra_tracking: true });
        setIds((xs) => [...xs.filter((x) => x !== p.id), p.id]); // xếp xuống cuối hàng
        toast('Đã gắn Theo dõi thêm');
      } else {
        row = await moveProduct(p, kind);
        if (!row) return;
        setIds((xs) => xs.filter((x) => x !== p.id));
        toast(kind === 'approve' ? `Approve ${row.code}` : 'Đã chuyển Fails');
      }
      onChanged(row);
      setDay(null);
      setI((n) => Math.max(0, Math.min(n, ids.length - 2)));
    } catch (e) { toast(e.message, { error: true }); } finally { setBusy(false); }
  }

  useEffect(() => {
    const k = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') onClose();
      else if (key === 'a') act('approve');
      else if (key === 'f') act('fails');
      else if (key === 't') { if (!p?.extra_tracking) act('extra'); }
      else if (key === 'arrowright') { setI((n) => Math.min(n + 1, ids.length - 1)); setDay(null); }
      else if (key === 'arrowleft') { setI((n) => Math.max(n - 1, 0)); setDay(null); }
      else if (/^[0-9]$/.test(key)) setDay(Number(key));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  return (
    <div className="review">
      <header>
        <h2>Duyệt lần lượt {ids.length ? `· ${Math.min(i + 1, ids.length)}/${ids.length}` : ''}</h2>
        <span className="muted small">A Approve · F Fails · T Theo dõi thêm · ← → chuyển mẫu · 1/2/3 xem ảnh từng ngày · Esc thoát</span>
        <button className="x" onClick={onClose} aria-label="Đóng">×</button>
      </header>
      {!p ? <div className="center muted">Hết mẫu chờ duyệt. Bấm Esc để quay lại bảng.</div> : (
        <div className="review-body">
          <div className="review-shot">
            <div className="thumbs">
              {shots.map((s) => <button key={s.id} className={'thumb' + (shown?.id === s.id ? ' on' : '')} onClick={() => setDay(s.day_index)}>N{s.day_index}</button>)}
            </div>
            <Shot path={shown?.screenshot_path || p.screenshot_path} className="shot big" />
          </div>
          <div className="review-info">
            <h3>{p.page_name || 'Không rõ page'} {p.priority && <span className="badge red">Ưu tiên</span>} {p.extra_tracking && <span className="badge blue">Theo dõi thêm</span>}</h3>
            <div className="muted small">{people[p.owner_id]?.full_name} · {p.due_at ? dueText(p.due_at) : 'Không tính hạn'}</div>
            {p.headline && <div className="drawer-headline">{p.headline}</div>}
            <p className="ad-content">{p.ad_content}</p>
            <div className="links">
              <a href={p.post_url} target="_blank" rel="noreferrer">Xem bài</a>
              {p.product_url && <a href={p.product_url} target="_blank" rel="noreferrer">Link sản phẩm</a>}
              {adLibraryFor(p) && <a href={adLibraryFor(p)} target="_blank" rel="noreferrer">Ads Library (US)</a>}
            </div>
            <table className="snaps">
              <thead><tr><th>Ngày</th><th>Like</th><th>Comment</th><th>Share</th></tr></thead>
              <tbody>{snaps.map((s) => <tr key={s.id}><td>N{s.day_index}</td><td>{fmtNum(s.likes)}</td><td>{fmtNum(s.comments)}</td><td>{fmtNum(s.shares)}</td></tr>)}</tbody>
            </table>
            <div className="growth">Tăng so với Ngày 0: L {fmtPct(p.growth_likes)} · C {fmtPct(p.growth_comments)} · S {fmtPct(p.growth_shares)}</div>
            {p.extra_tracking && p.daily_growth_likes !== null && <div className="daily-g">Hôm trước: L {fmtPct(p.daily_growth_likes)} · C {fmtPct(p.daily_growth_comments)} · S {fmtPct(p.daily_growth_shares)}</div>}
            <GrowthChart snaps={snaps} />
            <div className="row">
              <button className="btn green" disabled={busy} onClick={() => act('approve')}>Approve (A)</button>
              <button className="btn red" disabled={busy} onClick={() => act('fails')}>Fails (F)</button>
              {!p.extra_tracking && <button className="btn blue" disabled={busy} onClick={() => act('extra')}>Theo dõi thêm (T)</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
