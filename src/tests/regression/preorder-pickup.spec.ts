import { expect, test, type Page, type Route } from '@playwright/test';

const artistId = '11111111-1111-4111-8111-111111111111';
const preorderEventId = '22222222-2222-4222-8222-222222222222';
const liveEventId = '33333333-3333-4333-8333-333333333333';
const productId = '44444444-4444-4444-8444-444444444444';
const preorderOrderId = '55555555-5555-4555-8555-555555555555';
const ownerEmail = 'preorder-owner@example.com';
const artistSlug = 'preorder-regression';
const pickupCode = 'AB12CD';

const now = Date.now();
const startDate = new Date(now - 60 * 60 * 1000).toISOString();
const endDate = new Date(now + 6 * 60 * 60 * 1000).toISOString();
const futurePreorderStartDate = new Date(now + 24 * 60 * 60 * 1000).toISOString();
const futurePreorderEndDate = new Date(now + 36 * 60 * 60 * 1000).toISOString();
const stockHoldExpiresAt = new Date(now + 15 * 60 * 1000).toISOString();

type MockEventMode = 'both-active' | 'single-active';

interface MockOptions {
  eventMode: MockEventMode;
  holdExpired?: boolean;
}

let mockOptions: MockOptions;

const json = async (route: Route, body: unknown, status = 200) => {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
};

const parseBody = (route: Route) => {
  const raw = route.request().postData() || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const mockSupabase = async (page: Page) => {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.includes('/auth/v1/token')) {
      return json(route, {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: artistId,
          email: ownerEmail,
          role: 'authenticated',
          aud: 'authenticated',
        },
      });
    }

    if (path.includes('/auth/v1/user')) {
      return json(route, {
        id: artistId,
        email: ownerEmail,
        role: 'authenticated',
        aud: 'authenticated',
      });
    }

    if (path.includes('/auth/v1/logout')) {
      return json(route, {});
    }

    if (path.includes('/rest/v1/rpc/is_platform_admin')) {
      return json(route, false);
    }

    if (path.includes('/rest/v1/rpc/has_event_role')) {
      return json(route, true);
    }

    if (path.includes('/rest/v1/rpc/complete_verified_creator_signup')) {
      return json(route, { status: 'not_pending' });
    }

    if (path.includes('/rest/v1/rpc/get_actor_context')) {
      return json(route, [{
        artist_id: artistId,
        role: 'owner',
        is_owner: true,
        member_email: ownerEmail,
      }]);
    }

    if (path.includes('/rest/v1/rpc/list_my_pending_invitations')) {
      return json(route, []);
    }

    if (path.includes('/rest/v1/rpc/list_active_promotions')) {
      return json(route, []);
    }

    if (path.includes('/rest/v1/rpc/list_event_products')) {
      return json(route, [
        {
          id: productId,
          artist_id: artistId,
          name: 'Regression Preorder Charm',
          price: 120,
          image_url: null,
          description: 'Regression product',
          category: 'Regression',
          tags: [],
          status: 'enable',
          currency: 'THB',
          stock_total: 20,
          stock_reserved: 1,
          stock_sold: 0,
          is_unlimited: false,
          event_product_id: '66666666-6666-4666-8666-666666666666',
        },
      ]);
    }

    if (path.includes('/rest/v1/products')) {
      return json(route, [
        {
          id: productId,
          artist_id: artistId,
          name: 'Regression Preorder Charm',
          price: 120,
          image_url: null,
          description: 'Regression product',
          category: 'Regression',
          tags: [],
          status: 'enable',
          currency: 'THB',
          stock_total: 20,
          stock_reserved: 1,
          stock_sold: 0,
          is_unlimited: false,
        },
      ]);
    }

    if (path.includes('/rest/v1/rpc/create_preorder_with_stock')) {
      const body = parseBody(route);
      expect(body.p_event_id).toBe(preorderEventId);
      expect(body.p_customer_email).toBe('noqueue@example.com');
      return json(route, [
        {
          order_id: preorderOrderId,
          pickup_code: pickupCode,
          total_price: 120,
          currency: 'THB',
          pickup_instructions: 'Show this regression pickup code at the test booth.',
          payment_status: 'awaiting_payment',
          payment_methods: [],
          payment_deadline_at: stockHoldExpiresAt,
        },
      ]);
    }

    if (path.includes('/rest/v1/rpc/get_public_preorder_by_code')) {
      return json(route, [{
        order_id: preorderOrderId,
        event_id: preorderEventId,
        event_name: 'Regression Preorder Event',
        artist_name: 'Preorder Regression Artist',
        artist_facebook_url: null,
        order_type: 'preorder',
        shipping_address: null,
        tracking_number: null,
        shipping_carrier: null,
        shipped_at: null,
        status: mockOptions.holdExpired ? 'cancelled' : 'pending',
        pickup_status: mockOptions.holdExpired ? 'expired' : 'not_required',
        pickup_code: pickupCode,
        customer_name: 'No Queue Customer',
        customer_email_masked: 'n***@example.com',
        total_price: 120,
        currency: 'THB',
        pickup_instructions: 'Show this regression pickup code at the test booth.',
        payment_status: mockOptions.holdExpired ? 'payment_expired' : 'awaiting_payment',
        slip_url: null,
        submitted_at: null,
        confirmed_at: null,
        rejected_at: null,
        review_note: mockOptions.holdExpired ? 'stock_hold_expired' : null,
        payment_methods: [],
        payment_deadline_at: mockOptions.holdExpired
          ? new Date(now - 1000).toISOString()
          : stockHoldExpiresAt,
        created_at: new Date(now).toISOString(),
        picked_up_at: null,
        items: [{
          product_id: productId,
          name: 'Regression Preorder Charm',
          quantity: 1,
          price_per_unit: 120,
          currency: 'THB',
        }],
      }]);
    }

    if (path.includes('/rest/v1/artist_members')) {
      return json(route, {
        artist_id: artistId,
        role: 'owner',
        member_email: ownerEmail,
      });
    }

    if (path.includes('/rest/v1/event_payment_methods')) {
      return json(route, null);
    }

    if (path.includes('/rest/v1/event_products')) {
      return json(route, [{ id: '66666666-6666-4666-8666-666666666666' }]);
    }

    if (path.includes('/rest/v1/artists')) {
      return json(route, {
        id: artistId,
        slug: artistSlug,
        display_name: 'Preorder Regression Artist',
        bio: 'Regression artist',
        email: ownerEmail,
        image_url: null,
        broadcast_message: null,
        is_queue_open: true,
        x_url: null,
        facebook_url: null,
        ig_url: null,
        tiktok_url: null,
      });
    }

    if (path.includes('/rest/v1/events')) {
      const eventRows = [
        {
          id: preorderEventId,
          artist_id: artistId,
          event_name: 'Regression Preorder Event',
          start_date: futurePreorderStartDate,
          end_date: futurePreorderEndDate,
          event_timezone: 'Asia/Bangkok',
          selling_mode: 'preorder',
          preorder_opens_at: new Date(now - 30 * 60 * 1000).toISOString(),
          preorder_closes_at: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
          preorder_pickup_instructions: 'Show this regression pickup code at the test booth.',
          location: 'Regression Hall',
          booth_detail: 'A12',
          queueing_area: null,
          location_name: null,
          location_detail: null,
          booth_number: null,
          entrance_fee: null,
          transit_info: null,
          status: 'Confirmed',
          is_booth_open: true,
        },
        {
          id: liveEventId,
          artist_id: artistId,
          event_name: 'Regression Live Event',
          start_date: startDate,
          end_date: endDate,
          event_timezone: 'Asia/Bangkok',
          selling_mode: 'live',
          preorder_opens_at: null,
          preorder_closes_at: null,
          preorder_pickup_instructions: null,
          location: 'Regression Hall',
          booth_detail: 'A13',
          queueing_area: null,
          location_name: null,
          location_detail: null,
          booth_number: null,
          entrance_fee: null,
          transit_info: null,
          status: 'Confirmed',
          is_booth_open: true,
        },
      ];
      const servedEventRows = mockOptions.eventMode === 'single-active' ? [eventRows[0]] : eventRows;

      if (url.search.includes(`id=eq.${preorderEventId}`)) {
        return json(route, eventRows[0]);
      }

      if (url.search.includes(`id=eq.${liveEventId}`)) {
        return json(route, eventRows[1]);
      }

      return json(route, servedEventRows);
    }

    if (path.includes('/rest/v1/orders')) {
      return json(route, [
        {
          id: preorderOrderId,
          event_id: preorderEventId,
          created_at: new Date(now).toISOString(),
          status: 'pending',
          order_type: 'preorder',
          pickup_status: 'awaiting_pickup',
          pickup_code: pickupCode,
          customer_name: 'Pickup List Customer',
          customer_contact: '@pickup-list',
          customer_note: 'seeded for pickup list regression',
          total_price: 120,
          currency: 'THB',
          order_items: [
            {
              quantity: 1,
              products: { name: 'Regression Preorder Charm' },
            },
          ],
        },
      ]);
    }

    if (path.includes('/rest/v1/queues')) {
      return json(route, null);
    }

    if (path.includes('/realtime/v1')) {
      return route.abort();
    }

    return route.continue();
  });
};

const setSelectedEvent = async (page: Page, eventId: string) => {
  await page.addInitScript(
    ({ currentArtistId, currentEventId }) => {
      window.localStorage.clear();
      window.localStorage.setItem('nireq-language', 'en');
      window.localStorage.setItem(`customerSelectedEventId:${currentArtistId}`, currentEventId);
    },
    { currentArtistId: artistId, currentEventId: eventId }
  );
};

const loginOwner = async (page: Page) => {
  await page.goto('/manage-login');
  await page.fill('input[type="email"]', ownerEmail);
  await page.fill('input[type="password"]', 'mock-password');
  await page.getByRole('button', { name: /Login to Dashboard|Login/i }).click();
  await expect(page).not.toHaveURL(/manage-login/, { timeout: 20000 });
};

test.describe('pre-order pickup MVP regressions', () => {
  test.beforeEach(async ({ page }) => {
    mockOptions = { eventMode: 'both-active' };
    await mockSupabase(page);
  });

  test('customer pre-order checkout does not require a queue ticket', async ({ page }) => {
    await setSelectedEvent(page, preorderEventId);
    await page.goto(`/${artistSlug}/menu`);

    await expect(page.getByText('Pre-order now. No queue ticket needed.').first()).toBeVisible({ timeout: 20000 });
    const addButton = page.getByRole('button', { name: /^Add$/i }).first();
    await expect(addButton).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);
    await addButton.click();
    const totalButton = page.getByRole('button').filter({ hasText: /฿120|Total/i }).last();
    await expect(totalButton).toBeVisible({ timeout: 10000 });
    await totalButton.click();
    await page.getByPlaceholder('Name for pickup').fill('No Queue Customer');
    await page.getByPlaceholder('Email').fill('noqueue@example.com');
    await page.getByPlaceholder('LINE, Instagram, X, or other social (optional)').fill('@noqueue');
    await page.getByRole('button', { name: /^Pre-order$/i }).click();
    await page.getByRole('button', { name: /Place Pre-order/i }).click();

    await expect(page.getByText('Order code', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(pickupCode)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How to pay' })).toBeVisible();
    await expect(page.getByText(/Pay before/i)).toBeVisible();
    await expect(page.getByText(/Time left: 14:/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Photo or PDF of your transfer slip' })).toBeVisible();
  });

  test('expired checkout hold requires a new order', async ({ page }) => {
    mockOptions.holdExpired = true;
    await page.goto(`/${artistSlug}/order/${pickupCode}`);

    await expect(page.getByRole('heading', { name: 'Order expired' })).toBeVisible();
    await expect(page.getByText(/reserved items were released/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Order again from menu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Photo or PDF of your transfer slip' })).toHaveCount(0);
  });

  test('live mode customer menu still requires a queue ticket before checkout', async ({ page }) => {
    await setSelectedEvent(page, liveEventId);
    await page.goto(`/${artistSlug}/menu`);

    await expect(page.getByText('Queue Number', { exact: true })).toBeVisible({ timeout: 20000 });
    const addButton = page.getByRole('button', { name: /^Add$/i }).first();
    await expect(addButton).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);
    await addButton.click();

    await expect(page.getByText(/Get a queue number before confirming/i).first()).toBeVisible();
  });

  test('staff pickup page lists awaiting pre-orders for the event', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`/manage-events/${preorderEventId}/pickup`);

    await expect(page.getByRole('heading', { name: 'Pickup Orders' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(pickupCode)).toBeVisible();
    await expect(page.getByText('Pickup List Customer')).toBeVisible();
    await expect(page.locator('main').getByText('Awaiting pickup').last()).toBeVisible();
  });

  test('single active event opens the event workspace by default', async ({ page }) => {
    mockOptions.eventMode = 'single-active';
    await loginOwner(page);

    await expect(page).toHaveURL(new RegExp(`/manage-events/${preorderEventId}/workspace`), { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Regression Preorder Event' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Guided booth setup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue setup' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1 order waiting for pickup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open pickup' })).toBeVisible();
  });

  test('full event grid escape hatch keeps profile access visible', async ({ page }) => {
    mockOptions.eventMode = 'single-active';
    await loginOwner(page);

    await page.goto('/manage-events?view=all');

    await expect(page).toHaveURL(/\/manage-events\?view=all/);
    await expect(page.getByRole('heading', { name: 'Manage profile and events' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Profile Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Event Workspaces' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage' })).toBeVisible();
  });

  test('multiple active events show a grid and Manage opens the selected workspace', async ({ page }) => {
    await loginOwner(page);

    await expect(page.getByRole('heading', { name: 'Event Workspaces' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Regression Preorder Event' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Regression Live Event' })).toBeVisible();

    await page.getByRole('button', { name: 'Manage' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/manage-events/${preorderEventId}/workspace`), { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Regression Preorder Event' })).toBeVisible();
  });
});
