// import { test, expect } from '@playwright/test';
// import { CustomerPage } from '../e2e/pages/CustomerPage';
// import { createClient } from '@supabase/supabase-js';

// // --- CONFIGURATION ---
// const ADMIN_EMAIL = process.env.TEST_EMAIL || 'kongphop.testy@gmail.com';
// const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'Test112233';
// const ARTIST_SLUG = process.env.TEST_SLUG || 'testy';
// const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
// const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';

// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// // --- HELPER 1: Get User ID ---
// async function getUserId() {
//     const { data } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
//     return data.user?.id;
// }

// // --- HELPER 2: Clean Database ---
// async function prepareTestData(userId: string) {
//     console.log(`[Prep] Cleaning data for user ${userId}...`);
//     try {
//         await supabase.from('order_items').delete().neq('id', 0); 
//         await supabase.from('orders').delete().eq('artist_id', userId);
//         await supabase.from('products').delete().eq('artist_id', userId);
//         await supabase.from('tickets').delete().eq('artist_id', userId);
//         await supabase.from('queues').delete().eq('artist_id', userId);
//         await supabase.from('events').delete().eq('artist_id', userId);
//     } catch (e) {
//         console.warn('[Prep Warning] Cleanup incomplete', e);
//     }
// }

// // --- HELPER 3: Ensure Active Event ---
// async function ensureActiveEvent(userId: string) {
//     await supabase.from('artists').update({ is_queue_open: true }).eq('id', userId);
    
//     const { data: events } = await supabase.from('events').select('*')
//         .eq('artist_id', userId)
//         .eq('status', 'Confirmed')
//         .gte('end_date', new Date().toISOString());
    
//     if (!events || events.length === 0) {
//         const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
//         const tomorrow = new Date(Date.now() + 86400000).toISOString();
//         await supabase.from('events').insert({
//             artist_id: userId,
//             event_name: `Reg Event ${Date.now()}`,
//             start_date: oneHourAgo,
//             end_date: tomorrow,
//             status: 'Confirmed',
//             is_booth_open: true
//         });
//     } else {
//         await supabase.from('events').update({ is_booth_open: true }).eq('id', events[0].id);
//     }
// }

// // --- HELPER 4: Robust Login (แก้ปัญหาเครื่องช้า + กดไม่ติด) ---
// async function robustLogin(page: any) {
//     await page.goto('/manage-login');
//     await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    
//     // กรอกข้อมูล
//     await page.getByPlaceholder(/email/i).fill(ADMIN_EMAIL);
//     await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD);
    
//     // 🛑 WAIT: รอสักนิดให้ JS ทำงาน (สำคัญสำหรับเครื่องช้า)
//     await page.waitForTimeout(2000); 
    
//     // กดปุ่ม Login
//     const loginBtn = page.getByRole('button', { name: /Sign in|Login/i });
//     await expect(loginBtn).toBeEnabled();
//     await loginBtn.click();

//     // 🛑 CHECK: ถ้ามี Error เด้งขึ้นมา ให้ Test พังทันที (จะได้ไม่ต้องรอ Timeout 30 วิ)
//     const errorToast = page.getByText(/Invalid login|User not found|Password incorrect/i);
//     if (await errorToast.isVisible()) {
//         throw new Error('❌ Login Failed: Invalid Credentials or User Blocked');
//     }

//     // รอจนกว่าจะ Redirect ไปหน้า Landing Page
//     await expect(page).toHaveURL(new RegExp(`/${ARTIST_SLUG}`), { timeout: 30000 });
// }


// test.describe('Regression Suite @regression', () => {
//     test.setTimeout(120000); 

//     test.beforeEach(async ({ page }) => {
//         await page.goto(`/${ARTIST_SLUG}`);
//     });

//     test('R1. Critical Path: Admin Setup -> Customer Queue -> POS Payment', async ({ browser }) => {
//         // 1. Setup Data
//         const userId = await getUserId();
//         if (userId) {
//             await prepareTestData(userId);
//             await ensureActiveEvent(userId);

//             const { error } = await supabase.from('products').insert({
//                 artist_id: userId,
//                 name: `RegItem-${Date.now()}`,
//                 price: 100,
//                 status: 'enable', // Lowercase
//                 category: 'Test',
//                 currency: 'THB',
//                 image_url: null
//             });
//             if (error) throw new Error(`[R1 Seed Failed] ${error.message}`);
//         }

//         // 2. Admin Login & Nav
//         const adminContext = await browser.newContext();
//         const adminPage = await adminContext.newPage();
        
//         // ✅ ใช้ Robust Login แทน LoginPage class
//         await robustLogin(adminPage);
        
//         // เมื่อ URL นิ่งแล้ว ค่อยสั่งโดดไปหน้า POS
//         await adminPage.goto('/manage-pos-queues'); 
        
//         await expect(adminPage.getByRole('button', { name: 'Walk-in', exact: true })).toBeVisible({ timeout: 30000 });

//         // Ensure Booth Open
//         const boothStatusText = adminPage.getByText(/BOOTH OPEN|BOOTH CLOSED/i).first();
//         if ((await boothStatusText.innerText()).match(/CLOSED/i)) {
//             await adminPage.locator('button.rounded-full').first().click();
//             await expect(adminPage.getByText('BOOTH OPEN')).toBeVisible();
//         }

//         // 3. Customer Journey
//         const customerContext = await browser.newContext();
//         const customerPage = await customerContext.newPage();
//         const customer = new CustomerPage(customerPage);

//         await customerPage.goto(`/${ARTIST_SLUG}/queue`);
//         await customer.getTicket();

//         const ticketText = await customerPage.locator('.text-7xl').innerText();
//         const queueNum = ticketText.replace('#', '').trim();
//         console.log(`[R1] Queue: #${queueNum}`);

//         // 4. Admin Serve
//         await adminPage.bringToFront();
        
//         // Loop Call Next
//         for (let i = 0; i < 15; i++) {
//             const callingSection = adminPage.locator('div').filter({ hasText: /Calling/i }).last();
//             const myCard = callingSection.locator('div').filter({ hasText: `Queue #${queueNum}` });
            
//             if (await myCard.count() > 0 && await myCard.getByRole('button', { name: /Arrived/i }).isVisible()) {
//                 break;
//             }
            
//             const callNextBtn = adminPage.getByRole('button', { name: /Call Next/i }).first();
//             if (await callNextBtn.isEnabled()) {
//                 await callNextBtn.click();
//                 await adminPage.waitForTimeout(2000); 
//             } else {
//                 await adminPage.waitForTimeout(1000);
//             }
//         }

//         await adminPage.getByRole('button', { name: /Arrived/i }).first().click();

//         // 5. POS Payment
//         await adminPage.waitForTimeout(2000);
//         const queueTab = adminPage.getByRole('button', { name: `Queue #${queueNum}` });
        
//         if (!await queueTab.isVisible().catch(()=>false)) {
//              const callingArrived = adminPage.locator('.bg-yellow-50').getByRole('button', { name: /ARRIVED/i }).first();
//              if(await callingArrived.isVisible()) await callingArrived.click();
//         }

//         await expect(queueTab).toBeVisible({ timeout: 20000 });
//         await queueTab.click();
        
//         // Click Product
//         await adminPage.locator('[aria-label="Product grid"] .group').first().click();

//         await adminPage.getByRole('button', { name: /Charge/i }).click();
//         await adminPage.getByRole('button', { name: /Cash/i }).click();

//         await expect(customerPage.getByText(/Completed/i)).toBeVisible({ timeout: 20000 });
        
//         await adminContext.close();
//         await customerContext.close();
//     });

//     test('R2.1 Product Status Toggle (Enable/Disable/Soldout)', async ({ browser }) => {
//          const userId = await getUserId();
//          const TEST_PROD = `R2.1-Prod-${Date.now()}`;
         
//          if (userId) {
//              await prepareTestData(userId);
//              const { error } = await supabase.from('products').insert({
//                  artist_id: userId,
//                  name: TEST_PROD,
//                  price: 150,
//                  status: 'enable', 
//                  category: 'Regression Test',
//                  currency: 'THB',
//                  image_url: null 
//              });
//              if (error) throw new Error(`[R2.1 Seed Failed] ${error.message}`);
//          }

//          const adminContext = await browser.newContext();
//          const page = await adminContext.newPage();
         
//          // ✅ ใช้ Robust Login
//          await robustLogin(page);
         
//          await page.goto('/manage-products');
//          await page.waitForLoadState('domcontentloaded');

//          const searchInput = page.getByPlaceholder('Search products...');
//          await expect(searchInput).toBeVisible({ timeout: 30000 });

//          if(await searchInput.isVisible()) {
//             await searchInput.fill(TEST_PROD);
//             await page.waitForTimeout(1000);
//          }

//          const productCard = page.locator('div').filter({ hasText: TEST_PROD }).last();
//          await expect(productCard).toBeVisible({ timeout: 20000 });

//          // Test Toggle
//          await productCard.hover();
//          await productCard.getByRole('button').filter({ has: page.locator('svg.lucide-edit-2') }).click();
//          await page.getByLabel('Status').selectOption('disable'); 
//          await page.getByRole('button', { name: 'Save Changes' }).click();
//          await expect(productCard).toContainText(/DISABLED/i);

//          await productCard.hover();
//          await productCard.getByRole('button').filter({ has: page.locator('svg.lucide-edit-2') }).click();
//          await page.getByLabel('Status').selectOption('soldout'); 
//          await page.getByRole('button', { name: 'Save Changes' }).click();
//          await expect(productCard).toContainText(/SOLD OUT/i);
         
//          await adminContext.close();
//     });

//     test('R2.6 Booth Open/Close Toggle', async ({ browser }) => {
//         const userId = await getUserId();
//         if (userId) { await ensureActiveEvent(userId); }

//         const adminContext = await browser.newContext();
//         const page = await adminContext.newPage();
        
//         // ✅ ใช้ Robust Login
//         await robustLogin(page);

//         await page.goto('/manage-pos-queues');
//         await expect(page.getByRole('button', { name: 'Walk-in', exact: true })).toBeVisible({ timeout: 30000 });

//         const status = page.getByText(/BOOTH OPEN|BOOTH CLOSED/i).first();
//         await expect(status).toBeVisible({ timeout: 20000 });
        
//         const toggleBtn = page.locator('button.rounded-full').first();
//         const initialText = await status.innerText();
        
//         await toggleBtn.click();
//         if (initialText.includes('OPEN')) {
//             await expect(page.getByText('BOOTH CLOSED')).toBeVisible();
//             await toggleBtn.click(); 
//             await expect(page.getByText('BOOTH OPEN')).toBeVisible();
//         } else {
//             await expect(page.getByText('BOOTH OPEN')).toBeVisible();
//             await toggleBtn.click();
//             await expect(page.getByText('BOOTH CLOSED')).toBeVisible();
//         }
//         await adminContext.close();
//     });

//     test('R2.4 & R2.5 POS: Multiple Products & Price Calculation', async ({ browser }) => {
//          const userId = await getUserId();
//          if (userId) {
//             await prepareTestData(userId);
//             await supabase.from('products').insert({
//                 artist_id: userId,
//                 name: 'POS-Item-1',
//                 price: 100,
//                 status: 'enable',
//                 category: 'POS Test',
//                 currency: 'THB'
//             });
//          }

//          const adminContext = await browser.newContext();
//          const page = await adminContext.newPage();
         
//          // ✅ ใช้ Robust Login
//          await robustLogin(page);

//          await page.goto('/manage-pos-queues');
//          await expect(page.getByRole('button', { name: 'Walk-in', exact: true })).toBeVisible({ timeout: 30000 });

//          const status = page.getByText(/BOOTH/i).first();
//          if ((await status.innerText()).includes('CLOSED')) {
//              await page.locator('button.rounded-full').first().click();
//          }

//          const walkInBtn = page.getByRole('button', { name: 'Walk-in', exact: true });
//          await walkInBtn.click();
         
//          const grid = page.locator('[aria-label="Product grid"]');
//          await expect(grid).toBeVisible({ timeout: 20000 });

//          const firstProduct = grid.locator('.group').first();
//          await expect(firstProduct).toBeVisible();
//          await firstProduct.click();
//          await firstProduct.click();

//          const cart = page.locator('[aria-label="Shopping cart"]');
//          await expect(cart).toContainText(/[0-9]+/);
         
//          const chargeBtn = page.getByRole('button', { name: /Charge/i });
//          await expect(chargeBtn).toBeEnabled();
//          await chargeBtn.click();

//          await expect(page.getByRole('button', { name: /Cash/i })).toBeVisible({ timeout: 10000 });

//          await adminContext.close();
//     });
// });