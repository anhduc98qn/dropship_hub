import React, { useMemo, useState } from 'react';
import { useProducts, updateProduct } from '../lib/useProducts.js';
import { STATUSES, STATUS_LABEL, POST_APPROVE, fmtNum, fmtPct, fmtDate, dueText, isTracking } from '../lib/format.js';
import { adLibraryFor } from '../lib/adlib.js';
import { toXlsx, download } from '../lib/excel.js';
import { useToast } from '../components/Toast.jsx';
import ProductDrawer from './ProductDrawer.jsx';
import ReviewQueue from './ReviewQueue.jsx';

export function canMove(me, p, to) {
  if (!p || p.status === to) return false;
  if (me.role === 'manager') return true;
  return !!p.code && ['approve', ...POST_APPROVE].includes(p.status) && POST_APPROVE.includes(to);
}

// Đổi cột: hỏi lý do khi Fails; Up Store cần Cost + link store. Trả về dòng mới hoặc null nếu hủy.
export async function moveProduct(p, to) {
  const patch = { status: to };
  if (to === 'fails') {
    const reason = window.prompt('Lý do Fails (không bắt buộc):', p.fail_reason || '');
    if (reason === null) return null;
    patch.fail_reason = reason.trim() || null;
  }
  if (to === 'up_store' && (p.cost_usd === null || !p.store_url)) {
    throw new Error('Cần điền Cost và Link sản phẩm trên store (mở thẻ) trước khi chuyển sang Up Store');
  }
  return updateProduct(p.id, patch);
}

export function Badges({ p }) {
  const overdue = p.pending_review && p.due_at && new Date(p.due_at) < new Date();
  return (
    <div className="badges">
      {p.pending_review && <span className="badge amber">Chờ duyệt</span>}
      {p.priority && <span className="badge red">Ưu tiên</span>}
      {p.extra_tracking && <span className="badge blue">Theo dõi thêm</span>}
      {p.label_scale && <span className="badge green">Scale</span>}
      {overdue && <span className="badge red solid">{dueText(p.due_at)}</span>}
      {p.entry_pass === false && <span className="badge gray">Chưa đạt đầu vào</span>}
    </div>
  );
}

function Card({ p, owner, settings, onOpen, draggable }) {
  const days = settings.tracking_days || 3;
  return (
    <article className={'card' + (p.priority ? ' prio' : '')} draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onOpen(p.id)}>
      <div className="card-top">
        <b>{p.code || 'Chưa có mã'}</b>
        <span className="muted">{owner?.full_name || ''}</span>
      </div>
      <div className="card-page">{p.page_name || 'Không rõ page'}</div>
      {p.headline && <div className="card-headline">{p.headline}</div>}
      <Badges p={p} />
      <div className="card-nums">
        <span title="Like">👍 {fmtNum(p.latest_likes)}</span>
        <span title="Comment">💬 {fmtNum(p.latest_comments)}</span>
        <span title="Share">↗ {fmtNum(p.latest_shares)}</span>
      </div>
      {p.status === 'following' && (
        <div className="card-track muted">
          {isTracking(p) ? `Ngày ${Math.min(p.tracking_day, p.extra_tracking ? 99 : days)}${p.extra_tracking ? '' : `/${days}`}` : 'Đã chấm xong'}
          {p.growth_likes !== null && <> · L {fmtPct(p.growth_likes)} · C {fmtPct(p.growth_comments)} · S {fmtPct(p.growth_shares)}</>}
        </div>
      )}
      {p.extra_tracking && p.daily_growth_likes !== null && (
        <div className="daily-g">Hôm trước: L {fmtPct(p.daily_growth_likes)} · C {fmtPct(p.daily_growth_comments)} · S {fmtPct(p.daily_growth_shares)}</div>
      )}
      {p.pending_review && p.due_at && !p.extra_tracking && <div className="muted small">{dueText(p.due_at)} để duyệt</div>}
    </article>
  );
}

export default function Board({ me, settings }) {
  const toast = useToast();
  const { products, people, error, reload, patchLocal } = useProducts();
  const [open, setOpen] = useState(null);
  const [review, setReview] = useState(false);
  const [f, setF] = useState({ text: '', owner: '', pending: false, priority: false, extra: false, overdue: false });
  const [over, setOver] = useState(null);
  const manager = me.role === 'manager';
  const cols = me.role === 'ads' ? STATUSES.filter((s) => POST_APPROVE.includes(s.id)) : STATUSES;

  const list = useMemo(() => {
    if (!products) return [];
    const t = f.text.trim().toLowerCase();
    const now = new Date();
    return products.filter((p) =>
      (!t || [p.code, p.page_name, p.headline, p.ad_content, p.product_url].some((x) => (x || '').toLowerCase().includes(t))) &&
      (!f.owner || p.owner_id === f.owner) &&
      (!f.pending || p.pending_review) && (!f.priority || p.priority) && (!f.extra || p.extra_tracking) &&
      (!f.overdue || (p.pending_review && p.due_at && new Date(p.due_at) < now)));
  }, [products, f]);
  const pendingCount = (products || []).filter((p) => p.pending_review).length;

  async function move(p, to) {
    if (!canMove(me, p, to)) return toast('Bạn không chuyển được mẫu sang cột này', { error: true });
    const from = p.status;
    try {
      const row = await moveProduct(p, to);
      if (!row) return;
      patchLocal(row);
      toast(`${row.code || row.page_name || 'Mẫu'} → ${STATUS_LABEL[to]}`, {
        ms: 5000,
        action: canMove(me, row, from) ? { label: 'Hoàn tác', run: async () => {
          try { patchLocal(await updateProduct(row.id, { status: from })); } catch (e) { toast(e.message, { error: true }); }
        } } : null,
      });
    } catch (e) {
      toast(e.message, { error: true });
      if (to === 'up_store') setOpen(p.id);
    }
  }

  function exportExcel() {
    const head = ['Mã', 'Cột', 'Người tìm', 'Page', 'Link page', 'Link bài', 'Link sản phẩm', 'Headline', 'Description', 'Content',
      'Ads Library', 'Like gốc', 'Comment gốc', 'Share gốc', 'Like mới', 'Comment mới', 'Share mới', '% Like', '% Comment', '% Share',
      'Đạt đầu vào', 'Chờ duyệt', 'Ưu tiên', 'Ngày lưu', 'Cost ($)', 'Link store', 'Campaign', 'Ghi chú'];
    const rows = list.map((p) => [p.code, STATUS_LABEL[p.status], people[p.owner_id]?.full_name, p.page_name, p.page_url, p.post_url,
      p.product_url, p.headline, p.description, p.ad_content, adLibraryFor(p), p.base_likes, p.base_comments, p.base_shares,
      p.latest_likes, p.latest_comments, p.latest_shares, p.growth_likes === null ? null : Number(p.growth_likes),
      p.growth_comments === null ? null : Number(p.growth_comments), p.growth_shares === null ? null : Number(p.growth_shares),
      p.entry_pass === null ? '' : p.entry_pass ? 'Đạt' : 'Chưa', p.pending_review ? 'Có' : '', p.priority ? 'Có' : '',
      fmtDate(p.created_work_date), p.cost_usd === null ? null : Number(p.cost_usd), p.store_url, p.campaign_ref, p.note]);
    download(toXlsx([head, ...rows]), `dropship-hub-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (error) return <div className="center error">{error} <button className="btn" onClick={reload}>Thử lại</button></div>;
  if (!products) return <div className="center muted">Đang tải mẫu…</div>;
  const current = open && products.find((p) => p.id === open);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="board-wrap">
      <div className="filters">
        <input className="search" placeholder="Tìm mã, page, headline, content…" value={f.text} onChange={set('text')} />
        {manager && (
          <select value={f.owner} onChange={set('owner')}>
            <option value="">Mọi người</option>
            {Object.values(people).filter((p) => p.role !== 'ads').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )}
        <label className="chip"><input type="checkbox" checked={f.pending} onChange={set('pending')} /> Chờ duyệt ({pendingCount})</label>
        <label className="chip"><input type="checkbox" checked={f.priority} onChange={set('priority')} /> Ưu tiên</label>
        <label className="chip"><input type="checkbox" checked={f.extra} onChange={set('extra')} /> Theo dõi thêm</label>
        <label className="chip"><input type="checkbox" checked={f.overdue} onChange={set('overdue')} /> Quá hạn</label>
        <span className="grow" />
        {manager && <button className="btn amber" disabled={!pendingCount} onClick={() => setReview(true)}>Duyệt lần lượt ({pendingCount})</button>}
        <button className="btn" onClick={exportExcel}>Xuất Excel</button>
      </div>
      <div className="board">
        {cols.map((c) => {
          const items = list.filter((p) => p.status === c.id)
            .sort((a, b) => (b.pending_review - a.pending_review) || (b.priority - a.priority) || (new Date(b.created_at) - new Date(a.created_at)));
          return (
            <section key={c.id} className={'col' + (over === c.id ? ' over' : '')}
              onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const p = products.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (p) move(p, c.id); }}>
              <h3>{c.label} <span className="count">{items.length}</span></h3>
              <div className="col-body">
                {items.slice(0, 300).map((p) => (
                  <Card key={p.id} p={p} owner={people[p.owner_id]} settings={settings} onOpen={setOpen}
                    draggable={manager || (!!p.code && ['approve', ...POST_APPROVE].includes(p.status))} />
                ))}
                {items.length > 300 && <p className="muted small">Còn {items.length - 300} mẫu, dùng ô tìm kiếm để lọc.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {current && <ProductDrawer key={current.id} p={current} me={me} people={people} settings={settings}
        onClose={() => setOpen(null)} onChanged={patchLocal} onDeleted={() => { setOpen(null); reload(); }} onMove={move} />}
      {review && <ReviewQueue me={me} settings={settings} products={products} people={people}
        onClose={() => setReview(false)} onChanged={patchLocal} />}
    </div>
  );
}
