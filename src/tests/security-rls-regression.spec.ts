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
  endedEvent: randomUUID(),
  queue: randomUUID(),
  product: randomUUID(),
  secondProduct: randomUUID(),
  raceProduct: randomUUID(),
  allocationProduct: randomUUID(),
  promotion: randomUUID(),
  excludedPromotion: randomUUID(),
  selectedPromotion: randomUUID(),
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
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error || new Error(`Failed to create confirmed user ${email}`);
  return data.user.id;
};

const seedFixtures = async () => {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const endedStart = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
  const endedEnd = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
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
      id: ids.endedEvent,
      artist_id: ids.artist,
      event_name: 'RLS Ended Event',
      start_date: endedStart,
      end_date: endedEnd,
      status: 'Confirmed',
      is_booth_open: false,
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
      price: 150,
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
  await service.from('artist_promotions').delete().eq('artist_id', ids.artist);
  await service.from('order_items').delete().in('product_id', [ids.product, ids.secondProduct, ids.raceProduct, ids.allocationProduct]);
  await service.from('event_products').delete().in('event_id', [ids.event, ids.secondEvent, ids.endedEvent]);
  await service.from('orders').delete().in('event_id', [ids.event, ids.secondEvent, ids.endedEvent]);
  await service.from('queues').delete().eq('event_id', ids.event);
  await service.from('products').delete().in('id', [ids.product, ids.secondProduct, ids.raceProduct, ids.allocationProduct]);
  await service.from('events').delete().in('id', [ids.event, ids.secondEvent, ids.endedEvent]);
  await service.from('artists').delete().eq('id', ids.artist);
  await service.auth.admin.deleteUser(ids.artist);
  if (ids.unrelatedUser) await service.auth.admin.deleteUser(ids.unrelatedUser);
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

  test('event catalog save preserves existing stock when stock was not edited', async () => {
    const seedCatalog = await service.from('event_products').upsert(
      [
        {
          event_id: ids.event,
          product_id: ids.product,
          artist_id: ids.artist,
          is_enabled: true,
          is_unlimited: false,
          stock_total: 7,
        },
        {
          event_id: ids.event,
          product_id: ids.secondProduct,
          artist_id: ids.artist,
          is_enabled: true,
          is_unlimited: false,
          stock_total: 4,
        },
      ],
      { onConflict: 'event_id,product_id' }
    );
    expect(seedCatalog.error).toBeNull();

    const save = await owner.rpc('save_event_catalog', {
      p_event_id: ids.event,
      p_items: [
        {
          product_id: ids.product,
          is_enabled: true,
          price_override: null,
          is_unlimited: false,
        },
        {
          product_id: ids.secondProduct,
          is_enabled: true,
          price_override: null,
          is_unlimited: false,
        },
      ],
    });
    expect(save.error).toBeNull();

    const stock = await service
      .from('event_products')
      .select('product_id, stock_total, stock_reserved, stock_sold')
      .eq('event_id', ids.event)
      .in('product_id', [ids.product, ids.secondProduct]);

    expect(stock.error).toBeNull();
    expect(stock.data?.find((row) => row.product_id === ids.product)).toMatchObject({
      stock_total: 7,
      stock_reserved: 0,
      stock_sold: 0,
    });
    expect(stock.data?.find((row) => row.product_id === ids.secondProduct)).toMatchObject({
      stock_total: 4,
      stock_reserved: 0,
      stock_sold: 0,
    });
    expect(stock.data?.some((row) => row.stock_total === 0)).toBe(false);
  });

  test('ended event unsold stock no longer blocks future event allocation', async () => {
    await service.from('event_products').delete().eq('product_id', ids.allocationProduct);

    const seedEnded = await service.from('event_products').upsert(
      {
        event_id: ids.endedEvent,
        product_id: ids.allocationProduct,
        artist_id: ids.artist,
        is_enabled: true,
        is_unlimited: false,
        stock_total: 5,
        stock_sold: 2,
      },
      { onConflict: 'event_id,product_id' }
    );
    expect(seedEnded.error).toBeNull();

    const save = await owner.rpc('save_event_catalog', {
      p_event_id: ids.secondEvent,
      p_items: [
        {
          product_id: ids.allocationProduct,
          is_enabled: true,
          is_unlimited: false,
          stock_total: 3,
        },
      ],
    });
    expect(save.error).toBeNull();

    const allocation = await service
      .from('event_products')
      .select('stock_total, stock_sold')
      .eq('event_id', ids.secondEvent)
      .eq('product_id', ids.allocationProduct)
      .maybeSingle();

    expect(allocation.error).toBeNull();
    expect(allocation.data).toMatchObject({ stock_total: 3, stock_sold: 0 });
  });

  test('ended event sold stock remains deducted for future allocation', async () => {
    await service.from('event_products').delete().eq('product_id', ids.allocationProduct);

    const seedEnded = await service.from('event_products').upsert(
      {
        event_id: ids.endedEvent,
        product_id: ids.allocationProduct,
        artist_id: ids.artist,
        is_enabled: true,
        is_unlimited: false,
        stock_total: 5,
        stock_sold: 2,
      },
      { onConflict: 'event_id,product_id' }
    );
    expect(seedEnded.error).toBeNull();

    const save = await owner.rpc('save_event_catalog', {
      p_event_id: ids.secondEvent,
      p_items: [
        {
          product_id: ids.allocationProduct,
          is_enabled: true,
          is_unlimited: false,
          stock_total: 4,
        },
      ],
    });

    expect(save.error?.message || '').toMatch(/event_stock_exceeds_catalog_stock/i);
  });

  test('active event allocation still blocks stock for upcoming events', async () => {
    await service.from('event_products').delete().eq('product_id', ids.allocationProduct);

    const seedActive = await service.from('event_products').upsert(
      {
        event_id: ids.event,
        product_id: ids.allocationProduct,
        artist_id: ids.artist,
        is_enabled: true,
        is_unlimited: false,
        stock_total: 2,
      },
      { onConflict: 'event_id,product_id' }
    );
    expect(seedActive.error).toBeNull();

    const save = await owner.rpc('save_event_catalog', {
      p_event_id: ids.secondEvent,
      p_items: [
        {
          product_id: ids.allocationProduct,
          is_enabled: true,
          is_unlimited: false,
          stock_total: 4,
        },
      ],
    });

    expect(save.error?.message || '').toMatch(/event_stock_exceeds_catalog_stock/i);
  });

  test('event-level currency applies to catalog, customer orders, and POS orders', async () => {
    await service.from('event_products').delete().eq('event_id', ids.event);
    await service.from('orders').delete().eq('event_id', ids.event).neq('id', ids.order);

    const seedCatalog = await owner.rpc('save_event_catalog', {
      p_event_id: ids.event,
      p_items: [
        {
          product_id: ids.product,
          is_enabled: true,
          price_override: 12,
          is_unlimited: false,
          stock_total: 5,
        },
      ],
      p_currency_override: 'USD',
      p_update_event_currency: true,
    });
    expect(seedCatalog.error).toBeNull();

    const savedEvent = await service
      .from('events')
      .select('currency_override')
      .eq('id', ids.event)
      .maybeSingle();
    expect(savedEvent.error).toBeNull();
    expect(savedEvent.data?.currency_override).toBe('USD');

    const listed = await anon.rpc('list_event_products', { p_event_id: ids.event });
    expect(listed.error).toBeNull();
    expect(Array.isArray(listed.data)).toBe(true);
    expect((listed.data || []).find((row: any) => row.id === ids.product)).toMatchObject({
      currency: 'USD',
      price: 12,
    });

    const customerQueueId = randomUUID();
    const queueInsert = await service.from('queues').insert({
      id: customerQueueId,
      artist_id: ids.artist,
      event_id: ids.event,
      queue_number: 178,
      status: 'serving',
      queue_service_date: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    });
    expect(queueInsert.error).toBeNull();

    const customerOrder = await anon.rpc('create_customer_order_with_stock', {
      p_queue_id: customerQueueId,
      p_items: [{ product_id: ids.product, quantity: 1 }],
      p_payment_idempotency_key: randomUUID(),
    });
    expect(customerOrder.error).toBeNull();

    const customerOrderRow = await service
      .from('orders')
      .select('currency')
      .eq('id', customerOrder.data as string)
      .maybeSingle();
    expect(customerOrderRow.error).toBeNull();
    expect(customerOrderRow.data?.currency).toBe('USD');

    const customerOrderItem = await service
      .from('order_items')
      .select('currency')
      .eq('order_id', customerOrder.data as string)
      .maybeSingle();
    expect(customerOrderItem.error).toBeNull();
    expect(customerOrderItem.data?.currency).toBe('USD');

    const walkinOrder = await owner.rpc('create_walkin_order_with_stock', {
      p_event_id: ids.event,
      p_items: [{ product_id: ids.product, quantity: 1 }],
      p_payment_method: 'cash',
      p_payment_idempotency_key: randomUUID(),
    });
    expect(walkinOrder.error).toBeNull();

    const walkinOrderRow = await service
      .from('orders')
      .select('currency')
      .eq('id', walkinOrder.data as string)
      .maybeSingle();
    expect(walkinOrderRow.error).toBeNull();
    expect(walkinOrderRow.data?.currency).toBe('USD');

    const walkinOrderItem = await service
      .from('order_items')
      .select('currency')
      .eq('order_id', walkinOrder.data as string)
      .maybeSingle();
    expect(walkinOrderItem.error).toBeNull();
    expect(walkinOrderItem.data?.currency).toBe('USD');
  });

  test('promotion event exclusions hide global rules only for the excluded event', async () => {
    const seedPromotions = await service.from('artist_promotions').insert([
      {
        id: ids.promotion,
        artist_id: ids.artist,
        name: 'Global Bualoi Promo',
        promotion_type: 'quantity_discount',
        target_type: 'product',
        rule_type: 'discount',
        match_product_id: null,
        match_product_ids: [ids.product],
        buy_quantity: 2,
        reward_value: 10,
        reward_quantity: null,
        priority: 10,
        status: 'active',
        event_scope: 'all',
        event_ids: null,
        excluded_event_ids: null,
      },
      {
        id: ids.excludedPromotion,
        artist_id: ids.artist,
        name: 'Excluded Event Promo',
        promotion_type: 'quantity_discount',
        target_type: 'product',
        rule_type: 'discount',
        match_product_id: null,
        match_product_ids: [ids.product],
        buy_quantity: 2,
        reward_value: 20,
        reward_quantity: null,
        priority: 20,
        status: 'active',
        event_scope: 'all',
        event_ids: null,
        excluded_event_ids: [ids.event],
      },
      {
        id: ids.selectedPromotion,
        artist_id: ids.artist,
        name: 'Selected Second Event Promo',
        promotion_type: 'quantity_discount',
        target_type: 'product',
        rule_type: 'discount',
        match_product_id: null,
        match_product_ids: [ids.secondProduct],
        buy_quantity: 2,
        reward_value: 30,
        reward_quantity: null,
        priority: 30,
        status: 'active',
        event_scope: 'selected',
        event_ids: [ids.secondEvent],
        excluded_event_ids: null,
      },
    ]);
    expect(seedPromotions.error).toBeNull();

    const currentEventPromotions = await anon.rpc('list_active_promotions', {
      p_artist_id: ids.artist,
      p_event_id: ids.event,
    });
    expect(currentEventPromotions.error).toBeNull();
    const currentEventNames = new Set((currentEventPromotions.data || []).map((row: any) => row.name));
    expect(currentEventNames.has('Global Bualoi Promo')).toBe(true);
    expect(currentEventNames.has('Excluded Event Promo')).toBe(false);
    expect(currentEventNames.has('Selected Second Event Promo')).toBe(false);

    const secondEventPromotions = await anon.rpc('list_active_promotions', {
      p_artist_id: ids.artist,
      p_event_id: ids.secondEvent,
    });
    expect(secondEventPromotions.error).toBeNull();
    const secondEventNames = new Set((secondEventPromotions.data || []).map((row: any) => row.name));
    expect(secondEventNames.has('Global Bualoi Promo')).toBe(true);
    expect(secondEventNames.has('Excluded Event Promo')).toBe(true);
    expect(secondEventNames.has('Selected Second Event Promo')).toBe(true);

    const allEventPromotions = await anon.rpc('list_active_promotions', {
      p_artist_id: ids.artist,
      p_event_id: null,
    });
    expect(allEventPromotions.error).toBeNull();
    const allEventNames = new Set((allEventPromotions.data || []).map((row: any) => row.name));
    expect(allEventNames.has('Global Bualoi Promo')).toBe(true);
    expect(allEventNames.has('Excluded Event Promo')).toBe(true);
    expect(allEventNames.has('Selected Second Event Promo')).toBe(false);
  });

  test('event catalog still saves per-product price and stock overrides correctly', async () => {
    await service.from('event_products').delete().eq('product_id', ids.product);

    const save = await owner.rpc('save_event_catalog', {
      p_event_id: ids.secondEvent,
      p_items: [
        {
          product_id: ids.product,
          is_enabled: true,
          price_override: 245,
          is_unlimited: false,
          stock_total: 6,
        },
      ],
    });
    expect(save.error).toBeNull();

    const savedRow = await service
      .from('event_products')
      .select('price_override, stock_total, is_enabled')
      .eq('event_id', ids.secondEvent)
      .eq('product_id', ids.product)
      .maybeSingle();

    expect(savedRow.error).toBeNull();
    expect(savedRow.data).toMatchObject({
      price_override: 245,
      stock_total: 6,
      is_enabled: true,
    });

    const listed = await owner.rpc('list_event_products', { p_event_id: ids.secondEvent });
    expect(listed.error).toBeNull();
    expect((listed.data || []).find((row: any) => row.id === ids.product)).toMatchObject({
      price: 245,
      stock_total: 6,
    });
  });

  test('POS sale from event allocation does not re-trigger allocation overage', async () => {
    await service.from('event_products').delete().eq('product_id', ids.allocationProduct);

    const seedCatalog = await owner.rpc('save_event_catalog', {
      p_event_id: ids.secondEvent,
      p_items: [
        {
          product_id: ids.allocationProduct,
          is_enabled: true,
          is_unlimited: false,
          stock_total: 5,
        },
      ],
    });
    expect(seedCatalog.error).toBeNull();

    const paymentKey = randomUUID();
    const walkinOrder = await owner.rpc('create_walkin_order_with_stock', {
      p_event_id: ids.secondEvent,
      p_items: [{ product_id: ids.allocationProduct, quantity: 1 }],
      p_payment_method: 'cash',
      p_payment_idempotency_key: paymentKey,
    });
    expect(walkinOrder.error).toBeNull();

    const pricedOrder = await service.from('orders').select('subtotal_price, total_price').eq('id', walkinOrder.data as string).single();
    expect(pricedOrder.error).toBeNull();
    expect(pricedOrder.data).toMatchObject({ subtotal_price: 150, total_price: 150 });

    const eventStock = await service
      .from('event_products')
      .select('stock_total, stock_sold, stock_reserved')
      .eq('event_id', ids.secondEvent)
      .eq('product_id', ids.allocationProduct)
      .maybeSingle();

    expect(eventStock.error).toBeNull();
    expect(eventStock.data).toMatchObject({
      stock_total: 5,
      stock_sold: 1,
      stock_reserved: 0,
    });
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
});

test.describe('online campaign RLS and role boundaries', () => {
  const campaignIds = {
    owner: '',
    seller: '',
    other: '',
    artist: '',
    product: randomUUID(),
    campaign: randomUUID(),
    order: '',
    orderCode: '',
  };
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `campaign-owner-${suffix}@example.com`;
  const sellerEmail = `campaign-seller-${suffix}@example.com`;
  const otherEmail = `campaign-other-${suffix}@example.com`;
  const password = 'LocalOnlyCampaignSecurity123!';
  const artistSlug = `campaign-rls-${suffix}`;
  let ownerClient: SupabaseClient;
  let sellerClient: SupabaseClient;
  let otherClient: SupabaseClient;

  test.beforeAll(async () => {
    test.skip(!SERVICE_KEY || !ANON_KEY, 'Supabase service and anon keys are required for RLS regression tests');
    campaignIds.owner = await createConfirmedUser(ownerEmail, password);
    campaignIds.seller = await createConfirmedUser(sellerEmail, password);
    campaignIds.other = await createConfirmedUser(otherEmail, password);
    campaignIds.artist = campaignIds.owner;

    const now = Date.now();
    const artist = await service.from('artists').insert({
      id: campaignIds.artist,
      email: ownerEmail,
      slug: artistSlug,
      display_name: 'Campaign RLS Artist',
      is_public: true,
      is_verified: true,
      published_at: new Date().toISOString(),
    });
    if (artist.error) throw artist.error;
    const member = await service.from('artist_members').insert({
      artist_id: campaignIds.artist,
      member_email: sellerEmail,
      role: 'seller',
      status: 'active',
    });
    if (member.error) throw member.error;

    const product = await service.from('products').insert({
      id: campaignIds.product,
      artist_id: campaignIds.artist,
      name: 'Campaign RLS Product',
      price: 100,
      currency: 'THB',
      status: 'enable',
      stock_total: 4,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
    });
    if (product.error) throw product.error;

    const campaign = await service.from('online_campaigns').insert({
      id: campaignIds.campaign,
      artist_id: campaignIds.artist,
      name: 'Campaign RLS Sale',
      slug: 'secure-sale',
      opens_at: new Date(now - 60_000).toISOString(),
      closes_at: new Date(now + 86_400_000).toISOString(),
      currency: 'THB',
      shipping_enabled: true,
      flat_shipping_fee: 40,
      pickup_enabled: false,
      publication_status: 'published',
    });
    if (campaign.error) throw campaign.error;

    const setup = await Promise.all([
      service.from('online_campaign_products').insert({
        campaign_id: campaignIds.campaign,
        product_id: campaignIds.product,
        artist_id: campaignIds.artist,
        stock_total: 4,
        is_unlimited: false,
        is_enabled: true,
      }),
      service.from('campaign_payment_methods').insert({
        campaign_id: campaignIds.campaign,
        artist_id: campaignIds.artist,
        method_type: 'promptpay',
        display_name: 'PromptPay',
        promptpay_id: '0812345678',
      }),
    ]);
    for (const result of setup) if (result.error) throw result.error;

    const order = await anon.rpc('create_online_campaign_order', {
      p_campaign_id: campaignIds.campaign,
      p_items: [{ product_id: campaignIds.product, quantity: 1 }],
      p_fulfillment_method: 'shipping',
      p_pickup_point_id: null,
      p_customer_name: 'Private Buyer',
      p_customer_email: 'private-buyer@example.com',
      p_customer_phone: '0899999999',
      p_shipping_address: 'Private Bangkok address',
      p_customer_note: '',
      p_client_request_id: randomUUID(),
    });
    if (order.error) throw order.error;
    campaignIds.order = order.data[0].order_id;
    campaignIds.orderCode = order.data[0].order_code;

    const evidence = await anon.rpc('submit_online_payment_evidence', {
      p_artist_slug: artistSlug,
      p_order_code: campaignIds.orderCode,
      p_slip_url: 'campaign/security/slip.png',
      p_client_request_id: randomUUID(),
    });
    if (evidence.error) throw evidence.error;

    [ownerClient, sellerClient, otherClient] = await Promise.all([
      signInClient(ownerEmail, password),
      signInClient(sellerEmail, password),
      signInClient(otherEmail, password),
    ]);
  });

  test.afterAll(async () => {
    if (!SERVICE_KEY) return;
    if (campaignIds.order) {
      await service.from('payment_review_events').delete().eq('order_id', campaignIds.order);
      await service.from('order_payments').delete().eq('order_id', campaignIds.order);
      await service.from('order_items').delete().eq('order_id', campaignIds.order);
      await service.from('orders').delete().eq('id', campaignIds.order);
    }
    await service.from('campaign_payment_methods').delete().eq('campaign_id', campaignIds.campaign);
    await service.from('campaign_pickup_points').delete().eq('campaign_id', campaignIds.campaign);
    await service.from('online_campaign_products').delete().eq('campaign_id', campaignIds.campaign);
    await service.from('online_campaigns').delete().eq('id', campaignIds.campaign);
    await service.from('products').delete().eq('id', campaignIds.product);
    await service.from('artist_members').delete().eq('artist_id', campaignIds.artist);
    await service.from('artists').delete().eq('id', campaignIds.artist);
    await Promise.all([campaignIds.owner, campaignIds.seller, campaignIds.other].filter(Boolean).map((id) => service.auth.admin.deleteUser(id)));
  });

  test('anonymous and unrelated users cannot access campaign tables directly', async () => {
    const anonymousWrite = await anon.from('online_campaigns').insert({
      artist_id: campaignIds.artist,
      name: 'Anonymous write',
      slug: 'anonymous-write',
      opens_at: new Date().toISOString(),
      closes_at: new Date(Date.now() + 60_000).toISOString(),
      shipping_enabled: true,
    });
    expect(anonymousWrite.error?.message || '').toMatch(/permission denied|row-level security/i);

    for (const table of ['online_campaigns', 'online_campaign_products', 'campaign_payment_methods', 'orders', 'order_payments']) {
      const column = table === 'orders' || table === 'online_campaigns' ? 'id' : table === 'order_payments' ? 'order_id' : 'campaign_id';
      const target = table === 'orders' || table === 'order_payments' ? campaignIds.order : campaignIds.campaign;
      const read = await otherClient.from(table).select('*').eq(column, target);
      if (read.error) expect(read.error.message).toMatch(/permission denied|row-level security/i);
      else expect(read.data).toEqual([]);
    }

    const workspace = await otherClient.rpc('get_online_campaign_workspace', { p_campaign_id: campaignIds.campaign });
    expect(workspace.error?.message).toContain('forbidden');
  });

  test('seller can read fulfillment work but cannot configure or review payment', async () => {
    const campaigns = await sellerClient.rpc('list_my_online_campaigns');
    expect(campaigns.error).toBeNull();
    expect(campaigns.data.some((campaign: { id: string }) => campaign.id === campaignIds.campaign)).toBe(true);

    const workspace = await sellerClient.rpc('get_online_campaign_workspace', { p_campaign_id: campaignIds.campaign });
    expect(workspace.error).toBeNull();
    expect(workspace.data.orders[0].customer_name).toBe('Private Buyer');
    expect(workspace.data.orders[0].slip_url).toBeNull();
    expect(workspace.data.payment_methods).toEqual([]);
    expect(workspace.data.catalog).toEqual([]);

    const update = await sellerClient.from('online_campaigns').update({ name: 'Seller changed it' }).eq('id', campaignIds.campaign).select('id');
    expect(update.error || update.data?.length === 0).toBeTruthy();

    const review = await sellerClient.rpc('confirm_online_payment', { p_order_id: campaignIds.order, p_note: '' });
    expect(review.error?.message).toContain('forbidden');

    const unchanged = await service.from('online_campaigns').select('name').eq('id', campaignIds.campaign).single();
    expect(unchanged.data?.name).toBe('Campaign RLS Sale');
  });

  test('public order lookup masks customer contacts', async () => {
    const lookup = await anon.rpc('get_public_online_order_by_code', {
      p_artist_slug: artistSlug,
      p_order_code: campaignIds.orderCode,
    });
    expect(lookup.error).toBeNull();
    expect(lookup.data.customer_email_masked).toBe('pr***@example.com');
    expect(lookup.data).not.toHaveProperty('customer_email');
    expect(lookup.data).not.toHaveProperty('customer_phone');

    const ownerReview = await ownerClient.rpc('confirm_online_payment', { p_order_id: campaignIds.order, p_note: 'checked' });
    expect(ownerReview.error).toBeNull();
  });
});
