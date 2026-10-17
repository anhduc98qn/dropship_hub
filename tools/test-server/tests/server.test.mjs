// Test máy chủ test bằng đúng thư viện supabase-js mà web dùng: đăng ký, phân quyền, lưu mẫu, ảnh, đọc số, đổi cột.
// Cần cài thư viện web trước (npm run build:web); chưa cài thì bỏ qua.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const hasSb = existsSync(join(ROOT, 'web/node_modules/@supabase/supabase-js'));

test('máy chủ test: luồng đầy đủ qua supabase-js', { skip: !hasSb && 'chưa cài thư viện web', timeout: 120000 }, async () => {
  const { createClient } = createRequire(join(ROOT, 'web/package.json'))('@supabase/supabase-js');
  const dir = mkdtempSync(join(tmpdir(), 'dsh-'));
  const PORT = 18000 + Math.floor(Math.random() * 1000);
  const URL_ = 'http://localhost:' + PORT;
  const srv = spawn(process.execPath, [join(ROOT, 'tools/test-server/server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'pipe' });
  try {
    await new Promise((ok, bad) => { srv.stdout.on('data', (d) => /dang chay/.test(d) && ok()); srv.on('exit', () => bad(new Error('server exited'))); });
    const mk = () => createClient(URL_, 'test', { auth: { persistSession: false } });
    const ok = (label, v) => assert.ok(v, label);
    const boss = mk(), linh = mk();
    let r = await boss.auth.signUp({ email: 'boss@test.local', password: '123456', options: { data: { full_name: 'Sếp' } } });
    ok('signup boss ' + (r.error?.message || ''), !r.error && r.data.session);
    r = await linh.auth.signUp({ email: 'linh@test.local', password: '123456', options: { data: { full_name: 'Linh' } } });
    ok('signup linh', !r.error);
    r = await linh.auth.signInWithPassword({ email: 'linh@test.local', password: '123456' });
    ok('login linh', !r.error);
    const lid = r.data.user.id;
    const me = await boss.from('profiles').select('*').order('created_at');
    ok('profiles: ' + me.data?.map((p) => p.full_name + '/' + p.role).join(','), me.data?.[0].role === 'manager');
    r = await boss.from('profiles').update({ staff_code: 'linh' }).eq('id', lid).select();
    ok('manager sets staff code -> ' + r.data?.[0]?.staff_code, r.data?.[0]?.staff_code === 'LINH');
    r = await linh.from('profiles').update({ role: 'manager' }).eq('id', lid).select();
    ok('linh cannot self-promote: ' + r.error?.message, !!r.error);
    // upload + save
    const img = Buffer.from('RIFF0000WEBPVP8 ', 'binary');
    const pid = crypto.randomUUID();
    r = await linh.storage.from('screenshots').upload(`${lid}/${pid}/a.webp`, img, { contentType: 'image/webp', upsert: true });
    ok('upload ' + (r.error?.message || ''), !r.error);
    r = await linh.rpc('save_product', { p: { id: pid, post_url: 'https://www.facebook.com/story.php?story_fbid=1&id=2', post_key: 'fb:1', page_name: 'Shop A', likes: 900, comments: 150, shares: 150, ad_content: 'Hello world', screenshot_path: `${lid}/${pid}/a.webp` } });
    ok('save_product -> ' + JSON.stringify(r.data) + (r.error?.message || ''), r.data === pid);
    r = await linh.rpc('save_product', { p: { post_url: 'https://x', post_key: 'fb:1' } });
    ok('duplicate: ' + r.error?.message, /TRÙNG/.test(r.error?.message || ''));
    r = await linh.rpc('check_duplicate', { p_post_key: 'fb:1', p_content_hash: null, p_product_key: null });
    ok('check_duplicate rows=' + r.data?.length, r.data?.length === 1);
    r = await linh.rpc('get_tracking_queue');
    ok('queue today empty (saved today) n=' + r.data?.length, Array.isArray(r.data) && r.data.length === 0);
    r = await linh.storage.from('screenshots').createSignedUrl(`${lid}/${pid}/a.webp`, 3600);
    const got = r.data && await fetch(r.data.signedUrl);
    ok('signed url fetch ' + r.data?.signedUrl, got?.ok && (await got.arrayBuffer()).byteLength === img.length);
    await fetch(URL_ + '/__dev/lui-ngay?days=1', { method: 'POST' });
    r = await linh.rpc('get_tracking_queue');
    ok('queue after 1 day n=' + r.data?.length, r.data?.length === 1);
    r = await linh.rpc('record_snapshot', { p_product_id: pid, p_likes: 1000, p_comments: 200, p_shares: 170, p_screenshot_path: null, p_source: 'dom' });
    ok('record_snapshot ' + (r.error?.message || ''), !r.error);
    r = await linh.from('product_snapshots').select('*').eq('product_id', pid).order('day_index');
    ok('snapshots n=' + r.data?.length, r.data?.length === 2);
    r = await linh.from('products').update({ status: 'approve' }).eq('id', pid).select();
    ok('researcher cannot approve: ' + r.error?.message, !!r.error);
    r = await boss.from('products').update({ status: 'approve' }).eq('id', pid).select();
    ok('manager approve code=' + r.data?.[0]?.code, r.data?.[0]?.code === 'DS0001');
    r = await linh.from('products').update({ status: 'up_store' }).eq('id', pid).select();
    ok('up_store needs cost: ' + r.error?.message, /Cost/.test(r.error?.message || ''));
    r = await linh.from('products').update({ cost_usd: 4.5, store_url: 'https://store/x' }).eq('id', pid).select();
    ok('fill cost', r.data?.[0]?.cost_usd === 4.5);
    r = await linh.from('products').update({ status: 'up_store' }).eq('id', pid).select();
    ok('up_store ok', r.data?.[0]?.status === 'up_store');
    r = await boss.rpc('kpi', { p_days: 7 });
    ok('kpi rows=' + r.data?.length, r.data?.length >= 1);
    r = await linh.rpc('kpi', { p_days: 7 });
    ok('kpi denied for researcher', !!r.error);
    r = await boss.from('app_settings').update({ daily_target: 9 }).eq('id', 1).select();
    ok('settings update', r.data?.[0]?.daily_target === 9);
    r = await boss.from('products').delete().eq('id', pid);
    ok('delete ' + (r.error?.message || ''), !r.error);
    const dbg = await (await fetch(URL_ + '/__debug')).json();
    ok('debug telegram msgs=' + dbg.telegram.length + ' products=' + dbg.products.length, dbg.products.length === 0);
    const html = await (await fetch(URL_ + '/')).text();
    ok('web served', /<div id="root">/.test(html) || /Chưa build/.test(html));
  } finally {
    srv.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
