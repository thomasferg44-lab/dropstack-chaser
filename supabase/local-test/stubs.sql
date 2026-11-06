-- Minimal stand-ins for what Supabase provides, so the repo's SQL runs on a
-- throwaway local Postgres (PGlite). NOT a Supabase replica: no PostgREST.
-- Supabase's default privileges are recreated (they grant EXECUTE on every
-- new function to anon and authenticated), because that is what makes the
-- revoke lines in schema.sql necessary.
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json->>'role' $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated;
