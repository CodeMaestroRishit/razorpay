-- recovery_service is the pipeline's own connection (BYPASSRLS, set up in
-- 0001_init.sql), but BYPASSRLS only skips row-security policies — it does
-- not imply table-level GRANTs. Without this, every pipeline write fails
-- with "permission denied" against tables owned by the migration
-- bootstrap role. This is the local equivalent of a Supabase service-role
-- key, which similarly needs its own grants, not just RLS bypass.

grant usage on schema public to recovery_service;
grant all privileges on all tables in schema public to recovery_service;
grant all privileges on all sequences in schema public to recovery_service;
