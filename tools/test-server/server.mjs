// Máy chủ test trên máy: giả lập Supabase (REST, RPC, Auth, Storage) bằng PGlite chạy đúng supabase/schema.sql,
// đồng thời phục vụ web/dist. Dùng để test extension + web mà không cần tạo project Supabase.
//   node tools/test-server/server.mjs        (hoặc bấm đúp CHAY_SERVER_TEST.bat)
//   Web: http://localhost:8787 · Extension: địa chỉ http://localhost:8787, khóa công khai: test
// KHÔNG dùng cho dữ liệu thật: không kiểm tra chữ ký token, mật khẩu chỉ băm đơn giản.
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DATA = resolve(process.env.DATA_DIR || join(HERE, 'data'));
const FILES = join(DATA, 'files');
const DEBUG = join(DATA, 'debug');
const DIST = join(ROOT, 'web', 'dist');
const PORT = +(process.env.PORT || 8787);
for (const d of [DATA, FILES, DEBUG]) mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- database
const fresh = !existsSync(join(DATA, 'pg', 'PG_VERSION'));
const db = new PGlite(join(DATA, 'pg'), { parsers: { 1082: (v) => v, 1700: Number, 20: Number } });
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
if (fresh) await db.exec(read('supabase/tests/supabase_stub.sql'));
await db.exec(read('supabase/schema.sql').replace(/^create extension.*$/gim, '')); // chạy lại mỗi lần bật = nâng cấp schema
await db.exec(`create schema if not exists testsrv;
  create table if not exists testsrv.passwords (user_id uuid primary key, hash text not null);`);

const hash = (s) => createHash('sha256').update('dsh-test:' + s).digest('hex');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeToken(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { exp, token: `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp })}.test` };
}
function userOf(req) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+([^.]+)\.([^.]+)\./);
  if (!m) return null;
  try {
    const p = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    return p.sub && p.exp * 1000 > Date.now() ? p.sub : null;
  } catch (e) { return null; }
}
// Chạy câu lệnh với quyền người dùng (RLS + trigger kiểm tra quyền như Supabase thật)
function asUser(uid, fn) {
  return db.transaction(async (tx) => {
    if (uid) {
      await tx.query('set local role authenticated');
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    } else await tx.query('set local role anon');
    return fn(tx);
  });
}

// ---------------------------------------------------------------- http helpers
const send = (res, code, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(code, {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
    'Access-Control-Expose-Headers': '*',
    ...(isBuf ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers,
  });
  res.end(body === undefined ? '' : isBuf ? body : JSON.stringify(body));
};
const fail = (res, code, message) => send(res, code, { message, msg: message, error: message, code: String(code) });
const bodyOf = (req) => new Promise((ok, bad) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c)).on('end', () => ok(Buffer.concat(chunks))).on('error', bad);
});
const json = async (req) => { const b = await bodyOf(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => { if (!IDENT.test(s)) throw Object.assign(new Error('Tên cột không hợp lệ: ' + s), { status: 400 }); return `"${s}"`; };

// ---------------------------------------------------------------- auth
async function authUser(id) {
  const { rows: [u] } = await db.query('select id, email, raw_user_meta_data from auth.users where id = $1', [id]);
  return u && { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: u.raw_user_meta_data, app_metadata: {} };
}
async function session(id) {
  const user = await authUser(id);
  const { token, exp } = makeToken(user);
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r.' + id + '.' + randomUUID(), user };
}
async function auth(req, res, path, url) {
  if (path === '/signup' && req.method === 'POST') {
    const b = await json(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!email || String(b.password || '').length < 6) return fail(res, 400, 'Email và mật khẩu (≥ 6 ký tự) là bắt buộc');
    const { rows } = await db.query('select 1 from auth.users where email = $1', [email]);
    if (rows.length) return fail(res, 400, 'User already registered');
    const id = randomUUID();
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, JSON.stringify(b.data || {})]);
    await db.query('insert into testsrv.passwords values ($1, $2)', [id, hash(b.password)]);
    return send(res, 200, await session(id));
  }
  if (path === '/token' && req.method === 'POST') {
    const b = await json(req);
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const id = String(b.refresh_token || '').split('.')[1];
      if (!id || !(await authUser(id))) return fail(res, 400, 'Invalid Refresh Token');
      return send(res, 200, await session(id));
    }
    const { rows: [u] } = await db.query(
      'select u.id from auth.users u join testsrv.passwords p on p.user_id = u.id where u.email = $1 and p.hash = $2',
      [String(b.email || '').trim().toLowerCase(), hash(b.password || '')]);
    if (!u) return fail(res, 400, 'Invalid login credentials');
    return send(res, 200, await session(u.id));
  }
  if (path === '/user') {
    const id = userOf(req);
    return id ? send(res, 200, await authUser(id)) : fail(res, 401, 'invalid JWT');
  }
  if (path === '/logout') return send(res, 204);
  return fail(res, 404, 'not found');
}

// ---------------------------------------------------------------- REST (PostgREST rút gọn)
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
function where(url, params) {
  const out = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = v.match(/^(not\.)?(\w+)\.(.*)$/s);
    if (!m) throw Object.assign(new Error('Bộ lọc không hiểu được: ' + k), { status: 400 });
    const [, not, op, val] = m;
    let cond;
    if (op === 'is') cond = `${ident(k)} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
    else if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      cond = `${ident(k)}::text = any($${params.push(items)}::text[])`;
    } else if (OPS[op]) cond = `${ident(k)}::text ${OPS[op]} $${params.push(val.replace(/\*/g, '%'))}`;
    else throw Object.assign(new Error('Toán tử không hỗ trợ: ' + op), { status: 400 });
    if (['gt', 'gte', 'lt', 'lte'].includes(op)) cond = `${ident(k)} ${OPS[op]} $${params.length}`;
    out.push(not ? `not (${cond})` : cond);
  }
  return out.length ? ' where ' + out.join(' and ') : '';
}
async function rest(req, res, table, url, uid) {
  if (!IDENT.test(table)) return fail(res, 404, 'not found');
  const t = `public.${ident(table)}`;
  const params = [];
  const repr = /return=representation/.test(req.headers.prefer || '');
  if (req.method === 'GET' || req.method === 'HEAD') {
    const sel = url.searchParams.get('select') || '*';
    const cols = sel === '*' ? '*' : sel.split(',').map((c) => ident(c.trim())).join(', ');
    let sql = `select ${cols} from ${t}${where(url, params)}`;
    const order = url.searchParams.get('order');
    if (order) sql += ' order by ' + order.split(',').map((o) => { const [c, dir, nulls] = o.split('.'); return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`; }).join(', ');
    if (url.searchParams.get('limit')) sql += ` limit ${parseInt(url.searchParams.get('limit'), 10)}`;
    if (url.searchParams.get('offset')) sql += ` offset ${parseInt(url.searchParams.get('offset'), 10)}`;
    const { rows } = await asUser(uid, (tx) => tx.query(sql, params));
    return send(res, 200, rows);
  }
  if (req.method === 'PATCH') {
    const b = await json(req);
    const sets = Object.entries(b).map(([k, v]) => `${ident(k)} = $${params.push(v)}`);
    if (!sets.length) return send(res, repr ? 200 : 204, repr ? [] : undefined);
    const w = where(url, params);
    const { rows } = await asUser(uid, (tx) => tx.query(`update ${t} set ${sets.join(', ')}${w} returning *`, params));
    return repr ? send(res, 200, rows) : send(res, 204);
  }
  if (req.method === 'DELETE') {
    const w = where(url, params);
    if (!w) return fail(res, 400, 'Thiếu điều kiện xóa');
    const { rows } = await asUser(uid, (tx) => tx.query(`delete from ${t}${w} returning *`, params));
    return repr ? send(res, 200, rows) : send(res, 204);
  }
  return fail(res, 405, 'Phương thức không hỗ trợ trên máy chủ test');
}
async function rpc(req, res, name, uid) {
  if (!IDENT.test(name)) return fail(res, 404, 'not found');
  const args = await json(req);
  const { rows: [fn] } = await db.query(
    `select p.proretset, t.typname from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = $1 limit 1`, [name]);
  if (!fn) return fail(res, 404, `Không có hàm public.${name}`);
  const params = [];
  const named = Object.entries(args).map(([k, v]) => `${ident(k)} => $${params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)}`);
  const call = `public.${ident(name)}(${named.join(', ')})`;
  const { rows } = await asUser(uid, (tx) => tx.query(fn.proretset ? `select * from ${call}` : `select ${call} as v`, params));
  if (fn.proretset) return send(res, 200, rows);
  if (fn.typname === 'void') return send(res, 200, null);
  return send(res, 200, rows[0]?.v ?? null);
}

// ---------------------------------------------------------------- storage (bucket screenshots)
const safePath = (p) => {
  const full = normalize(join(FILES, decodeURIComponent(p)));
  if (!full.startsWith(FILES)) throw Object.assign(new Error('Đường dẫn không hợp lệ'), { status: 400 });
  return full;
};
async function storage(req, res, path, uid) {
  let m;
  if ((m = path.match(/^\/object\/sign\/screenshots\/(.+)$/))) {
    if (req.method === 'POST') { // tạo link ký (máy chủ test: không hết hạn)
      if (!uid) return fail(res, 401, 'Chưa đăng nhập');
      return send(res, 200, { signedURL: `/object/sign/screenshots/${m[1]}?token=local` });
    }
    const f = safePath(m[1]);
    return existsSync(f) ? send(res, 200, readFileSync(f), { 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=3600' }) : fail(res, 404, 'Không có ảnh');
  }
  if ((m = path.match(/^\/object\/screenshots\/(.+)$/)) && ['POST', 'PUT'].includes(req.method)) {
    if (!uid) return fail(res, 401, 'Chưa đăng nhập');
    if (decodeURIComponent(m[1]).split('/')[0] !== uid) return fail(res, 403, 'Chỉ được tải ảnh vào thư mục của mình');
    const f = safePath(m[1]);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, await bodyOf(req));
    return send(res, 200, { Key: `screenshots/${m[1]}` });
  }
  return fail(res, 404, 'not found');
}

// ---------------------------------------------------------------- công cụ test
async function dev(req, res, path, url) {
  if (path === '/__debug') {
    const q = async (sql) => (await db.query(sql)).rows;
    return send(res, 200, {
      today: (await q('select public.work_date(now()) d'))[0].d,
      profiles: await q('select id, email, full_name, role, staff_code, active from public.profiles order by created_at'),
      products: await q(`select id, code, status, page_name, page_url, post_url, product_url, headline, description, ad_library_url,
        tracking_start_date, tracking_day, tracking_done, extra_tracking, growth_likes, growth_comments, growth_shares, growth_pass,
        daily_growth_likes, daily_growth_comments, daily_growth_shares, due_at, priority,
        base_likes, base_comments, base_shares, latest_likes, latest_comments, latest_shares, entry_pass, pending_review,
        screenshot_path, created_at from public.products order by created_at`),
      snapshots: await q(`select s.product_id, p.page_name, s.day_index, s.work_date, s.likes, s.comments, s.shares, s.source, s.screenshot_path
        from public.product_snapshots s join public.products p on p.id = s.product_id order by p.created_at, s.day_index`),
      telegram: await q(`select created_at, body->>'text' as text from net.sent order by id desc limit 20`),
    });
  }
  if (path === '/__dump' && req.method === 'POST') {
    const b = await json(req);
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(b.kind || 'luu-mau').replace(/[^\w-]/g, '')}`;
    writeFileSync(join(DEBUG, name + '.json'), JSON.stringify({ url: b.url, data: b.data, text: b.text }, null, 2));
    if (b.html) writeFileSync(join(DEBUG, name + '.html'), b.html);
    return send(res, 200, { ok: true });
  }
  // Giả lập "đã qua N ngày": lùi mọi ngày theo dõi để mẫu lại vào hàng chờ đọc số
  if (path === '/__dev/lui-ngay' && req.method === 'POST') {
    const n = Math.max(1, Math.min(30, parseInt(url.searchParams.get('days') || '1', 10)));
    await db.exec(`update public.products set tracking_start_date = tracking_start_date - ${n}, created_work_date = created_work_date - ${n},
        created_at = created_at - interval '${n} day', due_at = due_at - interval '${n} day', campaign_started_at = campaign_started_at - interval '${n} day';
      update public.product_snapshots set work_date = work_date - ${n}, taken_at = taken_at - interval '${n} day';
      update public.daily_checkins set work_date = work_date - ${n};`);
    return send(res, 200, { ok: true, days: n });
  }
  // Chạy tay các việc theo lịch (Telegram ghi vào net.sent, xem ở /__debug)
  if (path === '/__dev/cron' && req.method === 'POST') {
    const job = url.searchParams.get('job');
    if (!['cron_reminder', 'cron_daily_report', 'cron_check_overdue'].includes(job)) return fail(res, 400, 'job không hợp lệ');
    await db.exec(`select public.${job}()`);
    return send(res, 200, { ok: true, job });
  }
  return fail(res, 404, 'not found');
}

// ---------------------------------------------------------------- web/dist
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp' };
function web(req, res, path) {
  if (path === '/config.js') {
    const origin = `http://${req.headers.host || 'localhost:' + PORT}`;
    return send(res, 200, Buffer.from(`window.DROPSHIP_CONFIG = ${JSON.stringify({ supabaseUrl: origin, supabaseAnonKey: 'test' })};`),
      { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
  }
  if (!existsSync(DIST)) return send(res, 200, Buffer.from('Chưa build web. Chạy: npm run build:web (ở thư mục gốc dự án)'), { 'Content-Type': 'text/plain; charset=utf-8' });
  let f = normalize(join(DIST, decodeURIComponent(path)));
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
  return send(res, 200, readFileSync(f), { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
}

// ---------------------------------------------------------------- router
async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const uid = userOf(req);
  let m;
  if ((m = path.match(/^\/auth\/v1(\/.*)$/))) return auth(req, res, m[1], url);
  if ((m = path.match(/^\/rest\/v1\/rpc\/(\w+)$/))) return rpc(req, res, m[1], uid);
  if ((m = path.match(/^\/rest\/v1\/(\w+)$/))) return rest(req, res, m[1], url, uid);
  if ((m = path.match(/^\/storage\/v1(\/.*)$/))) return storage(req, res, m[1], uid);
  if (path.startsWith('/realtime/')) return fail(res, 404, 'Máy chủ test không có realtime (web tự tải lại mỗi 2 phút)');
  if (path.startsWith('/__')) return dev(req, res, path, url);
  return web(req, res, path);
}

const server = (host) => http.createServer((req, res) => handle(req, res).catch((e) => {
  const code = e.status || 400;
  if (code >= 500 || !e.status) console.error(new Date().toISOString(), req.method, req.url, '→', e.message);
  if (!res.headersSent) fail(res, code, e.message);
}));
// Nghe cả IPv4 và IPv6: Chrome có thể phân giải "localhost" thành ::1
server('127.0.0.1').listen(PORT, '127.0.0.1', () => {
  console.log(`May chu test dang chay. Web app: http://localhost:${PORT}`);
  console.log(`Extension: Dia chi Supabase = http://localhost:${PORT} , Khoa cong khai = test`);
  console.log(`Du lieu luu o: ${DATA}`);
  console.log('KHONG dong cua so nay trong luc test.');
});
server('::1').listen(PORT, '::1').on('error', () => {}); // máy không có IPv6 thì bỏ qua
