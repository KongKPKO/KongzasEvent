import { test, expect } from '@playwright/test';

// Run tests in serial because they share state (Event A)
test.describe.configure({ mode: 'serial' });

// Shared State
let artistId: string;
let eventId: string;
let uniqueEventName: string;

// Credentials (from env or defaults)
const USER_A = {
  email: process.env.TEST_USER_A_EMAIL || 'artist_a@example.com',
  pass: process.env.TEST_USER_A_PASS || 'password123'
};

const USER_B = {
  email: process.env.TEST_USER_B_EMAIL || 'artist_b@example.com',
  pass: process.env.TEST_USER_B_PASS || 'password123'
};

/**
 * Helper: Login Flow
 */
async function login(page: any, email: string, pass: string) {
  return await test.step(`Login as ${email}`, async () => {
    await page.goto('/manage-login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', pass);

    // Intercept the token response to get the user ID
    const loginResponsePromise = page.waitForResponse((response: any) =>
      response.url().includes('/auth/v1/token') && response.status() === 200
    );

    await page.click('button:has-text("Login to Dashboard")');

    const loginResponse = await loginResponsePromise;
    const json = await loginResponse.json();
    const userId = json.user?.id;
    const accessToken = json.access_token;

    // Verify redirection
    await expect(page).toHaveURL(/\/manage-events|\/manage-pos-queues/);

    return { userId, accessToken };
  });
}

test.describe('Artist POS & Queue System - Full Flow', () => {

  test('1. Critical Security Test (Data Isolation)', async ({ page, browser }) => {

    // --- Step 1: User A Creates Event ---
    await test.step('User A: Create unique event', async () => {
      // Login & Capture ID
      const { userId } = await login(page, USER_A.email, USER_A.pass);
      artistId = userId; // Store for next tests

      await page.goto('/manage-events');

      // Open Modal
      await page.click('button:has-text("Add Event")');
      await expect(page.locator('h3:has-text("New Event")')).toBeVisible();

      // Fill Form
      uniqueEventName = `Event A ${Date.now()}`;
      await page.fill('input[name="event_name"]', uniqueEventName);

      // Set dates (Today to Tomorrow)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Format for datetime-local: YYYY-MM-DDTHH:mm
      const formatDate = (d: Date) => d.toISOString().slice(0, 16);

      await page.fill('input[name="start_date"]', formatDate(now));
      await page.fill('input[name="end_date"]', formatDate(tomorrow));

      // Save
      // Wait for response to capture Event ID
      const eventResponsePromise = page.waitForResponse((response: any) =>
        response.url().includes('/rest/v1/events') &&
        (response.request().method() === 'POST' || response.request().method() === 'PATCH') &&
        response.status() === 201 // Created
      );

      await page.click('button:has-text("Save Event")');

      const eventResponse = await eventResponsePromise;
      const eventData = await eventResponse.json();
      eventId = eventData.id; // Store for next tests (Test 2 needs this)

      console.log(`[Test] Created Event: ${uniqueEventName} (${eventId})`);

      // Verify in list
      await expect(page.locator(`text=${uniqueEventName}`)).toBeVisible();
    });

    // --- Step 2: User B Checks for Leakage ---
    await test.step('User B: Verify isolation', async () => {
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();

      await login(pageB, USER_B.email, USER_B.pass);

      await pageB.goto('/manage-events');

      // Must NOT see the event created by A
      await expect(pageB.locator(`text=${uniqueEventName}`)).not.toBeVisible();

      await contextB.close();
    });
  });

  test('2. The "Happy Path" (Queue -> POS Flow)', async ({ page }) => {
    // Requires Event from Test 1
    expect(eventId, 'Event ID must exist from previous test').toBeDefined();
    expect(artistId, 'Artist ID must exist from previous test').toBeDefined();

    await test.step('Setup: Login & Insert Queue Item', async () => {
        // Reuse login or login again (page is fresh in each test)
        const { accessToken } = await login(page, USER_A.email, USER_A.pass);

        // Insert a queue item directly to DB to simulate "Customer Joined"
        // Use page.request with the captured access token to bypass RLS issues
        // (Authenticated as User A)
        const response = await page.request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/queues`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'apikey': process.env.VITE_SUPABASE_ANON_KEY || '',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            data: {
                artist_id: artistId,
                event_id: eventId,
                queue_number: 999, // Distinct number
                status: 'waiting',
                created_at: new Date().toISOString()
            }
        });

        expect(response.ok(), `Failed to insert queue: ${response.statusText()}`).toBeTruthy();
    });

    await test.step('Queue Panel: Call & Arrive', async () => {
        await page.goto('/manage-pos-queues');

        // Locate "Call Next" - Wait for Realtime to sync
        const callBtn = page.locator('button:has-text("Call Next")');
        await expect(callBtn).toBeEnabled({ timeout: 10000 });

        // Click Call
        await callBtn.click();

        // Should move to "Calling" list and show "ARRIVED" button
        const arriveBtn = page.locator('button:has-text("ARRIVED")');
        await expect(arriveBtn).toBeVisible();

        // Click Arrived
        await arriveBtn.click();
    });

    await test.step('POS Panel: Process Order', async () => {
        // Check for Tab
        const queueTab = page.locator('button:has-text("Queue #999")');
        await expect(queueTab).toBeVisible();
        await queueTab.click();

        // Add Product (Find any product card)
        // We assume there's at least one product. If not, this step fails (as expected for "Live" system test)
        const productCard = page.locator('.grid > div').first();
        await expect(productCard).toBeVisible();
        await productCard.click();

        // Check Cart has item
        await expect(page.locator('text=Total')).toBeVisible();

        // Click Charge
        await page.click('button:has-text("Charge")');

        // Payment Modal
        await expect(page.locator('h3:has-text("Confirm Payment")')).toBeVisible();

        // Select Cash
        await page.click('button:has-text("CASH")');

        // Verify Completion
        await expect(page.locator('h3:has-text("Confirm Payment")')).not.toBeVisible();
        await expect(queueTab).not.toBeVisible(); // Tab should be gone
    });

  });

  test('3. Walk-in Order Flow', async ({ page }) => {
     // Login
     await login(page, USER_A.email, USER_A.pass);
     await page.goto('/manage-pos-queues');

     await test.step('Walk-in Sale', async () => {
        // Click Walk-in Tab
        await page.click('button:has-text("Walk-in")');

        // Add Product
        const productCard = page.locator('.grid > div').first();
        await expect(productCard).toBeVisible();
        await productCard.click();

        // Charge
        await page.click('button:has-text("Charge")');
        await page.click('button:has-text("CASH")');

        // Verify
        await expect(page.locator('h3:has-text("Confirm Payment")')).not.toBeVisible();
        // Cart should be empty (Total ฿0 or empty state)
        // Our UI shows "Cart is empty" or similar when empty?
        // Let's check if the product is gone from cart list.
        await expect(page.locator('.w-\\[280px\\] .flex-col')).not.toContainText('฿');
     });
  });

});
