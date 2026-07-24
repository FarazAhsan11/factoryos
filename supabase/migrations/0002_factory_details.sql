-- FactoryOS · Step 1: factory details + logo storage
-- Adds description + logo to factories and a public bucket to hold logos.

-- ── Factory profile fields ───────────────────────────────────────────────
alter table public.factories
  add column if not exists description text,
  add column if not exists logo_url   text;

-- ── Storage bucket for factory logos ─────────────────────────────────────
-- Public read so the URL can be dropped straight into <img>/emails. Writes
-- happen server-side with the service-role key (which bypasses RLS), so no
-- storage policies are needed for the create-factory flow.
insert into storage.buckets (id, name, public)
values ('factory-logos', 'factory-logos', true)
on conflict (id) do nothing;
