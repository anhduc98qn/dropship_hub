// Popup: kết nối Supabase → đăng nhập → đọc số ngay / bật tự đọc số
const $ = (id) => document.getElementById(id);
const send = (type, payload = {}) => new Promise((resolve, reject) =>
  chrome.runtime.sendMessage({ type, ...payload }, (res) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    res?.ok ? resolve(res.data) : reject(new Error(res?.error || 'Extension không phản hồi'));
  }));
const ROLE = { manager: 'Quản lý', researcher: 'Tìm mẫu', ads: 'Ads' };

function msg(text, err = false) { $('msg').textContent = text || ''; $('msg').className = 'msg' + (err ? ' err' : ''); }

function render(st) {
  $('v-config').hidden = st.configured;
  $('v-login').hidden = !st.configured || st.loggedIn;
  $('v-main').hidden = !st.loggedIn;
  if (!st.loggedIn) return;
  $('who-name').textContent = st.profile?.full_name || st.user?.email || '';
  $('who-role').textContent = ROLE[st.profile?.role] || '';
  $('server').textContent = st.config?.url?.replace(/^https?:\/\//, '') || '';
  $('c-auto').checked = st.autoEnabled;
  const p = st.progress;
  $('b-run').disabled = !!p?.running;
  $('progress').textContent = !p ? 'Chưa đọc lần nào trên máy này.'
    : p.running ? `Đang đọc: ${p.done || 0}/${p.total || 0} mẫu…`
      : `Lần gần nhất (${new Date(p.at).toLocaleString('vi-VN')}): xong ${p.ok || 0}, lỗi ${p.failed || 0}.` +
        (p.errors?.length ? ' ' + p.errors.slice(0, 2).join(' · ') : '');
}

async function act(fn) {
  msg('');
  try { render(await fn()); } catch (e) { msg(e.message, true); }
}

$('f-config').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  act(() => send('saveConfig', { url: f.url.value, anonKey: f.anonKey.value }));
});
$('f-login').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  act(() => send('login', { email: f.email.value.trim(), password: f.password.value }));
});
$('b-reconfig').addEventListener('click', () => { $('v-config').hidden = false; $('v-login').hidden = true; });
$('b-logout').addEventListener('click', () => act(() => send('logout')));
$('c-auto').addEventListener('change', (e) => act(() => send('setAuto', { enabled: e.target.checked })));
$('b-run').addEventListener('click', async () => {
  $('b-run').disabled = true;
  await send('runNow').catch((e) => msg(e.message, true));
  setTimeout(refresh, 500);
});

async function refresh() { try { render(await send('getState')); } catch (e) { msg(e.message, true); } }
chrome.storage.onChanged.addListener((c) => { if (c.progress || c.session) refresh(); });
refresh();
send('refreshProfile').then(render).catch(() => {});
