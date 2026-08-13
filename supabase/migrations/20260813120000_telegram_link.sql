-- One row per account: the Telegram chat that account has connected, so the
-- workspace can say "Connected as @handle" after the browser that arranged it
-- has been closed.
--
-- WHAT THIS ROW IS NOT. It is not a credential and it authenticates nothing.
-- Telegram has its own allow-list, and a binding grants that Telegram user the
-- same READING a web desk pass already gives — the shared book, the shared kill
-- switch, the shared counters — over a second transport. It never grants the
-- controls: /halt, /resume, /flatten, /reduceonly and /resetbook stay behind the
-- gateway's TELEGRAM_CONTROL_USER_IDS, which lives in deployment config and is
-- not reachable from this table or from any request. Nothing here is ever read
-- in the other direction: no Telegram identity authenticates a web request.
--
-- TWO STORES, DELIBERATELY. A GUEST binding is not here. It lives in the
-- gateway's own DuckDB `subscribers` row and lapses on its own clock, because a
-- guest desk pass is a browser-session cookie with no account behind it and
-- nothing durable to hang off. This table is the signed-in half: durable, and
-- gone when the account is, through the cascade below.
--
-- The gateway writes these rows with the service role, because the gateway is
-- the only party that holds the Telegram user id. The policies below are what
-- the *account* may do with its own row from the browser.
create table public.telegram_link (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  -- Telegram ids are 64-bit and getting longer; text avoids the day one stops
  -- fitting, and nothing here does arithmetic on them.
  telegram_user_id  text not null,
  telegram_chat_id  text not null,
  -- Handles are renameable, so this is a label for display and never a key.
  telegram_username text,
  linked_at         timestamptz not null default now(),
  -- One Telegram account, one desk account. Without this a single Telegram user
  -- could be bound to several accounts at once, and the gateway's alert routing
  -- would have no way to say which desk identity a chat belongs to.
  constraint telegram_link_one_account_per_telegram_user unique (telegram_user_id)
);

alter table public.telegram_link enable row level security;

-- Anonymous visitors have no account and therefore no row here. A guest who
-- connects a chat is recorded in the gateway's store instead, and reads nothing
-- from this table.
revoke all on public.telegram_link from anon;

create policy "Users read own telegram link"
  on public.telegram_link for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert own telegram link"
  on public.telegram_link for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own telegram link"
  on public.telegram_link for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: closing the account drops the row through the cascade
-- above. Note what that means for revocation and do not mistake it for an
-- oversight — a binding conveys read parity with a desk pass anyone can mint,
-- so there is nothing exclusive to withdraw in a hurry.

notify pgrst, 'reload schema';
