import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { AdminEventsPage } from './pages/AdminEventsPage';
import { AdminQueuesPage } from './pages/AdminQueuesPage';
import { AdminPOSPage } from './pages/AdminPOSPage';
import { CustomerPage } from './pages/CustomerPage';
import { AdminProductsPage } from './pages/AdminProductsPage';

// CONFIGURATION
// Replace these with valid credentials for your environment
const ADMIN_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const ARTIST_SLUG = process.env.TEST_SLUG || 'test1';

// เพิ่ม validation
test.beforeEach(async ({ page }) => {
  // Verify artist slug exists by checking homepage first
  console.log(`Verifying artist slug: ${ARTIST_SLUG}`);
  
  const response = await page.goto(`/${ARTIST_SLUG}`);
  if (!response || response.status() === 404) {
    throw new Error(`Artist slug "${ARTIST_SLUG}" not found (404). Check TEST_SLUG env variable.`);
  }
});

test.describe('The Full Service Loop', () => {
  test.slow(); // This test involves multiple steps and realtime, so give it more time

  test('Admin creates event, customer queues, admin calls, customer arrival, admin serves', async ({ browser }) => {
    test.setTimeout(100000);
    // --- 1. ADMIN CONTEXT ---
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    
    const loginPage = new LoginPage(adminPage);
    const eventsPage = new AdminEventsPage(adminPage);
    const productsPage = new AdminProductsPage(adminPage);
    const queuesPage = new AdminQueuesPage(adminPage);
    const posPage = new AdminPOSPage(adminPage);

    // 1.1 Login
    console.log('Admin: Logging in...');
    await loginPage.goto();
    await loginPage.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    
    // Verify Redirect (Wait for URL to update)
    await expect(adminPage).toHaveURL(/.*manage-events/, { timeout: 10000 });

    // 1.2 Create Event
    console.log('Admin: Creating Event...');
    await eventsPage.goto();
    const eventName = `Cosplay Fest ${Date.now()}`; // Unique Name
    await eventsPage.createEvent(eventName);

    // 1.3 Ensure Queue Open
    console.log('Admin: Checking Queue Status...');
    await queuesPage.goto();
    try {
      await queuesPage.ensureQueueOpen();
    } catch (e) {
      console.warn('Queue open failed, might already be open:', e);
    }
    // Important: Wait for page to load fully
    await adminPage.waitForLoadState('networkidle');
    await adminPage.waitForTimeout(2000);

    await queuesPage.ensureQueueOpen();

    // Extra wait for changes to propagate
    await adminPage.waitForTimeout(2000);

    // 1.4 Add Product
    console.log('Admin: Adding Product...');
    await productsPage.goto();
    // Wait for page to fully load
    await adminPage.waitForLoadState('domcontentloaded');
    await adminPage.waitForTimeout(1000);

    const PRODUCT_NAME = `Cheki-${Date.now()}`; // ใช้ชื่อไม่ซ้ำ
    await productsPage.addProduct(PRODUCT_NAME, '100');

      // --- 2. CUSTOMER CONTEXT ---
    console.log('Customer: Visiting Queue Page...');
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customer = new CustomerPage(customerPage);

    // 2.1 Visit Page with retry logic
    let visitSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
        console.log(`[Attempt ${attempt}/3] Navigating to queue page...`);
        await customer.goto(ARTIST_SLUG);
        visitSuccess = true;
        break;
        } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error);
        if (attempt === 3) throw error;
        await customerPage.waitForTimeout(2000);
        }
    }
    
    if (!visitSuccess) {
        throw new Error('Failed to load customer queue page after 3 attempts');
    }

    // 2.2 Wait for realtime data to settle
    console.log('Customer: Waiting for page to be ready...');
    await customerPage.waitForTimeout(3000);
    
    // 2.3 Get Ticket
    console.log('Customer: Getting Ticket...');
    await customer.getTicket();
    
    // Check LocalStorage
    const myQueueId = await customerPage.evaluate(() => localStorage.getItem('myQueueId'));
    expect(myQueueId).toBeTruthy();

    // Extract Queue Number from UI
    const ticketNumberText = await customerPage.locator('.text-7xl').innerText();
    const queueNum = ticketNumberText.replace('#', '').trim();
    console.log(`Customer Ticket: #${queueNum}`);

    // --- 3. ADMIN QUEUE MANAGEMENT ---
    console.log('Admin: Calling Ticket...');
    await queuesPage.goto(); // Reload to refresh list
    
    // Verify ticket is in waiting list
    await queuesPage.verifyTicketInWaiting(queueNum);

    // 3.1 Call Next
    // IMPORTANT: "Call Next" calls the *first* ticket. 
    // If there are other tickets, our ticket might not be next.
    // However, in a clean test env, or assuming we just pushed one, it should be fine.
    // But strictly, we should ensure we call OUR ticket.
    // The "Call Next" button in UI calls the top of waiting list.
    // If our ticket is verified to be in waiting list, and sorting is by number, 
    // we might need to call multiple times if there are older tickets?
    // For "Golden Path", we assume we are the next one or the specific one.
    // Refinement: Ideally, we click a "Call" button specifically for that ticket if available.
    // The UI `SupabaseDashboard.tsx` only has a big "Call Next" button.
    // We will assume "Call Next" works for the test scenario.
    await queuesPage.callNext();

    // 3.2 Verify Waiting -> Calling (Admin Side)
    // We might need to wait for realtime update or UI update
    await queuesPage.verifyTicketCalling(queueNum);

    // --- 4. CUSTOMER REALTIME CHECK ---
    console.log('Customer: Checking Notification...');
    // Realtime might take a moment
    await customer.verifyStatus("It's Your Turn"); 

    // --- 5. ARRIVAL & ORDER (POS) ---
    console.log('Admin: Confirming Arrival...');
    await queuesPage.confirmArrival();

    // Verify Customer sees "Being Served"
    await customer.verifyStatus("Being Served");

    // 5.1 Go to POS
    console.log('Admin: Opening POS...');
    await posPage.goto();

    // 5.2 Select Queue
    // Wait for the queue tab to appear
    await posPage.selectQueue(queueNum);

    // 5.3 Add Product
    await posPage.addToCart(PRODUCT_NAME);

    // 5.4 Charge (Cash)
    console.log('Admin: Processing Payment...');
    await posPage.chargeAndPay('CASH');

    // --- 6. COMPLETION ---
    console.log('Verifying Completion...');
    // 6.1 Assert Order Saved (Implicit by success alert or cart clear)
    await posPage.verifyOrderCompleted();

    // 6.2 Assert Queue Complete (Customer)
    await customer.verifyStatus("Completed");
    
    console.log('Test Complete!');

    // Cleanup
    await adminContext.close();
    await customerContext.close();
  });
});
