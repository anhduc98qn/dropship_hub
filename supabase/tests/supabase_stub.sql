-- =====================================================================
--  Giả lập phần "Supabase" tối thiểu để chạy schema.sql trong PGlite / PostgreSQL thường:
--  vai trò anon/authenticated, schema auth (users, uid()), net.http_post (ghi vào net.sent
--  thay vì gửi Telegram thật). KHÔNG chạy file này trên Supabase thật.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- pg_net giả: lưu yêu cầu để test đọc lại nội dung tin nhắn
create schema if not exists net;
create table if not exists net.sent (
  id bigserial primary key,
  url text,
  body jsonb,
  created_at timestamptz not null default now()
);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint
language sql as $$
  insert into net.sent(url, body) values (url, body) returning id
$$;

grant usage on schema public to anon, authenticated;
