-- FactoryOS · Quality — marking a CAPA action done takes any date
--
-- Run after 0080.
--
-- 0075 (M5) kept an action's "date done" between the day its CAPA was
-- raised and today. The date picker now offers every date, so the guard
-- stops refusing one outside that window:
--
--   · `capa_actions_guard` — the two date checks are gone. The date is
--     still required, with the evidence and the name.
--
-- The function is 0075's, unchanged apart from those two checks.

create or replace function public.capa_actions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  parent public.capas%rowtype;
  nullable_keys text[] := array['created_by', 'closed_by'];
begin
  select * into parent from public.capas where id = new.capa_id;
  if not found or parent.factory_id <> new.factory_id then
    raise exception 'That CAPA is not in this factory.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.capa_id is distinct from old.capa_id
       or new.factory_id is distinct from old.factory_id
       or new.created_at is distinct from old.created_at then
      raise exception 'An action stays on the CAPA it was raised under.'
        using errcode = 'check_violation';
    end if;

    if old.closed_date is not null then
      if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys) then
        raise exception 'This action is done — a done action is not edited.'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
  end if;

  if parent.status::text <> 'open' then
    raise exception '% is closed — its actions are not changed.', parent.capa_no
      using errcode = 'check_violation';
  end if;

  new.evidence      := nullif(btrim(coalesce(new.evidence, '')), '');
  new.linked_record := nullif(btrim(coalesce(new.linked_record, '')), '');

  if new.closed_date is not null then
    if parent.plan_approved_at is null then
      raise exception 'Approve the CAPA plan first — its actions start after approval.'
        using errcode = 'check_violation';
    end if;
    if new.evidence is null then
      raise exception 'Give the evidence — a document, record or work order.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.closed_by_name), '') = '' then
      raise exception 'Marking an action done needs a name against it.'
        using errcode = 'check_violation';
    end if;
    new.closed_by := auth.uid();
  else
    new.closed_by_name := null;
    new.closed_by := null;
  end if;

  return new;
end;
$fn$;
