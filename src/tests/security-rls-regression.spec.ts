import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const {
  url: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
} = resolveSupabaseTestEnv();

const OWNER_EMAIL = `rls-owner-${Date.now()}@example.com`;
const OWNER_PASSWORD = 'LocalOnlyRlsOwnerPassword123!';
const OTHER_EMAIL = `rls-other-${Date.now()}@example.com`;
const OTHER_PASSWORD = 'LocalOnlyRlsOtherPassword123!';

const service = createClient(SUPABASE_URL, SERVICE_KEY);
const anon = createClient(SUPABASE_URL, ANON_KEY);

const ids = {
  artist: randomUUID() as string,
  unrelatedUser: '',
  event: randomUUID(),
  secondEvent: randomUUID(),
  allocationEvent: randomUUID(),
  currencyEvent: randomUUID(),
  queue: randomUUID(),
  currencyQueue: randomUUID(),
  product: randomUUID(),
  secondProduct: randomUUID(),
  raceProduct: randomUUID(),
  allocationProduct: randomUUID(),
  currencyProduct: randomUUID(),
  order: randomUUID(),
  secondOrder: randomUUID(),
  raceOrder: randomUUID(),
};

const signInClient = async (email: string, password: string) => {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
};

const createConfirmedUser = async (email: string, password: string) => {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const signUp = await client.auth.signUp({ email, password });
  if (signUp.data.user) return signUp.data.user.id;

  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  if (!signIn.data.user) throw new Error(`Failed to create or sign in user ${email}`);
  return signIn.data.user.id;
};

const seedFixtures = async () => {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const serviceDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  ids.artist = await createConfirmedUser(OWNER_EMAIL, OWNER_PASSWORD);
  ids.unrelatedUser = await createConfirmedUser(OTHER_EMAIL, OTHER_PASSWORD);

  const { error: artistError } = await service.from('artists').upsert({
    id: ids.artist,
    email: OWNER_EMAIL,
    slug: `rls-${Date.now()}`,
    display_name: 'RLS Regression Artist',
    is_public: true,
    is_verified: true,
    published_at: now.toISOString(),
  });
  if (artistError) throw artistError;

  const { error: eventError } = await service.from('events').insert([
    {
      id: ids.event,
      artist_id: ids.artist,
      event_name: 'RLS Regression Event',
      start_date: start,
      end_date: end,
      status: 'Confirmed',
      is_booth_open: true,
      event_timezone: 'Asia/Bangkok',
    },
    {
      id: ids.secondEvent,
      artist_id: ids.artist,
      event_name: 'RLS Regression Event 2',
      start_date: start,
      end_date: end,
      status: 'Confirmed',
      is_booth_open: true,
      event_timezone: 'Asia/Bangkok',
    },
    {
      id: ids.allocationEvent,
      artist_id: ids.artist,
      event_name: 'RLS Allocation Event',
      start_date: start,
      end_date: end,
      status: 'Confirmed',
      is_booth_open: true,
      event_timezone: 'Asia/Bangkok',
    },
    {
      id: ids.currencyEvent,
      artist_id: ids.artist,
      event_name: 'RLS Currency Event',
      start_date: start,
      end_date: end,
      status: 'Confirmed',
      is_booth_open: true,
      event_timezone: 'Asia/Bangkok',
    },
  ]);
  if (eventError) throw eventError;

  const { error: productError } = await service.from('products').insert([
    {
      id: ids.product,
      artist_id: ids.artist,
      name: 'RLS Product',
      price: 100,
      status: 'enable',
      currency: 'THB',
      stock_total: 10,
      stock_reserved: 1,
      stock_sold: 0,
      is_unlimited: false,
    },
    {
      id: ids.secondProduct,
      artist_id: ids.artist,
      name: 'RLS Walkin Product',
      price: 100,
      status: 'enable',
      currency: 'THB',
      stock_total: 10,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
    },
    {
      id: ids.raceProduct,
      artist_id: ids.artist,
      name: 'RLS Race Product',
      price: 100,
      status: 'enable',
      currency: 'THB',
      stock_total: 10,
      stock_reserved: 2,
      stock_sold: 0,
      is_unlimited: false,
    },
    {
      id: ids.allocationProduct,
      artist_id: ids.artist,
      name: 'RLS Allocation Product',
      price: 100,
      status: 'enable',
      currency: 'THB',
      stock_total: 5,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
    },
    {
      id: ids.currencyProduct,
      artist_id: ids.artist,
      name: 'RLS Currency Override Product',
      price: 100,
      status: 'enable',
      currency: 'THB',
      stock_total: 5,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
    },
  ]);
  if (productError) throw productError;

  const { error: queueError } = await service.from('queues').insert({
    id: ids.queue,
    artist_id: ids.artist,
    event_id: ids.event,
    queue_number: 77,
    status: 'serving',
    queue_service_date: serviceDate,
  });
  if (queueError) throw queueError;

  const { error: currencyQueueError } = await service.from('queues').insert({
    id: ids.currencyQueue,
    artist_id: ids.artist,
    event_id: ids.currencyEvent,
    queue_number: 88,
    status: 'serving',
    queue_service_date: serviceDate,
  });
  if (currencyQueueError) throw currencyQueueError;

  const { error: orderError } = await service.from('orders').insert([
    {
      id: ids.order,
      event_id: ids.event,
      queue_id: ids.queue,
      status: 'confirmed',
      total_price: 100,
      currency: 'THB',
      payment_idempotency_key: null,
    },
    {
      id: ids.raceOrder,
      event_id: ids.secondEvent,
      queue_id: null,
      status: 'confirmed',
      total_price: 200,
      currency: 'THB',
      payment_idempotency_key: null,
    },
  ]);
  if (orderError) throw orderError;

  const { error: itemError } = await service.from('order_items').insert([
    {
      order_id: ids.order,
      product_id: ids.product,
      quantity: 1,
      price_per_unit: 100,
      currency: 'THB',
    },
    {
      order_id: ids.raceOrder,
      product_id: ids.raceProduct,
      quantity: 2,
      price_per_unit: 100,
      currency: 'THB',
    },
  ]);
  if (itemError) throw itemError;
};

const cleanupFixtures = async () => {
  await service.from('order_items').delete().in('product_id', [ids.product, ids.secondProduct, ids.raceProduct]);
  await service.from('order_items').delete().in('product_id', [ids.allocationProduct, ids.currencyProduct]);
  await service.from('orders').delete().in('event_id', [ids.event, ids.secondEvent, ids.allocationEvent, ids.currencyEvent]);
  await service.from('queues').delete().in('event_id', [ids.event, ids.currencyEvent]);
  await service.from('event_products').delete().in('product_id', [ids.allocationProduct, ids.currencyProduct]);
  await service.from('products').delete().in('id', [ids.product, ids.secondProduct, ids.raceProduct, ids.allocationProduct, ids.currencyProduct]);
  await service.from('events').delete().in('id', [ids.event, ids.secondEvent, ids.allocationEvent, ids.currencyEvent]);
  await service.from('artists').delete().eq('id', ids.artist);
};

test.describe('RLS and mutation security regressions', () => {
  let owner: SupabaseClient;
  let unrelated: SupabaseClient;

  test.beforeAll(async () => {
    test.skip(!SERVICE_KEY || !ANON_KEY, 'Supabase service and anon keys are required for RLS regression tests');
    await cleanupFixtures();
    await seedFixtures();
    owner = await signInClient(OWNER_EMAIL, OWNER_PASSWORD);
    unrelated = await signInClient(OTHER_EMAIL, OTHER_PASSWORD);
  });

  test.afterAll(async () => {
    if (SERVICE_KEY) await cleanupFixtures();
  });

  test('customer queue ticket creation is RPC-only and idempotent', async () => {
    const fingerprint = `rls-ticket-${randomUUID()}`;
    const first = await anon.rpc('create_queue_ticket', {
      p_artist_id: ids.artist,
      p_event_id: ids.event,
      p_customer_fingerprint: fingerprint,
    });
    expect(first.error).toBeNull();

    const second = await anon.rpc('create_queue_ticket', {
      p_artist_id: ids.artist,
      p_event_id: ids.event,
      p_customer_fingerprint: fingerprint,
    });
    expect(second.error).toBeNull();

    const firstTicket = Array.isArray(first.data) ? first.data[0] : first.data;
    const secondTicket = Array.isArray(second.data) ? second.data[0] : second.data;
    expect(secondTicket.id).toBe(firstTicket.id);
    expect(secondTicket.queue_number).toBe(firstTicket.queue_number);

    const directInsert = await anon.from('queues').insert({
      artist_id: ids.artist,
      event_id: ids.event,
      queue_number: 999,
      status: 'waiting',
      queue_service_date: firstTicket.queue_service_date,
    });
    expect(directInsert.error?.message || '').toMatch(/permission denied|violates row-level security/i);

    await service.from('queues').delete().eq('id', firstTicket.id);
    const staleRead = await anon
      .from('queues')
      .select('id, status')
      .eq('id', firstTicket.id)
      .maybeSingle();
    expect(staleRead.error).toBeNull();
    expect(staleRead.data).toBeNull();
  });

  test('payment completion is scoped, idempotent, and cannot be bypassed with direct writes', async () => {
    const directUpdate = await owner
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', ids.order);
    expect(directUpdate.error?.message || '').toMatch(/permission denied|violates row-level security/i);

    const completeKey = randomUUID();
    const complete = await owner.rpc('complete_order_with_stock', {
      p_order_id: ids.order,
      p_payment_method: 'cash',
      p_payment_idempotency_key: completeKey,
    });
    expect(complete.error).toBeNull();
    expect(complete.data).toBe(true);

    const retry = await owner.rpc('complete_order_with_stock', {
      p_order_id: ids.order,
      p_payment_method: 'cash',
      p_payment_idempotency_key: completeKey,
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(true);

    const wrongKey = await owner.rpc('complete_order_with_stock', {
      p_order_id: ids.order,
      p_payment_method: 'cash',
      p_payment_idempotency_key: randomUUID(),
    });
    expect(wrongKey.error?.message).toContain('payment_idempotency_key_conflict');

    const unauthorized = await unrelated.rpc('complete_order_with_stock', {
      p_order_id: ids.order,
      p_payment_method: 'cash',
      p_payment_idempotency_key: randomUUID(),
    });
    expect(unauthorized.error?.message).toContain('forbidden');

    const stock = await service
      .from('products')
      .select('stock_reserved, stock_sold')
      .eq('id', ids.product)
      .single();
    expect(stock.error).toBeNull();
    expect(stock.data).toMatchObject({ stock_reserved: 0, stock_sold: 1 });
  });

  test('walk-in retries and concurrent completion only deduct stock once', async () => {
    const walkinKey = randomUUID();
    const items = [{ product_id: ids.secondProduct, quantity: 2 }];
    const walkinFirst = await owner.rpc('create_walkin_order_with_stock', {
      p_event_id: ids.event,
      p_items: items,
      p_payment_method: 'transfer',
      p_payment_idempotency_key: walkinKey,
    });
    expect(walkinFirst.error).toBeNull();

    const walkinSecond = await owner.rpc('create_walkin_order_with_stock', {
      p_event_id: ids.event,
      p_items: items,
      p_payment_method: 'transfer',
      p_payment_idempotency_key: walkinKey,
    });
    expect(walkinSecond.error).toBeNull();
    expect(walkinSecond.data).toBe(walkinFirst.data);

    const raceKey = randomUUID();
    const [firstRace, secondRace] = await Promise.all([
      owner.rpc('complete_order_with_stock', {
        p_order_id: ids.raceOrder,
        p_payment_method: 'cash',
        p_payment_idempotency_key: raceKey,
      }),
      owner.rpc('complete_order_with_stock', {
        p_order_id: ids.raceOrder,
        p_payment_method: 'cash',
        p_payment_idempotency_key: raceKey,
      }),
    ]);
    expect(firstRace.error).toBeNull();
    expect(secondRace.error).toBeNull();

    const stock = await service
      .from('products')
      .select('id, stock_reserved, stock_sold')
      .in('id', [ids.secondProduct, ids.raceProduct])
      .order('id');
    expect(stock.error).toBeNull();
    expect(stock.data?.find((row) => row.id === ids.secondProduct)).toMatchObject({
      stock_reserved: 0,
      stock_sold: 2,
    });
    expect(stock.data?.find((row) => row.id === ids.raceProduct)).toMatchObject({
      stock_reserved: 0,
      stock_sold: 2,
    });
  });

  test('customer leave-queue path is RPC-only and ownership-checked', async () => {
    const ownerFingerprint = `rls-leave-owner-${randomUUID()}`;
    const otherFingerprint = `rls-leave-other-${randomUUID()}`;

    const created = await anon.rpc('create_queue_ticket', {
      p_artist_id: ids.artist,
      p_event_id: ids.event,
      p_customer_fingerprint: ownerFingerprint,
    });
    expect(created.error).toBeNull();
    const ticket = Array.isArray(created.data) ? created.data[0] : created.data;
    expect(ticket?.id).toBeTruthy();

    const directUpdate = await anon
      .from('queues')
      .update({ status: 'missed' })
      .eq('id', ticket.id);
    expect(directUpdate.error?.message || '').toMatch(/permission denied|violates row-level security/i);

    const stillActive = await service
      .from('queues')
      .select('status')
      .eq('id', ticket.id)
      .single();
    expect(stillActive.error).toBeNull();
    expect(stillActive.data?.status).toBe('waiting');

    const wrongOwner = await anon.rpc('leave_queue_ticket', {
      p_ticket_id: ticket.id,
      p_customer_fingerprint: otherFingerprint,
    });
    expect(wrongOwner.error?.message || '').toContain('ticket_ownership_mismatch');

    const missingFingerprint = await anon.rpc('leave_queue_ticket', {
      p_ticket_id: ticket.id,
      p_customer_fingerprint: null,
    });
    expect(missingFingerprint.error?.message || '').toContain('ticket_ownership_mismatch');

    const leave = await anon.rpc('leave_queue_ticket', {
      p_ticket_id: ticket.id,
      p_customer_fingerprint: ownerFingerprint,
    });
    expect(leave.error).toBeNull();
    expect(leave.data).toBe(true);

    const afterLeave = await service
      .from('queues')
      .select('status, last_updated_at')
      .eq('id', ticket.id)
      .single();
    expect(afterLeave.error).toBeNull();
    expect(afterLeave.data?.status).toBe('missed');
    expect(afterLeave.data?.last_updated_at).toBeTruthy();

    const anonReadAfterLeave = await anon
      .from('queues')
      .select('id, status')
      .eq('id', ticket.id)
      .maybeSingle();
    expect(anonReadAfterLeave.error).toBeNull();
    expect(anonReadAfterLeave.data?.status).toBe('missed');

    const finalizedRetry = await anon.rpc('leave_queue_ticket', {
      p_ticket_id: ticket.id,
      p_customer_fingerprint: ownerFingerprint,
    });
    expect(finalizedRetry.error?.message || '').toContain('ticket_not_active');

    const missingTicket = await anon.rpc('leave_queue_ticket', {
      p_ticket_id: randomUUID(),
      p_customer_fingerprint: ownerFingerprint,
    });
    expect(missingTicket.error?.message || '').toContain('ticket_not_found');
  });

  test('event catalog allocation prevents over-allocation but allows disabling used rows', async () => {
    const firstEventProduct = randomUUID();

    const first = await service.from('event_products').insert({
      id: firstEventProduct,
      event_id: ids.allocationEvent,
      product_id: ids.allocationProduct,
      artist_id: ids.artist,
      is_enabled: true,
      is_unlimited: false,
      stock_total: 5,
      stock_reserved: 1,
      stock_sold: 1,
    });
    expect(first.error).toBeNull();

    const overAllocation = await service.from('event_products').insert({
      event_id: ids.event,
      product_id: ids.allocationProduct,
      artist_id: ids.artist,
      is_enabled: true,
      is_unlimited: false,
      stock_total: 1,
    });
    expect(overAllocation.error?.message || '').toContain('event_stock_exceeds_catalog_stock');

    const disableUsedRow = await service
      .from('event_products')
      .update({ is_enabled: false, stock_total: 0 })
      .eq('id', firstEventProduct);
    expect(disableUsedRow.error).toBeNull();
  });

  test('event currency override is applied consistently to order items and orders', async () => {
    const eventProduct = await service.from('event_products').insert({
      event_id: ids.currencyEvent,
      product_id: ids.currencyProduct,
      artist_id: ids.artist,
      is_enabled: true,
      price_override: 12,
      currency_override: 'USD',
      is_unlimited: false,
      stock_total: 2,
    });
    expect(eventProduct.error).toBeNull();

    const createdOrder = await anon.rpc('create_customer_order_with_stock', {
      p_queue_id: ids.currencyQueue,
      p_items: [{ product_id: ids.currencyProduct, quantity: 1 }],
      p_payment_idempotency_key: randomUUID(),
    });
    expect(createdOrder.error).toBeNull();

    const orderId = Array.isArray(createdOrder.data) ? createdOrder.data[0] : createdOrder.data;
    const [order, items] = await Promise.all([
      service.from('orders').select('currency, total_price').eq('id', orderId).single(),
      service.from('order_items').select('currency, price_per_unit').eq('order_id', orderId),
    ]);

    expect(order.error).toBeNull();
    expect(items.error).toBeNull();
    expect(order.data).toMatchObject({ currency: 'USD', total_price: 12 });
    expect(items.data).toHaveLength(1);
    expect(items.data?.[0]).toMatchObject({ currency: 'USD', price_per_unit: 12 });
  });
});
