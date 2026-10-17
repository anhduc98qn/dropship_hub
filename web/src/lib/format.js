export const STATUSES = [
  { id: 'following', label: 'Following' },
  { id: 'fails', label: 'Fails' },
  { id: 'approve', label: 'Approve' },
  { id: 'up_store', label: 'Up Store' },
  { id: 'up_campaign', label: 'Up Campaign' },
  { id: 'campaign_fails', label: 'Campaign Fails' },
  { id: 'scale_winning', label: 'Scale / Winning' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
export const POST_APPROVE = ['up_store', 'up_campaign', 'campaign_fails', 'scale_winning'];
export const ROLE_LABEL = { manager: 'Quản lý', researcher: 'Tìm mẫu', ads: 'Ads' };

const nf = new Intl.NumberFormat('vi-VN');
export const fmtNum = (n) => (n === null || n === undefined ? '–' : nf.format(n));
export const fmtPct = (n) => (n === null || n === undefined ? '–' : `${n > 0 ? '+' : ''}${Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`);
export const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('vi-VN') : '–');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '–');
export const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

// Ngày làm việc (giờ VN, đổi ngày lúc 7:00) dạng YYYY-MM-DD — giống public.work_date()
export function workDate(date = new Date(), tz = 'Asia/Ho_Chi_Minh', dayStartHour = 7) {
  const shifted = new Date(date.getTime() - dayStartHour * 3600e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}
export const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400e3);

// Đang được đọc số mỗi ngày
export const isTracking = (p) => p.status === 'following' && (!p.tracking_done || p.extra_tracking);

// Tên campaign: DS0001_TEST_LINH_261013 (mã mẫu _ TEST _ mã NV người tìm _ ngày yyMMdd)
export function campaignName(p, staffCode) {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return [p.code || 'DS????', 'TEST', (staffCode || 'NV').toUpperCase(), ymd].join('_');
}

export function dueText(dueAt) {
  if (!dueAt) return '';
  const ms = new Date(dueAt) - Date.now();
  const h = Math.round(Math.abs(ms) / 3600e3);
  return ms < 0 ? `Quá hạn ${h}h` : `Còn ${h}h`;
}
