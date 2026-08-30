-- Extensions + two Postgres roles that stand in for Supabase's
-- service_role / anon+RLS split (see §13 of the architecture doc).
--
-- recovery_service : used by the backend pipeline. BYPASSRLS, like a
--                    Supabase service-role key. Never exposed to a client.
-- recovery_app     : RLS-enforced. Stands in for the anon/frontend role.
--                    Tenancy is scoped via `app.current_merchant_id`,
--                    the local equivalent of Supabase's auth.uid().

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'recovery_service') then
    create role recovery_service with login password 'recovery_service' bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'recovery_app') then
    create role recovery_app with login password 'recovery_app';
  end if;
end
$$;
