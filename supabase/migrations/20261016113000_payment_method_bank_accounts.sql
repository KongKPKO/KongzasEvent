-- A payment instruction is one recipient and may offer several bank accounts.
-- Keep the original bank columns synchronized for deployed clients that still
-- read or write the first account directly.

create function private.is_valid_payment_bank_accounts(p_bank_accounts jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_account jsonb;
begin
  if jsonb_typeof(p_bank_accounts) is distinct from 'array' then
    return false;
  end if;

  for v_account in
    select value
    from jsonb_array_elements(p_bank_accounts)
  loop
    if jsonb_typeof(v_account) is distinct from 'object' then
      return false;
    end if;

    if not (v_account ?& array['bank_name', 'account_name', 'account_number'])
      or exists (
        select 1
        from jsonb_object_keys(v_account) as account_key(key)
        where account_key.key <> all (array['bank_name', 'account_name', 'account_number'])
      )
      or jsonb_typeof(v_account -> 'bank_name') is distinct from 'string'
      or jsonb_typeof(v_account -> 'account_name') is distinct from 'string'
      or jsonb_typeof(v_account -> 'account_number') is distinct from 'string'
      or nullif(concat_ws('',
        btrim(v_account ->> 'bank_name'),
        btrim(v_account ->> 'account_name'),
        btrim(v_account ->> 'account_number')
      ), '') is null
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.is_valid_payment_bank_accounts(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.is_valid_payment_bank_accounts(jsonb)
  to anon, authenticated, service_role;

alter table public.event_payment_methods
  add column bank_accounts jsonb not null default '[]'::jsonb;

alter table public.campaign_payment_methods
  add column bank_accounts jsonb not null default '[]'::jsonb;

-- Preserve every legacy row that has at least one populated bank field.
update public.event_payment_methods
set bank_accounts = jsonb_build_array(jsonb_build_object(
  'bank_name', coalesce(bank_name, ''),
  'account_name', coalesce(account_name, ''),
  'account_number', coalesce(account_number, '')
))
where nullif(concat_ws('',
  btrim(coalesce(bank_name, '')),
  btrim(coalesce(account_name, '')),
  btrim(coalesce(account_number, ''))
), '') is not null;

update public.campaign_payment_methods
set bank_accounts = jsonb_build_array(jsonb_build_object(
  'bank_name', coalesce(bank_name, ''),
  'account_name', coalesce(account_name, ''),
  'account_number', coalesce(account_number, '')
))
where nullif(concat_ws('',
  btrim(coalesce(bank_name, '')),
  btrim(coalesce(account_name, '')),
  btrim(coalesce(account_number, ''))
), '') is not null;

alter table public.event_payment_methods
  add constraint event_payment_methods_bank_accounts_check
  check (private.is_valid_payment_bank_accounts(bank_accounts));

alter table public.campaign_payment_methods
  add constraint campaign_payment_methods_bank_accounts_check
  check (private.is_valid_payment_bank_accounts(bank_accounts));

create function private.sync_payment_method_bank_accounts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_legacy_has_value boolean;
begin
  v_legacy_has_value := nullif(concat_ws('',
    btrim(coalesce(new.bank_name, '')),
    btrim(coalesce(new.account_name, '')),
    btrim(coalesce(new.account_number, ''))
  ), '') is not null;

  if tg_op = 'INSERT' then
    if jsonb_typeof(new.bank_accounts) = 'array'
      and jsonb_array_length(new.bank_accounts) > 0
    then
      new.bank_name := new.bank_accounts -> 0 ->> 'bank_name';
      new.account_name := new.bank_accounts -> 0 ->> 'account_name';
      new.account_number := new.bank_accounts -> 0 ->> 'account_number';
    elsif new.bank_accounts = '[]'::jsonb and v_legacy_has_value then
      new.bank_accounts := jsonb_build_array(jsonb_build_object(
        'bank_name', coalesce(new.bank_name, ''),
        'account_name', coalesce(new.account_name, ''),
        'account_number', coalesce(new.account_number, '')
      ));
    end if;

    return new;
  end if;

  if new.bank_accounts is distinct from old.bank_accounts then
    if jsonb_typeof(new.bank_accounts) = 'array' then
      if jsonb_array_length(new.bank_accounts) > 0 then
        new.bank_name := new.bank_accounts -> 0 ->> 'bank_name';
        new.account_name := new.bank_accounts -> 0 ->> 'account_name';
        new.account_number := new.bank_accounts -> 0 ->> 'account_number';
      else
        new.bank_name := null;
        new.account_name := null;
        new.account_number := null;
      end if;
    end if;
  elsif row(new.bank_name, new.account_name, new.account_number)
    is distinct from row(old.bank_name, old.account_name, old.account_number)
  then
    if v_legacy_has_value then
      if jsonb_array_length(new.bank_accounts) = 0 then
        new.bank_accounts := jsonb_build_array(jsonb_build_object(
          'bank_name', coalesce(new.bank_name, ''),
          'account_name', coalesce(new.account_name, ''),
          'account_number', coalesce(new.account_number, '')
        ));
      else
        new.bank_accounts := jsonb_set(
          new.bank_accounts,
          '{0}',
          jsonb_build_object(
            'bank_name', coalesce(new.bank_name, ''),
            'account_name', coalesce(new.account_name, ''),
            'account_number', coalesce(new.account_number, '')
          ),
          false
        );
      end if;
    elsif jsonb_array_length(new.bank_accounts) > 0 then
      new.bank_accounts := new.bank_accounts - 0;

      if jsonb_array_length(new.bank_accounts) > 0 then
        new.bank_name := new.bank_accounts -> 0 ->> 'bank_name';
        new.account_name := new.bank_accounts -> 0 ->> 'account_name';
        new.account_number := new.bank_accounts -> 0 ->> 'account_number';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_payment_method_bank_accounts()
  from public, anon, authenticated, service_role;

create trigger trg_event_payment_methods_sync_bank_accounts
before insert or update of bank_accounts, bank_name, account_name, account_number
on public.event_payment_methods
for each row execute function private.sync_payment_method_bank_accounts();

create trigger trg_campaign_payment_methods_sync_bank_accounts
before insert or update of bank_accounts, bank_name, account_name, account_number
on public.campaign_payment_methods
for each row execute function private.sync_payment_method_bank_accounts();

-- This public campaign RPC builds payment JSON field-by-field. Other payment
-- projections use to_jsonb(payment_method), so the new column flows through
-- their existing public/create/workspace payloads automatically.
do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.get_public_online_campaign(text,text)'::regprocedure);

  if strpos(definition, '''bank_accounts'', pm.bank_accounts') = 0 then
    if strpos(definition, '''bank_name'', pm.bank_name') = 0 then
      raise exception 'Unexpected public campaign payment projection';
    end if;

    definition := replace(
      definition,
      '''bank_name'', pm.bank_name',
      '''bank_name'', pm.bank_name,
      ''bank_accounts'', pm.bank_accounts'
    );
    execute definition;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
