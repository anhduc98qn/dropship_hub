-- =====================================================================
--  Dropship Hub — database (Supabase / PostgreSQL 15+)
--  Cài mới: Supabase > SQL Editor > New query > dán toàn bộ file này > Run.
--  Chạy lại nhiều lần được (idempotent) — dùng luôn file này để nâng cấp.
--
--  Luồng: Lưu mẫu (extension) → Following (đọc số mỗi ngày, 3 ngày) → tự chấm → Chờ duyệt
--         → Quản lý: Approve (sinh mã DS0001) / Fails → Up Store → Up Campaign → Campaign Fails / Scale-Winning
--  Giờ: mọi "ngày làm việc" tính theo giờ Việt Nam, đổi ngày lúc 7:00 sáng (app_settings).
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
--  Cài đặt chung (1 dòng) + bí mật (không client nào đọc được)
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  timezone text not null default 'Asia/Ho_Chi_Minh',
  day_start_hour int not null default 7 check (day_start_hour between 0 and 23),
  tracking_days int not null default 3 check (tracking_days between 1 and 14),
  growth_threshold_pct numeric not null default 10,
  growth_min_metrics int not null default 2 check (growth_min_metrics between 1 and 3),
  entry_ratio numeric not null default 3,
  entry_required boolean not null default false,
  review_hours int not null default 24,
  daily_target int not null default 8,
  campaign_eval_days int not null default 3,
  ai_read_enabled boolean not null default false,
  telegram_chat_id text,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;

create table if not exists public.app_secrets (
  id int primary key default 1 check (id = 1),
  telegram_bot_token text
);
insert into public.app_secrets (id) values (1) on conflict do nothing;

-- Ngày làm việc của một thời điểm: giờ VN, trước 7:00 sáng vẫn tính là ngày hôm trước
create or replace function public.work_date(ts timestamptz default now()) returns date
language sql stable security definer set search_path = public as $$
  select ((ts at time zone s.timezone) - make_interval(hours => s.day_start_hour))::date
    from public.app_settings s where s.id = 1
$$;

-- ---------------------------------------------------------------------
--  Người dùng
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  role text check (role in ('manager', 'researcher', 'ads')),
  staff_code text,
  telegram_username text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_staff_code_key on public.profiles (upper(staff_code)) where staff_code is not null;

-- Tài khoản đầu tiên là Quản lý, các tài khoản sau là Tìm mẫu (quản lý đổi vai trò trong Quản trị)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
          case when exists (select 1 from public.profiles) then 'researcher' else 'manager' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'manager', false)
$$;

-- Chỉ quản lý đổi được vai trò / mã NV / khóa tài khoản (chống tự nâng quyền)
create or replace function public.profiles_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_manager() then
    if new.role is distinct from old.role or new.staff_code is distinct from old.staff_code
       or new.active is distinct from old.active or new.id is distinct from old.id then
      raise exception 'Chỉ quản lý được đổi vai trò, mã nhân viên hoặc khóa tài khoản';
    end if;
  end if;
  new.staff_code := nullif(upper(trim(new.staff_code)), '');
  return new;
end $$;
drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ---------------------------------------------------------------------
--  Mẫu sản phẩm + số đo mỗi ngày
-- ---------------------------------------------------------------------
create sequence if not exists public.product_code_seq;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id),
  status text not null default 'following'
    check (status in ('following', 'fails', 'approve', 'up_store', 'up_campaign', 'campaign_fails', 'scale_winning')),
  code text unique,
  -- nội dung quảng cáo
  page_name text, page_url text,
  post_url text not null, post_key text not null,
  product_url text, product_key text,
  headline text, description text, ad_content text, content_hash text, ad_library_url text,
  screenshot_path text,
  note text, fail_reason text,
  -- sau Approve
  cost_usd numeric, store_url text, campaign_ref text, campaign_started_at timestamptz,
  -- số đo
  base_likes int, base_comments int, base_shares int,
  latest_likes int, latest_comments int, latest_shares int,
  growth_likes numeric, growth_comments numeric, growth_shares numeric,
  daily_growth_likes numeric, daily_growth_comments numeric, daily_growth_shares numeric,
  entry_pass boolean, growth_pass boolean,
  -- theo dõi / duyệt
  tracking_start_date date not null default public.work_date(now()),
  tracking_day int not null default 0,
  tracking_done boolean not null default false,
  extra_tracking boolean not null default false,
  last_snapshot_at timestamptz,
  pending_review boolean not null default false,
  priority boolean not null default false,
  due_at timestamptz,
  overdue_notified_at timestamptz,
  label_scale boolean not null default false,
  campaign_eval_notified boolean not null default false,
  created_work_date date not null default public.work_date(now()),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);
create unique index if not exists products_post_key_key on public.products (post_key);
create index if not exists products_owner_idx on public.products (owner_id, created_work_date);
create index if not exists products_status_idx on public.products (status);
create index if not exists products_content_hash_idx on public.products (content_hash) where content_hash is not null;
create index if not exists products_product_key_idx on public.products (product_key) where product_key is not null;

create table if not exists public.product_snapshots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  day_index int not null,
  work_date date not null,
  likes int, comments int, shares int,
  source text not null default 'dom' check (source in ('dom', 'ai', 'manual')),
  screenshot_path text,
  taken_at timestamptz not null default now(),
  unique (product_id, work_date)
);

-- Lượt đọc số mỗi ngày của từng người (chấm "đã cập nhật")
create table if not exists public.daily_checkins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  posts_ok int not null default 0,
  posts_failed int not null default 0,
  primary key (user_id, work_date)
);

-- ---------------------------------------------------------------------
--  Tiện ích
-- ---------------------------------------------------------------------
-- % tăng so với gốc (gốc 0: có tăng = 100%, không tăng = 0%)
create or replace function public.pct(cur numeric, base numeric) returns numeric
language sql immutable as $$
  select case when cur is null or base is null then null
              when base = 0 then case when cur > 0 then 100 else 0 end
              else round((cur - base) * 100.0 / base, 1) end
$$;

-- Link Ads Library luôn lọc quảng cáo đang chạy (active) tại Mỹ (US)
create or replace function public.adlib_us(u text) returns text
language sql immutable as $$
  select case when u is null or u !~ 'facebook\.com/ads/library' then nullif(u, '')
    else regexp_replace(regexp_replace(
           case when u ~ '[?&]active_status=' then u else u || case when u ~ '\?' then '&' else '?' end || 'active_status=active' end,
           '([?&])active_status=[^&]*', '\1active_status=active'),
         '([?&])country=[^&]*', '\1country=US')
         || case when u ~ '[?&]country=' then '' else '&country=US' end
  end
$$;

create or replace function public.next_product_code() returns text
language sql security definer set search_path = public as $$
  select 'DS' || lpad(nextval('public.product_code_seq')::text, 4, '0')
$$;

-- ---------------------------------------------------------------------
--  Telegram
-- ---------------------------------------------------------------------
create or replace function public.tg_esc(t text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

create or replace function public.tg_send(msg text) returns void
language plpgsql security definer set search_path = public as $$
declare tok text; chat text;
begin
  select telegram_bot_token into tok from public.app_secrets where id = 1;
  select telegram_chat_id into chat from public.app_settings where id = 1;
  if coalesce(tok, '') = '' or coalesce(chat, '') = '' or coalesce(msg, '') = '' then return; end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', left(msg, 4000), 'parse_mode', 'HTML', 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;

-- "DS0001 · Tên page · @nhanvien" + headline + link bài / Ads Library (US, đang chạy)
create or replace function public.tg_product_line(p public.products) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ',
    '<b>' || public.tg_esc(coalesce(p.code, 'Chưa có mã')) || '</b>',
    public.tg_esc(coalesce(nullif(p.page_name, ''), 'Không rõ page')),
    (select coalesce('@' || nullif(pr.telegram_username, ''), public.tg_esc(pr.full_name))
       from public.profiles pr where pr.id = p.owner_id)
  )
  || coalesce(E'\n<i>' || public.tg_esc(left(nullif(p.headline, ''), 150)) || '</i>', '')
  || E'\n' || concat_ws(' · ',
       '<a href="' || public.tg_esc(p.post_url) || '">Xem bài</a>',
       '<a href="' || public.tg_esc(public.adlib_us(p.ad_library_url)) || '">Ads Library (US)</a>')
$$;

create or replace function public.tg_growth_lines(p public.products) returns text
language sql stable as $$
  select concat_ws(E'\n',
    case when p.extra_tracking and p.daily_growth_likes is not null then
      format('So với lần đọc trước: Like %s%% · Comment %s%% · Share %s%%',
             p.daily_growth_likes, p.daily_growth_comments, p.daily_growth_shares) end,
    format('So với Ngày 0: Like %s → %s · Comment %s → %s · Share %s → %s',
           coalesce(p.base_likes::text, '?'), coalesce(p.latest_likes::text, '?'),
           coalesce(p.base_comments::text, '?'), coalesce(p.latest_comments::text, '?'),
           coalesce(p.base_shares::text, '?'), coalesce(p.latest_shares::text, '?')))
$$;

-- ---------------------------------------------------------------------
--  Quyền sửa mẫu + việc tự động khi đổi cột
-- ---------------------------------------------------------------------
create or replace function public.products_before_update() returns trigger
language plpgsql set search_path = public as $$
declare
  r text;
  s public.app_settings;
  allowed text[];
  post_approve text[] := array['up_store', 'up_campaign', 'campaign_fails', 'scale_winning'];
begin
  select * into s from public.app_settings where id = 1;

  -- Sửa trực tiếp từ web / extension (không qua hàm hệ thống): kiểm tra quyền theo vai trò
  if current_user in ('anon', 'authenticated') then
    r := public.my_role();
    if r is null then raise exception 'Tài khoản chưa được kích hoạt'; end if;
    if r <> 'manager' then
      if new.extra_tracking is distinct from old.extra_tracking then
        raise exception 'Chỉ quản lý được gắn hoặc bỏ Theo dõi thêm';
      end if;
      if new.label_scale is distinct from old.label_scale then
        raise exception 'Chỉ quản lý được gắn nhãn Scale';
      end if;
      if new.status is distinct from old.status
         and not (old.code is not null and old.status = any (post_approve || 'approve'::text) and new.status = any (post_approve)) then
        raise exception 'Chỉ quản lý được chuyển mẫu sang cột này';
      end if;
      allowed := case r
        when 'ads' then array['status', 'campaign_ref', 'note']
        else array['status', 'campaign_ref', 'note', 'cost_usd', 'store_url', 'page_name', 'page_url', 'product_url',
                   'product_key', 'headline', 'description', 'ad_content', 'content_hash', 'ad_library_url'] end;
      if (to_jsonb(new) - allowed - 'updated_at') is distinct from (to_jsonb(old) - allowed - 'updated_at') then
        raise exception 'Bạn không có quyền sửa thông tin này';
      end if;
    end if;
  end if;

  new.updated_at := now();
  new.ad_library_url := public.adlib_us(new.ad_library_url);

  -- Theo dõi thêm: chỉ cho mẫu Following đã chấm xong 3 ngày; trong lúc theo dõi thêm không tính hạn duyệt
  if new.extra_tracking and not old.extra_tracking then
    if not (new.status = 'following' and new.tracking_done) then
      raise exception 'Chỉ gắn Theo dõi thêm cho mẫu ở Following đã đủ % ngày theo dõi', s.tracking_days;
    end if;
    new.due_at := null;
  elsif old.extra_tracking and not new.extra_tracking and new.status = 'following' and new.pending_review then
    new.due_at := now() + make_interval(hours => s.review_hours);
    new.overdue_notified_at := null;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'up_store' and (new.cost_usd is null or coalesce(new.store_url, '') = '') then
      raise exception 'Cần điền Cost và Link sản phẩm trên store trước khi chuyển sang Up Store';
    end if;
    new.status_changed_at := now();
    if new.status <> 'following' then
      new.extra_tracking := false;
      new.pending_review := false;
      new.due_at := null;
    end if;
    if new.status not in ('following', 'fails') and new.code is null then
      new.code := public.next_product_code();
    end if;
    if new.status = 'up_campaign' and old.status <> 'up_campaign' then
      new.campaign_started_at := now();
      new.campaign_eval_notified := false;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists products_before_update on public.products;
create trigger products_before_update before update on public.products
  for each row execute function public.products_before_update();

create or replace function public.products_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare head text;
begin
  if new.status is distinct from old.status then
    head := case new.status
      when 'approve' then '✅ <b>APPROVE</b> — điền Cost + link store rồi chuyển Up Store'
      when 'fails' then '❌ <b>FAILS</b>' || coalesce(' — ' || public.tg_esc(nullif(new.fail_reason, '')), '')
      when 'up_store' then '🏬 <b>UP STORE</b> — Ads lên campaign'
      when 'up_campaign' then '🚀 <b>UP CAMPAIGN</b>' || coalesce(' — ' || public.tg_esc(nullif(new.campaign_ref, '')), '')
      when 'campaign_fails' then '⛔ <b>CAMPAIGN FAILS</b>'
      when 'scale_winning' then '🏆 <b>SCALE / WINNING</b>'
      else null end;
    if head is not null then perform public.tg_send(head || E'\n' || public.tg_product_line(new)); end if;
  end if;
  if new.label_scale and not old.label_scale then
    perform public.tg_send('🔥 <b>GẮN NHÃN SCALE</b> — Ads tăng ngân sách' || E'\n' || public.tg_product_line(new));
  end if;
  return null;
end $$;
drop trigger if exists products_after_update on public.products;
create trigger products_after_update after update on public.products
  for each row execute function public.products_after_update();

-- ---------------------------------------------------------------------
--  Chấm tăng trưởng
-- ---------------------------------------------------------------------
-- Cập nhật số mới nhất + % so với gốc (lần đọc có số sớm nhất). p_final: hết 3 ngày → chấm đạt/không đạt.
create or replace function public._evaluate_product(p_id uuid, p_final boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
  p public.products;
  b record; l record; prev record;
  n int; pass boolean; prio boolean; was_pending boolean;
begin
  select * into s from public.app_settings where id = 1;
  select * into p from public.products where id = p_id for update;
  was_pending := p.pending_review;

  select likes, comments, shares into b from public.product_snapshots
   where product_id = p_id and coalesce(likes, comments, shares) is not null order by work_date limit 1;
  select likes, comments, shares, work_date into l from public.product_snapshots
   where product_id = p_id and coalesce(likes, comments, shares) is not null order by work_date desc limit 1;
  if l is null then return; end if;

  p.base_likes := b.likes; p.base_comments := b.comments; p.base_shares := b.shares;
  p.latest_likes := l.likes; p.latest_comments := l.comments; p.latest_shares := l.shares;
  p.growth_likes := public.pct(l.likes, b.likes);
  p.growth_comments := public.pct(l.comments, b.comments);
  p.growth_shares := public.pct(l.shares, b.shares);
  p.entry_pass := case when b.likes is null or b.comments is null or b.shares is null then null
                       else (b.comments + b.shares) * s.entry_ratio >= b.likes end;

  if p.extra_tracking then
    -- Theo dõi thêm: so với lần đọc trước
    select likes, comments, shares into prev from public.product_snapshots
     where product_id = p_id and work_date < l.work_date and coalesce(likes, comments, shares) is not null
     order by work_date desc limit 1;
    if prev is not null then
      p.daily_growth_likes := public.pct(l.likes, prev.likes);
      p.daily_growth_comments := public.pct(l.comments, prev.comments);
      p.daily_growth_shares := public.pct(l.shares, prev.shares);
      n := (p.daily_growth_likes >= s.growth_threshold_pct)::int + (p.daily_growth_comments >= s.growth_threshold_pct)::int
         + (p.daily_growth_shares >= s.growth_threshold_pct)::int;
      if coalesce(n, 0) >= s.growth_min_metrics then
        p.growth_pass := true;
        p.pending_review := true;
        p.priority := p.priority or coalesce(p.daily_growth_comments >= s.growth_threshold_pct and p.daily_growth_shares >= s.growth_threshold_pct, false);
        p.due_at := null;
      end if;
    end if;
  elsif p_final then
    n := coalesce((p.growth_likes >= s.growth_threshold_pct)::int, 0) + coalesce((p.growth_comments >= s.growth_threshold_pct)::int, 0)
       + coalesce((p.growth_shares >= s.growth_threshold_pct)::int, 0);
    pass := n >= s.growth_min_metrics;
    prio := coalesce(p.growth_comments >= s.growth_threshold_pct and p.growth_shares >= s.growth_threshold_pct, false);
    p.tracking_done := true;
    p.growth_pass := pass;
    p.pending_review := pass;
    p.priority := pass and prio;
    p.due_at := case when pass then now() + make_interval(hours => s.review_hours) end;
    p.overdue_notified_at := null;
  end if;

  update public.products set
    base_likes = p.base_likes, base_comments = p.base_comments, base_shares = p.base_shares,
    latest_likes = p.latest_likes, latest_comments = p.latest_comments, latest_shares = p.latest_shares,
    growth_likes = p.growth_likes, growth_comments = p.growth_comments, growth_shares = p.growth_shares,
    daily_growth_likes = p.daily_growth_likes, daily_growth_comments = p.daily_growth_comments,
    daily_growth_shares = p.daily_growth_shares, entry_pass = p.entry_pass, growth_pass = p.growth_pass,
    tracking_done = p.tracking_done, pending_review = p.pending_review, priority = p.priority,
    due_at = p.due_at, overdue_notified_at = p.overdue_notified_at
  where id = p_id;

  if p.pending_review and not was_pending then
    perform public.tg_send('🟡 <b>CHỜ DUYỆT</b>' || case when p.extra_tracking then ' (theo dõi thêm)' else '' end
      || case when p.priority then ' ⭐ ưu tiên' else '' end || E'\n'
      || public.tg_product_line(p) || E'\n' || public.tg_growth_lines(p));
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Hàm cho extension
-- ---------------------------------------------------------------------
create or replace function public.check_duplicate(p_post_key text, p_content_hash text default null, p_product_key text default null)
returns table (match_type text, product_id uuid, owner_name text, code text, page_name text, status text)
language sql stable security definer set search_path = public as $$
  select m.match_type, p.id, pr.full_name, p.code, p.page_name, p.status
  from (
    select 'post' as match_type, id, 1 as ord from public.products where p_post_key is not null and post_key = p_post_key
    union all
    select 'content', id, 2 from public.products where nullif(p_content_hash, '') is not null and content_hash = p_content_hash
    union all
    select 'product', id, 3 from public.products where nullif(p_product_key, '') is not null and product_key = p_product_key
  ) m
  join public.products p on p.id = m.id
  join public.profiles pr on pr.id = p.owner_id
  where auth.uid() is not null
  order by m.ord, p.created_at desc
  limit 10
$$;

-- Lưu mẫu mới (Ngày 0). p: các trường của mẫu + likes/comments/shares + screenshot_path.
create or replace function public.save_product(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.app_settings;
  dup record;
  new_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  lk int := nullif(p ->> 'likes', '')::int;
  cm int := nullif(p ->> 'comments', '')::int;
  sh int := nullif(p ->> 'shares', '')::int;
  entry boolean;
begin
  if public.my_role() is null then raise exception 'Tài khoản chưa được kích hoạt'; end if;
  if coalesce(p ->> 'post_url', '') = '' or coalesce(p ->> 'post_key', '') = '' then
    raise exception 'Thiếu link bài viết';
  end if;
  select * into s from public.app_settings where id = 1;

  select pr.full_name, x.code into dup from public.products x join public.profiles pr on pr.id = x.owner_id
   where x.post_key = p ->> 'post_key';
  if found then
    raise exception 'TRÙNG: Bài này đã được % lưu%', dup.full_name, coalesce(' (' || dup.code || ')', '');
  end if;

  entry := case when lk is null or cm is null or sh is null then null else (cm + sh) * s.entry_ratio >= lk end;
  if s.entry_required and entry is false then
    raise exception 'Chưa đạt tiêu chí đầu vào: (Share + Comment) × % < Like', s.entry_ratio;
  end if;

  insert into public.products (id, owner_id, page_name, page_url, post_url, post_key, product_url, product_key,
    headline, description, ad_content, content_hash, ad_library_url, screenshot_path, note,
    base_likes, base_comments, base_shares, latest_likes, latest_comments, latest_shares, entry_pass, last_snapshot_at)
  values (new_id, uid, nullif(p ->> 'page_name', ''), nullif(p ->> 'page_url', ''), p ->> 'post_url', p ->> 'post_key',
    nullif(p ->> 'product_url', ''), nullif(p ->> 'product_key', ''),
    nullif(p ->> 'headline', ''), nullif(p ->> 'description', ''), nullif(p ->> 'ad_content', ''),
    nullif(p ->> 'content_hash', ''), public.adlib_us(nullif(p ->> 'ad_library_url', '')),
    nullif(p ->> 'screenshot_path', ''), nullif(p ->> 'note', ''),
    lk, cm, sh, lk, cm, sh, entry, now());

  insert into public.product_snapshots (product_id, day_index, work_date, likes, comments, shares, source, screenshot_path)
  values (new_id, 0, public.work_date(now()), lk, cm, sh,
          coalesce(nullif(p ->> 'source', ''), 'dom'), nullif(p ->> 'screenshot_path', ''));
  return new_id;
end $$;

-- Ghi số đọc được hôm nay (extension gọi mỗi ngày). Đủ ngày theo dõi → tự chấm.
create or replace function public.record_snapshot(p_product_id uuid, p_likes int, p_comments int, p_shares int,
  p_screenshot_path text default null, p_source text default 'dom') returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.products;
  s public.app_settings;
  d date := public.work_date(now());
  idx int;
begin
  select * into s from public.app_settings where id = 1;
  select * into p from public.products where id = p_product_id;
  if not found then raise exception 'Không tìm thấy mẫu'; end if;
  if p.owner_id is distinct from auth.uid() and not public.is_manager() then
    raise exception 'Chỉ người lưu mẫu hoặc quản lý được ghi số';
  end if;
  idx := d - p.tracking_start_date;
  if idx < 1 then return; end if; -- Ngày 0 đã ghi khi lưu mẫu

  insert into public.product_snapshots as sn (product_id, day_index, work_date, likes, comments, shares, source, screenshot_path)
  values (p_product_id, idx, d, p_likes, p_comments, p_shares, coalesce(p_source, 'dom'), p_screenshot_path)
  on conflict (product_id, work_date) do update set
    likes = coalesce(excluded.likes, sn.likes), comments = coalesce(excluded.comments, sn.comments),
    shares = coalesce(excluded.shares, sn.shares), source = excluded.source,
    screenshot_path = coalesce(excluded.screenshot_path, sn.screenshot_path), taken_at = now();

  update public.products set last_snapshot_at = now(), tracking_day = greatest(tracking_day, idx) where id = p_product_id;
  perform public._evaluate_product(p_product_id, p.status = 'following' and not p.tracking_done and idx >= s.tracking_days);
end $$;

-- Sửa số một ngày khi extension đọc sai ("Sửa số" trên web). Ngày cuối đã chấm thì chấm lại.
create or replace function public.update_snapshot(p_snapshot_id uuid, p_likes int, p_comments int, p_shares int) returns void
language plpgsql security definer set search_path = public as $$
declare sn public.product_snapshots; p public.products; s public.app_settings;
begin
  select * into s from public.app_settings where id = 1;
  select * into sn from public.product_snapshots where id = p_snapshot_id;
  if not found then raise exception 'Không tìm thấy lần đọc số'; end if;
  select * into p from public.products where id = sn.product_id;
  if p.owner_id is distinct from auth.uid() and not public.is_manager() then
    raise exception 'Chỉ người lưu mẫu hoặc quản lý được sửa số';
  end if;
  update public.product_snapshots set likes = p_likes, comments = p_comments, shares = p_shares, source = 'manual'
   where id = p_snapshot_id;
  perform public._evaluate_product(p.id, p.status = 'following' and p.tracking_done and not p.extra_tracking
                                         and p.tracking_day >= s.tracking_days);
end $$;

-- Danh sách mẫu của tôi cần đọc số hôm nay
create or replace function public.get_tracking_queue()
returns table (id uuid, post_url text, page_name text, tracking_day int, extra_tracking boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select p.id, p.post_url, p.page_name, (public.work_date(now()) - p.tracking_start_date)::int, p.extra_tracking
      from public.products p
     where p.owner_id = auth.uid()
       and p.status = 'following'
       and (not p.tracking_done or p.extra_tracking)
       and p.tracking_start_date < public.work_date(now())
       and not exists (select 1 from public.product_snapshots sn
                        where sn.product_id = p.id and sn.work_date = public.work_date(now())
                          and coalesce(sn.likes, sn.comments, sn.shares) is not null)
     order by p.created_at;
end $$;

create or replace function public.checkin_start() returns void
language sql security definer set search_path = public as $$
  insert into public.daily_checkins (user_id, work_date) values (auth.uid(), public.work_date(now()))
  on conflict (user_id, work_date) do nothing
$$;

create or replace function public.checkin_finish(p_ok int, p_failed int) returns void
language sql security definer set search_path = public as $$
  insert into public.daily_checkins (user_id, work_date, finished_at, posts_ok, posts_failed)
  values (auth.uid(), public.work_date(now()), now(), p_ok, p_failed)
  on conflict (user_id, work_date) do update set finished_at = now(),
    posts_ok = public.daily_checkins.posts_ok + excluded.posts_ok,
    posts_failed = excluded.posts_failed
$$;

-- ---------------------------------------------------------------------
--  Hiệu suất (tab Hiệu suất, chỉ quản lý)
-- ---------------------------------------------------------------------
create or replace function public.kpi(p_days int default 7)
returns table (user_id uuid, full_name text, staff_code text, role text, found int, worked_days int,
               updated_days int, approved int, failed int, pending int, today_found int, today_updated boolean)
language plpgsql stable security definer set search_path = public as $$
declare d date := public.work_date(now());
begin
  if not public.is_manager() then raise exception 'Chỉ quản lý xem được hiệu suất'; end if;
  return query
    select pr.id, pr.full_name, pr.staff_code, pr.role,
      (select count(*)::int from public.products x where x.owner_id = pr.id and x.created_work_date > d - p_days),
      (select count(distinct x.created_work_date)::int from public.products x where x.owner_id = pr.id and x.created_work_date > d - p_days),
      (select count(*)::int from public.daily_checkins c where c.user_id = pr.id and c.finished_at is not null and c.work_date > d - p_days),
      (select count(*)::int from public.products x where x.owner_id = pr.id and x.code is not null and x.created_work_date > d - p_days),
      (select count(*)::int from public.products x where x.owner_id = pr.id and x.status = 'fails' and x.created_work_date > d - p_days),
      (select count(*)::int from public.products x where x.owner_id = pr.id and x.pending_review),
      (select count(*)::int from public.products x where x.owner_id = pr.id and x.created_work_date = d),
      exists (select 1 from public.daily_checkins c where c.user_id = pr.id and c.work_date = d and c.finished_at is not null)
    from public.profiles pr
    where pr.active and pr.role in ('researcher', 'manager')
    order by pr.full_name;
end $$;

-- ---------------------------------------------------------------------
--  Việc theo lịch (pg_cron)
-- ---------------------------------------------------------------------
-- 6:00: nhắc người còn mẫu chưa đọc số trong ngày làm việc sắp kết thúc
create or replace function public.cron_reminder() returns void
language plpgsql security definer set search_path = public as $$
declare d date := public.work_date(now()); msg text;
begin
  select string_agg(format('• %s: còn %s mẫu chưa đọc số',
           coalesce('@' || nullif(k.telegram_username, ''), public.tg_esc(k.full_name)), k.n), E'\n')
    into msg
    from (select pr.full_name, pr.telegram_username, count(*) n
            from public.products p join public.profiles pr on pr.id = p.owner_id
           where p.status = 'following' and (not p.tracking_done or p.extra_tracking)
             and p.tracking_start_date < d
             and not exists (select 1 from public.product_snapshots sn where sn.product_id = p.id and sn.work_date = d
                              and coalesce(sn.likes, sn.comments, sn.shares) is not null)
           group by pr.id, pr.full_name, pr.telegram_username) k;
  if msg is not null then
    perform public.tg_send('⏰ <b>NHẮC ĐỌC SỐ</b> — mở Chrome để extension tự đọc số trước 7:00' || E'\n' || msg);
  end if;
end $$;

-- 7:05: báo cáo ngày làm việc vừa xong
create or replace function public.cron_daily_report() returns void
language plpgsql security definer set search_path = public as $$
declare
  d date := public.work_date(now()) - 1;
  s public.app_settings;
  body text; pend int; over int; extra int; extra_max int;
begin
  select * into s from public.app_settings where id = 1;
  select string_agg(format('• %s: %s', public.tg_esc(pr.full_name),
           case when k.n = 0 then 'KHÔNG có mẫu (nghỉ?)' else format('%s/%s mẫu', k.n, s.daily_target) end
           || case when k.upd then ' · đã đọc số' else '' end), E'\n' order by pr.full_name)
    into body
    from public.profiles pr
    cross join lateral (
      select (select count(*) from public.products x where x.owner_id = pr.id and x.created_work_date = d)::int n,
             exists (select 1 from public.daily_checkins c where c.user_id = pr.id and c.work_date = d and c.finished_at is not null) upd
    ) k
   where pr.active and pr.role = 'researcher';
  select count(*) filter (where pending_review), count(*) filter (where pending_review and due_at < now()),
         count(*) filter (where extra_tracking), max(public.work_date(now()) - tracking_start_date) filter (where extra_tracking)
    into pend, over, extra, extra_max
    from public.products where status = 'following';
  perform public.tg_send(format('📊 <b>BÁO CÁO NGÀY %s</b>', to_char(d, 'DD/MM')) || E'\n'
    || coalesce(body, 'Chưa có nhân viên tìm mẫu') || E'\n'
    || format('Chờ duyệt: %s (quá hạn %s)', pend, over)
    || case when extra > 0 then E'\n' || format('Đang theo dõi thêm: %s mẫu (lâu nhất %s ngày)', extra, extra_max) else '' end);
end $$;

-- Mỗi giờ: báo mẫu Chờ duyệt quá hạn + nhắc đánh giá campaign
create or replace function public.cron_check_overdue() returns void
language plpgsql security definer set search_path = public as $$
declare p public.products; s public.app_settings;
begin
  select * into s from public.app_settings where id = 1;
  for p in select * from public.products where status = 'following' and pending_review and not extra_tracking
             and due_at < now() and overdue_notified_at is null order by due_at loop
    perform public.tg_send('🔴 <b>CẦN XỬ LÝ</b> — quá hạn duyệt ' || s.review_hours || 'h' || E'\n' || public.tg_product_line(p));
    update public.products set overdue_notified_at = now() where id = p.id;
  end loop;
  for p in select * from public.products where status = 'up_campaign' and not campaign_eval_notified
             and campaign_started_at < now() - make_interval(days => s.campaign_eval_days) loop
    perform public.tg_send(format('📈 <b>ĐÁNH GIÁ CAMPAIGN</b> — đã chạy %s ngày: gắn Scale hoặc chuyển Campaign Fails / Scale',
                                  s.campaign_eval_days) || E'\n' || public.tg_product_line(p));
    update public.products set campaign_eval_notified = true where id = p.id;
  end loop;
end $$;

-- Lịch chạy (giờ UTC): 6:00 VN = 23:00 UTC, 7:05 VN = 00:05 UTC
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobname) from cron.job where jobname in ('dsh-reminder', 'dsh-daily-report', 'dsh-overdue');
    perform cron.schedule('dsh-reminder', '0 23 * * *', 'select public.cron_reminder()');
    perform cron.schedule('dsh-daily-report', '5 0 * * *', 'select public.cron_daily_report()');
    perform cron.schedule('dsh-overdue', '10 * * * *', 'select public.cron_check_overdue()');
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Phân quyền (RLS)
-- ---------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.app_secrets enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_snapshots enable row level security;
alter table public.daily_checkins enable row level security;

-- Xem được mẫu: quản lý tất cả; tìm mẫu: mẫu của mình; ads: các cột từ Up Store
create or replace function public.can_see_product(p_owner uuid, p_status text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.my_role()
    when 'manager' then true
    when 'researcher' then p_owner = auth.uid()
    when 'ads' then p_status in ('up_store', 'up_campaign', 'campaign_fails', 'scale_winning')
    else false end
$$;

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated using (true);
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for update to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_manager()) with check (id = auth.uid() or public.is_manager());

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (public.can_see_product(owner_id, status));
drop policy if exists products_update on public.products;
-- (quyền sửa từng cột và chuyển cột do trigger products_before_update kiểm tra)
create policy products_update on public.products for update to authenticated
  using (public.can_see_product(owner_id, status)) with check (true);
drop policy if exists products_delete on public.products;
create policy products_delete on public.products for delete to authenticated
  using (public.is_manager() or (owner_id = auth.uid() and status = 'following'));

drop policy if exists snapshots_read on public.product_snapshots;
create policy snapshots_read on public.product_snapshots for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.can_see_product(p.owner_id, p.status)));

drop policy if exists checkins_read on public.daily_checkins;
create policy checkins_read on public.daily_checkins for select to authenticated using (user_id = auth.uid() or public.is_manager());

grant select on public.app_settings, public.profiles, public.products, public.product_snapshots, public.daily_checkins to authenticated;
grant update on public.app_settings, public.profiles, public.products to authenticated;
grant delete on public.products to authenticated;
revoke all on public.app_secrets from anon, authenticated;
grant usage on sequence public.product_code_seq to authenticated;

revoke execute on function public._evaluate_product(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.tg_send(text) from public, anon, authenticated;
revoke execute on function public.cron_reminder() from public, anon, authenticated;
revoke execute on function public.cron_daily_report() from public, anon, authenticated;
revoke execute on function public.cron_check_overdue() from public, anon, authenticated;
revoke execute on function public.next_product_code() from public, anon;
grant execute on function public.next_product_code() to authenticated; -- trigger chạy với quyền người sửa

-- Quản lý đặt token bot Telegram (không ai đọc lại được)
create or replace function public.set_telegram_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Chỉ quản lý được đặt token Telegram'; end if;
  update public.app_secrets set telegram_bot_token = nullif(trim(p_token), '') where id = 1;
end $$;
create or replace function public.telegram_status() returns table (has_token boolean, chat_id text)
language sql stable security definer set search_path = public as $$
  select coalesce(sec.telegram_bot_token, '') <> '', st.telegram_chat_id
    from public.app_secrets sec, public.app_settings st where public.is_manager()
$$;
create or replace function public.telegram_test() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Chỉ quản lý'; end if;
  perform public.tg_send('✅ Dropship Hub đã kết nối Telegram');
end $$;

-- ---------------------------------------------------------------------
--  Realtime + lưu ảnh chụp (chỉ có trên Supabase thật)
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'products') then
    execute 'alter publication supabase_realtime add table public.products';
  end if;
end $$;

do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false) on conflict (id) do nothing;
    execute 'drop policy if exists "dsh screenshots upload" on storage.objects';
    execute $p$create policy "dsh screenshots upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists "dsh screenshots update" on storage.objects';
    execute $p$create policy "dsh screenshots update" on storage.objects for update to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists "dsh screenshots read" on storage.objects';
    execute $p$create policy "dsh screenshots read" on storage.objects for select to authenticated
      using (bucket_id = 'screenshots')$p$;
  end if;
end $$;
