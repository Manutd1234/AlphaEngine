-- The private bucket profile avatars live in.
--
-- PRIVATE, and that is the whole security posture. A public bucket serves
-- `/storage/v1/object/public/<bucket>/<path>` to anyone who asks, with no
-- policy evaluated on the way — and nothing in this repository probes
-- `/storage/v1/*`, so the exposure would be invisible to every check that
-- currently runs. Reads go through short-lived signed URLs instead.
--
-- Ownership is the first path segment: `<uid>/avatar.png`. Every policy below
-- compares `(storage.foldername(name))[1]` to the caller's uid, so a signed-in
-- account can write and replace exactly one folder and read nobody else's.
--
-- WHY THIS RUNS INSIDE A DO BLOCK
--
-- `storage.objects` and `storage.buckets` are owned by `supabase_storage_admin`,
-- and `create policy` requires ownership of the table. The migration role is
-- widely `postgres` and widely does own these, but that is a property of the
-- project, not something this repository can prove. `supabase db push` aborts
-- the entire job on the first failing statement — which would take the sessions
-- migration in the commit before this one, both Edge Function deploys and the
-- anonymous probe down with it, for a bucket.
--
-- So the failure is contained and, more importantly, is not silent: it raises a
-- WARNING that names the exact dashboard steps. `raise notice` would be worse
-- than useless here, because a migration that quietly does nothing is
-- indistinguishable from one that worked.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars',
    'avatars',
    false,
    2097152,                                    -- 2 MiB; an avatar is not a document
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  )
  on conflict (id) do update
    set public             = false,             -- never let a later hand flip it
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception
  when insufficient_privilege or undefined_table then
    raise warning using message =
      'avatars bucket not created: the migration role cannot write storage.buckets. '
      'Create it by hand: Storage -> New bucket -> name "avatars", Public OFF, '
      'file size limit 2 MB. The profile page degrades to initials until it exists.';
end;
$$;

do $$
begin
  -- Dropped first so re-applying this migration against a project that already
  -- has them is not an error. `create policy` has no `if not exists`.
  drop policy if exists "Avatars are readable by their owner"   on storage.objects;
  drop policy if exists "Avatars are writable by their owner"   on storage.objects;
  drop policy if exists "Avatars are replaceable by their owner" on storage.objects;
  drop policy if exists "Avatars are removable by their owner"  on storage.objects;

  -- SELECT is needed even though reads go through signed URLs: creating a
  -- signed URL is itself authorised against these policies.
  create policy "Avatars are readable by their owner"
    on storage.objects for select
    to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  create policy "Avatars are writable by their owner"
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  -- `using` AND `with check`: without the second clause an account could move a
  -- row it owns into somebody else's folder.
  create policy "Avatars are replaceable by their owner"
    on storage.objects for update
    to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  create policy "Avatars are removable by their owner"
    on storage.objects for delete
    to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  -- No policy names `anon` at all. Anonymous visitors browse the whole desk
  -- without an account and have no avatar to reach; the absence is the rule.
exception
  when insufficient_privilege then
    raise warning using message =
      'avatars policies not created: the migration role does not own '
      'storage.objects. Add them by hand in Storage -> Policies on the avatars '
      'bucket, scoped to (storage.foldername(name))[1] = auth.uid()::text for '
      'select, insert, update and delete. Until then uploads are rejected, '
      'which is the safe direction to fail.';
end;
$$;
