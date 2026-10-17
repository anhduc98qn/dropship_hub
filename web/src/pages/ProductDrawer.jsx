import React, { useEffect, useState } from 'react';
import { supabase, q, rpc } from '../lib/supabase.js';
import { updateProduct } from '../lib/useProducts.js';
import { STATUSES, STATUS_LABEL, POST_APPROVE, fmtNum, fmtPct, fmtDate, fmtDateTime, campaignName, isUrl } from '../lib/format.js';
import { adLibraryFor, adLibraryUrl } from '../lib/adlib.js';
import { normalizeText, sha256, productKey } from '../lib/text.js';
import { useToast } from '../components/Toast.jsx';
import GrowthChart from '../components/GrowthChart.jsx';
import Shot from '../components/Shot.jsx';
import { Badges, canMove } from './Board.jsx';

const SOURCE = { dom: 'Extension', ai: 'AI đọc ảnh', manual: 'Sửa tay' };

export function useSnapshots(id, version) {
  const [snaps, setSnaps] = useState([]);
  useEffect(() => {
    let on = true;
    q(supabase.from('product_snapshots').select('*').eq('product_id', id).order('day_index')).then((r) => on && setSnaps(r)).catch(() => {});
    return () => { on = false; };
  }, [id, version]);
  return snaps;
}

function SnapRow({ s, canEdit, onSaved }) {
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  async function save() {
    const n = (v) => (v === '' ? null : parseInt(v, 10));
    try {
      await rpc('update_snapshot', { p_snapshot_id: s.id, p_likes: n(edit.likes), p_comments: n(edit.comments), p_shares: n(edit.shares) });
      setEdit(null);
      onSaved();
    } catch (e) { toast(e.message, { error: true }); }
  }
  if (edit) {
    const inp = (k) => <input type="number" min="0" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />;
    return (
      <tr className="editing"><td>N{s.day_index}</td><td>{fmtDate(s.work_date)}</td><td>{inp('likes')}</td><td>{inp('comments')}</td><td>{inp('shares')}</td>
        <td colSpan="2"><button className="btn sm primary" onClick={save}>Lưu</button> <button className="btn sm" onClick={() => setEdit(null)}>Hủy</button></td></tr>
    );
  }
  return (
    <tr>
      <td>N{s.day_index}</td><td>{fmtDate(s.work_date)}</td>
      <td>{fmtNum(s.likes)}</td><td>{fmtNum(s.comments)}</td><td>{fmtNum(s.shares)}</td>
      <td className="muted small">{SOURCE[s.source] || s.source}</td>
      <td>{canEdit && <button className="btn sm" onClick={() => setEdit({ likes: s.likes, comments: s.comments, shares: s.shares })}>Sửa số</button>}</td>
    </tr>
  );
}

export default function ProductDrawer({ p, me, people, settings, onClose, onChanged, onDeleted, onMove }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const snaps = useSnapshots(p.id, `${version}-${p.updated_at}`);
  const [shot, setShot] = useState(null);
  const manager = me.role === 'manager';
  const mine = p.owner_id === me.id;
  const canEditAd = manager || (me.role === 'researcher' && mine);
  const canEditStore = manager || (mine && me.role === 'researcher');
  const owner = people[p.owner_id];
  const [ad, setAd] = useState(() => pick(p));
  const [store, setStore] = useState({ cost_usd: p.cost_usd ?? '', store_url: p.store_url || '', campaign_ref: p.campaign_ref || '' });
  const [busy, setBusy] = useState(false);
  const days = settings.tracking_days || 3;

  function pick(x) {
    return { page_name: x.page_name || '', page_url: x.page_url || '', product_url: x.product_url || '', headline: x.headline || '',
      description: x.description || '', ad_content: x.ad_content || '', ad_library_url: x.ad_library_url || '', note: x.note || '' };
  }
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !e.target.closest?.('input, textarea') && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function run(fn, okText) {
    setBusy(true);
    try { const row = await fn(); if (row) onChanged(row); if (okText) toast(okText); } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  }

  const saveAd = () => run(async () => {
    if (!canEditAd) return updateProduct(p.id, { note: ad.note.trim() || null }); // Ads chỉ sửa ghi chú
    const patch = { ...ad };
    for (const k of Object.keys(patch)) patch[k] = patch[k].trim() || null;
    if (patch.ad_content !== (p.ad_content || null)) {
      patch.content_hash = patch.ad_content ? await sha256(normalizeText(patch.ad_content)) : null;
      // link Ads Library tự tạo theo content, trừ khi đã sửa tay
      if ((ad.ad_library_url || '') === (p.ad_library_url || '')) patch.ad_library_url = adLibraryUrl(patch.ad_content);
    }
    patch.product_key = patch.product_url ? productKey(patch.product_url) : null;
    return updateProduct(p.id, patch);
  }, 'Đã lưu thông tin quảng cáo');

  const saveStore = () => run(() => {
    const cost = store.cost_usd === '' ? null : Number(store.cost_usd);
    if (cost !== null && !(cost >= 0)) throw new Error('Cost phải là số');
    if (store.store_url && !isUrl(store.store_url)) throw new Error('Link store phải bắt đầu bằng http(s)://');
    const patch = me.role === 'ads' ? { campaign_ref: store.campaign_ref || null }
      : { cost_usd: cost, store_url: store.store_url.trim() || null, campaign_ref: store.campaign_ref.trim() || null };
    return updateProduct(p.id, patch);
  }, 'Đã lưu');

  const setFlag = (patch, text) => run(() => updateProduct(p.id, patch), text);
  async function del() {
    if (!window.confirm('Xóa hẳn mẫu này cùng các lần đọc số? Không hoàn tác được.')) return;
    try { await q(supabase.from('products').delete().eq('id', p.id)); toast('Đã xóa mẫu'); onDeleted(); } catch (e) { toast(e.message, { error: true }); }
  }
  const copy = (t) => navigator.clipboard.writeText(t).then(() => toast('Đã copy: ' + t));
  const targets = STATUSES.filter((s) => canMove(me, p, s.id));
  const showStore = p.code || ['approve', ...POST_APPROVE].includes(p.status);
  const camp = campaignName(p, owner?.staff_code);
  const lastShot = [...snaps].reverse().find((s) => s.screenshot_path)?.screenshot_path || p.screenshot_path;
  const field = (k, label, el = 'input') => (
    <label>{label}{el === 'textarea'
      ? <textarea rows="5" value={ad[k]} disabled={!canEditAd} onChange={(e) => setAd({ ...ad, [k]: e.target.value })} />
      : <input value={ad[k]} disabled={!canEditAd} onChange={(e) => setAd({ ...ad, [k]: e.target.value })} />}</label>
  );

  return (
    <div className="drawer-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" aria-label="Chi tiết mẫu">
        <header>
          <div>
            <h2>{p.code || 'Chưa có mã'} · {STATUS_LABEL[p.status]}</h2>
            <div className="muted small">{owner?.full_name} · lưu {fmtDateTime(p.created_at)}</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Đóng">×</button>
        </header>
        <div className="drawer-body">
          <Badges p={p} />
          {p.headline && <div className="drawer-headline">{p.headline}</div>}
          <div className="links">
            <a href={p.post_url} target="_blank" rel="noreferrer">Xem bài</a>
            {p.product_url && <a href={p.product_url} target="_blank" rel="noreferrer">Link sản phẩm</a>}
            {p.store_url && <a href={p.store_url} target="_blank" rel="noreferrer">Link store</a>}
            {adLibraryFor(p) && <a href={adLibraryFor(p)} target="_blank" rel="noreferrer">Ads Library (US, đang chạy)</a>}
            {p.page_url && <a href={p.page_url} target="_blank" rel="noreferrer">Page</a>}
          </div>

          {(targets.length > 0 || manager) && (
            <div className="actions">
              {manager && p.status === 'following' && <>
                <button className="btn green" disabled={busy} onClick={() => onMove(p, 'approve')}>Approve</button>
                <button className="btn red" disabled={busy} onClick={() => onMove(p, 'fails')}>Fails</button>
                {p.tracking_done && <button className="btn blue" disabled={busy} onClick={() => setFlag({ extra_tracking: !p.extra_tracking },
                  p.extra_tracking ? 'Đã bỏ Theo dõi thêm' : 'Đã gắn Theo dõi thêm')}>{p.extra_tracking ? 'Bỏ Theo dõi thêm' : 'Theo dõi thêm'}</button>}
              </>}
              {manager && ['up_campaign', 'scale_winning'].includes(p.status) && !p.label_scale &&
                <button className="btn amber" disabled={busy} onClick={() => setFlag({ label_scale: true }, 'Đã gắn nhãn Scale và báo Ads')}>Gắn nhãn Scale và báo Ads</button>}
              {targets.length > 0 && (
                <select value="" onChange={(e) => e.target.value && onMove(p, e.target.value)} disabled={busy}>
                  <option value="">Chuyển sang cột…</option>
                  {targets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              )}
            </div>
          )}
          {p.extra_tracking && <p className="note extra">Theo dõi thêm: extension đọc số mỗi ngày tới khi thẻ rời Following; mỗi lần so với lần đọc trước, đạt thì tự lên Chờ duyệt.</p>}
          {p.status === 'fails' && p.fail_reason && <p className="note">Lý do Fails: {p.fail_reason}</p>}

          {showStore && (
            <section>
              <h3>Lên store / campaign</h3>
              <div className="g3">
                <label>Cost ($)<input type="number" min="0" step="0.01" value={store.cost_usd} disabled={!canEditStore} onChange={(e) => setStore({ ...store, cost_usd: e.target.value })} /></label>
                <label className="span2">Link sản phẩm trên store<input value={store.store_url} disabled={!canEditStore} onChange={(e) => setStore({ ...store, store_url: e.target.value })} /></label>
              </div>
              <label>Campaign / ghi chú Ads<input value={store.campaign_ref} onChange={(e) => setStore({ ...store, campaign_ref: e.target.value })} /></label>
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={saveStore}>Lưu</button>
                {p.code && <button className="btn" onClick={() => copy(camp)}>Copy tên campaign: <code>{camp}</code></button>}
              </div>
            </section>
          )}

          <section>
            <h3>Số đo mỗi ngày</h3>
            <div className="nums-summary">
              <div><b>Gốc</b> 👍 {fmtNum(p.base_likes)} · 💬 {fmtNum(p.base_comments)} · ↗ {fmtNum(p.base_shares)}</div>
              <div><b>Mới nhất</b> 👍 {fmtNum(p.latest_likes)} · 💬 {fmtNum(p.latest_comments)} · ↗ {fmtNum(p.latest_shares)}</div>
              <div className="growth"><b>Tăng</b> L {fmtPct(p.growth_likes)} · C {fmtPct(p.growth_comments)} · S {fmtPct(p.growth_shares)}
                {p.growth_pass !== null && <> · {p.growth_pass ? 'Đạt' : 'Không đạt'}</>}</div>
              {p.status === 'following' && <div className="muted small">Ngày {p.tracking_day}{p.extra_tracking ? '' : `/${days}`}{p.tracking_done ? ' · đã chấm' : ''}</div>}
            </div>
            <GrowthChart snaps={snaps} />
            <table className="snaps">
              <thead><tr><th>Ngày</th><th>Ngày làm việc</th><th>Like</th><th>Comment</th><th>Share</th><th>Nguồn</th><th /></tr></thead>
              <tbody>{snaps.map((s) => <SnapRow key={s.id} s={s} canEdit={manager || mine} onSaved={() => setVersion((v) => v + 1)} />)}</tbody>
            </table>
            <div className="thumbs">
              {snaps.filter((s) => s.screenshot_path).map((s) => (
                <button key={s.id} className={'thumb' + ((shot || lastShot) === s.screenshot_path ? ' on' : '')} onClick={() => setShot(s.screenshot_path)}>N{s.day_index}</button>
              ))}
            </div>
            <Shot path={shot || lastShot} className="shot big" />
          </section>

          <section>
            <h3>Nội dung quảng cáo</h3>
            <div className="g2">{field('page_name', 'Tên page')}{field('page_url', 'Link page')}</div>
            {field('product_url', 'Link sản phẩm')}
            {field('headline', 'Headline')}
            {field('description', 'Description')}
            {field('ad_content', 'Content', 'textarea')}
            {field('ad_library_url', 'Link Ads Library')}
            <label>Ghi chú<input value={ad.note} onChange={(e) => setAd({ ...ad, note: e.target.value })} /></label>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={saveAd}>Lưu nội dung</button>
              {(manager || (mine && p.status === 'following')) && <button className="btn red ghost" onClick={del}>Xóa mẫu</button>}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
