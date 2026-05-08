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
  queue: randomUUID(),
  product: randomUUID(),
  secondProduct: randomUUID(),
  raceProduct: randomUUID(),
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
  await service.from('orders').delete().in('event_id', [ids.event, ids.secondEvent]);
  await service.from('queues').delete().eq('event_id', ids.event);
  await service.from('products').delete().in('id', [ids.product, ids.secondProduct, ids.raceProduct]);
  await service.from('events').delete().in('id', [ids.event, ids.secondEvent]);
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
});
