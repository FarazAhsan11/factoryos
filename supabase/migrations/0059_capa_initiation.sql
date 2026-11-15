-- FactoryOS · Quality — initiating a CAPA in one step
--
-- Run after 0058.
--
-- A case's CAPA tab now offers the reference system's four paths: resolve
-- directly (no CAPA, a correction instead), initiate a CAPA, link to an open
-- CAPA with the same root cause, or decide at review. Initiating is one form
-- that writes the whole plan at once — title, why a CAPA, owner, target
-- date, the root cause and how it was found, the first corrective and
-- preventive actions, and the effectiveness criteria with their verify-by
-- date — so the CAPA gets four more columns:
--
--   reason       why this case earns a CAPA (a checked list)
--   target_date  when the CAPA is meant to be complete — distinct from
--                verify_by, when its effectiveness is checked
--   root_cause   the cause the actions address, shared by every case linked
--                to the CAPA rather than retyped on each
--   rca_method   how it was found: 5-Why, Fishbone, Fault tree, FMEA
--
-- All four stay editable while the CAPA is open and freeze with the rest of
-- it once verified (the jsonb test in `capas_guard` covers new columns
-- without being told about them).
--
-- `initiate_capa()` writes the CAPA, its actions and the case's link in one
-- transaction — `security invoker`, so the caller's RLS still decides.
-- `create_capa_for_case()` (0057) stays, unused.

-- ── 1. The columns ───────────────────────────────────────────────────────

alter table public.capas
  add column if not exists reason      text,
  add column if not exists target_date date,
  add column if not exists root_cause  text,
  add column if not exists rca_method  text;

alter table public.capas
  drop constraint if exists capas_reason_known;
alter table public.capas
  add constraint capas_reason_known check (
    reason is null or reason in (
      'Critical / Major impact', 'Recurring issue', 'Systemic',
      'Regulatory / customer impact'
    )
  );

alter table public.capas
  drop constraint if exists capas_rca_method_known;
alter table public.capas
  add constraint capas_rca_method_known check (
    rca_method is null or rca_method in (
      '5-Why', 'Fishbone (Ishikawa)', 'Fault tree', 'FMEA'
    )
  );

-- ── 2. Initiate: CAPA, actions and link, together ────────────────────────

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
  -- [{ "kind": "ca" | "pa", "description": text, "owner_name": text,
  --    "target_date": "YYYY-MM-DD" | null }, …]
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
    root_cause, rca_method, effectiveness_criteria, verify_by
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
    p_verify_by
  )
  returning id into new_id;

  insert into public.capa_actions (
    factory_id, capa_id, kind, description, owner_name, target_date
  )
  select
    target.factory_id,
    new_id,
    x.kind,
    btrim(x.description),
    nullif(btrim(coalesce(x.owner_name, '')), ''),
    x.target_date
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

-- ── 3. The register's view, with the new columns appended ────────────────

create or replace view public.capas_expanded
with (security_invoker = true) as
select
  c.id,
  c.factory_id,
  c.capa_no,
  c.title,
  c.owner_name,
  c.status,
  c.effectiveness_criteria,
  c.verify_by,
  c.verification,
  c.verified_by_name,
  c.verified_at,
  c.created_by,
  c.created_at,

  (select count(*) from public.capa_actions x where x.capa_id = c.id)
    as action_count,
  (select count(*) from public.capa_actions x
    where x.capa_id = c.id and x.closed_date is not null)
    as actions_closed,
  (select count(*) from public.capa_actions x
    where x.capa_id = c.id and x.closed_date is null
      and x.target_date is not null and x.target_date < current_date)
    as actions_overdue,
  (c.status = 'open' and c.verify_by is not null and c.verify_by < current_date)
    as is_verify_overdue,

  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'deviation_no', d.deviation_no,
        'type', d.type,
        'status', d.status
      )
      order by d.created_at
    )
    from public.deviations d
    where d.capa_id = c.id
  ), '[]'::jsonb) as cases,

  -- ── Appended by 0059 ──────────────────────────────────────────────────
  c.reason,
  c.target_date,
  c.root_cause,
  c.rca_method,
  (c.status = 'open' and c.target_date is not null and c.target_date < current_date)
    as is_overdue
from public.capas c;

grant select on public.capas_expanded to authenticated;
