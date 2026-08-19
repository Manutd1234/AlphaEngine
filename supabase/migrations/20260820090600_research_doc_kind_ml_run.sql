-- 'ml_run' joins the corpus's kind vocabulary.
--
-- A supervised run is not a backtest_run. It shares the provenance — the same
-- data_hash, the same deflated Sharpe — but it also has a fitted model, a
-- feature spec and folds with a purge, and a reader filtering the corpus for
-- "what has this desk fitted" cannot get there through a kind that also means
-- "moving-average sweep". Kinds are how this corpus is filtered
-- (match_research_documents_hybrid takes filter_kind), so collapsing the two
-- would make that filter answer a question nobody asked.
--
-- ADD VALUE rather than a new type. Rewriting the enum would mean rewriting
-- every row in research_documents and every function that names the type; the
-- value is appended, which is a catalogue change and touches no data.
--
-- Postgres will not let a value added in a transaction be USED in that same
-- transaction. Supabase runs each migration file in one, so this file adds the
-- value and nothing else — the first insert that uses it necessarily happens
-- in a later statement, from the application.

alter type public.research_doc_kind add value if not exists 'ml_run';
