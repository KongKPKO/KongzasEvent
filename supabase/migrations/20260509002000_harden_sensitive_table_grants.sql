-- Harden Data API grants for security-sensitive tables.
--
-- RLS policies remain the row-level authority, but grants decide whether anon
-- and authenticated browser roles can reach a table at all. Earlier baseline
-- migrations granted broad ALL-style privileges, including TRUNCATE, to public
-- roles. These revokes make sensitive payment/team/product/event mutations
-- deliberate and keep customer mutations on the RPC paths where stock and
-- idempotency checks live.

-- Never expose schema-control or RLS-bypassing table privileges to browser
-- roles. TRUNCATE is not row scoped, and TRIGGER/REFERENCES are not needed by
-- the client application.
revoke truncate, trigger, references on
  public.artist_members,
  public.artist_promotions,
  public.event_member_assignments,
  public.event_products,
  public.events,
  public.order_items,
  public.orders,
  public.products,
  public.queues
from anon, authenticated;

-- Anonymous customers only need read access to public catalog/event/queue
-- views plus RPC execution for queue tickets and customer orders. They should
-- not directly insert/update/delete sensitive queue, order, product, event, or
-- team rows.
revoke insert, update, delete on
  public.artist_members,
  public.artist_promotions,
  public.event_member_assignments,
  public.event_products,
  public.events,
  public.order_items,
  public.orders,
  public.products,
  public.queues
from anon;

-- POS/payment writes are RPC-only so stock reservation, stock sale conversion,
-- payment idempotency, and staff authorization checks cannot be bypassed with
-- direct Data API writes.
revoke insert, update, delete on public.orders, public.order_items
from authenticated;

-- Queue creation is RPC-only (`create_queue_ticket`) and queue deletes are not
-- part of the app workflow. Authenticated queue staff still retain scoped UPDATE
-- through existing RLS policies for call/arrive/missed status transitions.
revoke insert, delete on public.queues
from authenticated;
