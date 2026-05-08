-- Customer "leave queue" path. The grants hardening migration revokes anon
-- UPDATE on public.queues, so customers can no longer mark their own ticket
-- as `missed` through a direct table mutation. This migration adds a narrow
-- SECURITY DEFINER RPC that:
--
--   * loads the queue row FOR UPDATE
--   * verifies the ticket is still in an active state
--   * verifies ownership via the customer_fingerprint column when one is
--     stored on the row (anon fingerprints are best-effort idempotency tokens,
--     not credentials, but they prevent random anon callers from cancelling
--     other customers' tickets)
--   * transitions status to 'missed' and refreshes last_updated_at
--
-- The RPC is the only sanctioned path for anon customers to leave a queue;
-- direct anon UPDATE on public.queues stays blocked.
drop function if exists public.leave_queue_ticket(uuid, text);

create or replace function public.leave_queue_ticket(
  p_ticket_id uuid,
  p_customer_fingerprint text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
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

grant execute on function public.leave_queue_ticket(uuid, text) to anon, authenticated;
