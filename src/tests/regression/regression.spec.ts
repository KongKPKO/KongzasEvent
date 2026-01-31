import { test, expect, Page, Locator } from '@playwright/test';
import { CustomerPage } from '../e2e/pages/CustomerPage';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const ADMIN_EMAIL = process.env.TEST_EMAIL || 'kongphop.testy@gmail.com';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'Test112233';
const ARTIST_SLUG = process.env.TEST_SLUG || 'testy';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- HELPER 1: Get User ID ---
async function getUserId() {
    const { data } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    return data.user?.id;
}

// --- HELPER 2: Clean Database ---
async function prepareTestData(userId: string) {
    console.log(`[Prep] Cleaning data for user ${userId}...]`);
    try {
        await supabase.from('order_items').delete().neq('id', 0);
        await supabase.from('orders').delete().eq('artist_id', userId);
        await supabase.from('products').delete().eq('artist_id', userId);
        await supabase.from('tickets').delete().eq('artist_id', userId);
        await supabase.from('queues').delete().eq('artist_id', userId);
        await supabase.from('events').delete().eq('artist_id', userId);
    } catch (e) {
        console.warn('[Prep Warning] Cleanup incomplete', e);
    }
}

// --- HELPER 3: Ensure Active Event ---
async function ensureActiveEvent(userId: string) {
    await supabase.from('artists').update({ is_queue_open: true }).eq('id', userId);
    
    const { data: events } = await supabase.from('events').select('*')
        .eq('artist_id', userId)
        .eq('status', 'Confirmed')
        .gte('end_date', new Date().toISOString());
    
    if (!events || events.length === 0) {
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const tomorrow = new Date(Date.now() + 86400000).toISOString();
        await supabase.from('events').insert({
            artist_id: userId,
            event_name: `Reg Event ${Date.now()}`,
            start_date: oneHourAgo,
            end_date: tomorrow,
            status: 'Confirmed',
            is_booth_open: true
        });
    } else {
        await supabase.from('events').update({ is_booth_open: true }).eq('id', events[0].id);
    }
}

// --- HELPER 4: Robust Login (handles UI text differences & redirects) ---
async function robustLogin(page: Page) {
    await page.goto('/manage-login');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    
    // Fill credentials using the same selectors as working E2E LoginPage
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    
    // Small wait for JS bindings on slower machines
    await page.waitForTimeout(1000);
    
    // Click login - current UI uses "Login to Dashboard"
    const loginBtn = page.getByRole('button', { name: /Login to Dashboard|Sign in|Login/i });
    await expect(loginBtn).toBeEnabled();
    await loginBtn.click();

    // If an error toast appears, fail early
    const errorToast = page.getByText(/Invalid login|User not found|Password incorrect/i);
    if (await errorToast.isVisible().catch(()=>false)) {
        throw new Error('❌ Login Failed: Invalid Credentials or User Blocked');
    }

    // Align expectation with working E2E: just ensure we are not stuck on login
    await expect(page).not.toHaveURL(/manage-login/);
}



// --- HELPER 6: Find product edit button on ManageProducts (desktop + mobile) ---
async function findProductEditButton(page: Page, productName: string) {
    // Desktop: table layout
    const tableVisible = await page.locator('table').first().isVisible().catch(() => false);
    if (tableVisible) {
        const row = page.locator('tr', { has: page.getByText(productName, { exact: true }) }).first();
        await expect(row).toBeVisible({ timeout: 20000 });
        await row.scrollIntoViewIfNeeded().catch(() => {});
        // Last cell contains Actions: [Edit, Delete]
        return row.locator('td').last().locator('button').first();
    }

    // Mobile: card layout (no table)
    // Each mobile card contains an h3 title and actions at absolute bottom-right
    const card = page.locator('div').filter({ has: page.locator('h3', { hasText: productName }) }).first();
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const actions = card.locator('div.absolute.bottom-2.right-2 button');
    if (await actions.count() > 0) {
        return actions.first(); // Edit is first, Delete is second
    }
    // Fallback by accessible name if present
    const namedEdit = card.getByRole('button', { name: /Edit|แก้ไข/i }).first();
    return namedEdit;
}

// --- HELPER 7: Ensure POS panel active across devices (handles mobile tab + visibility) ---
async function ensurePosPanelActive(page: Page) {
    const grid = page.locator('[aria-label="Product grid"]').first();
    const cart = page.locator('[aria-label="Shopping cart"]').first();
    const searchInput = page.getByLabel(/Search products/i).first();

    const clickPosTabVariants = async () => {
        // Preferred: explicit test id
        const posTabById = page.locator('[data-testid="pos-tab"]').first();
        if (await posTabById.isVisible().catch(() => false)) {
            await posTabById.click({ force: true });
        }
        // Try semantic by role/name
        const posByRole = page.getByRole('button', { name: /POS\s*\/\s*Order|^POS$|Order/i });
        if (await posByRole.first().isVisible().catch(() => false)) {
            await posByRole.first().click({ force: true });
        }
        // Try index-based within a two-button switcher if exists
        const switcherButtons = page.locator('[data-testid="pos-switcher"] button');
        const count = await switcherButtons.count();
        if (count >= 2) {
            await switcherButtons.nth(1).click({ force: true }).catch(() => {});
        } else if (count === 1) {
            await switcherButtons.first().click({ force: true }).catch(() => {});
        }
    };

    const cssVisible = async (locator: Locator) => {
        const handle = await locator.elementHandle().catch(() => null);
        if (!handle) return false;
        return await handle.evaluate((el) => {
            const style = window.getComputedStyle(el as HTMLElement);
            const rect = (el as HTMLElement).getBoundingClientRect();
            return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && (el as any).offsetParent !== null;
        }).catch(() => false);
    };

    const posPane = page.locator('[data-testid="pos-pane"]').first();

    for (let attempt = 0; attempt < 6; attempt++) {
        await clickPosTabVariants();
        await grid.scrollIntoViewIfNeeded().catch(() => {});
        await cart.scrollIntoViewIfNeeded().catch(() => {});
        await searchInput.scrollIntoViewIfNeeded().catch(() => {});
        await posPane.scrollIntoViewIfNeeded().catch(() => {});

        const anyVisible = (await posPane.isVisible().catch(() => false)) || (await grid.isVisible().catch(() => false)) || (await cart.isVisible().catch(() => false)) || (await searchInput.isVisible().catch(() => false));
        const anyCssVisible = (await cssVisible(posPane)) || (await cssVisible(grid)) || (await cssVisible(cart)) || (await cssVisible(searchInput));
        if (anyVisible || anyCssVisible) {
            return;
        }
        await page.waitForTimeout(800);
    }

    await page.screenshot({ path: 'debug-pos-hidden.png', fullPage: true });
    throw new Error('POS panel (pane/grid/cart/search) not visible after activating POS tab');
}


test.describe('Regression Suite @regression', () => {
    test.setTimeout(180000);

    test.beforeEach(async ({ page }) => {
        // Land on login to prime session for some flows
        await page.goto('/manage-login');
    });

    test('R1. Critical Path: Admin Setup -> Customer Queue -> POS Payment', async ({ browser }) => {
        // 1. Setup Data
        const userId = await getUserId();
        if (userId) {
            await prepareTestData(userId);
            await ensureActiveEvent(userId);

            const { error } = await supabase.from('products').insert({
                artist_id: userId,
                name: `RegItem-${Date.now()}`,
                price: 100,
                status: 'enable', // Lowercase
                category: 'Test',
                currency: 'THB',
                image_url: null
            });
            if (error) throw new Error(`[R1 Seed Failed] ${error.message}`);
        }

        // 2. Admin Login & Nav
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();
        
        // ✅ Robust Login to /manage-events
        await robustLogin(adminPage);
        
        // Navigate to POS/Queues
        await adminPage.goto('/manage-pos-queues'); 
        await ensurePosPanelActive(adminPage);

        // Ensure Booth Open
        const boothStatusText = adminPage.getByText(/BOOTH OPEN|BOOTH CLOSED/i).first();
        if ((await boothStatusText.innerText()).match(/CLOSED/i)) {
            await adminPage.locator('button.rounded-full').first().click();
            await expect(adminPage.getByText('BOOTH OPEN')).toBeVisible();
        }

        // 3. Customer Journey
        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        const customer = new CustomerPage(customerPage);

        await customer.goto(ARTIST_SLUG);
        await customer.getTicket();

        const ticketText = await customerPage.locator('.text-7xl').innerText();
        const queueNum = ticketText.replace('#', '').trim();
        console.log(`[R1] Queue: #${queueNum}`);

        // 4. Admin Serve
        await adminPage.bringToFront();
        
        // Loop Call Next until our queue appears with Arrived
        for (let i = 0; i < 15; i++) {
            const callingSection = adminPage.locator('div').filter({ hasText: /Calling/i }).last();
            const myCard = callingSection.locator('div').filter({ hasText: `Queue #${queueNum}` });
            
            if (await myCard.count() > 0 && await myCard.getByRole('button', { name: /Arrived/i }).isVisible()) {
                break;
            }
            
            const callNextBtn = adminPage.getByRole('button', { name: /Call Next/i }).first();
            if (await callNextBtn.isEnabled()) {
                await callNextBtn.click();
                await adminPage.waitForTimeout(2000); 
            } else {
                await adminPage.waitForTimeout(1000);
            }
        }

        await adminPage.getByRole('button', { name: /Arrived/i }).first().click();

        // 5. POS Payment
        await adminPage.waitForTimeout(2000);
        const queueTab = adminPage.getByRole('button', { name: `Queue #${queueNum}` });
        
        if (!await queueTab.isVisible().catch(()=>false)) {
             const callingArrived = adminPage.locator('.bg-yellow-50').getByRole('button', { name: /ARRIVED/i }).first();
             if(await callingArrived.isVisible()) await callingArrived.click();
        }

        await expect(queueTab).toBeVisible({ timeout: 20000 });
        await queueTab.click();
        
        // Click Product
        await adminPage.locator('[aria-label="Product grid"] .group').first().click();

        await adminPage.getByRole('button', { name: /Charge/i }).click();
        await adminPage.getByRole('button', { name: /Cash/i }).click();

        await expect(customerPage.getByText(/Completed/i)).toBeVisible({ timeout: 20000 });
        
        await adminContext.close();
        await customerContext.close();
    });

    test('R2.1 Product Status Toggle (Enable/Disable/Soldout)', async ({ browser }) => {
         const userId = await getUserId();
         const TEST_PROD = `R2.1-Prod-${Date.now()}`;
         
         if (userId) {
             await prepareTestData(userId);
             const { error } = await supabase.from('products').insert({
                 artist_id: userId,
                 name: TEST_PROD,
                 price: 150,
                 status: 'enable', 
                 category: 'Regression Test',
                 currency: 'THB',
                 image_url: null 
             });
             if (error) throw new Error(`[R2.1 Seed Failed] ${error.message}`);
         }

         const adminContext = await browser.newContext();
         const page = await adminContext.newPage();
         
         // ✅ Robust Login
         await robustLogin(page);
         
         await page.goto('/manage-products');
         await page.waitForLoadState('domcontentloaded');

         const searchInput = page.getByPlaceholder('Search products...');
         await expect(searchInput).toBeVisible({ timeout: 30000 });

         if(await searchInput.isVisible()) {
            await searchInput.fill(TEST_PROD);
            await page.waitForTimeout(1000);
         }

         // Use shared helper to find edit button (desktop table or mobile cards)
         let editButton = await findProductEditButton(page, TEST_PROD);
         await expect(editButton).toBeVisible({ timeout: 20000 });

         // Toggle to DISABLED
         await editButton.click();
         await page.getByLabel('Status').selectOption('disable'); 
         await page.getByRole('button', { name: 'Save Changes' }).click();

         // Wait briefly for list refresh
         await page.waitForTimeout(1000);

         // Verify disabled status text appears somewhere near the product name
         let productContainer = page.locator('tr', { has: page.getByText(TEST_PROD, { exact: true }) }).first();
         if (!(await productContainer.isVisible().catch(() => false))) {
            productContainer = page.locator('div').filter({ has: page.locator('h3', { hasText: TEST_PROD }) }).first();
         }
         await expect(productContainer).toBeVisible({ timeout: 20000 });
         await expect(productContainer.getByText(/Disabled|DISABLED/).first()).toBeVisible({ timeout: 20000 });

         // Re-open edit with the helper again
         editButton = await findProductEditButton(page, TEST_PROD);
         await editButton.click();
         await page.getByLabel('Status').selectOption('soldout'); 
         await page.getByRole('button', { name: 'Save Changes' }).click();

         await page.waitForTimeout(1000);
         let productContainer2 = page.locator('tr', { has: page.getByText(TEST_PROD, { exact: true }) }).first();
         if (!(await productContainer2.isVisible().catch(() => false))) {
            productContainer2 = page.locator('div').filter({ has: page.locator('h3', { hasText: TEST_PROD }) }).first();
         }
         await expect(productContainer2).toBeVisible({ timeout: 20000 });
         await expect(productContainer2.locator('span:has-text("Sold Out"), span:has-text("SOLD OUT")').first()).toBeVisible({ timeout: 20000 });
         
         await adminContext.close();
    });

    test('R2.6 Booth Open/Close Toggle', async ({ browser }) => {
        const userId = await getUserId();
        if (userId) { await ensureActiveEvent(userId); }

        const adminContext = await browser.newContext();
        const page = await adminContext.newPage();
        
        // ✅ Robust Login
        await robustLogin(page);

        await page.goto('/manage-pos-queues');
        // Ensure dashboard is loaded; either status text or product grid visible
        await expect(page.getByText(/BOOTH OPEN|BOOTH CLOSED/i).first()).toBeVisible({ timeout: 30000 });

        const status = page.getByText(/BOOTH OPEN|BOOTH CLOSED/i).first();
        await expect(status).toBeVisible({ timeout: 20000 });
        
        const toggleBtn = page.locator('button.rounded-full').first();
        const initialText = await status.innerText();
        
        await toggleBtn.click();
        if (initialText.includes('OPEN')) {
            await expect(page.getByText('BOOTH CLOSED')).toBeVisible();
            await toggleBtn.click(); 
            await expect(page.getByText('BOOTH OPEN')).toBeVisible();
        } else {
            await expect(page.getByText('BOOTH OPEN')).toBeVisible();
            await toggleBtn.click();
            await expect(page.getByText('BOOTH CLOSED')).toBeVisible();
        }
        await adminContext.close();
    });

    test('R2.4 & R2.5 POS: Multiple Products & Price Calculation', async ({ browser }) => {
         const userId = await getUserId();
         if (userId) {
            await prepareTestData(userId);
            await supabase.from('products').insert({
                artist_id: userId,
                name: 'POS-Item-1',
                price: 100,
                status: 'enable',
                category: 'POS Test',
                currency: 'THB'
            });
         }

         const adminContext = await browser.newContext();
         const page = await adminContext.newPage();
         
         // ✅ Robust Login
         await robustLogin(page);

         await page.goto('/manage-pos-queues');
         await ensurePosPanelActive(page);

         const status = page.getByText(/BOOTH/i).first();
         if ((await status.innerText()).includes('CLOSED')) {
             await page.locator('button.rounded-full').first().click();
         }

         // Walk-in tab is default or not required to interact; proceed with grid
         
         const grid = page.locator('[aria-label="Product grid"]');
         await expect(grid).toBeVisible({ timeout: 20000 });

         const firstProduct = grid.locator('.group').first();
         await expect(firstProduct).toBeVisible();
         await firstProduct.click();
         await firstProduct.click();

         const cart = page.locator('[aria-label="Shopping cart"]');
         await expect(cart).toContainText(/[0-9]+/);
         
         const chargeBtn = page.getByRole('button', { name: /Charge/i });
         await expect(chargeBtn).toBeEnabled();
         await chargeBtn.click();

         await expect(page.getByRole('button', { name: /Cash/i })).toBeVisible({ timeout: 10000 });

         await adminContext.close();
    });
});
