// Test database: chạy schema.sql thật trong PGlite (không cần cài PostgreSQL / Supabase).
// Chạy: npm test  (ở thư mục gốc dự án)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

const A = '00000000-0000-0000-0000-00000000000a'; // quản lý (người đăng ký đầu tiên)
const B = '00000000-0000-0000-0000-00000000000b'; // tìm mẫu
const C = '00000000-0000-0000-0000-00000000000c'; // ads
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';

async function setup() {
  const db = new PGlite({ parsers: { 1082: (v) => v, 1700: Number } });
  await db.exec(read('tests/supabase_stub.sql'));
  const schema = read('schema.sql').replace(/^create extension.*$/gim, '');
  await db.exec(schema);
  await db.exec(schema); // chạy lại lần 2 được (dùng để nâng cấp)
  await db.exec(`insert into auth.users (id,email,raw_user_meta_data) values
    ('${A}','boss@x','{"full_name":"Sếp"}'),('${B}','linh@x','{"full_name":"Linh"}'),('${C}','hoa@x','{"full_name":"Hoa"}');
    update public.app_secrets set telegram_bot_token='T'; update public.app_settings set telegram_chat_id='-1';`);
  const as = (u) => db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${u}',false);`);
  const sys = (sql) => db.exec(`reset role; ${sql}`);
  // Giả lập "đã sang ngày mới": lùi ngày bắt đầu theo dõi và ngày của các lần đọc số
  const shift = (id) => sys(`update public.products set tracking_start_date=tracking_start_date-1, created_work_date=created_work_date-1 where id='${id}';
    update public.product_snapshots set work_date=work_date-1 where product_id='${id}'`);
  const row = async (id) => (await db.query(`select * from public.products where id=$1`, [id])).rows[0];
  const err = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };
  const val = async (sql, p) => Object.values((await db.query(sql, p)).rows[0] || {})[0];
  const tg = async () => { await db.exec('reset role'); return (await db.query(`select body->>'text' t from net.sent order by id`)).rows.map((r) => r.t); };
  await as(A);
  await db.exec(`update public.profiles set role='researcher', staff_code='linh' where id='${B}';
                 update public.profiles set role='ads', staff_code='HOA' where id='${C}';`);
  return { db, as, sys, shift, row, err, val, tg };
}

const save = (db, id, key, l, c, s, extra = {}) =>
  db.query(`select public.save_product($1::jsonb)`, [JSON.stringify({ id, post_url: 'https://fb.com/' + key, post_key: key, likes: l, comments: c, shares: s, ...extra })]);

// Ghi số 3 ngày liên tiếp cho các mẫu
async function track(t, plan) {
  const n = Object.values(plan)[0].length;
  for (let k = 0; k < n; k++) {
    for (const [id, days] of Object.entries(plan)) {
      await t.shift(id); await t.as(B);
      await t.db.query(`select public.record_snapshot($1,$2,$3,$4,null,'dom')`, [id, ...days[k]]);
    }
  }
}

test('vai trò: người đầu tiên là quản lý, chống tự nâng quyền', async () => {
  const t = await setup();
  assert.equal(await t.val(`select role from public.profiles where id='${A}'`), 'manager');
  assert.equal(await t.val(`select staff_code from public.profiles where id='${B}'`), 'LINH');
  await t.as(B);
  assert.match(await t.err(`update public.profiles set role='manager' where id='${B}'`), /Chỉ quản lý/);
  assert.equal(await t.err(`update public.profiles set full_name='Linh Nguyễn', telegram_username='linhng' where id='${B}'`), null);
  // không đọc được token Telegram
  assert.match(await t.err(`select * from public.app_secrets`), /permission denied/);
});

test('lưu mẫu: Ngày 0, trùng bài, tiêu chí đầu vào, link Ads Library', async () => {
  const t = await setup();
  await t.as(B);
  await save(t.db, P1, 'k1', 1000, 100, 100, {
    ad_library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=%22abc%22',
  });
  const p = await t.row(P1);
  assert.equal(p.owner_id, B);
  assert.equal(p.status, 'following');
  assert.equal(p.entry_pass, false); // (100+100)*3 < 1000
  assert.match(p.ad_library_url, /active_status=active/);
  assert.match(p.ad_library_url, /country=US/);
  assert.equal(await t.val(`select count(*)::int from public.product_snapshots where product_id='${P1}' and day_index=0`), 1);
  assert.match(await t.err(`select public.save_product($1::jsonb)`, [JSON.stringify({ post_url: 'u', post_key: 'k1' })]), /TRÙNG.*Linh/);
  const dups = (await t.db.query(`select * from public.check_duplicate('k1', null, null)`)).rows;
  assert.equal(dups[0].match_type, 'post');
  assert.equal(dups[0].owner_name, 'Linh');
  // bắt buộc đạt đầu vào
  await t.sys(`update public.app_settings set entry_required = true`);
  await t.as(B);
  assert.match(await t.err(`select public.save_product($1::jsonb)`, [JSON.stringify({ post_url: 'u2', post_key: 'k2', likes: 1000, comments: 1, shares: 1 })]), /đầu vào/);
  assert.equal(await t.err(`select public.save_product($1::jsonb)`, [JSON.stringify({ post_url: 'u3', post_key: 'k3', likes: 10, comments: 5, shares: 5 })]), null);
});

test('adlib_us chuẩn hóa link', async () => {
  const t = await setup();
  const OLD = 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&media_type=all&q=%22abc%22&search_type=keyword_exact_phrase';
  const fixed = await t.val(`select public.adlib_us($1)`, [OLD]);
  assert.match(fixed, /active_status=active/);
  assert.match(fixed, /country=US/);
  assert.doesNotMatch(fixed, /country=ALL/);
  const bare = await t.val(`select public.adlib_us($1)`, ['https://www.facebook.com/ads/library/?q=abc']);
  assert.match(bare, /active_status=active.*country=US/);
  assert.equal(await t.val(`select public.adlib_us('https://x.com/a')`), 'https://x.com/a');
  assert.equal(await t.val(`select public.adlib_us('')`), null);
});

test('theo dõi 3 ngày → chấm Chờ duyệt / Ưu tiên, Telegram', async () => {
  const t = await setup();
  await t.as(B);
  await save(t.db, P1, 'k1', 1000, 100, 100, { headline: 'Đèn <ngủ> 16 màu', page_name: 'Glow & Co' });
  await save(t.db, P2, 'k2', 100, 100, 100);
  // trong ngày 0: không có gì để đọc
  assert.equal((await t.db.query(`select * from public.get_tracking_queue()`)).rows.length, 0);
  await t.shift(P1); await t.shift(P2); await t.as(B);
  assert.equal((await t.db.query(`select * from public.get_tracking_queue()`)).rows.length, 2);
  await t.db.query(`select public.record_snapshot($1,1100,111,100,null,'dom')`, [P1]);
  await t.db.query(`select public.record_snapshot($1,101,120,100,null,'dom')`, [P2]);
  let p1 = await t.row(P1);
  assert.equal(p1.tracking_day, 1);
  assert.equal(p1.latest_likes, 1100);
  assert.equal(p1.pending_review, false);
  assert.equal((await t.db.query(`select * from public.get_tracking_queue()`)).rows.length, 0, 'đã đọc hôm nay');
  // đọc ra toàn null không tính là đã đọc
  await t.shift(P1); await t.shift(P2); await t.as(B);
  await t.db.query(`select public.record_snapshot($1,null,null,null,null,'dom')`, [P1]);
  assert.equal((await t.db.query(`select * from public.get_tracking_queue()`)).rows.length, 2);
  await t.db.query(`select public.record_snapshot($1,1150,112,100,null,'dom')`, [P1]);
  await t.db.query(`select public.record_snapshot($1,102,125,105,null,'dom')`, [P2]);
  // Ngày 3: P1 Like +20%, Comment +15% (2/3) → Chờ duyệt, không ưu tiên; P2 Comment + Share → ưu tiên
  await t.shift(P1); await t.shift(P2); await t.as(B);
  await t.db.query(`select public.record_snapshot($1,1200,115,100,null,'dom')`, [P1]);
  await t.db.query(`select public.record_snapshot($1,103,130,115,null,'dom')`, [P2]);
  p1 = await t.row(P1);
  const p2 = await t.row(P2);
  assert.equal(p1.tracking_done, true);
  assert.deepEqual([p1.growth_likes, p1.growth_comments, p1.growth_shares], [20, 15, 0]);
  assert.equal(p1.pending_review, true);
  assert.equal(p1.priority, false);
  assert.ok(p1.due_at);
  assert.equal(p2.pending_review, true);
  assert.equal(p2.priority, true);
  // ghi lại cùng ngày sau khi đã chấm → không chấm lại
  await t.db.query(`select public.record_snapshot($1,1000,100,100,null,'dom')`, [P1]);
  assert.equal((await t.row(P1)).pending_review, true);
  const msgs = await t.tg();
  const m = msgs.find((x) => x.includes('CHỜ DUYỆT') && x.includes('Glow'));
  assert.ok(m, 'có tin Chờ duyệt');
  assert.ok(m.includes('Glow &amp; Co') && m.includes('<i>Đèn &lt;ngủ&gt; 16 màu</i>'), 'escape HTML');
  assert.ok(msgs.some((x) => x.includes('ưu tiên')));
});

test('không đạt sau 3 ngày + Theo dõi thêm', async () => {
  const t = await setup();
  await t.as(B);
  await save(t.db, P1, 'k1', 1000, 100, 100);
  await save(t.db, P2, 'k2', 1000, 100, 100);
  await t.as(A);
  assert.match(await t.err(`update public.products set extra_tracking=true where id='${P1}'`), /đủ 3 ngày/);
  await track(t, {
    [P1]: [[1010, 101, 101], [1020, 102, 102], [1030, 103, 103]],
    [P2]: [[1100, 120, 110], [1200, 130, 120], [1300, 140, 130]],
  });
  let p1 = await t.row(P1), p2 = await t.row(P2);
  assert.ok(!p1.pending_review && p1.tracking_done && p1.growth_pass === false);
  assert.ok(p2.pending_review && p2.due_at);

  await t.as(B);
  assert.match(await t.err(`update public.products set extra_tracking=true where id='${P1}'`), /Chỉ quản lý/);
  await t.as(A);
  await t.db.query(`update public.products set extra_tracking=true where id in ('${P1}','${P2}')`);
  p2 = await t.row(P2);
  assert.ok(p2.pending_review && p2.due_at === null, 'giữ Chờ duyệt, tắt hạn 24h');

  await t.shift(P1); await t.shift(P2); await t.as(B);
  const q = (await t.db.query(`select id from public.get_tracking_queue()`)).rows.map((r) => r.id);
  assert.ok(q.includes(P1) && q.includes(P2), 'Ngày 4 vẫn đọc số');
  await t.db.query(`select public.record_snapshot($1,1040,113,104,null,'dom')`, [P1]);
  p1 = await t.row(P1);
  assert.equal(p1.pending_review, false);
  assert.deepEqual([p1.daily_growth_likes, p1.daily_growth_comments, p1.daily_growth_shares], [1, 9.7, 1]);
  await t.shift(P1); await t.as(B);
  await t.db.query(`select public.record_snapshot($1,1050,130,125,null,'dom')`, [P1]);
  p1 = await t.row(P1);
  assert.ok(p1.pending_review && p1.priority && p1.growth_pass, 'Comment + Share ≥10% so với hôm trước');
  assert.equal(p1.due_at, null);

  await t.db.exec('reset role');
  await t.db.query(`update public.products set due_at = now() - interval '1 hour' where id='${P1}'`);
  await t.db.query('select public.cron_check_overdue()');
  const msgs = await t.tg();
  assert.ok(msgs.some((x) => x.includes('theo dõi thêm') && x.includes('So với lần đọc trước')));
  assert.ok(!msgs.some((x) => x.includes('CẦN XỬ LÝ')), 'không báo quá hạn mẫu đang theo dõi thêm');

  await t.as(A);
  await t.db.query(`update public.products set extra_tracking=false where id='${P2}'`);
  p2 = await t.row(P2);
  assert.ok(!p2.extra_tracking && p2.due_at, 'bỏ Theo dõi thêm → có lại hạn duyệt');
  await t.db.query(`update public.products set status='approve' where id='${P1}'`);
  p1 = await t.row(P1);
  assert.ok(!p1.extra_tracking && !p1.pending_review && p1.code === 'DS0001');
  await t.as(B);
  assert.ok(!(await t.db.query(`select id from public.get_tracking_queue()`)).rows.some((r) => r.id === P1));
});

test('quyền chuyển cột: Approve → Up Store → Campaign', async () => {
  const t = await setup();
  await t.as(B);
  await save(t.db, P1, 'k1', 10, 5, 5, { headline: 'Đèn ngủ cảm ứng' });
  assert.match(await t.err(`update public.products set status='approve' where id='${P1}'`), /Chỉ quản lý/);
  assert.match(await t.err(`update public.products set pending_review=true where id='${P1}'`), /không có quyền/);
  assert.equal(await t.err(`update public.products set note='ok', headline='Đèn ngủ 16 màu' where id='${P1}'`), null);
  // ads không thấy mẫu đang Following
  await t.as(C);
  assert.equal((await t.db.query(`select id from public.products`)).rows.length, 0);
  await t.as(A);
  await t.db.query(`update public.products set status='approve' where id='${P1}'`);
  assert.equal((await t.row(P1)).code, 'DS0001');
  await t.as(B);
  assert.match(await t.err(`update public.products set status='up_store' where id='${P1}'`), /Cost/);
  await t.db.query(`update public.products set cost_usd=4.5, store_url='https://shop.x/p/1', status='up_store' where id='${P1}'`);
  await t.as(C);
  assert.equal((await t.db.query(`select id from public.products`)).rows.length, 1, 'ads thấy từ Up Store');
  assert.match(await t.err(`update public.products set cost_usd=1 where id='${P1}'`), /không có quyền/);
  assert.match(await t.err(`update public.products set label_scale=true where id='${P1}'`), /Chỉ quản lý/);
  await t.db.query(`update public.products set status='up_campaign', campaign_ref='DS0001_TEST_LINH_261013' where id='${P1}'`);
  assert.ok((await t.row(P1)).campaign_started_at);
  await t.as(A);
  await t.db.query(`update public.products set label_scale=true where id='${P1}'`);
  // sau 3 ngày chạy camp: nhắc đánh giá 1 lần
  await t.db.exec(`reset role; update public.products set campaign_started_at = now() - interval '4 days'`);
  await t.db.query('select public.cron_check_overdue()');
  await t.db.query('select public.cron_check_overdue()');
  const msgs = await t.tg();
  assert.equal(msgs.filter((x) => x.includes('ĐÁNH GIÁ CAMPAIGN')).length, 1);
  for (const k of ['APPROVE', 'UP STORE', 'UP CAMPAIGN', 'SCALE']) assert.ok(msgs.some((x) => x.includes(k)), k);
  assert.ok(msgs.some((x) => x.includes('Ads Library (US)')) || msgs.some((x) => x.includes('Xem bài')));
});

test('sửa số, xóa mẫu, hàng chờ quá hạn, báo cáo ngày, KPI', async () => {
  const t = await setup();
  await t.as(B);
  await save(t.db, P1, 'k1', 1000, 100, 100);
  await track(t, { [P1]: [[1000, 100, 100], [1000, 100, 100], [1000, 100, 100]] });
  assert.equal((await t.row(P1)).pending_review, false);
  // extension đọc sai Ngày 3 → sửa số → chấm lại
  const sid = await t.val(`select id from public.product_snapshots where product_id='${P1}' and day_index=3`);
  await t.db.query(`select public.update_snapshot($1, 1200, 130, 100)`, [sid]);
  const p = await t.row(P1);
  assert.equal(p.pending_review, true);
  assert.equal(p.latest_comments, 130);
  await t.db.exec(`reset role; update public.products set due_at = now() - interval '1 hour'`);
  await t.db.query('select public.cron_check_overdue()');
  await t.db.query('select public.cron_check_overdue()');
  assert.equal((await t.tg()).filter((x) => x.includes('CẦN XỬ LÝ')).length, 1, 'báo quá hạn đúng 1 lần');

  await t.as(B);
  await save(t.db, P2, 'k2', 10, 5, 5);
  await t.db.query(`select public.checkin_finish(1, 0)`);
  await t.as(C);
  assert.match(await t.err(`select * from public.kpi(7)`), /Chỉ quản lý/);
  await t.as(A);
  const k = (await t.db.query(`select * from public.kpi(7)`)).rows.find((r) => r.full_name === 'Linh');
  assert.equal(k.found, 2);
  assert.equal(k.today_found, 1);
  assert.equal(k.today_updated, true);
  await t.db.exec('reset role');
  await t.db.query('select public.cron_daily_report()');
  await t.db.query('select public.cron_reminder()');
  const rep = (await t.tg()).find((x) => x.includes('BÁO CÁO NGÀY'));
  assert.ok(rep && rep.includes('Linh'), rep);
  // xóa mẫu: chủ mẫu xóa được khi còn ở Following
  await t.as(B);
  await t.db.query(`delete from public.products where id='${P2}'`);
  assert.equal(await t.row(P2), undefined);
});

test('work_date: trước 7:00 sáng giờ VN vẫn là ngày hôm trước', async () => {
  const t = await setup();
  assert.equal(await t.val(`select public.work_date('2026-10-13 06:59:00+07')::text`), '2026-10-12');
  assert.equal(await t.val(`select public.work_date('2026-10-13 07:00:00+07')::text`), '2026-10-13');
});
