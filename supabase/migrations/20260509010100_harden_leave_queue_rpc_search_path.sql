-- Tighten leave_queue_ticket search_path from 'public' to '' (empty).
-- All other SECURITY DEFINER RPCs in this codebase use set search_path = ''
-- as the hardened form. The function body already uses schema-qualified
-- references (public.queues), so the empty search_path is safe and consistent.

create or replace function public.leave_queue_ticket(
  p_ticket_id uuid,
  p_customer_fingerprint text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket record;
  v_supplied_fingerprint text;
begin
  if p_ticket_id is null then
    raise exception 'ticket_not_found';
  end if;

  v_supplied_fingerprint := nullif(left(btrim(p_customer_fingerprint), 128), '');

  select q.id, q.status, q.customer_fingerprint
  into v_ticket
  from public.queues q
  where q.id = p_ticket_id
  for update;

  if not found then
    raise exception 'ticket_not_found';
  end if;

  if v_ticket.status not in ('waiting', 'calling', 'serving') then
    raise exception 'ticket_not_active';
  end if;

  if v_ticket.customer_fingerprint is not null then
    if v_supplied_fingerprint is null
       or v_supplied_fingerprint <> v_ticket.customer_fingerprint then
      raise exception 'ticket_ownership_mismatch';
    end if;
  end if;

  update public.queues
  set status = 'missed',
      last_updated_at = now()
  where id = p_ticket_id;

  return true;
end;
$$;
