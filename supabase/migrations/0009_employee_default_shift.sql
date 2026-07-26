-- FactoryOS · Admin → Employees: default shift
-- Which shift someone normally works. The attendance grid and roster read this
-- to pre-fill who is expected on a given shift, so it belongs on the person,
-- not on each day's record.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'shift_slot') then
    create type public.shift_slot as enum ('morning', 'afternoon', 'both');
  end if;
end
$$;

alter table public.profiles
  add column if not exists default_shift public.shift_slot not null default 'morning';

-- The invite/import flows pass the shift as auth metadata, so the profile
-- trigger has to carry it across too (0001 only read role / full_name /
-- factory_id). Unknown or missing values fall back to morning.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, role, factory_id, default_shift
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'operator'),
    (new.raw_user_meta_data ->> 'factory_id')::uuid,
    coalesce(
      (new.raw_user_meta_data ->> 'default_shift')::public.shift_slot,
      'morning'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
