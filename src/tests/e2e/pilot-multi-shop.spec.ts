import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';
import { resolveSupabaseTestEnv } from '../helpers/localSupabaseEnv';
import { LoginPage } from './pages/LoginPage';

const SHOP_COUNT = 4;
const runId = randomUUID();
const password = 'LocalOnlyMultiShopPassword123!';

type ShopFixture = {
  index: number;
  email: string;
  slug: string;
  artistId: string;
  eventId: string;
  eventName: string;
  productId: string;
  productName: string;
  price: number;
  stockTotal: number;
  ownerClient?: SupabaseClient;
};

type ShopSession = ShopFixture & {
  adminContext: BrowserContext;
  adminPage: Page;
  customerContext: BrowserContext;
  customerPage: Page;
  ticketId?: string;
  ticketNumber?: number;
};

const shops: ShopFixture[] = Array.from({ length: SHOP_COUNT }, (_, index) => ({
  index,
  email: `multi-shop-${index}-${runId}@example.test`,
  slug: `multi-${index}-${runId.slice(0, 8)}`,
  artistId: '',
  eventId: randomUUID(),
  eventName: `Multi Shop Event ${index + 1} ${runId}`,
  productId: randomUUID(),
  productName: `Multi Shop Item ${index + 1} ${runId}`,
  price: 101 + index,
  stockTotal: 5 + index,
}));

let service: SupabaseClient | undefined;
let env: ReturnType<typeof resolveSupabaseTestEnv> | undefined;

const must = (result: { error: { message: string } | null }, action: string) => {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
};

const dataOrThrow = <T>(
  result: { data: T; error: { message: string } | null },
  action: string,
): NonNullable<T> => {
  must(result, action);
  if (result.data == null) throw new Error(`${action}: response data missing`);
  return result.data;
};

const expectNoPrivateRows = (
  result: { data: unknown[] | null; error: { message: string } | null },
) => {
  if (result.error) {
    expect(result.error.message).toMatch(/permission denied|row-level security/i);
  } else {
    expect(result.data).toEqual([]);
  }
};

// Operators can explicitly retry a failed workspace read. Never retry a
// ticket or payment mutation, whose first response may have been lost.
async function expectReadyOrRecover(page: Page, ready: Locator, shop: ShopFixture) {
  const retry = page.getByRole('button', { name: 'Retry loading workspace', exact: true });
  await expect(ready.or(retry).first()).toBeVisible({ timeout: 30_000 });
  if (await retry.isVisible()) {
    test.info().annotations.push({ type: 'manual-read-retry', description: `Shop ${shop.index + 1}: ${page.url()}` });
    await retry.click();
  }
  await expect(ready).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  if (!process.env.SUPABASE_WORKDIR) {
    throw new Error('Multi-shop pilot requires SUPABASE_WORKDIR for a disposable local Supabase instance');
  }

  env = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)) {
    throw new Error('Multi-shop pilot fixtures require a loopback Supabase URL');
  }

  const now = Date.now();
  for (const shop of shops) {
    const fixture = await ensureOwnerArtistFixture({
      email: shop.email,
      password,
      slug: shop.slug,
      displayName: `Multi Shop Browser Fixture ${shop.index + 1}`,
    });
    service = fixture.service;
    shop.artistId = fixture.userId;

    must(await service.from('events').insert({
      id: shop.eventId,
      artist_id: shop.artistId,
      event_name: shop.eventName,
      start_date: new Date(now - 60 * 60 * 1000).toISOString(),
      end_date: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      status: 'Confirmed',
      is_booth_open: true,
    }), `seed event for shop ${shop.index + 1}`);
    must(await service.from('products').insert({
      id: shop.productId,
      artist_id: shop.artistId,
      name: shop.productName,
      price: shop.price,
      status: 'enable',
      category: 'Multi-shop browser fixture',
      currency: 'THB',
      stock_total: shop.stockTotal,
      is_unlimited: false,
    }), `seed product for shop ${shop.index + 1}`);
    must(await service.from('event_products').insert({
      event_id: shop.eventId,
      product_id: shop.productId,
      artist_id: shop.artistId,
      is_enabled: true,
      stock_total: shop.stockTotal,
      is_unlimited: false,
    }), `seed event product for shop ${shop.index + 1}`);


  }
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (!service) return;

  for (const shop of [...shops].reverse()) {
    if (!shop.artistId) continue;

    const orders = await service.from('orders').select('id').eq('event_id', shop.eventId);
    must(orders, `list orders for shop ${shop.index + 1} cleanup`);
    const orderIds = (orders.data || []).map(({ id }) => id);
    if (orderIds.length > 0) {
      must(await service.from('order_payments').delete().in('order_id', orderIds), `delete payments for shop ${shop.index + 1}`);
      must(await service.from('order_items').delete().in('order_id', orderIds), `delete order items for shop ${shop.index + 1}`);
      must(await service.from('orders').delete().in('id', orderIds), `delete orders for shop ${shop.index + 1}`);
    }
    must(await service.from('queues').delete().eq('event_id', shop.eventId), `delete queues for shop ${shop.index + 1}`);
    must(await service.from('event_products').delete().eq('event_id', shop.eventId), `delete event products for shop ${shop.index + 1}`);
    must(await service.from('products').delete().eq('id', shop.productId), `delete product for shop ${shop.index + 1}`);
    must(await service.from('events').delete().eq('id', shop.eventId), `delete event for shop ${shop.index + 1}`);
    must(await service.from('artists').delete().eq('id', shop.artistId), `delete artist for shop ${shop.index + 1}`);
    const deletedUser = await service.auth.admin.deleteUser(shop.artistId);
    if (deletedUser.error) throw new Error(`delete user for shop ${shop.index + 1}: ${deletedUser.error.message}`);
  }
});

test.describe('four-shop concurrent service pilot', () => {
  test('keeps queue, checkout, stock, and private data isolated across four live shops', async ({ browser }) => {
    test.setTimeout(180_000);
    if (!service || !env) throw new Error('Multi-shop fixtures were not initialized');
    const db = service;
    const localEnv = env;

    // Model four separate operator devices instead of placing all eight
    // sessions in a single browser process/network pool.
    const devices = await Promise.all(
      Array.from({ length: SHOP_COUNT }, () => browser.browserType().launch()),
    );
    const contexts = await Promise.all(
      devices.flatMap((device) => [device.newContext(), device.newContext()]),
    );
    const sessions: ShopSession[] = [];

    try {
      for (const shop of shops) {
        const adminContext = contexts[shop.index * 2];
        const customerContext = contexts[shop.index * 2 + 1];
        await Promise.all([
          adminContext.addInitScript(() => localStorage.setItem('nireq-language', 'en')),
          customerContext.addInitScript(() => localStorage.setItem('nireq-language', 'en')),
        ]);
        const [adminPage, customerPage] = await Promise.all([
          adminContext.newPage(),
          customerContext.newPage(),
        ]);
        adminPage.setDefaultTimeout(20_000);
        customerPage.setDefaultTimeout(20_000);
        sessions.push({ ...shop, adminContext, adminPage, customerContext, customerPage });
      }

      await Promise.all(sessions.map(async (session) => {
        const login = new LoginPage(session.adminPage);
        await login.goto();
        await login.login(session.email, password);
        await expectReadyOrRecover(session.adminPage, session.adminPage.getByRole('heading', { name: session.eventName, exact: true, level: 1 }), session);
        await expect(session.adminPage).toHaveURL(/\/manage-events(?:\/|$)/, { timeout: 30_000 });
        // Use this browser's verified session for the owner/RLS checks rather
        // than issuing a second password login during fixture setup.
        const accessToken = await session.adminPage.evaluate(async () => {
          const modulePath = '/src/supabaseClient.ts';
          const { supabase } = await import(modulePath);
          const { data, error } = await supabase.auth.getSession();
          if (error || !data.session) throw new Error('Expected the signed-in pilot session');
          return data.session.access_token as string;
        });
        session.ownerClient = createClient(localEnv.url, localEnv.anonKey, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await session.adminPage.goto(`/manage-pos-queues?eventId=${session.eventId}`);
        await expectReadyOrRecover(session.adminPage, session.adminPage.getByTestId('pos-event-selector'), session);
        await expect(session.adminPage.getByTestId('pos-event-selector')).toHaveValue(session.eventId, { timeout: 30_000 });
        await expect(session.adminPage.getByTestId('booth-status')).toHaveText('Booth Open');
      }));

      await Promise.all(sessions.map(async (session) => {
        await session.customerPage.goto(`/${session.slug}/queue`);
        const joinButton = session.customerPage.getByRole('button', { name: /Get Ticket|Join (?:the )?Queue/i });
        await expect(joinButton).toBeEnabled({ timeout: 30_000 });
        await joinButton.click();
        session.ticketNumber = Number((await session.customerPage.locator('.text-7xl').innerText()).replace('#', '').trim());
        expect(session.ticketNumber).toBeGreaterThan(0);
      }));

      await Promise.all(sessions.map(async (session) => {
        const ticket = dataOrThrow(await db
          .from('queues')
          .select('id, artist_id, event_id, status')
          .eq('event_id', session.eventId)
          .eq('queue_number', session.ticketNumber!)
          .single(), `read queue ticket for shop ${session.index + 1}`);
        expect(ticket).toMatchObject({
          artist_id: session.artistId,
          event_id: session.eventId,
          status: 'waiting',
        });
        session.ticketId = ticket.id as string;
      }));

      await Promise.all(sessions.map(async (session) => {
        await session.adminPage.reload();
        const callNext = session.adminPage.getByRole('button', {
          name: new RegExp(`^Call Next \\(#${session.ticketNumber}\\)$`, 'i'),
        });
        await expectReadyOrRecover(session.adminPage, callNext, session);
        await expect(callNext).toBeEnabled({ timeout: 30_000 });
        await callNext.click();
        await expect.poll(async () => dataOrThrow(await db
          .from('queues')
          .select('status')
          .eq('id', session.ticketId!)
          .single(), `read called ticket for shop ${session.index + 1}`).status).toBe('calling');
      }));

      await Promise.all(sessions.map(async (session) => {
        await expect(session.customerPage.getByText(/It's Your Turn|Now Serving|Please proceed/i).first()).toBeVisible({ timeout: 30_000 });
        const arrived = session.adminPage.getByRole('button', { name: 'ARRIVED', exact: true });
        await expect(arrived).toBeVisible({ timeout: 30_000 });
        await arrived.click();
        await expect.poll(async () => dataOrThrow(await db
          .from('queues')
          .select('status')
          .eq('id', session.ticketId!)
          .single(), `read serving ticket for shop ${session.index + 1}`).status).toBe('serving');
      }));

      await Promise.all(sessions.map(async (session) => {
        const queueTab = session.adminPage.getByRole('button', {
          name: `Queue #${session.ticketNumber}`,
          exact: true,
        });
        await expect(queueTab).toBeVisible({ timeout: 30_000 });
        await queueTab.click();
        await session.adminPage.getByRole('button', { name: new RegExp(session.productName) }).first().click();
        const charge = session.adminPage.getByRole('button', { name: /Charge/ });
        await expect(charge).toBeEnabled({ timeout: 30_000 });
        await charge.click();
        await session.adminPage.getByRole('button', { name: /CASH/i }).click();
      }));

      const paidOrders = await Promise.all(sessions.map(async (session) => {
        await expect.poll(async () => dataOrThrow(await db
          .from('queues')
          .select('status')
          .eq('id', session.ticketId!)
          .single(), `read completed ticket for shop ${session.index + 1}`).status, { timeout: 30_000 }).toBe('complete');

        const order = dataOrThrow(await db
          .from('orders')
          .select('id, event_id, queue_id, status, payment_method, total_price')
          .eq('event_id', session.eventId)
          .eq('queue_id', session.ticketId!)
          .single(), `read paid order for shop ${session.index + 1}`);
        expect(order).toMatchObject({
          event_id: session.eventId,
          queue_id: session.ticketId,
          status: 'completed',
          payment_method: 'cash',
          total_price: session.price,
        });

        const event = dataOrThrow(await db
          .from('events')
          .select('id, artist_id')
          .eq('id', session.eventId)
          .single(), `read event association for shop ${session.index + 1}`);
        expect(event).toEqual({ id: session.eventId, artist_id: session.artistId });

        const product = dataOrThrow(await db
          .from('products')
          .select('id, artist_id')
          .eq('id', session.productId)
          .single(), `read product association for shop ${session.index + 1}`);
        expect(product).toEqual({ id: session.productId, artist_id: session.artistId });

        const items = await db.from('order_items')
          .select('product_id, quantity, price_per_unit')
          .eq('order_id', order.id);
        must(items, `read order items for shop ${session.index + 1}`);
        expect(items.data).toEqual([{
          product_id: session.productId,
          quantity: 1,
          price_per_unit: session.price,
        }]);

        const stock = dataOrThrow(await db
          .from('event_products')
          .select('artist_id, event_id, product_id, stock_total, stock_reserved, stock_sold')
          .eq('event_id', session.eventId)
          .eq('product_id', session.productId)
          .single(), `read event stock for shop ${session.index + 1}`);
        expect(stock).toEqual({
          artist_id: session.artistId,
          event_id: session.eventId,
          product_id: session.productId,
          stock_total: session.stockTotal,
          stock_reserved: 0,
          stock_sold: 1,
        });

        await expect(session.customerPage.getByText(/Completed|Order complete|Thank you/i).first()).toBeVisible({ timeout: 30_000 });
        return order;
      }));

      await Promise.all(sessions.map(async (session, index) => {
        const ownerClient = session.ownerClient;
        if (!ownerClient) throw new Error(`Owner client missing for shop ${session.index + 1}`);
        const otherSession = sessions[(index + 1) % sessions.length];
        const otherOrder = paidOrders[(index + 1) % paidOrders.length];

        const ownRead = await ownerClient.from('orders')
          .select('id, event_id, queue_id, status, total_price, payment_method')
          .eq('id', paidOrders[index].id);
        must(ownRead, `owner reads own order for shop ${session.index + 1}`);
        expect(ownRead.data).toHaveLength(1);

        expectNoPrivateRows(await ownerClient.from('orders')
          .select('id, event_id, queue_id, status, total_price, payment_method')
          .eq('id', otherOrder.id));

        const crossEventMutation = await ownerClient.from('events')
          .update({ is_booth_open: false })
          .eq('id', otherSession.eventId)
          .select('id');
        expectNoPrivateRows(crossEventMutation);

        const unchangedOtherEvent = dataOrThrow(await db
          .from('events')
          .select('is_booth_open')
          .eq('id', otherSession.eventId)
          .single(), `verify cross-shop event mutation denial for shop ${session.index + 1}`);
        expect(unchangedOtherEvent.is_booth_open).toBe(true);
      }));

      const unauthenticated = createClient(localEnv.url, localEnv.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await Promise.all(paidOrders.map(async (order) => {
        expectNoPrivateRows(await unauthenticated.from('orders')
          .select('id, event_id, queue_id, status, total_price, payment_method')
          .eq('id', order.id));
      }));
    } finally {
      const contextClosures = await Promise.allSettled(contexts.map((context) => context.close()));
      const deviceClosures = await Promise.allSettled(devices.map((device) => device.close()));
      const failures = [...contextClosures, ...deviceClosures].filter((result) => result.status === 'rejected');
      if (failures.length) throw new Error(`Could not close ${failures.length} pilot browser resources`);
    }
  });
});
