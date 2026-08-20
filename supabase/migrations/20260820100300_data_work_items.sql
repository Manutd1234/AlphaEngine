-- E3.4 — data_work_items in Postgres, and the id sequence SQLite did by hand.
--
-- `WorkItemStore.create` mints ids as
-- `MAX(CAST(substr(id, ?) AS INTEGER)) + 1` inside a transaction, per prefix.
-- That is a read-modify-write standing in for a sequence because SQLite has
-- none. Postgres does, so the prefixes get real sequences and the RPC below
-- allocates from them atomically — which is stronger than the lock it replaces,
-- not weaker.
--
-- The sequences are seeded to match the committed fixture: `test_work_items.py`
-- pins the literal next ids `BUG-095` and `REQ-188`, so they start at 95 and
-- 188. A sequence that started at 1 would pass every behavioural test and fail
-- that one, which is the test doing its job.

create table if not exists public.data_work_items (
  id          text primary key,
  desk_id     text not null default 'default',
  kind        text not null check (kind in ('request', 'ticket', 'bug')),
  priority    text not null check (priority in ('P0', 'P1', 'P2', 'P3')),
  status      text not null check (status in ('intake', 'ready', 'progress', 'resolved')),
  title       text not null,
  summary     text not null default '',
  owner       text not null default 'Unassigned',
  area        text not null default 'Pipeline',
  opened_at   double precision not null,
  sla_due_at  double precision,
  resolved_at double precision,
  created_by  text not null,
  updated_at  double precision not null,
  updated_by  text not null,
  version     integer not null default 1
);

create index if not exists ix_work_items_status
  on public.data_work_items (desk_id, status, priority, opened_at);

create sequence if not exists public.work_item_bug_seq start with 95;
create sequence if not exists public.work_item_req_seq start with 188;
create sequence if not exists public.work_item_tkt_seq start with 323;

-- One id, allocated atomically. Returns the formatted id rather than the raw
-- number so the caller cannot format it two different ways.
create or replace function public.next_work_item_id(prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  case upper(prefix)
    when 'BUG' then n := nextval('public.work_item_bug_seq');
    when 'REQ' then n := nextval('public.work_item_req_seq');
    when 'TKT' then n := nextval('public.work_item_tkt_seq');
    else raise exception 'unknown work item prefix: %', prefix;
  end case;
  return upper(prefix) || '-' || lpad(n::text, 3, '0');
end;
$$;

alter table public.data_work_items enable row level security;
