-- FactoryOS · Quality — who raised a CAPA, set explicitly
--
-- Run after 0059.
--
-- Initiating a CAPA from a case was refused with "new row violates
-- row-level security policy for table capas". The insert policy asks for
-- `created_by = auth.uid()`, and the CAPA relied on the column's default to
-- supply it. This makes that hold however the table was first created:
--
--   · the default is (re)asserted on both tables, so a browser insert of an
--     action never has to send who it is;
--   · `initiate_capa()` and `create_capa_for_case()` write `created_by`
--     themselves rather than trusting the default.
--
-- Safe to run more than once.

alter table public.capas
  alter column created_by set default auth.uid();
alter table public.capa_actions
  alter column created_by set default auth.uid();

create or replace function public.initiate_capa(
  p_case       uuid,
  p_title      text,
  p_reason     text,
  p_owner      text,
  p_target     date,
  p_root_cause text,
  p_rca_method text,
  p_criteria   text,
  p_verify_by  date,
  p_actions    jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  target public.deviations%rowtype;
  new_id uuid;
begin
  select * into target from public.deviations where id = p_case;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if target.status = 'closed' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;

  insert into public.capas (
    factory_id, title, reason, owner_name, target_date,
    root_cause, rca_method, effectiveness_criteria, verify_by, created_by
  )
  values (
    target.factory_id,
    p_title,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_owner, '')), ''),
    p_target,
    nullif(btrim(coalesce(p_root_cause, '')), ''),
    nullif(btrim(coalesce(p_rca_method, '')), ''),
    nullif(btrim(coalesce(p_criteria, '')), ''),
    p_verify_by,
    auth.uid()
  )
  returning id into new_id;

  insert into public.capa_actions (
    factory_id, capa_id, kind, description, owner_name, target_date, created_by
  )
  select
    target.factory_id,
    new_id,
    x.kind,
    btrim(x.description),
    nullif(btrim(coalesce(x.owner_name, '')), ''),
    x.target_date,
    auth.uid()
  from jsonb_to_recordset(coalesce(p_actions, '[]'::jsonb))
    as x(kind text, description text, owner_name text, target_date date)
  where coalesce(btrim(x.description), '') <> '';

  update public.deviations
     set capa_id = new_id,
         capa_needed = true,
         capa_not_needed_reason = null
   where id = p_case;

  return new_id;
end;
$fn$;

revoke all on function public.initiate_capa(uuid, text, text, text, date, text, text, text, date, jsonb) from public;
grant execute on function public.initiate_capa(uuid, text, text, text, date, text, text, text, date, jsonb) to authenticated;
