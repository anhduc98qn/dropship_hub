// Dropship Hub — service worker: kết nối Supabase, chụp màn hình, tự đọc số mỗi ngày.
importScripts('shared.js');
const D = self.DSH;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
const AUTO_MAX = 3;           // số lần tự đọc tối đa mỗi ngày (cách nhau ≥ 1 giờ) khi còn bài chưa đọc được
const AUTO_GAP = 55 * 60e3;

// ================================================================ cấu hình + phiên đăng nhập
const store = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};
async function getConfig() {
  return (await store.get('config')) || { url: '', anonKey: '' };
}
function checkUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[^/]+$/.test(u) || D.isLocalServer(u)) return u;
  throw new Error('Địa chỉ Supabase phải dạng https://xxxx.supabase.co (http chỉ dùng cho máy chủ test localhost)');
}

class ApiError extends Error {}
async function api(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
  const c = await getConfig();
  if (!c.url || !c.anonKey) throw new ApiError('Chưa kết nối Supabase — mở popup extension để cài đặt');
  const h = { apikey: c.anonKey, ...headers };
  if (auth) h.Authorization = `Bearer ${await accessToken()}`;
  if (body !== undefined && !(body instanceof Blob)) h['Content-Type'] = 'application/json';
  const res = await fetch(c.url + path, { method, headers: h, body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    if (res.status === 401 && auth) await store.set('session', null);
    throw new ApiError(data?.message || data?.msg || data?.error_description || data?.error || `Lỗi ${res.status}`);
  }
  return raw ? res : data;
}

async function saveSession(s) {
  await store.set('session', {
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: Date.now() + (s.expires_in || 3600) * 1000, user: { id: s.user.id, email: s.user.email },
  });
}
let refreshing = null;
async function accessToken() {
  const s = await store.get('session');
  if (!s) throw new ApiError('Chưa đăng nhập — mở popup extension để đăng nhập');
  if (Date.now() < s.expires_at - 120e3) return s.access_token;
  refreshing ||= api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: s.refresh_token } })
    .then(saveSession)
    .catch(async (e) => { await store.set('session', null); throw new ApiError('Phiên đăng nhập hết hạn, đăng nhập lại: ' + e.message); })
    .finally(() => { refreshing = null; });
  await refreshing;
  return (await store.get('session')).access_token;
}
const rpc = (name, args = {}) => api(`/rest/v1/rpc/${name}`, { method: 'POST', body: args });

async function loadProfile() {
  const s = await store.get('session');
  const [profile] = await api(`/rest/v1/profiles?id=eq.${s.user.id}&select=full_name,role,staff_code,active`);
  const [settings] = await api('/rest/v1/app_settings?select=entry_ratio,entry_required,tracking_days,day_start_hour,timezone');
  await store.set('profile', profile || null);
  await store.set('settings', settings || {});
  return { profile, settings };
}

async function getState() {
  const [config, session, profile, settings, progress, auto] = await Promise.all(
    ['config', 'session', 'profile', 'settings', 'progress', 'autoEnabled'].map(store.get));
  return {
    configured: !!(config?.url && config?.anonKey),
    loggedIn: !!session,
    config: config ? { url: config.url } : null,
    user: session?.user || null,
    profile: profile || null,
    settings: settings || {},
    progress: progress || null,
    autoEnabled: auto !== false,
  };
}

// ================================================================ lưu ảnh (Supabase Storage)
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
async function dataUrlToBlob(dataUrl) { return (await fetch(dataUrl)).blob(); }
async function upload(path, dataUrl) {
  const blob = await dataUrlToBlob(dataUrl);
  await api(`/storage/v1/object/screenshots/${path}`, {
    method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'image/webp', 'x-upsert': 'true' },
  });
  return path;
}

async function saveProduct({ fields, image }) {
  const s = await store.get('session');
  const id = crypto.randomUUID();
  let screenshot_path = '';
  let warn = '';
  if (image) {
    try { screenshot_path = await upload(`${s.user.id}/${id}/${stamp()}.webp`, image); }
    catch (e) { warn = 'Đã lưu mẫu nhưng chưa tải được ảnh: ' + e.message; }
  }
  await rpc('save_product', { p: { ...fields, id, screenshot_path } });
  const settings = (await store.get('settings')) || {};
  if (D.entryPass(fields.likes, fields.comments, fields.shares, Number(settings.entry_ratio || 3)) === false) {
    warn = (warn ? warn + ' ' : '') + 'Mẫu chưa đạt tiêu chí đầu vào, vẫn được theo dõi 3 ngày.';
  }
  return { id, warn };
}

// ================================================================ chụp màn hình (ghép nhiều khung trên OffscreenCanvas)
// Chrome cho tối đa 2 lần captureVisibleTab mỗi giây → tự giãn cách ở đây, content script không phải chờ cố định.
const captures = new Map();
let lastCapture = 0;
async function captureTab(windowId) {
  const wait = lastCapture + 510 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCapture = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
  return createImageBitmap(await dataUrlToBlob(dataUrl));
}
function capStart({ id, width, height, maxWidth = 720 }) {
  const scale = Math.min(1, maxWidth / width);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  captures.set(id, { canvas, ctx, scale, at: Date.now() });
  for (const [k, v] of captures) if (Date.now() - v.at > 5 * 60e3) captures.delete(k); // dọn ảnh bị bỏ dở
  return true;
}
// Một lần chụp, vẽ 1 hoặc nhiều vùng (regions) vào ảnh ghép. destX: vẽ lệch sang phải (ghép 2 vùng cạnh nhau)
async function capSeg({ id, viewportWidth, regions, ...one }, sender) {
  const cap = captures.get(id);
  if (!cap) throw new Error('Phiên chụp đã hết hạn');
  const bmp = await captureTab(sender.tab.windowId);
  const k = bmp.width / viewportWidth;
  for (const { left, top, width, from, to, destX = 0 } of regions || [one]) {
    const h = to - from;
    cap.ctx.drawImage(bmp, left * k, top * k, width * k, h * k, destX * cap.scale, from * cap.scale, width * cap.scale, h * cap.scale);
  }
  bmp.close();
  return true;
}
// Chiều cao vùng nhìn thấy thật (px CSS) — nhỏ hơn innerHeight khi trang bị phóng to/thu nhỏ
async function capProbe({ viewportWidth }, sender) {
  const bmp = await captureTab(sender.tab.windowId);
  const h = bmp.height / (bmp.width / viewportWidth);
  bmp.close();
  return h;
}
async function capEnd({ id }) {
  const cap = captures.get(id);
  if (!cap) throw new Error('Phiên chụp đã hết hạn');
  captures.delete(id);
  const blob = await cap.canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

// ================================================================ chẩn đoán (chỉ máy chủ test trên máy)
async function debugDump(payload) {
  const c = await getConfig();
  if (!D.isLocalServer(c.url)) return false;
  fetch(c.url + '/__dump', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
  return true;
}

// ================================================================ đọc số mỗi ngày
function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message: String(message).slice(0, 400) });
}
const setProgress = (p) => store.set('progress', { ...p, at: Date.now() });

function waitComplete(tabId, ms = 30000) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const t = setTimeout(done, ms);
    chrome.tabs.onUpdated.addListener(fn);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete' && tab.url !== 'about:blank') done(); }).catch(done);
  });
}
// Content script có thể chưa sẵn sàng ngay khi trang vừa tải xong → thử lại vài lần
async function sendWithRetry(tabId, msg, tries = 15) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await chrome.tabs.sendMessage(tabId, msg); }
    catch (e) { last = e; await sleep(700); }
  }
  throw new Error('Trang Facebook không phản hồi (' + (last?.message || 'không rõ') + ')');
}

let running = false;
// final = false: chưa phải lần thử cuối trong ngày → bài không đọc được số nào thì KHÔNG ghi (lần sau thử lại)
async function runDailyUpdate({ auto = false, final = true } = {}) {
  if (running) throw new Error('Đang đọc số, đợi lượt hiện tại xong');
  running = true;
  let win = null;
  let ok = 0, failed = 0;
  const errors = [];
  try {
    const s = await store.get('session');
    if (!s) throw new Error('Chưa đăng nhập');
    const queue = (await rpc('get_tracking_queue')) || [];
    const total = queue.length;
    await rpc('checkin_start');
    await setProgress({ running: true, done: 0, total, ok, failed, auto });
    if (total && auto) notify('Dropship Hub đang tự đọc số', `${total} mẫu đang theo dõi. Một cửa sổ sẽ tự mở từng bài — đừng đóng, thu nhỏ hay để cửa sổ khác che lên cho tới khi xong.`);

    if (total) {
      win = await chrome.windows.create({ url: 'about:blank', focused: true, width: 1180, height: 1000, type: 'normal' });
      const tabId = win.tabs[0].id;
      const t0 = Date.now();
      const timing = [];
      let done = 0;
      const finish = async () => {
        done++;
        await setProgress({ running: true, done, total, ok, failed, auto });
        chrome.action.setBadgeText({ text: `${done}/${total}` });
      };
      // Tải ảnh lên + ghi số chạy nền, song song với việc mở bài kế tiếp
      const saveOne = async (item, res) => {
        const { likes, comments, shares } = res.counts;
        if (likes === null && comments === null && shares === null && !final) {
          failed++;
          errors.push(`${item.page_name || item.post_url}: chưa đọc được số, sẽ tự thử lại sau 1 giờ`);
          return;
        }
        let path = null;
        if (res.image) path = await upload(`${s.user.id}/${item.id}/${stamp()}.webp`, res.image).catch(() => null);
        await rpc('record_snapshot', {
          p_product_id: item.id, p_likes: likes, p_comments: comments, p_shares: shares, p_screenshot_path: path, p_source: 'dom',
        });
        if (likes === null && comments === null && shares === null) {
          failed++;
          errors.push(`${item.page_name || item.post_url}: không đọc được số, hãy sửa tay trên web`);
        } else ok++;
      };
      const saves = [];
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        const ts = Date.now();
        try {
          await chrome.tabs.update(tabId, { url: D.readUrl(item.post_url) });
          await waitComplete(tabId);
          await sleep(rand(800, 1600)); // content script tự chờ khung bài; nghỉ ngắn cho giống người dùng thật
          const res = await sendWithRetry(tabId, { type: 'scrapePost' });
          if (!res?.ok) throw new Error(res?.error || 'Không đọc được bài');
          timing.push({ bai: item.page_name, giay: +((Date.now() - ts) / 1000).toFixed(1) });
          saves.push(saveOne(item, res)
            .catch((e) => { failed++; errors.push(`${item.page_name || item.post_url}: ${e.message}`); })
            .then(finish));
        } catch (e) {
          failed++;
          errors.push(`${item.page_name || item.post_url}: ${e.message}`);
          await finish();
        }
        if (i < queue.length - 1) await sleep(rand(1500, 3000)); // nghỉ ngẫu nhiên giữa các bài
      }
      await Promise.all(saves);
      debugDump({ html: '', text: '', url: '', kind: 'doc-so-thoi-gian', data: { tong_giay: +((Date.now() - t0) / 1000).toFixed(1), bai: timing } });
    }
    await rpc('checkin_finish', { p_ok: ok, p_failed: failed });
    if (total || !auto) {
      notify('Dropship Hub: đã đọc số hôm nay',
        !total ? 'Không có mẫu nào cần đọc số hôm nay.'
          : `Xong ${ok}/${total} mẫu.` + (errors.length ? ' Lỗi: ' + errors.slice(0, 3).join(' · ') : ''));
    }
    return { total, ok, failed, errors };
  } catch (e) {
    notify('Dropship Hub: lỗi đọc số', e.message);
    throw e;
  } finally {
    running = false;
    if (win) chrome.windows.remove(win.id).catch(() => {});
    chrome.action.setBadgeText({ text: '' });
    await setProgress({ running: false, ok, failed, errors: errors.slice(0, 10) });
  }
}

// Tự đọc số: khi mở Chrome và mỗi giờ; tối đa AUTO_MAX lần/ngày khi còn mẫu chưa đọc được
async function autoTick() {
  if ((await store.get('autoEnabled')) === false || running) return;
  if (!(await store.get('session'))) return;
  const settings = (await store.get('settings')) || {};
  const today = D.workDate(new Date(), settings.timezone || 'Asia/Ho_Chi_Minh', settings.day_start_hour ?? 7);
  let st = (await store.get('autoState')) || {};
  if (st.day !== today) st = { day: today, tries: 0, last: 0 };
  if (st.tries >= AUTO_MAX || Date.now() - st.last < AUTO_GAP) return;
  let queue;
  try { queue = await rpc('get_tracking_queue'); } catch (e) { return; }
  if (!queue?.length) return;
  await store.set('autoState', { day: today, tries: st.tries + 1, last: Date.now() });
  await runDailyUpdate({ auto: true, final: st.tries + 1 >= AUTO_MAX }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('auto', { delayInMinutes: 1, periodInMinutes: 60 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('auto', { delayInMinutes: 1, periodInMinutes: 60 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'auto') autoTick(); });

// ================================================================ lệnh từ popup / content script
const handlers = {
  getState,
  async saveConfig({ url, anonKey }) {
    const clean = checkUrl(url);
    if (!String(anonKey || '').trim()) throw new Error('Thiếu khóa công khai (anon key)');
    await store.set('config', { url: clean, anonKey: String(anonKey).trim() });
    await store.set('session', null);
    return getState();
  },
  async login({ email, password }) {
    const s = await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
    await saveSession(s);
    const { profile } = await loadProfile();
    if (!profile?.active) { await store.set('session', null); throw new Error('Tài khoản chưa được quản lý kích hoạt'); }
    return getState();
  },
  async logout() {
    await api('/auth/v1/logout', { method: 'POST' }).catch(() => {});
    await chrome.storage.local.remove(['session', 'profile', 'autoState']);
    return getState();
  },
  async refreshProfile() { await loadProfile(); return getState(); },
  checkDuplicate: ({ post_key, content_hash, product_key }) =>
    rpc('check_duplicate', { p_post_key: post_key, p_content_hash: content_hash, p_product_key: product_key }),
  saveProduct,
  async runNow() { runDailyUpdate({ auto: false, final: true }).catch(() => {}); return true; },
  async setAuto({ enabled }) { await store.set('autoEnabled', !!enabled); return getState(); },
  capStart, capSeg, capProbe, capEnd,
  // Cửa sổ đọc số bị che/thu nhỏ → đưa lên trước (Facebook chỉ vẽ nội dung khi cửa sổ hiển thị)
  async focusMe(_a, sender) {
    if (sender?.tab?.windowId) await chrome.windows.update(sender.tab.windowId, { focused: true, state: 'normal' }).catch(() => {});
    return true;
  },
  debugDump,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg, sender))
    .then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});
