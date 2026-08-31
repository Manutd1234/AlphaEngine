-- Replace every physical row for one logical research document atomically.
--
-- Chunking originally posted one row at a time.  When a renderer changed the
-- chunk count, the new deterministic refs did not conflict with the old ones,
-- so both generations stayed retrievable.  Deleting first is worse: an embed
-- or HTTP failure would erase the only complete version.  This RPC stages the
-- whole set in one Postgres transaction and removes older siblings only when
-- every incoming row carries a ready embedding.  Any SQL/HTTP failure rolls
-- back the upserts and the delete together.

create or replace function public.replace_research_document_chunks(
  p_desk_id uuid,
  p_kind public.research_doc_kind,
  p_parent_source_ref text,
  p_rows jsonb
)
returns setof public.research_documents
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_count integer;
  v_distinct integer;
  v_source_refs text[];
  v_complete boolean;
  v_direct boolean;
begin
  if p_desk_id is null then
    raise exception using errcode = 'not_null_violation', message = 'p_desk_id is required';
  end if;
  if p_kind is null then
    raise exception using errcode = 'not_null_violation', message = 'p_kind is required';
  end if;
  if nullif(btrim(p_parent_source_ref), '') is null then
    raise exception using errcode = 'not_null_violation', message = 'p_parent_source_ref is required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'check_violation', message = 'p_rows must be a non-empty JSON array';
  end if;
  if jsonb_array_length(p_rows) > 128 then
    raise exception using errcode = 'check_violation', message = 'one document may not exceed 128 chunks';
  end if;

  select
    count(*)::integer,
    count(distinct row->>'source_ref')::integer,
    array_agg(row->>'source_ref' order by ordinal),
    bool_and(
      row->>'embedding_status' = 'ready'
      and jsonb_typeof(row->'embedding') = 'array'
    )
  into v_count, v_distinct, v_source_refs, v_complete
  from jsonb_array_elements(p_rows) with ordinality as incoming(row, ordinal);

  if v_distinct <> v_count or exists (
    select 1 from jsonb_array_elements(p_rows) row
    where nullif(btrim(row->>'source_ref'), '') is null
  ) then
    raise exception using errcode = 'check_violation', message = 'incoming source_ref values must be non-empty and unique';
  end if;

  select
    v_count = 1
    and p_rows->0->>'source_ref' = p_parent_source_ref
    and p_rows->0 #>> '{metrics,_retrieval_chunk,parent_source_ref}' is null
  into v_direct;

  if not v_direct and exists (
    select 1
    from jsonb_array_elements(p_rows) with ordinality as incoming(row, ordinal)
    where row #>> '{metrics,_retrieval_chunk,parent_source_ref}' is distinct from p_parent_source_ref
       or row #>> '{metrics,_retrieval_chunk,chunk_source_ref}' is distinct from row->>'source_ref'
       or coalesce(row #>> '{metrics,_retrieval_chunk,index}', '') !~ '^[0-9]+$'
       or coalesce(row #>> '{metrics,_retrieval_chunk,count}', '') !~ '^[0-9]+$'
       or (row #>> '{metrics,_retrieval_chunk,index}')::integer <> ordinal
       or (row #>> '{metrics,_retrieval_chunk,count}')::integer <> v_count
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'p_rows must be one direct document or one complete ordered chunk generation';
  end if;

  insert into public.research_documents (
    desk_id, user_id, kind, source_ref, symbol, interval, strategy,
    occurred_at, title, body, metrics, data_hash,
    embedding, embedding_model, embedding_status,
    image_embedding, image_embedding_model, image_embedding_status
  )
  select
    p_desk_id, incoming.user_id, p_kind, btrim(incoming.source_ref),
    incoming.symbol, incoming.interval, incoming.strategy,
    incoming.occurred_at, incoming.title, incoming.body,
    coalesce(incoming.metrics, '{}'::jsonb), incoming.data_hash,
    case when v_complete and jsonb_typeof(incoming.embedding) = 'array'
      then incoming.embedding::text::extensions.vector(384) else null end,
    case when v_complete then incoming.embedding_model else null end,
    case when v_complete then 'ready' else 'pending' end,
    case when v_complete and jsonb_typeof(incoming.image_embedding) = 'array'
      then incoming.image_embedding::text::extensions.vector(512) else null end,
    case when v_complete then incoming.image_embedding_model else null end,
    case when v_complete then coalesce(incoming.image_embedding_status, 'absent') else 'absent' end
  from jsonb_to_recordset(p_rows) as incoming(
    user_id uuid,
    source_ref text,
    symbol text,
    interval text,
    strategy text,
    occurred_at timestamptz,
    title text,
    body text,
    metrics jsonb,
    data_hash text,
    embedding jsonb,
    embedding_model text,
    embedding_status text,
    image_embedding jsonb,
    image_embedding_model text,
    image_embedding_status text
  )
  on conflict (desk_id, kind, source_ref) do update set
    user_id = excluded.user_id,
    symbol = excluded.symbol,
    interval = excluded.interval,
    strategy = excluded.strategy,
    occurred_at = excluded.occurred_at,
    title = excluded.title,
    body = excluded.body,
    metrics = excluded.metrics,
    data_hash = excluded.data_hash,
    embedding = excluded.embedding,
    embedding_model = excluded.embedding_model,
    embedding_status = excluded.embedding_status,
    image_embedding = excluded.image_embedding,
    image_embedding_model = excluded.image_embedding_model,
    image_embedding_status = excluded.image_embedding_status
  where v_complete;

  -- Pending rows are useful retry records but cannot replace the only complete
  -- generation.  A later backfill sends the same content-derived refs with
  -- ready vectors, reaches this branch and retires the old siblings then.
  if v_complete then
    delete from public.research_documents document
    where document.desk_id = p_desk_id
      and document.kind = p_kind
      and (
        document.source_ref = p_parent_source_ref
        or document.metrics #>> '{_retrieval_chunk,parent_source_ref}' = p_parent_source_ref
      )
      and not (document.source_ref = any(v_source_refs));
  end if;

  return query
  select document.*
  from public.research_documents document
  where document.desk_id = p_desk_id
    and document.kind = p_kind
    and document.source_ref = any(v_source_refs)
  order by document.source_ref;
end
$$;

comment on function public.replace_research_document_chunks(
  uuid, public.research_doc_kind, text, jsonb
) is
  'Atomically upserts one logical document generation and deletes stale siblings only when every incoming text embedding is ready.';

revoke execute on function public.replace_research_document_chunks(
  uuid, public.research_doc_kind, text, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_research_document_chunks(
  uuid, public.research_doc_kind, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
