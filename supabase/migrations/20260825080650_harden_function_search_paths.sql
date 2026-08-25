alter function public.update_last_updated_at_column() set search_path = '';
alter function public.update_last_updated_column() set search_path = '';
alter function public.update_updated_at_column() set search_path = '';
alter function public.set_updated_at_timestamp() set search_path = '';
alter function public.normalize_artist_role(text) set search_path = '';

create or replace function public.check_active_currency_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_active_currency text;
begin
  if new.status in ('enable', 'soldout') then
    select p.currency into current_active_currency
    from public.products p
    where p.artist_id = new.artist_id
      and p.status in ('enable', 'soldout')
      and p.id != new.id
    limit 1;

    if current_active_currency is not null
      and current_active_currency != new.currency then
      raise exception 'Conflict Currency: ร้านนี้มีเมนูที่ขายเป็นสกุลเงิน % อยู่แล้ว ไม่สามารถเปิดขายเมนูที่เป็น % ผสมกันได้',
        current_active_currency,
        new.currency;
    end if;
  end if;

  return new;
end;
$$;
