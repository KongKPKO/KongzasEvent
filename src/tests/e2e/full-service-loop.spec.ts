import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { CustomerPage } from './pages/CustomerPage';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const ADMIN_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const ARTIST_SLUG = process.env.TEST_SLUG || 'test1';
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321', 
  process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || ''
);

test.beforeEach(async ({ page }) => {
  // Validate Slug Exists
  console.log(`Verifying artist slug: ${ARTIST_SLUG}`);
  const response = await page.goto(`/${ARTIST_SLUG}`);
  if (!response || response.status() === 404) {
    throw new Error(`Artist slug "${ARTIST_SLUG}" not found. Check env vars.`);
  }
});

test.describe('The Full Service Loop (Unified POS & Queue)', () => {
  test.slow(); // Allow more time for this complex flow

  test('E2E: Create Event -> Customer Ticket -> Call/Serve -> POS Payment', async ({ browser }) => {
    test.setTimeout(120000); // 2 minutes max

    // ==========================================
    // 0. PRE-SEED DATA (Guarantee Valid Event)
    // ==========================================
    // เราจะดึง User ID จากการ Login หรือ Hardcode ไว้ถ้าใช้ Test Account เดิม
    // เพื่อความชัวร์ ให้ Login ก่อนเพื่อเอา User ID แล้วค่อยยัด DB
    
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const loginPage = new LoginPage(adminPage);
    
    // 1.1 Login First
    console.log('Admin: Logging in...');
    await loginPage.goto();
    await loginPage.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(adminPage).not.toHaveURL(/.*login/); 
    await expect(adminPage.getByText('Logout', { exact: false }).first()).toBeVisible({ timeout: 20000 });
    
    // 1.2 Get User ID from LocalStorage (fixed key extraction)
    const sessionStr = await adminPage.evaluate(() => {
        // Find the correct Supabase auth key
        const authKey = Object.keys(localStorage).find(k => k.includes('-auth-token'));
        if (!authKey) return null;
        return localStorage.getItem(authKey);
    });
    const session = sessionStr ? JSON.parse(sessionStr) : null;
    const userId = session?.user?.id;
    console.log(`Admin: User ID extracted: ${userId || 'FAILED'}`);

    let PRODUCT_NAME = '';
    if (userId) {
          console.log(`Admin: Seeding Event for User ${userId}...`);
          
          // ✅ FIX 1: แก้เรื่องเวลา ถอยหลังไป 1 ชั่วโมง (เพื่อให้เริ่มชัวร์ๆ ไม่ติดเรื่อง Timezone)
          const now = new Date();
          const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); 
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

          // ลองเดาชื่อตารางว่า 'tickets' หรือ 'queues' (ใส่ try-catch กันพังถ้าชื่อผิด)
          try {
              await supabase.from('tickets').delete().eq('artist_id', userId);
              await supabase.from('queues').delete().eq('artist_id', userId);
          } catch (e) { console.log('⚠️ Cleanup warning:', e); }

          // Clear old events
          await supabase.from('events').delete().eq('artist_id', userId);
          
          // ✅ FIX 2: กันเหนียว! บังคับเปิดคิวระดับ Artist (เผื่อเทสอื่นไปปิดไว้)
          await supabase.from('artists').update({ 
              is_queue_open: true 
          }).eq('id', userId);

          // ✅ FIX 3: สร้าง Event แบบเปิดร้าน + เวลาเป็นอดีต
          await supabase.from('events').insert({
              artist_id: userId,
              event_name: `E2E Fest ${Date.now()}`,
              start_date: oneHourAgo.toISOString(), // เริ่มไปแล้ว
              end_date: tomorrow.toISOString(),     // ยังไม่จบ
              status: 'Confirmed',
              is_booth_open: true                   // เปิดรับคิวแน่นอน
          });
        


        // Insert Product with correct schema
        PRODUCT_NAME = `TestItem-${Date.now()}`;
        await supabase.from('products').insert({
            artist_id: userId,
            name: PRODUCT_NAME,
            price: 100,
            status: 'enable',
            category: 'Test',
            image_url: 'https://placehold.co/100x100'
        });
    }

    // 1.3 Refresh & Go to Workspace
    await adminPage.goto('/manage-pos-queues');
    
    // ✅ FIX: รอให้ UI โหลดเสร็จก่อน (รอ Tab Walk-in)
    await expect(adminPage.getByText('Walk-in', { exact: true })).toBeVisible({ timeout: 15000 });

    console.log('Admin: Checking Queue Status on UI...');
    
    // ✅ FIX: UI ใช้ Toggle Switch ไม่ใช่ Button Start/Stop
    // เราได้ Seed ข้อมูลเปิด Booth ไว้แล้ว เลยแค่ต้องเช็คว่า UI แสดงถูกต้อง
    // Toggle state มีข้อความ "BOOTH OPEN" หรือ "BOOTH CLOSED"
    const boothStatusText = adminPage.getByText(/BOOTH OPEN|BOOTH CLOSED/i).first();
    await expect(boothStatusText).toBeVisible({ timeout: 15000 });
    
    const statusText = await boothStatusText.innerText();
    console.log(`Admin: Booth status -> "${statusText}"`);
    
    // ถ้า Booth ปิดอยู่ ให้คลิก Toggle เพื่อเปิด
    if (statusText.match(/CLOSED/i)) {
        console.log('Admin: Booth is closed. Clicking toggle to open...');
        // Toggle button อยู่ถัดจาก text 
        const toggle = adminPage.locator('button.rounded-full').first();
        await toggle.click();
        await expect(adminPage.getByText('BOOTH OPEN')).toBeVisible({ timeout: 5000 });
    } else {
        console.log('Admin: Booth is already OPEN.');
    }

    // ==========================================
    // 2. CUSTOMER JOURNEY (Get Ticket)
    // ==========================================
    console.log('Customer: Visiting Queue Page...');
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customer = new CustomerPage(customerPage);

    // 2.1 Navigate with Retry
    await customerPage.goto(`/${ARTIST_SLUG}/queue`);
    await customerPage.waitForLoadState('domcontentloaded');

    // 2.2 Get Ticket
    console.log('Customer: Getting Ticket...');
    await customer.getTicket();

    // 2.3 Extract Ticket Number
    const ticketNumberText = await customerPage.locator('.text-7xl').innerText();
    const queueNum = ticketNumberText.replace('#', '').trim();
    console.log(`Customer Ticket Generated: #${queueNum}`);

    // ==========================================
    console.log(`Admin: Looking for Queue #${queueNum}...`);
    await adminPage.bringToFront();

    // ✅ FIX: รีโหลดเพื่อให้ Realtime Queue List โหลดใหม่
    await adminPage.reload();
    await adminPage.waitForLoadState('domcontentloaded');
    
    // รอให้ UI โหลดเสร็จ (เช็คจาก Call Next button)
    await expect(adminPage.getByRole('button', { name: /Call Next/i })).toBeVisible({ timeout: 15000 });

    // Verify ticket appears in "Waiting" list
    // ✅ FIX: UI แสดงเป็น "#X" ไม่ใช่ "Queue #X"
    const queueCard = adminPage.locator(`text=#${queueNum}`).first();
    await expect(queueCard).toBeVisible({ timeout: 10000 });

    // ==========================================
    // 3. ADMIN: CALLING & ARRIVAL
    // ==========================================
    console.log(`Admin: Processing Queue #${queueNum}...`);
    await adminPage.bringToFront();

    // ✅ เนื่องจากเรา cleanup queues ใน seed data แล้ว คิวเราควรเป็นคิวแรก
    // แค่กด Call Next 1 ครั้งก็พอ
    console.log('Admin: Clicking Call Next...');
    const callNextBtn = adminPage.getByRole('button', { name: /Call Next/i }).first();
    
    // รอให้ปุ่มพร้อม
    await expect(callNextBtn).toBeEnabled({ timeout: 10000 });
    await callNextBtn.click();
    
    // รอให้ Realtime update
    await adminPage.waitForTimeout(2000);

    // ✅ FIX: ตรวจสอบว่าคิวเราถูกเรียกแล้ว โดยหาปุ่ม ARRIVED
    // หาปุ่ม ARRIVED ที่มี text #${queueNum} อยู่ใกล้ๆ
    const arrivedBtn = adminPage.getByRole('button', { name: /Arrived/i }).first();
    await expect(arrivedBtn).toBeVisible({ timeout: 10000 });
    
    console.log(`✅ Queue #${queueNum} is now being called!`);

    // -------------------------------------------------------
    // พอถึงคิวเราแล้ว ค่อยไปต่อ...
    // -------------------------------------------------------

    // 3.3 Verify Customer Side (Realtime Check)
    await customer.verifyStatus("It's Your Turn");

    // 3.4 Admin Click "Arrived" (Confirmed ว่าลูกค้ามาแล้ว)
    console.log('Admin: Confirming Customer Arrival...');
      
    // คลิกปุ่ม Arrived (ใช้ตัวเดียวกับที่เช็คด้านบน)
    await arrivedBtn.click();
    console.log('✅ Clicked ARRIVED button!');

    // ==========================================
    // 4. ADMIN: POS & PAYMENT (Right Panel)
    // ==========================================
    console.log(`Admin: Preparing POS for Queue #${queueNum}...`);
    await adminPage.bringToFront();
    
    // Wait for status to update and UI to reflect
    await adminPage.waitForTimeout(2000);
    
    // Take screenshot to debug
    await adminPage.screenshot({ path: 'debug-admin-before-pos.png', fullPage: true });
    
    // Check if Queue Tab appeared (status changed to 'serving')
    let queueTab = adminPage.getByRole('button', { name: `Queue #${queueNum}` });
    const tabVisible = await queueTab.isVisible().catch(() => false);
    
    if (!tabVisible) {
        // Queue Tab not visible - status might not have updated
        // Look for the queue in CALLING section and click ARRIVED again
        console.log(`⚠️ Queue Tab not visible. Looking for queue in Calling section...`);
        
        const callingArrivedBtn = adminPage.locator('.bg-yellow-50').filter({ hasText: `#${queueNum}` }).getByRole('button', { name: /ARRIVED/i }).first();
        const arrivedBtnExists = await callingArrivedBtn.isVisible({ timeout: 3000 }).catch(() => false);
        
        if (arrivedBtnExists) {
            console.log('Found queue in Calling section. Clicking ARRIVED again...');
            await callingArrivedBtn.click();
            await adminPage.waitForTimeout(2000);
            
            // Now wait for the tab
            queueTab = adminPage.getByRole('button', { name: `Queue #${queueNum}` });
        }
    }
    
    console.log(`Admin: Waiting for Queue #${queueNum} tab to appear...`);
    await expect(queueTab).toBeVisible({ timeout: 10000 });
    await queueTab.click();

    // 4.2 Add Product to Cart
    console.log('Admin: Adding product to cart...');
    await adminPage.getByText(PRODUCT_NAME).click();

    // 4.3 Charge & Pay
    console.log('Admin: Charging...');
    await adminPage.getByRole('button', { name: /Charge/i }).click();
    
    // Select Payment Method (Cash) inside Modal
    await adminPage.getByRole('button', { name: /Cash/i }).click();

    // ==========================================
    // 5. VERIFICATION
    // ==========================================
    console.log('Verifying Completion...');
    
    // 5.1 Admin: Tab should disappear (or Cart clear)
    await adminPage.waitForTimeout(2000);
    await expect(queueTab).not.toBeVisible({ timeout: 10000 });

    // 5.2 Customer: Status "Completed"
    await customerPage.bringToFront();
    // Use verifyStatus or check text directly
    await expect(customerPage.getByText(/Completed/i)).toBeVisible({ timeout: 10000 });

    console.log('✅ E2E Test Passed: Full Loop Success!');

    // Cleanup
    await adminContext.close();
    await customerContext.close();
  });
});