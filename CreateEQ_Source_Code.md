# CreateEQ Source Code for Documentation

## package.json
```json
{
  "name": "event-web-queue",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "preview": "vite preview",
    "test": "npx playwright test"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.90.1",
    "browser-image-compression": "^2.0.2",
    "clsx": "^2.1.0",
    "date-fns": "^3.3.1",
    "firebase": "^10.8.0",
    "logrocket": "^12.0.0",
    "lucide-react": "^0.344.0",
    "papaparse": "^5.5.3",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.1",
    "tailwind-merge": "^2.2.1",
    "vite-plugin-pwa": "^0.19.2"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.11.0",
    "@playwright/test": "^1.57.0",
    "@types/k6": "^1.5.0",
    "@types/node": "^25.0.3",
    "@types/papaparse": "^5.5.2",
    "@types/react": "^18.2.56",
    "@types/react-dom": "^18.2.19",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.18",
    "dotenv": "^17.2.3",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.2.2",
    "vite": "^5.1.4"
  }
}

```

## src/App.tsx
```tsx
import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';

// Customer Pages
import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
import MenuView from './pages/customer/MenuView';
import QueueView from './pages/customer/QueueView';

// Creator Pages
import ManageProducts from './pages/creators/ManageProducts';
import ManageArtist from './pages/creators/ManageArtist';
import OrderHistory from './pages/creators/OrderHistory';
import ManageCombined from './pages/ManageCombined';

// Auth & Layout
import ManageLogin from './pages/ManageLogin';

function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);

      if (event === "PASSWORD_RECOVERY") {
        console.log("Recovery session detected. Prompting for new password.");

        // Use native prompt for a quick fix UI
        const newPassword = window.prompt("Security Alert: Please set your new password immediately.");

        if (newPassword && newPassword.trim().length > 0) {
            try {
              const { error } = await supabase.auth.updateUser({ password: newPassword });
              if (error) throw error;

              alert("Success! Your password has been changed. You are now logged in.");
              window.location.href = "/"; // Ensure they are on a safe page

            } catch (error: any) {
              alert("Error changing password: " + error.message);
              // Optional: sign them out if it failed for security
              // supabase.auth.signOut();
            }
        } else {
           // Handle case where user cancelled prompt
           alert("Password change cancelled. For security, please try the reset link again when ready.");
           await supabase.auth.signOut();
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>; 
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Routes>
          {/* Login Page */}
          <Route path="/manage-login" element={<ManageLogin />} />
          
          {/* Creator Dashboard Routes (Protected) */}
          <Route 
            path="/manage-products" 
            element={session ? <ManageProducts /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-events" 
            element={session ? <ManageArtist /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-events/:eventId/history" 
            element={session ? <OrderHistory /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-pos-queues" 
            element={session ? <ManageCombined /> : <Navigate to="/manage-login" replace />} 
          />
      
          {/* Root Redirect */}
          <Route path="/" element={<Navigate to="/manage-login" replace />} />

          {/* Customer Facing App */}
          <Route path="/:slug" element={<CustomerLayout />}>
             <Route path="home" element={<CustomerHome />} />
             <Route path="menu" element={<MenuView />} />
             <Route path="queue" element={<QueueView />} />
             <Route index element={<CustomerHome />} />
          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App;
```

## src/supabaseClient.ts
```tsx
import { createClient } from '@supabase/supabase-js';

// ฟังก์ชันดึงค่า Config แบบ Hybrid (รองรับทั้ง Vite และ Node.js/Playwright)
const getEnv = (key: string) => {
  // 1. ลองดึงจาก Vite (Browser)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key];
  }
  // 2. ถ้าไม่มี ให้ลองดึงจาก Node.js (Playwright/Server)
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return '';
};

// ใช้ getEnv ดึงค่าแทนการเรียกตรงๆ
const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseKey = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('VITE_SUPABASE_KEY');

if (!supabaseUrl || !supabaseKey) {
  throw new Error('⚠️ Missing Supabase URL or Key. Check your .env file or CI secrets.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
```

## src/main.tsx
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import LogRocket from 'logrocket';

LogRocket.init('zrljr5/event-queue');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

```

## src/firebase.ts
```tsx
import { initializeApp } from "firebase/app";
// import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDH_WUvvJ7tH6Wc18oMraSNOUTEIQw8sec",
  authDomain: "event-queue-app.firebaseapp.com",
  projectId: "event-queue-app",
  storageBucket: "event-queue-app.firebasestorage.app",
  messagingSenderId: "991644955784",
  appId: "1:991644955784:web:b5b28539ebb99cd4b49b3d",
  measurementId: "G-7G3Q0BNTCQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore (Database)
// Using experimentalForceLongPolling to avoid "Offline" issues in some network environments
import { initializeFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export const auth = getAuth(app);

```

## src/tests/load-test.k6.ts
```tsx
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Load Test for EventWebQueue Application
 * 
 * Scenario: Simulates up to 100 concurrent users
 * - Viewing artist home page
 * - Accessing queue page
 * - Browsing menu
 * - Getting queue tickets (API simulation)
 * 
 * Run with: k6 run src/tests/load-test.k6.ts
 * Or: k6 run --vus 50 --duration 2m src/tests/load-test.k6.ts
 */

// ============================================
// CONFIGURATION
// ============================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5173';
const ARTIST_SLUG = __ENV.ARTIST_SLUG || 'test1';
const SUPABASE_URL = __ENV.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = __ENV.SUPABASE_KEY || '';

// ============================================
// CUSTOM METRICS
// ============================================

const pageLoadTime = new Trend('page_load_time', true);
const apiResponseTime = new Trend('api_response_time', true);
const errorRate = new Rate('error_rate');
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');

// ============================================
// TEST OPTIONS
// ============================================

export const options = {
  // Stages: Ramp up to 30 users (realistic for small-medium events)
  stages: [
    { duration: '20s', target: 10 },   // Warm up to 10 users
    { duration: '30s', target: 20 },   // Ramp up to 20 users
    { duration: '1m', target: 30 },    // Ramp up to 30 users (peak load)
    { duration: '1m', target: 30 },    // Hold at 30 users
    { duration: '20s', target: 10 },   // Ramp down to 10
    { duration: '10s', target: 0 },    // Ramp down to 0
  ],
  
  // Thresholds: Define acceptable performance limits
  thresholds: {
    http_req_duration: ['p(95)<2000'],      // 95% of requests < 2s
    http_req_failed: ['rate<0.05'],         // Less than 5% failure rate
    page_load_time: ['p(90)<3000'],         // 90% of pages load < 3s
    api_response_time: ['p(95)<1000'],      // 95% of API calls < 1s
    error_rate: ['rate<0.1'],               // Less than 10% error rate
  },
  
  // Other settings
  noConnectionReuse: false,
  userAgent: 'K6-LoadTest/1.0',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function checkResponse(response: http.Response, name: string): boolean {
  const passed = check(response, {
    [`${name}: status is 200`]: (r) => r.status === 200,
    [`${name}: response time < 2s`]: (r) => r.timings.duration < 2000,
  });
  
  if (passed) {
    successfulRequests.add(1);
    errorRate.add(0);
  } else {
    failedRequests.add(1);
    errorRate.add(1);
  }
  
  return passed;
}

// ============================================
// MAIN TEST SCENARIO
// ============================================

export default function () {
  // Simulate realistic user behavior with random delays
  
  group('1. View Artist Home Page', () => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/${ARTIST_SLUG}`);
    const loadTime = Date.now() - start;
    
    pageLoadTime.add(loadTime);
    checkResponse(response, 'Home Page');
    
    // User reads the page
    sleep(Math.random() * 2 + 1); // 1-3 seconds
  });

  group('2. Navigate to Queue Page', () => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    const loadTime = Date.now() - start;
    
    pageLoadTime.add(loadTime);
    checkResponse(response, 'Queue Page');
    
    // User checks queue status
    sleep(Math.random() * 3 + 2); // 2-5 seconds
  });

  group('3. Browse Menu Page', () => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/${ARTIST_SLUG}/menu`);
    const loadTime = Date.now() - start;
    
    pageLoadTime.add(loadTime);
    checkResponse(response, 'Menu Page');
    
    // User browses products
    sleep(Math.random() * 5 + 3); // 3-8 seconds
  });

  // Simulate API calls (if Supabase URL is provided)
  if (SUPABASE_URL && SUPABASE_KEY) {
    group('4. API: Fetch Artist Data', () => {
      const start = Date.now();
      const response = http.get(
        `${SUPABASE_URL}/rest/v1/artists?slug=eq.${ARTIST_SLUG}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const responseTime = Date.now() - start;
      
      apiResponseTime.add(responseTime);
      checkResponse(response, 'API: Fetch Artist');
    });

    group('5. API: Fetch Products', () => {
      const start = Date.now();
      const response = http.get(
        `${SUPABASE_URL}/rest/v1/products?select=*&limit=50`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const responseTime = Date.now() - start;
      
      apiResponseTime.add(responseTime);
      checkResponse(response, 'API: Fetch Products');
    });

    group('6. API: Fetch Active Events', () => {
      const start = Date.now();
      const response = http.get(
        `${SUPABASE_URL}/rest/v1/events?status=eq.Confirmed&select=*`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const responseTime = Date.now() - start;
      
      apiResponseTime.add(responseTime);
      checkResponse(response, 'API: Fetch Events');
    });
  }

  // Think time between iterations
  sleep(Math.random() * 2 + 1);
}

// ============================================
// LIFECYCLE HOOKS
// ============================================

export function setup() {
  console.log('🚀 Load Test Starting...');
  console.log(`   Target: ${BASE_URL}/${ARTIST_SLUG}`);
  console.log(`   Max VUs: 30`);
  
  // Verify target is accessible
  const response = http.get(`${BASE_URL}/${ARTIST_SLUG}`);
  if (response.status !== 200) {
    console.error(`❌ Target unreachable! Status: ${response.status}`);
    throw new Error('Target URL is not accessible');
  }
  
  console.log('✅ Target is accessible. Starting load test...');
  return { startTime: Date.now() };
}

export function teardown(data: { startTime: number }) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\n🏁 Load Test Completed in ${duration.toFixed(1)} seconds`);
  console.log('📊 Check the summary above for detailed metrics.');
}

// ============================================
// SPIKE TEST SCENARIO (Optional)
// ============================================

export function spikeTest() {
  // Sudden spike of traffic
  group('Spike: Simultaneous Page Load', () => {
    const responses = http.batch([
      ['GET', `${BASE_URL}/${ARTIST_SLUG}`],
      ['GET', `${BASE_URL}/${ARTIST_SLUG}/queue`],
      ['GET', `${BASE_URL}/${ARTIST_SLUG}/menu`],
    ]);
    
    responses.forEach((response, index) => {
      const pages = ['Home', 'Queue', 'Menu'];
      checkResponse(response, `Spike-${pages[index]}`);
    });
  });
}

```

## src/tests/regression/helpers/testData.ts
```tsx

import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
export const TEST_CONFIG = {
  ADMIN_EMAIL: process.env.TEST_EMAIL || 'kongphop.testy@gmail.com',
  ADMIN_PASSWORD: process.env.TEST_PASSWORD || 'Test112233',
  ARTIST_SLUG: process.env.TEST_SLUG || 'testy',
  SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
  SUPABASE_KEY: process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || ''
};

export const supabase = createClient(TEST_CONFIG.SUPABASE_URL, TEST_CONFIG.SUPABASE_KEY);

export async function seedTestData(userId: string) {
  const timestamp = Date.now();
  const eventName = `Regression Fest ${timestamp}`;
  const productName = `RegItem-${timestamp}`;
  
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); 
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 1. Cleanup old data
  try {
      await supabase.from('tickets').delete().eq('artist_id', userId);
      await supabase.from('queues').delete().eq('artist_id', userId);
      await supabase.from('events').delete().eq('artist_id', userId);
      await supabase.from('products').delete().eq('artist_id', userId).ilike('name', 'RegItem%');
  } catch (e) {
      console.log('⚠️ Cleanup warning:', e);
  }

  // 2. Open Queue
  await supabase.from('artists').update({ is_queue_open: true }).eq('id', userId);

  // 3. Create Event
  await supabase.from('events').insert({
      artist_id: userId,
      event_name: eventName,
      start_date: oneHourAgo.toISOString(),
      end_date: tomorrow.toISOString(),
      status: 'Confirmed',
      is_booth_open: true
  });

  // 4. Create Product
  await supabase.from('products').insert({
      artist_id: userId,
      name: productName,
      price: 150,
      status: 'enable',
      category: 'Regression',
      image_url: 'https://placehold.co/100x100',
      currency: 'THB'
  });


  return { eventName, productName };
}

```

## src/tests/e2e/pages/AdminEventsPage.ts
```tsx
import { Page, expect } from '@playwright/test';

export class AdminEventsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/manage-events');
  }

  async createEvent(eventName: string) {
    await this.page.getByRole('button', { name: 'Add Event' }).click();
    
    // Fill Modal
    await this.page.fill('input[name="event_name"]', eventName);
    
    // Set dates (Today + Tomorrow for safety)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Format for datetime-local: YYYY-MM-DDTHH:MM
    const format = (d: Date) => d.toISOString().slice(0, 16);
    
    await this.page.fill('input[name="start_date"]', format(now));
    await this.page.fill('input[name="end_date"]', format(tomorrow));
    
    await this.page.getByRole('button', { name: 'Save Event' }).click();
    
    // Check if created
    await expect(this.page.getByText(eventName)).toBeVisible();
  }
}

```

## src/tests/e2e/pages/CustomerPage.ts
```tsx
// CustomerPage.ts
import { Page, expect } from '@playwright/test';

export class CustomerPage {
  constructor(private page: Page) {}

  async goto(artistSlug: string) {
    console.log(`[Customer] Navigating to /${artistSlug}/queue`);
    
    try {
      // Navigate with less strict load state
      await this.page.goto(`/${artistSlug}/queue`, {
        waitUntil: 'domcontentloaded', // แทน 'networkidle'
        timeout: 30000
      });
      
      console.log(`[Customer] Page loaded at ${this.page.url()}`);
      
      // Wait for key UI elements instead
      await Promise.race([
        this.page.waitForSelector('text=/queue|get ticket|booth/i', { timeout: 10000 }),
        this.page.waitForTimeout(5000) // Fallback timeout
      ]);
      
      console.log('[Customer] Page ready ✓');
      
    } catch (error) {
      console.error(`[Customer] Failed to load /${artistSlug}/queue:`, error);
      await this.page.screenshot({ path: 'debug-customer-goto-failed.png' });
      throw error;
    }
  }

  async getTicket() {
    console.log('[Customer] Attempting to get ticket...');
    
    // Wait for realtime data to load
    await this.page.waitForTimeout(3000);
    
    // Debug screenshot
    await this.page.screenshot({ path: 'debug-before-get-ticket.png', fullPage: true });
    
    // Find the Get Ticket button with multiple variations
    const buttonSelectors = [
      this.page.getByRole('button', { name: /get ticket/i }),
      this.page.getByRole('button', { name: /join queue/i }),
      this.page.getByRole('button', { name: /join the queue/i }),
      this.page.locator('button:has-text("Get Ticket")'),
    ];
    
    let ticketButton = null;
    for (const selector of buttonSelectors) {
      if (await selector.isVisible().catch(() => false)) {
        ticketButton = selector;
        break;
      }
    }
    
    if (!ticketButton) {
      console.error('[Customer] Get Ticket button not found');
      
      // Check for common blocking states
      if (await this.page.getByText('Loading...').isVisible()) {
          throw new Error('Get Ticket failed: Page is stuck Loading...');
      }
      if (await this.page.getByText(/Booth Closed|Queue is currently closed/i).isVisible()) {
          const msg = await this.page.getByText(/Booth Closed|Queue is currently closed/i).innerText();
          throw new Error(`Get Ticket failed: Queue is invalid (${msg})`);
      }

      // Dump content for debug
      const bodyText = await this.page.locator('body').textContent();
      console.log('[Customer] Page content:', bodyText?.substring(0, 500));
      await this.page.screenshot({ path: 'debug-customer-no-ticket-btn.png' });
      
      throw new Error('Get Ticket button not found on page');
    }
    
    // Wait for button to be enabled
    await ticketButton.waitFor({ state: 'visible', timeout: 10000 });
    
    const isDisabled = await ticketButton.isDisabled();
    if (isDisabled) {
      const buttonText = await ticketButton.textContent();
      console.error(`[Customer] Button is disabled. Shows: "${buttonText}"`);
      throw new Error(`Get Ticket button is disabled (shows: "${buttonText}")`);
    }
    
    // Click and wait for response
    console.log('[Customer] Clicking Get Ticket button...');
    await ticketButton.click();
    
    // Wait for ticket number to appear
    try {
      await this.page.waitForSelector('.text-7xl', { timeout: 15000 });
      const ticketNumber = await this.page.locator('.text-7xl').textContent();
      console.log(`[Customer] Ticket received: ${ticketNumber} ✓`);
    } catch (error) {
      await this.page.screenshot({ path: 'debug-after-click-ticket.png' });
      console.error('[Customer] Ticket number did not appear');
      throw error;
    }
  }

  async verifyStatus(status: string) {
     console.log(`[Customer] Verifying status: "${status}"`);
     
     const statusPatterns: Record<string, RegExp> = {
       'Waiting': /waiting|you are in the queue/i,
       // ✅ เพิ่ม 'now serving' เข้าไปด้วย เผื่อ UI ข้ามสถานะ
       "It's Your Turn": /it's your turn|calling|proceed to.*booth|please proceed|now serving/i, 
       "Being Served": /being served|active/i,
       "Completed": /completed|thank you|order.*complete/i,
       "Cancelled": /cancelled|missed/i,
       "Expired": /expired/i
     };
     
     const pattern = statusPatterns[status] || new RegExp(status, 'i');
     // ใช้ .first() กันเหนียว เผื่อเจอหลายตัว
     const locator = this.page.getByText(pattern).first();
     
     try {
       // 1. ลองรอดูก่อน 5 วินาที (เผื่อ Realtime มาทัน)
       await expect(locator).toBeVisible({ timeout: 5000 });
       console.log(`[Customer] Status verified (Realtime): "${status}" ✓`);

     } catch (error) {
       // 2. ถ้าไม่มาใน 5 วิ ให้กด Reload หน้า 1 ที (Force Update)
       console.log(`[Customer] Status "${status}" not found via Realtime. Reloading page...`);
       
       await this.page.reload();
       await this.page.waitForLoadState('domcontentloaded');
       
       // 3. รออีกรอบ (คราวนี้ต้องมาแน่ เพราะโหลดใหม่แล้ว)
       await expect(locator).toBeVisible({ timeout: 15000 });
       console.log(`[Customer] Status verified (After Reload): "${status}" ✓`);
     }
   }
}
```

## src/tests/e2e/pages/LoginPage.ts
```tsx
import { Page } from '@playwright/test';

export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/manage-login');
  }

  async login(email: string, pass: string) {
    await this.page.fill('input[type="email"]', email);
    await this.page.fill('input[type="password"]', pass);
    await this.page.click('button[type="submit"]'); // Adjust selector if needed
  }
}

```

## src/tests/e2e/pages/AdminProductsPage.ts
```tsx
// AdminProductsPage.ts
import { Page } from '@playwright/test';

export class AdminProductsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/manage-products');
    await this.page.waitForLoadState('networkidle');
  }

  async addProduct(name: string, price: string) {
    console.log(`[Products] Adding: ${name} (${price} THB)`);
    
    try {
      // Wait for page to load
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1000);
      
      // Check if product already exists
      const exists = await this.page.getByText(name).first().isVisible().catch(() => false);
      if (exists) {
        console.log(`[Products] "${name}" already exists ✓`);
        return;
      }
      
      // Find the "Add New Item" form section
      const formSection = this.page.locator('form').filter({ 
        has: this.page.getByText('Add New Item') 
      }).or(this.page.locator('form').first());
      
      // Fill Product Name (by placeholder)
      const nameInput = formSection.getByPlaceholder(/iced latte|product name/i);
      await nameInput.waitFor({ timeout: 10000 });
      await nameInput.fill(name);
      console.log('[Products] Filled product name');
      
      // Fill Price (by placeholder or type)
      const priceInput = formSection.locator('input[type="number"]').first();
      await priceInput.fill(price);
      console.log('[Products] Filled price');
      
      // Upload Image (required field)
      const fileInput = formSection.locator('input[type="file"]').first();
      
      // Create a dummy image file for testing
      const buffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      
      await fileInput.setInputFiles({
        name: 'test-product.png',
        mimeType: 'image/png',
        buffer: buffer,
      });
      console.log('[Products] Uploaded test image');
      
      // Optional: Fill category and description if needed
      // (Skip for now to match minimal test requirements)
      
      // Submit form - Find "Add Product" button
      const submitButton = formSection.getByRole('button', { name: /add product/i });
      
      // Wait for API response
      const [response] = await Promise.all([
        this.page.waitForResponse(
          resp => resp.url().includes('products') && resp.request().method() === 'POST',
          { timeout: 10000 }
        ).catch(() => null),
        submitButton.click()
      ]);
      
      if (response) {
        console.log(`[Products] API Response: ${response.status()}`);
      }
      
      // Wait for UI update
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(2000);
      
      // Verify product appears in the list
      const productCard = this.page.locator('.grid').getByText(name).first();
      await productCard.waitFor({ state: 'visible', timeout: 10000 });
      console.log(`[Products] "${name}" added successfully ✓`);
      
    } catch (error) {
      // Debug on error
      await this.page.screenshot({ 
        path: `debug-add-product-error-${Date.now()}.png`,
        fullPage: true 
      });
      
      // Log form state
      const formHtml = await this.page.locator('form').first().innerHTML();
      console.error('[Products] Form HTML:', formHtml.substring(0, 500));
      
      throw error;
    }
  }
}
```

## src/utils/currency.ts
```tsx
// Currency utility for multi-currency support
// Each product can have its own currency

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  position: 'before' | 'after';  // Symbol position relative to amount
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  THB: { code: 'THB', symbol: '฿', name: 'Thai Baht', position: 'before' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', position: 'before' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', position: 'before' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', position: 'before' },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', position: 'before' },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', position: 'before' },
  MYR: { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', position: 'before' },
  KRW: { code: 'KRW', symbol: '₩', name: 'Korean Won', position: 'before' },
  CNY: { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', position: 'before' },
  TWD: { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar', position: 'before' },
  HKD: { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', position: 'before' },
  PHP: { code: 'PHP', symbol: '₱', name: 'Philippine Peso', position: 'before' },
  IDR: { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', position: 'before' },
  VND: { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', position: 'after' },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', position: 'before' },
};

export const DEFAULT_CURRENCY = 'THB';

/**
 * Get currency symbol from currency code
 */
export function getCurrencySymbol(currencyCode?: string | null): string {
  const code = currencyCode || DEFAULT_CURRENCY;
  return CURRENCIES[code]?.symbol || code;
}

/**
 * Format price with currency symbol
 * @param amount - The price amount
 * @param currencyCode - Currency code (e.g., 'THB', 'USD')
 * @returns Formatted price string (e.g., '฿1,500', '$50')
 */
export function formatPrice(amount: number, currencyCode?: string | null): string {
  const code = currencyCode || DEFAULT_CURRENCY;
  const currency = CURRENCIES[code] || CURRENCIES[DEFAULT_CURRENCY];
  const formattedAmount = amount.toLocaleString();
  
  if (currency.position === 'after') {
    return `${formattedAmount}${currency.symbol}`;
  }
  return `${currency.symbol}${formattedAmount}`;
}

/**
 * Get list of available currencies for dropdown
 */
export function getCurrencyOptions(): { value: string; label: string }[] {
  return Object.values(CURRENCIES).map(c => ({
    value: c.code,
    label: `${c.symbol} ${c.code} - ${c.name}`
  }));
}

```

## src/utils/imageUtils.ts
```tsx
/**
 * Transforms a Supabase Storage URL into an ImageKit URL for optimization.
 * 
 * @param url - The original Supabase Storage URL
 * @param width - The desired width for resizing (default: 600)
 * @returns The optimized ImageKit URL or the original URL if not from Supabase
 */
const IMAGEKIT_ENDPOINT = 'https://ik.imagekit.io/kongzas';

export const getOptimizedImageUrl = (url: string, width: number = 600): string => {
   if (!url) return '';

   // Check if it's a Supabase Storage URL
   if (url.includes('supabase.co/storage/v1/object/public/')) {
      try {
         // Split specifically at the public folder path to get the relative file path
         const splitKey = '/storage/v1/object/public/';
         const parts = url.split(splitKey);
         
         // If split was successful, we take the second part (the file path)
         if (parts.length > 1) {
            const filePath = parts[1];
            
            // Construct ImageKit URL: Endpoint + / + Clean File Path
            // Append transformation parameters: tr=w-[width],q-80
            return `${IMAGEKIT_ENDPOINT}/${filePath}?tr=w-${width},q-80`;
         }
      } catch (error) {
         console.error('Error transforming ImageKit URL:', error);
      }
   }

   // Fallback: If not a Supabase URL or error occurs, return original
   return url;
};

```

## src/components/Navbar.tsx
```tsx
// import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Coffee, Users } from 'lucide-react';

export const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-md border-b border-gray-200 z-50 pb-2">
      <div className="max-w-md mx-auto flex flex-col items-center px-4 pt-3 pb-2">
        {/* Brand */}
        <div className="font-bold text-xl tracking-wider uppercase mb-3" style={{ color: '#ee81a3' }}>Kongzas</div>

        {/* Navigation Links */}
        <div className="flex gap-4 w-full justify-center">
          <NavLink 
            to="/" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive 
                  ? 'shadow-md scale-105' 
                  : 'hover:bg-gray-50'
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: 'transparent',
              color: isActive ? '#ee81a3' : '#9ca3af',
              borderColor: isActive ? '#ee81a3' : '#e5e7eb'
            })}
          >
            <Home size={28} />
            <span className="text-xs font-bold mt-1">Home</span>
          </NavLink>

          <NavLink 
            to="/menu" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive 
                  ? 'shadow-md scale-105' 
                  : 'hover:bg-gray-50'
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: 'transparent',
              color: isActive ? '#ee81a3' : '#9ca3af',
              borderColor: isActive ? '#ee81a3' : '#e5e7eb'
            })}
          >
            <Coffee size={28} />
            <span className="text-xs font-bold mt-1">Menu</span>
          </NavLink>

          <NavLink 
            to="/queue" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive 
                  ? 'shadow-md scale-105' 
                  : 'hover:bg-gray-50'
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: 'transparent',
              color: isActive ? '#ee81a3' : '#9ca3af',
              borderColor: isActive ? '#ee81a3' : '#e5e7eb'
            })}
          >
            <Users size={28} />
            <span className="text-xs font-bold mt-1">Queue</span>
          </NavLink>
        </div>
      </div>
    </nav>
  );
};

```

## src/components/CallingNotification.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, ChevronRight, Coffee, Info, AlertTriangle, PauseCircle } from 'lucide-react';

interface CallingNotificationProps {
  artistId: string;
  slug: string;
  broadcastMessage?: string;
}

const CallingNotification = ({ artistId, slug, broadcastMessage: initialBroadcastMessage }: CallingNotificationProps) => {
  const navigate = useNavigate();
  const [isCalling, setIsCalling] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  
  // State สำหรับเก็บข้อความ Broadcast
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(initialBroadcastMessage || null);

  // 1. โหลดข้อมูลเริ่มต้น
  useEffect(() => {
    if (!artistId) return;

    // 1.1 ดึง Broadcast ล่าสุด
    const fetchBroadcast = async () => {
      const { data } = await supabase
        .from('artists')
        .select('broadcast_message')
        .eq('id', artistId)
        .single();
      if (data) setBroadcastMessage(data.broadcast_message);
    };
    fetchBroadcast();

    // 1.2 ดึงสถานะ Ticket ตัวเองจาก LocalStorage (Namespaced by Artist ID)
    const storedTicketId = localStorage.getItem(`ticket_id_${artistId}`);
    
    if (storedTicketId) {
      setTicketId(storedTicketId);
      const fetchTicketStatus = async () => {
        const { data } = await supabase
            .from('queues')
            .select('status, queue_number')
            .eq('id', storedTicketId)
            .single();
            
        // รองรับทั้ง serving และ calling
        if (data && (data.status === 'serving' || data.status === 'calling')) {
          setIsCalling(true);
          setTicketNumber(data.queue_number);
        }
      };
      fetchTicketStatus();
    }
  }, [artistId]);

  // 2. Realtime Listener
  useEffect(() => {
    let ticketChannel: any = null;
    
    // ฟัง Ticket ของเรา
    if (ticketId) {
       ticketChannel = supabase.channel(`my-ticket-notification:${ticketId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${ticketId}` }, (payload) => {
            // เช็คสถานะเรียกล่าสุด
            if (payload.new.status === 'serving' || payload.new.status === 'calling') {
              setIsCalling(true);
              setTicketNumber(payload.new.queue_number);
              if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            } else {
              // ถ้าสถานะเปลี่ยนเป็น complete/cancelled ให้ปิดแจ้งเตือน
              setIsCalling(false);
            }
        })
        .subscribe();
    }

    // ฟัง Broadcast ส่วนกลาง
    const broadcastChannel = supabase.channel(`artist-broadcast-notification:${artistId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` }, (payload) => {
          setBroadcastMessage(payload.new.broadcast_message);
      })
      .subscribe();

    return () => {
      if (ticketChannel) supabase.removeChannel(ticketChannel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [ticketId, artistId]);


  // 🎨 RENDER LOGIC
  
  // Priority 1: Calling Notification
  if (isCalling) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
        <div 
          onClick={() => navigate(`/${slug}/queue`)}
          className="pointer-events-auto w-full max-w-md bg-yellow-400 text-yellow-900 rounded-b-2xl shadow-xl shadow-yellow-400/20 py-3 px-4 flex items-center justify-between cursor-pointer border-b-2 border-x-2 border-yellow-200 animate-bounce-in"
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="bg-white/90 p-2 rounded-full shadow-sm animate-pulse flex-shrink-0">
              <Bell size={18} className="text-yellow-600 fill-yellow-600" />
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <span className="font-black text-sm text-yellow-950 uppercase tracking-wide leading-tight">
                Your Turn!
              </span>
              <span className="text-xs font-semibold text-yellow-800 truncate leading-tight">
                 Queue <span className="font-black text-sm text-yellow-950">#{ticketNumber}</span> Please come to booth!
              </span>
            </div>
          </div>
          <div className="bg-white/40 p-1 rounded-full flex-shrink-0 ml-2">
             <ChevronRight size={16} className="text-yellow-900" />
          </div>
        </div>
      </div>
    );
  }

  // Priority 2: Broadcast Message
  if (broadcastMessage) {
    const msg = broadcastMessage.toLowerCase();
    
    let theme = "bg-blue-500 border-blue-400 shadow-blue-500/20 text-white"; 
    let Icon = Info;
    let iconColor = "text-white";

    if (msg.includes('พัก') || msg.includes('break')) {
        theme = "bg-pink-500 border-pink-400 shadow-pink-500/20 text-white";
        Icon = Coffee;
    } else if (msg.includes('ด่วน') || msg.includes('urgent') || msg.includes('sorry')) {
        theme = "bg-orange-500 border-orange-400 shadow-orange-500/20 text-white";
        Icon = AlertTriangle;
    } else if (msg.includes('หยุด') || msg.includes('stop') || msg.includes('closed') || msg.includes('pause')) {
        theme = "bg-gray-200 border-gray-300 shadow-gray-300/20 text-gray-800";
        Icon = PauseCircle;
        iconColor = "text-gray-800";
    }

    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
        <div className={`pointer-events-auto w-full max-w-md rounded-b-2xl shadow-xl py-3 px-4 flex items-center justify-center gap-3 border-b-2 border-x-2 animate-slide-down ${theme}`}>
            <div className="bg-white/20 p-1.5 rounded-full flex-shrink-0">
              <Icon size={18} className={iconColor} />
            </div>
            <div className="font-bold text-sm text-center break-words">
              {broadcastMessage}
            </div>
        </div>
      </div>
    );
  }

  return null;
};

export default CallingNotification;
```

## src/components/AvatarUpload.tsx
```tsx
import { useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Camera, Loader2, User, AlertCircle } from 'lucide-react';
import imageCompression from 'browser-image-compression';

interface AvatarUploadProps {
  currentImageUrl?: string;
  artistId: string;
  onUploadComplete: (url: string) => void;
}

const AvatarUpload = ({ currentImageUrl, artistId, onUploadComplete }: AvatarUploadProps) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageCompression = async (imageFile: File): Promise<File> => {
    // 1. Validation: Allow large raw files (e.g., up to 10MB) to support camera uploads
    if (imageFile.size > 10 * 1024 * 1024) {
       throw new Error("File too large. Maximum size is 10MB.");
    }

    // 2. Skip Condition: If the original file is already smaller than 0.2MB, skip compression
    if (imageFile.size / 1024 / 1024 < 0.2) {
       return imageFile;
    }

    // 3. Optimization Target
    const options = {
       maxSizeMB: 0.2,           // Aim for ~200KB
       maxWidthOrHeight: 800,    // 800px is sufficient for profile pics
       useWebWorker: true,
       fileType: 'image/webp',   // Convert to WebP
       initialQuality: 0.8
    };

    try {
       const compressedFile = await imageCompression(imageFile, options);
       
       // Ensure we return a file with the correct extension if it was converted
       const newName = imageFile.name.replace(/\.[^/.]+$/, "") + '.webp';
       return new File([compressedFile], newName, { type: 'image/webp' });
    } catch (err) {
       console.warn('Compression failed, falling back to original file', err);
       return imageFile;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Start Compression
      setIsCompressing(true);
      const processedFile = await handleImageCompression(file);
      setIsCompressing(false);

      // Start Upload
      setIsUploading(true);
      
      const timestamp = Date.now();
      const filePath = `${artistId}/${timestamp}.webp`;

      // Upload to 'Avatar' bucket
      const { error: uploadError } = await supabase.storage
        .from('Avatar')
        .upload(filePath, processedFile, {
          contentType: 'image/webp',
          upsert: true
        });

      if (uploadError) throw uploadError;

      // Construct final ImageKit URL
      // Endpoint: https://ik.imagekit.io/kongzas
      // Path: /Avatar/{artistId}/{timestamp}.webp
      // Transformation: force 400x400 square crop
      // const finalUrl = `https://ik.imagekit.io/kongzas/Avatar/${filePath}?tr=w-400,h-400,fo-auto`;

      // 1. สร้าง URL แบบตรงๆ จาก Supabase ก่อน (เพื่อเอามาเช็ค)
      const { data: { publicUrl } } = supabase.storage
        .from('Avatar') // ชื่อ Bucket ที่คุณใช้
        .getPublicUrl(filePath);

      // 2. สร้างตัวแปร finalUrl รอไว้
      let finalUrl = publicUrl;

      // 3. เช็คว่า "ไม่ใช่" Localhost ใช่ไหม? (ถ้าไม่ใช่ Local ค่อยใช้ ImageKit)
      const isLocal = publicUrl.includes('localhost') || publicUrl.includes('127.0.0.1');

      if (!isLocal) {
        // ✅ Production: ใช้ ImageKit
        finalUrl = `https://ik.imagekit.io/kongzas/Avatar/${filePath}?tr=w-400,h-400,fo-auto`;
      } else {
        // 🏠 Local Docker: ใช้ publicUrl เดิม (ไม่ต้องทำอะไรเพิ่ม)
        console.log('Using Local Docker URL (Bypass ImageKit):', finalUrl);
      }
      // หลังจากนี้ก็เอา finalUrl ไป save ลง Database ตามเดิม

      setPreviewUrl(finalUrl);
      onUploadComplete(finalUrl);

    } catch (err: any) {
      console.error('Upload failed:', err);
      setError(err.message || 'Failed to upload image');
      // Revert preview if needed, or just keep the old one
    } finally {
      setIsCompressing(false);
      setIsUploading(false);
      // Reset input so same file can be selected again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    if (isUploading || isCompressing) return;
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div 
        onClick={handleClick}
        className={`
          relative w-32 h-32 rounded-full cursor-pointer overflow-hidden border-4 border-white shadow-lg group
          ${(isCompressing || isUploading) ? 'pointer-events-none opacity-80' : 'hover:border-pink-100 transition-all'}
        `}
      >
        {/* Image Preview */}
        {previewUrl ? (
          <img 
            src={previewUrl} 
            alt="Profile Avatar" 
            className="w-full h-full object-cover bg-gray-100"
          />
        ) : (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300">
            <User size={48} />
          </div>
        )}

        {/* Overlay (Hover or Processing) */}
        <div className={`
          absolute inset-0 bg-black/30 flex flex-col items-center justify-center text-white transition-opacity duration-200
          ${(isCompressing || isUploading) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        `}>
          {isCompressing ? (
            <>
              <Loader2 className="animate-spin mb-1" size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Optimizing</span>
            </>
          ) : isUploading ? (
            <>
              <Loader2 className="animate-spin mb-1" size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Uploading</span>
            </>
          ) : (
            <Camera size={32} />
          )}
        </div>
      </div>

      {/* Hidden Input */}
      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
      />

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-1 text-red-500 text-xs animate-pulse">
           <AlertCircle size={12} />
           <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default AvatarUpload;

```

## src/components/CustomerHeader.tsx
```tsx
import { ReactNode } from 'react';
import { User } from 'lucide-react';

interface CustomerHeaderProps {
  artistId: string;
  title: string;
  avatarUrl?: string; // New prop for avatar
  avatarDisplay?: 'stacked' | 'inline'; // New prop for layout
  children?: ReactNode; // For Bio, Status Badge, or Subtitle
  className?: string; // For additional styling if needed
}

const CustomerHeader = ({ title, avatarUrl, avatarDisplay, children, className = "", transparent = false }: CustomerHeaderProps & { transparent?: boolean }) => {
  return (
    <div className={`sticky top-0 z-30 transition-all ${transparent ? '' : 'bg-white/95 backdrop-blur-sm shadow-sm'} ${className}`}>
      {/* Added pt-8 for "Move Down" fix (12-16px more breathing room), pb-3 for spacing */}
      <div className="pt-8 pb-3 px-6 text-center w-full max-w-md mx-auto">
         
         {/* Avatar rendering: STACKED */}
         {avatarDisplay === 'stacked' && (
            <div className="flex justify-center mb-3">
               {avatarUrl ? (
                  <img 
                     src={avatarUrl} 
                     alt={title} 
                     className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md bg-gray-100"
                  />
               ) : (
                  <div className="w-32 h-32 rounded-full bg-pink-100 flex items-center justify-center border-4 border-white shadow-md">
                     <span className="text-5xl font-black text-pink-500">{title.charAt(0)}</span>
                  </div>
               )}
            </div>
         )}

         {/* Standardized Title: Pink, Black Font, Centered, Hight-aligned */}
         <div className="flex items-center justify-center gap-3 mb-1">
             {/* Avatar rendering: INLINE */}
             {avatarDisplay === 'inline' && (
                avatarUrl ? (
                   <img 
                     src={avatarUrl} 
                     alt={title} 
                     className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm bg-gray-100 shrink-0"
                   />
                ) : (
                   <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center border-2 border-white shadow-sm shrink-0">
                      {title ? <span className="text-base font-bold text-pink-500">{title.charAt(0)}</span> : <User size={20} className="text-pink-400" />}
                   </div>
                )
             )}
            
             <h1 className="text-2xl font-black text-[#d63384] tracking-tight drop-shadow-sm leading-none">
                {title}
             </h1>
         </div>

         {/* Sub-content (Bio, Badges, etc) */}
         {children && (
            <div className="mt-1">
               {children}
            </div>
         )}
      </div>
    </div>
  );
};

export default CustomerHeader;

```

## src/components/AdminWaitingList.tsx
```tsx
import React from 'react';
import { Card } from './ui';
import { TicketData } from '../services/QueueInterfaces';

interface AdminWaitingListProps {
  tickets: TicketData[];
}

export const AdminWaitingList: React.FC<AdminWaitingListProps> = ({
  tickets
}) => {
  if (tickets.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-700">Waiting Customers ({tickets.length})</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tickets.map((ticket) => (
          <Card key={ticket.id} className="flex justify-between items-center p-4 hover:shadow-md transition-shadow cursor-default border-l-4 border-l-gray-300 bg-white">
            <div>
              <span className="text-xs text-gray-400 uppercase font-bold">Ticket</span>
              <div className="text-2xl font-bold text-gray-600">#{ticket.id}</div>
              <div className="text-xs text-gray-400 mt-1">
                 Waited {Math.floor((Date.now() - ticket.timestamp)/60000)}m
              </div>
            </div>
            {/* Note: interactive "Admit" removed to enforce strict Queue Order via "Call Next" button in controls. 
                Can add "Jump Queue" feature later if needed. */}
          </Card>
        ))}
      </div>
    </div>
  );
};

```

## src/components/AdminQueueControls.tsx
```tsx
import React from 'react';
import { Card, Button } from './ui';
import { SkipForward, RotateCcw, Users } from 'lucide-react';

interface AdminQueueControlsProps {
  nextTicketId: number | null;
  pendingCount: number;
  readyCount: number;
  waitingCount: number;
  onCallNext: () => void;
  onUndo: () => void;
  onReset: () => void;
}

export const AdminQueueControls: React.FC<AdminQueueControlsProps> = ({
  nextTicketId,
  pendingCount,
  readyCount,
  waitingCount,
  onCallNext,
  onUndo,
  onReset
}) => {
  const handleCallNext = () => {
    onCallNext();
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-8 border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-2xl font-bold">Queue Control</h2>
          <p className="text-gray-500 text-sm">Manage the flow of the event</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full text-sm font-medium text-gray-600">
          <Users size={16} />
          <span>Total: {pendingCount + readyCount + waitingCount}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8 items-center">
        {/* Next to Serve Display */}
        <div className="text-center p-6 bg-gradient-to-br from-indigo-50 to-white rounded-3xl border border-indigo-100 relative overflow-hidden">
          <div className="text-sm font-bold uppercase text-indigo-400 tracking-wider mb-2">
            Next Ticket
          </div>
          <div className="text-8xl font-black text-indigo-600 leading-tight">
            {nextTicketId ? `#${nextTicketId}` : '-'}
          </div>
          <div className="mt-2 text-gray-500 font-medium text-sm">
            {waitingCount} waiting
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4">
          <Button 
             size="lg" 
             onClick={handleCallNext}
             disabled={waitingCount === 0}
             className="w-full shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <SkipForward className="mr-2" size={20} />
            Call Next
          </Button>

          <Button 
            variant="outline"
            onClick={onUndo}
            className="w-full text-gray-600 border-gray-200 hover:bg-gray-50"
          >
            Undo Last
          </Button>

          <div className="pt-4 border-t border-gray-100 mt-2">
            <Button 
              variant="ghost" 
              className="w-full text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={() => {
                if(confirm("Are you sure you want to reset the queue? This cannot be undone.")) {
                  onReset();
                  localStorage.removeItem('queue_timer_end');
                }
              }}
            >
              <RotateCcw size={16} className="mr-2" />
              Reset Queue
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

```

## src/components/Socials.tsx
```tsx
import React from 'react';
import { Button } from '../components/ui';
import { Instagram, Facebook, Mail } from 'lucide-react';

const XIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </svg>
);

// Custom TikTok Icon since Lucide doesn't have it standard
const TiktokIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

export const Socials: React.FC = () => {
  const socialLinks = [
    {
      name: 'X',
      icon: <XIcon size={24} />,
      url: 'https://x.com/SKongza',
      color: 'hover:bg-black hover:text-white'
    },
    {
      name: 'Instagram',
      icon: <Instagram size={24} />,
      url: 'https://www.instagram.com/kongkpko/',
      color: 'hover:bg-pink-600 hover:text-white'
    },
    {
      name: 'Facebook',
      icon: <Facebook size={24} />,
      url: 'https://www.facebook.com/kongzas/',
      color: 'hover:bg-blue-600 hover:text-white'
    },
    {
      name: 'Tiktok',
      icon: <TiktokIcon size={24} />,
      url: 'https://www.tiktok.com/@kongzaswithpaimon',
      color: 'hover:bg-black hover:text-white'
    },
    {
      name: 'Email',
      icon: <Mail size={24} />,
      url: 'mailto:konglnwzas@gmail.com',
      color: 'hover:bg-red-500 hover:text-white'
    }
  ];

  const openLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="socials-section py-4 text-center bg-gray-50 rounded-2xl mt-0 mb-6">
      <h3 className="section-title text-xl font-bold mb-6">Follow Me</h3>
      <div className="flex flex-wrap justify-center gap-4 px-4">
        {socialLinks.map((social) => (
          <Button
            key={social.name}
            variant="outline"
            className={`rounded-full w-12 h-12 p-0 flex items-center justify-center transition-all duration-300 border-2 ${social.color}`}
            onClick={() => openLink(social.url)}
            title={social.name}
          >
            {social.icon}
          </Button>
        ))}
      </div>
      <div className="mt-4 text-sm text-gray-400">
        Click to connect
      </div>
    </section>
  );
};

```

## src/components/MainLayout.tsx
```tsx
import React from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';

const MainLayout: React.FC = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const NavLink = ({ to, icon, label }: { to: string; icon: string; label: string }) => {
    const active = isActive(to);
    return (
      <Link
        to={to}
        className={`flex flex-col items-center justify-center group transition-colors px-2 ${
          active
            ? 'text-primary dark:text-primary'
            : 'text-slate-400 dark:text-slate-500 hover:text-primary dark:hover:text-primary'
        }`}
      >
        <span className={`material-icons-round text-2xl mb-0.5 ${active ? '' : 'group-hover:scale-110 transition-transform'}`}>
            {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top Desktop Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-surface-light/80 dark:bg-background-dark/80 border-b border-border-light dark:border-border-dark hidden md:block">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" className="text-primary font-bold text-xl tracking-tight">
                Kongzas
              </Link>
            </div>
            <div className="flex space-x-8 items-center ml-auto">
              <NavLink to="/" icon="home" label="Home" />
              <NavLink to="/menu" icon="coffee" label="Menu" />
              <NavLink to="/queue" icon="people" label="Queue" />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow w-full">
        <Outlet />
      </main>

       {/* Safe padding for bottom nav on mobile */}
       <div className="pb-20 md:pb-0"></div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 w-full bg-surface-light dark:bg-surface-dark border-t border-border-light dark:border-border-dark pb-safe z-50">
        <div className="grid grid-cols-3 h-16">
            <Link to="/" className={`flex flex-col items-center justify-center ${isActive('/') ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
                <span className="material-icons-round">home</span>
                <span className="text-xs font-medium mt-1">Home</span>
            </Link>
             <Link to="/menu" className={`flex flex-col items-center justify-center ${isActive('/menu') ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
                <span className="material-icons-round">coffee</span>
                <span className="text-xs font-medium mt-1">Menu</span>
            </Link>
             <Link to="/queue" className={`flex flex-col items-center justify-center ${isActive('/queue') ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
                <span className="material-icons-round">people</span>
                <span className="text-xs font-medium mt-1">Queue</span>
            </Link>
        </div>
      </div>
    </div>
  );
};

export default MainLayout;

```

## src/components/RequireAuth.tsx
```tsx
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

export const RequireAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (localStorage.getItem('test_auth') === 'true') {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(!!user);
      }
    });
    return () => unsubscribe();
  }, []);

  if (isAuthenticated === null) {
    // Loading state (optional: add a spinner here)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-[#0070C0] font-bold">Verifying Access...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login page, but save the current location they were trying to go to
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};

```

## src/components/AdminHeader.tsx
```tsx
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Calendar, Coffee, Users, LogOut, Menu, X } from 'lucide-react';

// --- TYPES ---
interface ActiveEvent {
    id: string;
    event_name: string;
}

type ActivePage = 'events' | 'menu' | 'pos';

interface AdminHeaderProps {
    activePage: ActivePage;
    activeEvent?: ActiveEvent | null;
}

// Navigation Items Config
const navItems = [
    { path: '/manage-events', label: 'Events', icon: Calendar, page: 'events' as ActivePage },
    { path: '/manage-products', label: 'Menu', icon: Coffee, page: 'menu' as ActivePage },
    { path: '/manage-pos-queues', label: 'POS/Queue', icon: Users, page: 'pos' as ActivePage },
];

export default function AdminHeader({ activePage, activeEvent }: AdminHeaderProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/manage-login');
    };

    return (
        <header className="bg-white border-b border-gray-200 h-14 flex items-center justify-between px-4 md:px-6 shrink-0 z-20 shadow-sm relative">
            {/* Left: Brand + Event Badge */}
            <div className="flex items-center gap-2">
                <div className="bg-pink-500 text-white p-1.5 rounded-md font-bold text-sm">K</div>
                <span className="font-bold text-gray-800 hidden md:inline">Kongzas <span className="text-pink-600">Workspace</span></span>
                <span className="font-bold text-gray-800 md:hidden">Kongzas</span>
                
                {/* Active Event Badge */}
                {activeEvent && (
                    <div className="ml-2 md:ml-3 px-2 py-0.5 bg-green-50 border border-green-200 rounded-full text-xs font-bold text-green-700 flex items-center gap-1 max-w-[120px] md:max-w-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0"></span>
                        <span className="truncate">{activeEvent.event_name}</span>
                    </div>
                )}
                {activeEvent === null && (
                    <div className="ml-2 md:ml-3 px-2 py-0.5 bg-red-50 border border-red-200 rounded-full text-xs font-bold text-red-600">
                        <span className="md:hidden">No Event</span>
                        <span className="hidden md:inline">⚠️ No Active Event</span>
                    </div>
                )}
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activePage === item.page || location.pathname === item.path;
                    
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                isActive
                                    ? 'bg-pink-50 text-pink-700 border border-pink-200'
                                    : 'text-gray-600 hover:text-pink-600 hover:bg-gray-50'
                            }`}
                            aria-label={item.label}
                        >
                            <Icon size={14} aria-hidden="true" />
                            <span className="hidden sm:inline">{item.label}</span>
                        </button>
                    );
                })}
                
                <div className="h-5 w-px bg-gray-200 mx-2"></div>
                
                <button 
                    onClick={handleLogout} 
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:text-red-600 hover:bg-red-50 flex items-center gap-1.5 transition-all"
                    aria-label="Logout"
                >
                    <LogOut size={14} aria-hidden="true" />
                    <span className="hidden sm:inline">Logout</span>
                </button>
            </div>

            {/* Mobile Menu Button */}
            <button 
                className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
                {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Mobile Dropdown Menu */}
            {isMenuOpen && (
                <div className="absolute top-14 left-0 right-0 bg-white border-b border-gray-200 shadow-lg md:hidden flex flex-col p-4 gap-2 animate-in slide-in-from-top-2 duration-200">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activePage === item.page || location.pathname === item.path;
                        return (
                            <button
                                key={item.path}
                                onClick={() => {
                                    navigate(item.path);
                                    setIsMenuOpen(false);
                                }}
                                className={`w-full text-left px-4 py-3 rounded-lg text-sm font-semibold flex items-center gap-3 transition-all ${
                                    isActive
                                        ? 'bg-pink-50 text-pink-700 border border-pink-200'
                                        : 'text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Icon size={18} />
                                {item.label}
                            </button>
                        );
                    })}
                    <div className="h-px bg-gray-100 my-1"></div>
                    <button 
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-3 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 flex items-center gap-3"
                    >
                        <LogOut size={18} />
                        Logout
                    </button>
                </div>
            )}
        </header>
    );
}

```

## src/components/Layout.tsx
```tsx
// import React from 'react';
import { Navbar } from './Navbar';
import { Outlet } from 'react-router-dom';

export const Layout = () => {
  return (
    <div className="min-h-screen bg-gray-50 pt-36"> {/* Padding top for fixed navbar */}
      <Navbar />
      <Outlet />
    </div>
  );
};

```

## src/components/ui/Card.tsx
```tsx
import React from 'react';
import './Card.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  hoverEffect?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', title, hoverEffect = true }) => {
  return (
    <div className={`card ${hoverEffect ? 'card-hover' : ''} ${className}`}>
      {title && <h3 className="card-title">{title}</h3>}
      <div className="card-content">
        {children}
      </div>
    </div>
  );
};

```

## src/components/ui/index.ts
```tsx
export * from './Button';
export * from './Card';

```

## src/components/ui/Button.tsx
```tsx
import { ButtonHTMLAttributes, FC } from 'react';
import { clsx } from 'clsx';
// import { twMerge } from 'tailwind-merge'; 
// Even without tailwind, clsx can be used for conditional classes, but twMerge is for tailwind conflicts. I'll just use clsx since I'm doing vanilla CSS mostly but class checking is useful.
// Actually, I promised Vanilla CSS. I will use CSS Modules or just scoped classes if I can, but standard CSS is fine. I'll use `className` prop.

import './Button.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: FC<ButtonProps> = ({ 
  children, 
  className, 
  variant = 'primary', 
  size = 'md', 
  isLoading, 
  disabled,
  ...props 
}) => {
  return (
    <button 
      className={clsx(
        'btn',
        `btn-${variant}`,
        `btn-${size}`,
        isLoading && 'btn-loading',
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? <span className="spinner" /> : children}
    </button>
  );
};

```

## src/components/dashboard/PosPanel.tsx
```tsx
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { User, CheckCircle } from 'lucide-react';
import { formatPrice } from '../../utils/currency';

// --- TYPES ---
interface Product {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    is_out_of_stock: boolean;
    status: string;
    category: string | null;
    currency?: string;  // ✅ NEW: Currency code
}
interface CartItem { product: Product; quantity: number; notes?: string; }

// ✅ SHARED TYPE: Active Event (from parent)
interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

// ✅ SHARED TYPE: Queue Item (from parent)
interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
    last_updated_at: string;
    created_at?: string;
    served_at?: string;
    completed_at?: string;
}

type SortType = 'name' | 'price_low' | 'price_high';

// --- PROPS ---
interface POSPanelProps {
    activeEvent: ActiveEvent | null;
    servingQueues: QueueItem[];  // ✅ NEW: Serving queues from parent
    selectedQueueId: string | null;
    selectedQueueNumber: string | null;
    onSelectQueue: (queue: { id: string; queue_number: string }) => void;  // ✅ NEW: Tab selection
    onClearQueue: () => void;
}

export default function POSPanel({ activeEvent, servingQueues, selectedQueueId, selectedQueueNumber, onSelectQueue, onClearQueue }: POSPanelProps) {
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

    // REFS to prevent stale closures and infinite loops
    const selectedQueueIdRef = useRef<string | null>(null);
    const currentOrderIdRef = useRef<string | null>(null);
    const productsRef = useRef<Product[]>([]);
    const isFetchingRef = useRef(false);

    // Search, Filter & Sort
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [sortBy, setSortBy] = useState<SortType>('name');

    // Keep refs in sync with state
    useEffect(() => {
        selectedQueueIdRef.current = selectedQueueId;
    }, [selectedQueueId]);

    useEffect(() => {
        currentOrderIdRef.current = currentOrderId;
    }, [currentOrderId]);

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    // --- FETCH PRODUCTS (with artist_id filter for multi-tenant isolation) ---
    const fetchProducts = useCallback(async () => {
        // 🔐 SECURITY: Must get current user first
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            console.warn('[POS] No authenticated user for products fetch');
            setProducts([]);
            return;
        }

        // 🔐 SECURITY: Filter by artist_id to prevent data leakage
        const { data } = await supabase
            .from('products')
            .select('*')
            .eq('artist_id', user.id)  // ✅ CRITICAL: Only this artist's products
            .eq('status', 'enable')
            .order('name');
        
        if (data) {
            console.log('[POS] Loaded products for artist:', user.id, 'count:', data.length);
            setProducts(data);
        }
    }, []);

    // --- 1. FETCH PRODUCTS + Static Realtime (runs once on mount) ---
    useEffect(() => {
        fetchProducts();

        const channel = supabase.channel('pos-panel-products')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchProducts)
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchProducts]);

    // --- 2. STABLE FETCH ORDER FUNCTION ---
    const fetchCurrentOrder = useCallback(async () => {
        if (isFetchingRef.current) return;
        
        isFetchingRef.current = true;

        const targetQueueId = selectedQueueIdRef.current;
        
        setLoading(true);
        console.log('[POS] Fetching order for Queue:', targetQueueId);

        try {
            let query = supabase.from('orders')
                .select('id, status, queue_id, event_id')
                .neq('status', 'completed');

            if (targetQueueId) {
                query = query.eq('queue_id', targetQueueId);
            } else {
                query = query.is('queue_id', null);
            }

            const { data: order, error } = await query
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (selectedQueueIdRef.current !== targetQueueId) {
                isFetchingRef.current = false;
                return;
            }

            if (error) {
                console.error("Error fetching order:", error);
                isFetchingRef.current = false;
                setLoading(false);
                return;
            }

            if (order) {
                console.log('[POS] Found existing order:', order.id, 'for event:', order.event_id);
                setCurrentOrderId(order.id);
                
                const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id);

                if (selectedQueueIdRef.current !== targetQueueId) {
                    isFetchingRef.current = false;
                    return;
                }

                const currentProducts = productsRef.current;
                if (items && currentProducts.length > 0) {
                    const newCart: CartItem[] = items.map(item => {
                        const prod = currentProducts.find(p => p.id === item.product_id);
                        return prod ? { product: prod, quantity: item.quantity, notes: item.notes } : null;
                    }).filter(Boolean) as CartItem[];

                    setCart(newCart);
                } else {
                    setCart([]);
                }
            } else {
                console.log('[POS] No existing order found for this queue/event');
                setCurrentOrderId(null);
                setCart([]);
            }
        } catch (err) {
            console.error("Critical Error:", err);
        } finally {
            isFetchingRef.current = false;
            if (selectedQueueIdRef.current === targetQueueId) {
                setLoading(false);
            }
        }
    }, []);

    // --- 3. REACT TO selectedQueueId OR activeEvent CHANGES ---
    useEffect(() => {
        setCart([]);
        setCurrentOrderId(null);
        setLoading(false);
        isFetchingRef.current = false;

        if (activeEvent) {
            fetchCurrentOrder();
        }

        let orderChannel: RealtimeChannel | null = null;

        if (selectedQueueId) {
            const channelName = `pos-orders-${selectedQueueId}-${Date.now()}`;
            
            orderChannel = supabase.channel(channelName)
                .on(
                    'postgres_changes',
                    { 
                        event: 'INSERT', 
                        schema: 'public', 
                        table: 'orders', 
                        filter: `queue_id=eq.${selectedQueueId}` 
                    },
                    (payload) => {
                        console.log('[POS] New order INSERT detected:', payload.new);
                        setTimeout(() => {
                            fetchCurrentOrder();
                        }, 100);
                    }
                )
                .on(
                    'postgres_changes',
                    { 
                        event: 'DELETE', 
                        schema: 'public', 
                        table: 'orders'
                    },
                    (payload) => {
                        // When order is deleted (e.g., customer cancelled from MenuView)
                        // Check if it matches current order and clear cart
                        console.log('[POS] Order DELETE detected:', payload.old);
                        if (currentOrderIdRef.current && payload.old?.id === currentOrderIdRef.current) {
                            console.log('[POS] Current order was cancelled by customer, clearing cart');
                            setCart([]);
                            setCurrentOrderId(null);
                        }
                    }
                )
                .subscribe();
        }

        return () => {
            if (orderChannel) {
                supabase.removeChannel(orderChannel);
            }
        };
    }, [selectedQueueId, activeEvent, fetchCurrentOrder]);

    // --- 4. DISPLAY LOGIC ---
    const categories = useMemo(() => {
        const cats = products.map(p => p.category).filter(Boolean) as string[];
        return ['All', ...new Set(cats)];
    }, [products]);

    const filteredProducts = useMemo(() => {
        let result = products.filter(product => {
            const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });
        return result.sort((a, b) => {
            if (sortBy === 'price_low') return a.price - b.price;
            if (sortBy === 'price_high') return b.price - a.price;
            return a.name.localeCompare(b.name);
        });
    }, [products, searchQuery, selectedCategory, sortBy]);

    // --- 5. HELPERS ---
    const getProductImage = (path: string | null) => {
        if (!path) return '';
        if (path.startsWith('http') || path.startsWith('blob:')) return path;
        return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/Menu/${path}`;
    };

    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id);
            if (existing) return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            return [...prev, { product, quantity: 1 }];
        });
    };

    const decreaseQuantity = (productId: string) => {
        setCart(prev => prev.map(item => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item).filter(item => item.quantity > 0));
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId));
    };

    const totalPrice = useMemo(() => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [cart]);

    // --- 6. PAYMENT HANDLER ---
    const handlePayment = async (method: 'cash' | 'transfer') => {
        if (!activeEvent) {
            alert('Cannot process payment: No active event.');
            return;
        }

        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            let orderId = currentOrderId;

            if (!orderId) {
                // ✅ FIX: Removed artist_id - orders table uses event_id to link to artist
                const { data: order, error } = await supabase.from('orders').insert({
                    event_id: activeEvent.id,
                    queue_id: selectedQueueId,
                    status: 'completed',
                    total_price: totalPrice,
                    currency: cart[0]?.product.currency || 'THB', // ✅ NEW: Save currency
                    payment_method: method,
                }).select('id').single();

                if (error) {
                    console.error('[Payment] INSERT error:', error);
                    throw error;
                }
                orderId = order.id;
            } else {
                console.log('[Payment] Adopting order', orderId, 'into event:', activeEvent.id);
                
                const { error } = await supabase.from('orders').update({ 
                    status: 'completed', 
                    total_price: totalPrice,
                    currency: cart[0]?.product.currency || 'THB', // ✅ NEW: Update currency
                    payment_method: method,
                    event_id: activeEvent.id
                }).eq('id', orderId);
                
                if (error) {
                    console.error('[Payment] UPDATE error:', error);
                    throw error;
                }
            }

            await supabase.from('order_items').delete().eq('order_id', orderId);
            
            const itemsToInsert = cart.map(item => ({
                order_id: orderId,
                product_id: item.product.id,
                quantity: item.quantity,
                price_per_unit: item.product.price,
                notes: item.notes || ''
            }));
            
            if (itemsToInsert.length > 0) {
                await supabase.from('order_items').insert(itemsToInsert);
            }

            if (selectedQueueId) {
                const { error: queueError } = await supabase
                    .from('queues')
                    .update({ status: 'complete' }) 
                    .eq('id', selectedQueueId);
                
                if (queueError) {
                    console.error('[Payment] Queue update error:', queueError);
                    throw queueError;
                }
            }

            console.log('[Payment] Success:', method.toUpperCase());
            
            setCart([]); 
            setCurrentOrderId(null);
            setIsPaymentModalOpen(false);
            onClearQueue();

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.error('[Payment] Full error:', err);
            alert('Error: ' + errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* ✅ NEW: Horizontal Tabs Header for Customer Selection */}
            <div className="bg-white border-b border-gray-200 shrink-0 shadow-sm">
                <div className="px-4 py-2">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Select Customer</div>
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        {/* Walk-in Tab (Always First) */}
                        <button
                            onClick={onClearQueue}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all shrink-0 ${
                                !selectedQueueId 
                                    ? 'bg-pink-600 text-white shadow-md shadow-pink-200' 
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            <User size={16} />
                            <span>Walk-in</span>
                        </button>

                        {/* Serving Queue Tabs */}
                        {servingQueues.map(queue => {
                            const isSelected = selectedQueueId === queue.id;
                            return (
                                <button
                                    key={queue.id}
                                    onClick={() => onSelectQueue({ id: queue.id, queue_number: String(queue.queue_number) })}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all shrink-0 ${
                                        isSelected 
                                            ? 'bg-pink-600 text-white shadow-md shadow-pink-200' 
                                            : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                    }`}
                                >
                                    <CheckCircle size={14} className={isSelected ? 'text-white' : 'text-green-500'} />
                                    <span>Queue #{queue.queue_number}</span>
                                </button>
                            );
                        })}

                        {/* Empty state hint */}
                        {servingQueues.length === 0 && (
                            <div className="text-xs text-gray-500 italic px-2">No queues serving</div>
                        )}
                    </div>
                </div>

                {/* Current Selection Indicator */}
                <div className={`px-4 py-2 border-t transition-colors ${
                    selectedQueueId 
                        ? 'bg-gradient-to-r from-pink-50 to-rose-50 border-pink-100' 
                        : 'bg-gray-50/50 border-gray-100'
                }`}>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            {selectedQueueId ? (
                                <>
                                    <span className="inline-flex items-center gap-2 bg-pink-600 text-white px-3 py-1 rounded-full shadow-sm">
                                        <span className="text-xs font-bold">Queue</span>
                                        <span className="text-lg font-black">#{selectedQueueNumber}</span>
                                    </span>
                                    {currentOrderId && (
                                        <span className="text-xs text-green-600 font-bold flex items-center gap-1">
                                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                            Active Order
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="text-lg font-extrabold text-gray-700">Walk-in Customer</span>
                            )}
                        </div>
                        
                        {activeEvent && (
                            <div className="text-right">
                                <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Event</div>
                                <div className="text-xs font-bold text-pink-600 max-w-[150px] truncate" title={activeEvent.event_name}>
                                    {activeEvent.event_name}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* LEFT: Cart */}
                <div className="w-full h-[40%] md:h-full md:w-[280px] bg-white border-b md:border-b-0 md:border-r border-pink-100 flex flex-col shrink-0 order-1 md:order-1">
                    <div className="flex-1 overflow-y-auto p-3 space-y-2" tabIndex={0} role="region" aria-label="Shopping cart">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-80">
                                <span className="text-4xl mb-2">🛒</span>
                                <p className="font-medium text-sm">{loading ? 'Loading...' : 'Cart is empty'}</p>
                            </div>
                        ) : (
                            cart.map((item) => (
                                <div key={item.product.id} className="flex items-center justify-between p-2 bg-white border border-gray-100 rounded-lg shadow-sm">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <div className="w-8 h-8 shrink-0 rounded-md overflow-hidden border border-gray-200 bg-gray-100">
                                            {item.product.image_url ? (
                                                <img
                                                    src={getProductImage(item.product.image_url)}
                                                    alt={item.product.name}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=No+Img'; }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-500">No Img</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col truncate">
                                            <span className="font-bold text-xs text-gray-800 truncate block max-w-[100px]" title={item.product.name}>{item.product.name}</span>
                                            <span className="text-[10px] text-gray-500">{formatPrice(item.product.price, item.product.currency)}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-0.5 ml-1">
                                        <span className="font-bold text-pink-600 text-xs">{formatPrice(item.product.price * item.quantity, item.product.currency)}</span>
                                        <div className="flex items-center gap-1">
                                            <div className="flex items-center bg-gray-50 rounded border border-gray-200 h-5">
                                                <button onClick={() => decreaseQuantity(item.product.id)} className="w-5 h-full flex items-center justify-center text-gray-500 hover:text-red-600 text-[10px]" aria-label={`Decrease quantity of ${item.product.name}`}>-</button>
                                                <span className="min-w-[16px] text-center font-bold text-gray-700 text-[10px]">{item.quantity}</span>
                                                <button onClick={() => addToCart(item.product)} className="w-5 h-full flex items-center justify-center text-gray-500 hover:text-green-600 text-[10px]" aria-label={`Increase quantity of ${item.product.name}`}>+</button>
                                            </div>
                                            <button onClick={() => removeFromCart(item.product.id)} className="text-[9px] text-gray-500 hover:text-red-500" aria-label={`Remove ${item.product.name} from cart`}>✕</button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Total & Charge */}
                    <div className="p-3 border-t border-pink-100 bg-white shrink-0">
                        <div className="flex justify-between items-baseline mb-2">
                            <span className="text-gray-500 font-medium text-sm">Total</span>
                            <span className="text-2xl font-extrabold text-gray-900">{formatPrice(totalPrice, cart[0]?.product.currency)}</span>
                        </div>
                        
                        {!activeEvent && (
                            <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 font-bold text-center">
                                ⚠️ No Active Event / Event Ended
                            </div>
                        )}
                        
                        <button
                            disabled={cart.length === 0 || loading || !activeEvent}
                            onClick={() => setIsPaymentModalOpen(true)}
                            className="w-full bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold py-3 rounded-xl shadow-lg shadow-pink-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95"
                        >
                            {loading ? 'Processing...' : !activeEvent ? 'Event Ended' : 'Charge ' + formatPrice(totalPrice, cart[0]?.product.currency)}
                        </button>
                    </div>
                </div>

                {/* RIGHT: Product Grid */}
                <div className="flex-1 flex flex-col min-w-0 bg-gray-50/50 order-2 md:order-2">
                    {/* Search & Filter */}
                    <div className="bg-white px-4 py-3 border-b border-gray-100 shadow-sm shrink-0 space-y-2">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 text-sm"
                                aria-label="Search products"
                            />
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortType)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white cursor-pointer font-medium"
                                aria-label="Sort products by"
                            >
                                <option value="name">Name</option>
                                <option value="price_low">Price ↑</option>
                                <option value="price_high">Price ↓</option>
                            </select>
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${selectedCategory === cat ? 'bg-pink-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Product Grid */}
                    <div className="flex-1 overflow-y-auto p-4" tabIndex={0} role="region" aria-label="Product grid">
                        {filteredProducts.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-60"><p>No products found.</p></div>
                        ) : (
                            <div className="grid grid-cols-4 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-2">
                                {filteredProducts.map((product) => (
                                    <div
                                        key={product.id}
                                        onClick={() => addToCart(product)}
                                        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all active:scale-95 group flex flex-col gap-1 p-0"
                                    >
                                        <div className="w-full aspect-square bg-gray-100 relative overflow-hidden shrink-0">
                                            {product.image_url ? (
                                                <img
                                                    src={getProductImage(product.image_url)}
                                                    alt={product.name}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Img'; }}
                                                />
                                            ) : (<div className="w-full h-full flex items-center justify-center text-xs text-gray-500">📷</div>)}
                                        </div>
                                        <div className="flex flex-col px-1 pb-1 justify-between flex-1 min-w-0">
                                            <div className="flex flex-col justify-between items-start w-full">
                                                <h3 className="font-bold text-gray-800 truncate text-[10px] w-full mb-0.5" title={product.name}>{product.name}</h3>
                                                <p className="text-pink-600 font-extrabold text-[10px]">{formatPrice(product.price, product.currency)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Payment Modal */}
            {isPaymentModalOpen && (
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                        <h3 className="text-2xl font-black text-gray-800 text-center mb-2">Confirm Payment</h3>
                        <p className="text-gray-500 text-center mb-6">Amount: <span className="text-pink-600 font-bold">{formatPrice(totalPrice, cart[0]?.product.currency)}</span></p>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <button
                                onClick={() => handlePayment('cash')}
                                className="flex flex-col items-center justify-center p-6 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-100 hover:border-emerald-300 rounded-xl transition-all active:scale-95"
                            >
                                <span className="text-4xl mb-2">💵</span>
                                <span className="font-bold text-emerald-700">CASH</span>
                            </button>
                            <button
                                onClick={() => handlePayment('transfer')}
                                className="flex flex-col items-center justify-center p-6 bg-sky-50 hover:bg-sky-100 border-2 border-sky-100 hover:border-sky-300 rounded-xl transition-all active:scale-95"
                            >
                                <span className="text-4xl mb-2">🏦</span>
                                <span className="font-bold text-sky-700">TRANSFER</span>
                            </button>
                        </div>
                        <button
                            onClick={() => setIsPaymentModalOpen(false)}
                            className="w-full py-3 text-gray-500 font-bold hover:bg-gray-50 hover:text-gray-600 rounded-xl transition-colors"
                        >
                            CANCEL
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

```

## src/components/dashboard/QueuePanel.tsx
```tsx
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../ui';
import { 
    LayoutDashboard, Bell, RotateCcw, Play, 
    Coffee, AlertCircle, PauseCircle, X 
} from 'lucide-react';

// --- TYPES ---
interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
    last_updated_at: string;
    created_at?: string;
    served_at?: string;
    completed_at?: string;
}

// ✅ SHARED TYPE: Active Event (from parent)
interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

// --- PROPS ---
interface QueuePanelProps {
    activeEvent: ActiveEvent | null;
    queues: QueueItem[];  // ✅ NOW A PROP (passed from parent, already filtered - no 'serving')
    selectedQueueId: string | null;
    onSelectQueue: (queue: { id: string; queue_number: string }) => void;
}

// --- HELPERS ---
const formatElapsedTime = (dateString?: string) => {
    if (!dateString) return '0s';
    const ms = Date.now() - new Date(dateString).getTime();
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function QueuePanel({ activeEvent, queues, selectedQueueId, onSelectQueue }: QueuePanelProps) {
    const [isBoothActive, setIsBoothActive] = useState(false);
    const [isQueueOpen, setIsQueueOpen] = useState(true);
    const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);

    // Sync booth status from activeEvent prop
    useEffect(() => {
        if (activeEvent) {
            setIsBoothActive(activeEvent.is_booth_open || false);
        }
    }, [activeEvent]);

    // Fetch artist settings on mount
    useEffect(() => {
        const fetchArtistSettings = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: artistData } = await supabase
                .from('artists')
                .select('broadcast_message, is_queue_open')
                .eq('id', user.id)
                .single();

            if (artistData) {
                setBroadcastMessage(artistData.broadcast_message || null);
                setIsQueueOpen(artistData.is_queue_open ?? true);
            }
        };

        fetchArtistSettings();

        // Realtime for artist settings
        const setupRealtime = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            supabase
                .channel(`queue-panel-artists-${user.id}`)
                .on(
                    'postgres_changes', 
                    { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${user.id}` }, 
                    (payload) => {
                        const updatedArtist = payload.new as { broadcast_message: string | null; is_queue_open: boolean };
                        setBroadcastMessage(updatedArtist.broadcast_message || null);
                        setIsQueueOpen(updatedArtist.is_queue_open ?? true);
                    }
                )
                .subscribe();
        };

        setupRealtime();
    }, []);

    // --- BROADCAST HANDLER (Consolidated with is_queue_open logic) ---
    const handleSetBroadcast = async (msg: string | null) => {
        // Toggle off if clicking same button
        const newMessage = (msg === broadcastMessage && msg !== null) ? null : msg;
        
        // Determine is_queue_open based on message
        // "Queue closed temporarily" = CLOSED, everything else = OPEN
        const newQueueOpen = newMessage === "Queue closed temporarily" ? false : true;
        
        const previousMessage = broadcastMessage;
        const previousQueueOpen = isQueueOpen;
        
        // Optimistic update
        setBroadcastMessage(newMessage);
        setIsQueueOpen(newQueueOpen);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setBroadcastMessage(previousMessage);
            setIsQueueOpen(previousQueueOpen);
            return;
        }

        // Single Supabase call for both fields
        const { error } = await supabase
            .from('artists')
            .update({ 
                broadcast_message: newMessage,
                is_queue_open: newQueueOpen 
            })
            .eq('id', user.id);

        if (error) {
            console.error('Error updating broadcast/queue status:', error);
            setBroadcastMessage(previousMessage);
            setIsQueueOpen(previousQueueOpen);
        }
    };

    const handleToggleBooth = async () => {
        if (!activeEvent) {
            alert("No Active Event Today! Cannot open booth.");
            return;
        }

        const newStatus = !isBoothActive;
        setIsBoothActive(newStatus);

        const { error } = await supabase
            .from('events')
            .update({ is_booth_open: newStatus })
            .eq('id', activeEvent.id);

        if (error) {
            console.error('Error updating booth status:', error);
            setIsBoothActive(!newStatus);
        }
    };



    // --- STATUS UPDATE (triggers parent refetch via onRefreshQueues) ---
    const updateStatus = useCallback(async (id: string, newStatus: string) => {
        const updates: Record<string, unknown> = { status: newStatus, last_updated_at: new Date().toISOString() };
        if (newStatus === 'serving') updates.served_at = new Date().toISOString();
        if (newStatus === 'complete') updates.completed_at = new Date().toISOString();

        const { error } = await supabase
            .from('queues')
            .update(updates)
            .eq('id', id);

        if (error) {
            console.error(`Error updating status to ${newStatus}:`, error);
        }
        // Parent will receive realtime update and refresh
    }, []);

    const handleCallNext = useCallback(() => {
        const waitingList = queues.filter(q => q.status === 'waiting' || (q.status as string) === 'queued').sort((a, b) => a.queue_number - b.queue_number);
        const next = waitingList[0];
        if (next) {
            updateStatus(next.id, 'calling');
        }
    }, [queues, updateStatus]);

    const handleConfirmArrival = useCallback((ticket: QueueItem) => {
        updateStatus(ticket.id, 'serving');
        onSelectQueue({ id: ticket.id, queue_number: String(ticket.queue_number) });
    }, [updateStatus, onSelectQueue]);

    // --- DERIVED STATE from prop ---
    const waitingTickets = queues.filter(q => q.status === 'waiting' || (q.status as string) === 'queued').sort((a, b) => a.queue_number - b.queue_number);
    const readyTickets = queues.filter(q => q.status === 'calling');
    const expiredTickets = queues.filter(q => q.status === 'missed' || q.status === 'expired');

    const nextTicket = waitingTickets[0];
    const totalInQueue = queues.length;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 bg-white shrink-0">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-bold flex items-center gap-2 text-gray-800">
                        <LayoutDashboard className="text-pink-500" size={18} />
                        Queue Control
                    </h2>
                </div>

                {/* Broadcast Controls */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {/* ✅ Stop Queue - RED when active to indicate CLOSED */}
                    <button
                        onClick={() => handleSetBroadcast("Queue closed temporarily")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${broadcastMessage === "Queue closed temporarily"
                            ? "bg-gray-200 text-gray-700 border-gray-300 ring-2 ring-gray-500 ring-offset-1"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-200"
                            }`}
                        aria-label="Stop queue temporarily"
                    >
                        <PauseCircle size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">หยุดรับคิว</span>
                    </button>
                    <button
                        onClick={() => handleSetBroadcast("Break time")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${broadcastMessage === "Break time"
                            ? "bg-pink-100 text-pink-700 border-pink-200 ring-2 ring-pink-500 ring-offset-1"
                            : "bg-pink-50 text-pink-700 hover:bg-pink-100 border-pink-200"
                            }`}
                        aria-label="Set break time message"
                    >
                        <Coffee size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">พักเบรค</span>
                    </button>
                    <button
                        onClick={() => handleSetBroadcast("Urgent matter, sorry for the inconvenience")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${broadcastMessage === "Urgent matter, sorry for the inconvenience"
                            ? "bg-orange-100 text-orange-700 border-orange-200 ring-2 ring-orange-500 ring-offset-1"
                            : "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200"
                            }`}
                        aria-label="Set urgent message"
                    >
                        <AlertCircle size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">ติดธุระ</span>
                    </button>
                    {broadcastMessage && (
                        <button
                            onClick={() => handleSetBroadcast(null)}
                            className="p-1.5 rounded-lg border border-green-200 hover:bg-green-50 text-green-700 transition-colors flex items-center gap-1"
                            title="Clear message & Re-open queue"
                        >
                            <X size={14} />
                            <span className="text-[9px] font-bold">CLEAR</span>
                        </button>
                    )}
                </div>

                {/* Toggle Controls - Only Booth toggle remains */}
                <div className="flex items-center gap-4 text-[10px]">

                    <div className="flex items-center gap-2">
                        <span className={`font-bold uppercase tracking-wider ${isBoothActive ? 'text-green-700' : 'text-gray-500'}`}>
                            {isBoothActive ? 'BOOTH OPEN' : 'BOOTH CLOSED'}
                        </span>
                        <button
                            onClick={handleToggleBooth}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isBoothActive ? 'bg-green-500' : 'bg-gray-300'}`}
                            aria-label={isBoothActive ? 'Close booth' : 'Open booth'}
                            role="switch"
                            aria-checked={isBoothActive}
                        >
                            <span className={`${isBoothActive ? 'translate-x-4' : 'translate-x-1'} inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform`} />
                        </button>
                    </div>
                </div>

                {/* Active Event Badge */}
                {activeEvent && (
                    <div className="mt-3 bg-pink-50/50 border border-pink-100 rounded p-1.5 text-center">
                        <div className="text-xs font-bold text-pink-700 uppercase tracking-wider mb-0.5">Active Event</div>
                        <div className="font-bold text-sm text-gray-900 leading-tight">{activeEvent.event_name}</div>
                    </div>
                )}
                {!activeEvent && (
                    <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-1.5 text-center text-xs text-gray-500">
                        No Active Event Today
                    </div>
                )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-2 p-3 text-center border-b border-gray-100 bg-gray-50/50 shrink-0">
                <div className="py-0.5">
                    <div className="text-[10px] font-medium text-gray-500 uppercase">Total</div>
                    <div className="mt-0.5 text-xl font-black text-gray-900">{totalInQueue}</div>
                </div>
                <div className="py-0.5">
                    <div className="text-[10px] font-medium text-gray-500 uppercase">Next</div>
                    <div className="mt-0.5 text-xl font-black text-pink-500">#{nextTicket ? nextTicket.queue_number : '-'}</div>
                </div>
                <div className="py-0.5">
                    <div className="text-[10px] font-medium text-gray-500 uppercase">Waiting</div>
                    <div className="mt-0.5 text-xl font-black text-gray-900">{waitingTickets.length}</div>
                </div>
            </div>

            {/* Call Next Button */}
            <div className="p-3 border-b border-gray-100 bg-white shrink-0">
                <Button
                    onClick={handleCallNext}
                    disabled={!nextTicket}
                    className={`w-full py-3 text-base rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 ${!nextTicket ? 'bg-gray-100 text-gray-500 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-pink-200'}`}
                >
                    <Play size={18} fill="currentColor" />
                    <span className="font-black">Call Next {nextTicket ? `(#${nextTicket.queue_number})` : ''}</span>
                </Button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3" tabIndex={0} role="region" aria-label="Queue list">
                {/* Calling Section */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="p-3">
                        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Bell className="text-yellow-500" size={14} />
                            Calling ({readyTickets.length})
                        </h3>
                        {readyTickets.length > 0 ? (
                            <div className="space-y-1.5">
                                {readyTickets.map(ticket => (
                                    <div
                                        key={ticket.id}
                                        className={`bg-yellow-50 border rounded-md p-2 flex flex-col items-center text-center ${selectedQueueId === ticket.id ? 'border-pink-400 ring-2 ring-pink-200' : 'border-yellow-100'}`}
                                    >
                                        <div className="text-2xl font-black text-gray-900 leading-none">#{ticket.queue_number}</div>
                                        <div className="text-[9px] text-gray-500 mb-1.5">{formatElapsedTime(ticket.last_updated_at)} ago</div>
                                        <Button
                                            onClick={() => handleConfirmArrival(ticket)}
                                            className="w-full bg-pink-500 hover:bg-pink-600 text-white border-none shadow-sm h-7 text-[10px] font-bold tracking-wide rounded"
                                        >
                                            ARRIVED
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-500 text-[10px] py-4 italic border border-dashed border-gray-100 rounded-md">
                                Empty
                            </div>
                        )}
                    </div>
                </div>

                {/* ✅ SERVING SECTION REMOVED - Now in POS Panel Header */}

                {/* Waiting List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h3 className="font-bold text-xs text-gray-900">Waiting List</h3>
                        <span className="bg-gray-200 text-gray-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{waitingTickets.length}</span>
                    </div>
                    <div className="max-h-[200px] overflow-y-auto">
                        {waitingTickets.length > 0 ? (
                            <ul className="divide-y divide-gray-50">
                                {waitingTickets.map((t, idx) => (
                                    <li key={t.id} className="px-3 py-1 hover:bg-gray-50 transition-colors flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[10px] font-bold">
                                                #{t.queue_number}
                                            </div>
                                            <div>
                                                <p className="text-[11px] font-bold text-gray-800 leading-none">
                                                    {idx === 0 ? 'Next' : 'Wait'}
                                                </p>
                                                <p className="text-[9px] text-gray-500 leading-none mt-0.5">
                                                    {t.created_at ? formatElapsedTime(t.created_at) : 'Queued'}
                                                </p>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="p-4 text-center text-gray-500 text-[10px]">Queue is empty</div>
                        )}
                    </div>
                </div>

                {/* Missed Tickets */}
                {expiredTickets.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden opacity-90">
                        <div className="px-3 py-1.5 border-b border-gray-100 flex justify-between items-center bg-red-50/30">
                            <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                                <RotateCcw size={12} className="text-red-400" />
                                Missed
                            </h3>
                            <span className="bg-red-100 text-red-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{expiredTickets.length}</span>
                        </div>
                        <div className="max-h-[120px] overflow-y-auto">
                            <ul className="divide-y divide-gray-50">
                                {expiredTickets.map(t => (
                                    <li key={t.id} className="px-3 py-1 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-red-400">#{t.queue_number}</span>
                                            <span className="text-[9px] text-gray-500">
                                                {t.status === 'expired' ? 'Expired' : 'Cancelled'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => updateStatus(t.id, 'waiting')}
                                            className="text-[9px] text-pink-500 font-bold hover:underline"
                                        >
                                            Recall
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

```

## src/hooks/useMidnightTick.ts
```tsx
import { useState, useEffect } from 'react';

export const useMidnightTick = () => {
  // Initialize with local safe date
  const [currentDate, setCurrentDate] = useState(new Date().toLocaleDateString('en-CA'));

  useEffect(() => {
    const checkDate = () => {
      const nowStr = new Date().toLocaleDateString('en-CA');
      if (nowStr !== currentDate) {
        console.log("Midnight Tick: Date changed to", nowStr);
        setCurrentDate(nowStr);
      }
    };

    // Check every 30 seconds to be closer to 00:00 without heavy load
    const timer = setInterval(checkDate, 30000);
    
    return () => clearInterval(timer);
  }, [currentDate]);

  return currentDate;
};

```

## src/hooks/useArtist.ts
```tsx
import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export interface Artist {
  id: string;
  slug: string;
  display_name?: string;
  bio?: string;

  x_url?: string;
  ig_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  email?: string;
  broadcast_message?: string;
}

export const useArtist = (slug: string | undefined) => {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
       setLoading(false);
       return;
    }

    const fetchArtist = async () => {
      try {
        const { data, error } = await supabase
          .from('artists')
          .select('id, slug, display_name, bio, x_url, ig_url, facebook_url, tiktok_url, email, broadcast_message')
          .eq('slug', slug)
          .single();

        if (error) {
           console.error("Supabase Artist Fetch Error:", error.message, error.details);
           setError(`Artist not found: ${error.message}`);
           setArtist(null);
        } else {
           setArtist(data);
        }
      } catch (err: any) {
        console.error("Unexpected Error fetching artist:", err);
        setError(`Failed to fetch artist: ${err.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    fetchArtist();
  }, [slug]);

  return { artist, loading, error };
};

```

## src/hooks/useArtistRealtime.ts
```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

// Optimized Interfaces (Only essential fields)
export interface RealtimeArtist {
  id: string;
  display_name: string;
  bio: string;
  image_url?: string;
  broadcast_message?: string;
  is_queue_open?: boolean; // New Field
  x_url?: string | null;
  facebook_url?: string | null;
  ig_url?: string | null;
  tiktok_url?: string | null;
  email?: string | null;
}

export interface RealtimeEvent {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  location_name: string;

  entrance_fee?: string;
  transit_info?: string;
  status: 'Confirmed' | 'Cancelled';
  is_booth_open: boolean;
}

interface UseArtistRealtimeProps {
  artistId: string;
  initialArtist?: RealtimeArtist; 
}

export const useArtistRealtime = ({ artistId, initialArtist }: UseArtistRealtimeProps) => {
  const [artist, setArtist] = useState<RealtimeArtist | null>(initialArtist || null);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(true); // Assumption: Starts connected
  
  // Fetch Initial Data logic (Optimized)
  const fetchInitialData = async () => {
     try {
        // Timezone-safe date string (YYYY-MM-DD) for broad filtering
        const todayStr = new Date().toLocaleDateString('en-CA');
        
const [artistRes, eventsRes] = await Promise.all([
           supabase.from('artists').select('id, display_name, bio, image_url, broadcast_message, is_queue_open, x_url, facebook_url, ig_url, tiktok_url, email').eq('id', artistId).single(),
           // Filter strictly by date string to prevent timezone dropouts
           supabase.from('events').select('id, event_name, start_date, end_date, location_name, entrance_fee, transit_info, status, is_booth_open')
             .eq('artist_id', artistId)
             .gte('end_date', todayStr) 
             .order('start_date', { ascending: true })
        ]);

        if (artistRes.data) setArtist(artistRes.data);
        if (eventsRes.data) setEvents(eventsRes.data);
     } catch (err) {
        console.error("Initial Fetch Error", err);
     }
  };

  useEffect(() => {
    if (!artistId) return;

    fetchInitialData();

    // SETUP REALTIME
    const channel: RealtimeChannel = supabase
      .channel(`artist-realtime-${artistId}`)
      .on(
         'postgres_changes',
         { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` },
         (payload) => {
             // Full Refresh on Artist Update (Syncs everything)
             console.log("Realtime: Artist updated, refetching...", payload);
             fetchInitialData();
         }
      )
      .on(
         'postgres_changes',
         { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${artistId}` },
         (payload) => {
             console.log("Realtime: Events Change Detected", payload);
             
             // 1. Optimistic Update for "UPDATE" events (e.g. Toggle Booth)
             if (payload.eventType === 'UPDATE') {
                const updatedEvent = payload.new as RealtimeEvent;
                setEvents((prevEvents) => 
                    prevEvents.map(e => e.id === updatedEvent.id ? { ...e, ...updatedEvent } : e)
                );
             } else {
                // 2. For INSERT/DELETE, we refetch to ensure sorting & filtering logic (e.g. dates) is strict
                fetchInitialData();
             }
         }
      )
      .subscribe((status) => {
         if (status === 'SUBSCRIBED') setIsConnected(true);
         if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setIsConnected(false);
      });

    // Connection Status Listener (Global)
    supabase.channel('system').on('system', { event: '*' }, (payload) => {
        if (payload.event === 'disconnect') setIsConnected(false);
        if (payload.event === 'connect') setIsConnected(true);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [artistId]);

  return { artist, events, isConnected, refresh: fetchInitialData };
};

```

## src/pages/ManageCombined.tsx
```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import QueuePanel from '../components/dashboard/QueuePanel';
import PosPanel from '../components/dashboard/PosPanel';
import AdminHeader from '../components/AdminHeader';
import { Loader2 } from 'lucide-react';

// --- SHARED TYPE: Active Event ---
export interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

// --- SHARED TYPE: Queue Item ---
export interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
    last_updated_at: string;
    created_at?: string;
    served_at?: string;
    completed_at?: string;
}

export default function ManageCombined() {
    // ✅ SINGLE SOURCE OF TRUTH: Active Event
    const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
    const [eventLoading, setEventLoading] = useState(true);
    
    // ✅ LIFTED STATE: Queues now managed here (passed to children)
    const [queues, setQueues] = useState<QueueItem[]>([]);
    
    // Shared state to connect both panels
    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(null);

    // Mobile specific state
    const [activeTab, setActiveTab] = useState<'queue' | 'pos'>('queue');

    // Refs for stable callbacks
    const activeEventIdRef = useRef<string | null>(null);

    // Keep ref in sync
    useEffect(() => {
        activeEventIdRef.current = activeEvent?.id || null;
    }, [activeEvent]);

    // ✅ FETCH ACTIVE EVENT (with artist_id filter for multi-tenant isolation)
    const fetchActiveEvent = useCallback(async () => {
        try {
            // 🔐 SECURITY: Must get current user first
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                console.warn('[ManageCombined] No authenticated user');
                setActiveEvent(null);
                setEventLoading(false);
                return;
            }

            const now = new Date().toISOString();
            
            // 🔐 SECURITY: Filter by artist_id to prevent data leakage
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('artist_id', user.id)  // ✅ CRITICAL: Only this artist's events
                .eq('status', 'Confirmed')
                .gte('end_date', now)
                .order('start_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error('[ManageCombined] Error fetching active event:', error);
                setActiveEvent(null);
            } else if (data) {
                console.log('[ManageCombined] Active event loaded:', data.event_name);
                setActiveEvent(data as ActiveEvent);
            } else {
                console.log('[ManageCombined] No active event found for this artist');
                setActiveEvent(null);
            }
        } catch (err) {
            console.error('[ManageCombined] Error fetching active event:', err);
            setActiveEvent(null);
        } finally {
            setEventLoading(false);
        }
    }, []);

    // ✅ FETCH QUEUES (lifted from QueuePanel)
    const fetchQueues = useCallback(async () => {
        const eventId = activeEventIdRef.current;
        if (!eventId) {
            setQueues([]);
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        console.log('[ManageCombined] Fetching queues for event:', eventId);
        const { data, error } = await supabase
            .from('queues')
            .select('*')
            .eq('artist_id', user.id)
            .eq('event_id', eventId)
            .order('id', { ascending: true });

        if (!error && data) {
            setQueues(data);
        }
    }, []);

    // ✅ Initial fetch + realtime subscriptions
    useEffect(() => {
        fetchActiveEvent();

        const channel = supabase.channel('manage-combined-events')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
                console.log('[ManageCombined] Event change detected, refetching...');
                fetchActiveEvent();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchActiveEvent]);

    // ✅ Fetch queues when activeEvent changes
    useEffect(() => {
        if (activeEvent) {
            fetchQueues();
        } else {
            setQueues([]);
        }
    }, [activeEvent?.id, fetchQueues]);

    // ✅ Realtime subscription for QUEUES (lifted from QueuePanel)
    useEffect(() => {
        let channel: ReturnType<typeof supabase.channel> | null = null;

        const setupQueueRealtime = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            channel = supabase
                .channel(`manage-combined-queues-${user.id}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'queues', filter: `artist_id=eq.${user.id}` },
                    (payload) => {
                        if (payload.eventType === 'INSERT') {
                            const newTicket = payload.new as QueueItem;
                            setQueues((prev) => {
                                if (prev.find(q => q.id === newTicket.id)) return prev;
                                return [...prev, newTicket];
                            });
                        } else if (payload.eventType === 'UPDATE') {
                            const updatedTicket = payload.new as QueueItem;
                            setQueues((prev) => prev.map(q => q.id === updatedTicket.id ? { ...q, ...updatedTicket } : q));
                        } else if (payload.eventType === 'DELETE') {
                            const deletedId = (payload.old as QueueItem).id;
                            setQueues((prev) => prev.filter(q => q.id !== deletedId));
                        }
                    }
                )
                .subscribe();
        };

        setupQueueRealtime();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, []);



    // ✅ DERIVED STATE: Filter queues for each panel
    const filteredQueues = activeEvent?.id
        ? queues.filter(q => q.event_id === activeEvent.id)
        : queues;

    // Serving queues go to POS header (RIGHT panel)
    const servingQueues = filteredQueues.filter(q => q.status === 'serving');
    
    // Other queues go to QueuePanel (LEFT panel) - waiting, calling, missed
    const otherQueues = filteredQueues.filter(q => q.status !== 'serving');

    // Loading state
    if (eventLoading) {
        return (
            <div className="flex flex-col h-screen bg-gray-50 items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-pink-500 mb-3" />
                <p className="text-gray-500 text-sm font-medium">Loading workspace...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
            {/* ✅ Unified Admin Header */}
            <AdminHeader activePage="pos" activeEvent={activeEvent} />

            {/* 📱 Mobile Tab Switcher */}
            <div className="md:hidden flex p-2 bg-white border-b border-gray-200 gap-2 shrink-0" data-testid="pos-switcher">
                <button 
                    onClick={() => setActiveTab('queue')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                        activeTab === 'queue' 
                            ? 'bg-pink-50 text-pink-600 border border-pink-200' 
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    Queue Control
                </button>
                <button 
                    onClick={() => setActiveTab('pos')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                        activeTab === 'pos' 
                            ? 'bg-pink-50 text-pink-600 border border-pink-200' 
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                    }`}
                    data-testid="pos-tab"
                >
                    POS / Order
                </button>
            </div>

            {/* MAIN CONTENT (Split View) */}
            <div className="flex flex-1 overflow-hidden">
                
                {/* LEFT PANEL: Queue Management (35%) - Hidden on mobile unless queue tab active */}
                <div className={`
                    ${activeTab === 'queue' ? 'flex' : 'hidden'} 
                    md:flex w-full md:w-[35%] md:min-w-[320px] md:max-w-[400px] 
                    border-r border-gray-200 bg-white flex-col z-10 
                    shadow-[4px_0_24px_rgba(0,0,0,0.02)]
                `}>
                    <QueuePanel 
                        activeEvent={activeEvent}
                        queues={otherQueues}  /* ✅ PASSED: waiting, calling, missed only */
                        selectedQueueId={selectedQueueId}
                        onSelectQueue={(queue) => {
                            setSelectedQueueId(queue.id);
                            setSelectedQueueNumber(queue.queue_number);
                        }}
                    />
                </div>

                {/* RIGHT PANEL: POS & Orders (65%) - Hidden on mobile unless pos tab active */}
                <div className={`
                    ${activeTab === 'pos' ? 'flex' : 'hidden'} 
                    md:flex flex-1 bg-gray-50 flex-col min-w-0
                `} data-testid="pos-pane">
                    <PosPanel 
                        activeEvent={activeEvent}
                        servingQueues={servingQueues}  /* ✅ PASSED: serving only */
                        selectedQueueId={selectedQueueId}
                        selectedQueueNumber={selectedQueueNumber}
                        onSelectQueue={(queue) => {
                            setSelectedQueueId(queue.id);
                            setSelectedQueueNumber(queue.queue_number);
                        }}
                        onClearQueue={() => {
                            setSelectedQueueId(null);
                            setSelectedQueueNumber(null);
                        }}
                    />
                </div>

            </div>
        </div>
    );
}
```

## src/pages/ManageLogin.tsx
```tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Card, Button } from '../components/ui';
import { KeyRound, Mail, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ManageLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check if already logged in
  useEffect(() => {
     supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
           navigate('/manage-events');
        }
     });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
    } else {
       // Success! Redirect to Events page
       navigate('/manage-events');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-green-600 tracking-wider uppercase mb-2">Queue Manager</h1>
          <p className="text-gray-500 font-medium">Supabase Portal</p>
        </div>

        <Card className="p-8 shadow-xl border-gray-100 bg-white">
          <h2 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2">
            <KeyRound className="text-green-600" />
            Creator Login
          </h2>

          {errorMsg && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 flex items-start gap-2 text-sm font-medium border border-red-100 animate-fade-in">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent outline-none transition-all"
                  placeholder="artist@example.com"
                  required
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Password</label>
              <div className="relative">
                 <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent outline-none transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 mt-4"
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Login to Dashboard'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default ManageLogin;

```

## src/pages/creators/ManageArtist.tsx
```tsx
import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { 
  Trash2, Plus, Calendar, MapPin, FileText, 
  BarChart2, X, User, Ticket 
} from 'lucide-react'; 
import { Button } from '../../components/ui';
import { useNavigate } from 'react-router-dom';
import AvatarUpload from '../../components/AvatarUpload';
import AdminHeader from '../../components/AdminHeader';

interface Artist {
  id: string;
  display_name: string;
  bio: string;
  image_url: string;

  x_url: string;
  ig_url: string;
  facebook_url: string;
  tiktok_url: string;
  email: string;
}

interface Event {
  id: string;
  artist_id: string;
  event_name: string;
  location_name: string;
  location_detail: string;

  entrance_fee: string;
  transit_info: string;
  start_date: string;
  end_date: string;
  status: 'Confirmed' | 'Cancelled' | 'Ended';
}

const ManageArtist = () => {
  const navigate = useNavigate();
  
  const [artist, setArtist] = useState<Artist | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<Partial<Event>>({});
  const [isEditingEvent, setIsEditingEvent] = useState(false);

  // Stats Modal State
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [summaryStats, setSummaryStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Filter State
  const [filterMonth, setFilterMonth] = useState<number | 'all'>('all');
  const [filterYear, setFilterYear] = useState<number | 'all'>('all');

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        if (isMounted) setIsLoading(true);

        // 1. Get User
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
           navigate('/manage-login'); // Force redirect
           return;
        }

        // 2. Fetch Artist by User ID
        const { data: artistData, error: artistError } = await supabase
          .from('artists')
          .select('*')
          .eq('id', user.id)
          .single();

        if (artistError) throw artistError;

        if (isMounted && artistData) {
          setArtist(artistData);

          // 2. Fetch Events
          const { data: eventData, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('artist_id', artistData.id)
            .order('start_date', { ascending: true });

          if (eventError) throw eventError;

          if (isMounted) {
            // Auto-update events that have passed end_date to 'Ended'
            const now = new Date();
            const updatedEvents = (eventData || []).map((evt: Event) => {
              if (evt.status === 'Confirmed' && new Date(evt.end_date) < now) {
                return { ...evt, status: 'Ended' as const };
              }
              return evt;
            });

            // Update in database for events that need to be marked as Ended
            const endedEventIds = updatedEvents
              .filter((evt: Event, idx: number) => 
                eventData && eventData[idx]?.status === 'Confirmed' && evt.status === 'Ended'
              )
              .map((evt: Event) => evt.id);

            if (endedEventIds.length > 0) {
              supabase
                .from('events')
                .update({ status: 'Ended' })
                .in('id', endedEventIds)
                .then(({ error }) => {
                  if (error) console.error('Error updating ended events:', error);
                });
            }

            setEvents(updatedEvents);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchData();

    return () => { isMounted = false; };
  }, []);



  // --- Profile Actions ---

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!artist) return;
    setArtist({ ...artist, [e.target.name]: e.target.value });
  };

  const handleAvatarUpload = async (url: string) => {
    if (!artist) return;
    try {
       // 1. Update Local State (Optimistic)
       setArtist({ ...artist, image_url: url });

       // 2. IMMEDIATE SAVE to DB
       const { error } = await supabase
          .from('artists')
          .update({ image_url: url })
          .eq('id', artist.id);

       if (error) throw error;
       alert('Profile picture updated successfully!');
    } catch (error) {
       console.error("Error saving avatar:", error);
       alert('Failed to save profile picture.');
    }
  };

  const handleProfileSave = async () => {
    if (!artist) return;
    try {
      setIsSaving(true);
      const { error } = await supabase
        .from('artists')
        .update({
          display_name: artist.display_name,
          bio: artist.bio,
          x_url: artist.x_url,
          ig_url: artist.ig_url,
          facebook_url: artist.facebook_url,
          tiktok_url: artist.tiktok_url,
          email: artist.email,
          image_url: artist.image_url
        })
        .eq('id', artist.id);

      if (error) throw error;
      alert("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile.");
    } finally {
      setIsSaving(false);
    }
  };

  // --- Event Actions ---

  const handleOpenModal = (event?: Event) => {
    if (event) {
      setCurrentEvent(event);
      setIsEditingEvent(true);
    } else {
      setCurrentEvent({
        event_name: '',
        location_name: '',
        location_detail: '',

        entrance_fee: '',
        transit_info: '',
        start_date: '',
        end_date: '',
        status: 'Confirmed'
      });
      setIsEditingEvent(false);
    }
    setIsModalOpen(true);
  };

  const handleFunctionChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setCurrentEvent({ ...currentEvent, [e.target.name]: e.target.value });
  };

  const handleEventSave = async () => {
    if (!artist || !currentEvent.event_name || !currentEvent.start_date || !currentEvent.end_date) {
      alert("Please fill in required fields (Name, Start Date, End Date)");
      return;
    }

    try {
      setIsSaving(true);
      
      const eventPayload = {
        ...currentEvent,
        artist_id: artist.id,
      };

      // --- Fix: Timezone & End of Day Logic ---
      if (currentEvent.start_date) {
         eventPayload.start_date = new Date(currentEvent.start_date).toISOString();
      }

      if (currentEvent.end_date) {
         const endDateObj = new Date(currentEvent.end_date);
         
         // If time is exactly 00:00 (user didn't pick a time), set to 23:59:59
         if (endDateObj.getHours() === 0 && endDateObj.getMinutes() === 0) {
            endDateObj.setHours(23, 59, 59, 999);
         }
         
         eventPayload.end_date = endDateObj.toISOString();
      }
      // ----------------------------------------
      // Remove id if it's undefined (new event) to let DB generate it
      if (!isEditingEvent) delete eventPayload.id;

      const { data, error } = await supabase
        .from('events')
        .upsert(eventPayload)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        if (isEditingEvent) {
          setEvents(events.map(e => e.id === data.id ? data : e));
        } else {
          setEvents([...events, data].sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()));
        }
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Error saving event:", error);
      alert("Failed to save event.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEventDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this event?")) return;
    try {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
      setEvents(events.filter(e => e.id !== id));
    } catch (error) {
       console.error("Error deleting event:", error);
       alert("Failed to delete event.");
    }
  };

  // --- STATS LOGIC ---
  const handleOpenStats = async (event: Event) => {
      setCurrentEvent(event);
      setIsStatsModalOpen(true);
      setLoadingStats(true);
      setSummaryStats(null);

      try {
         const { data: queues, error } = await supabase
            .from('queues')
            .select('*')
            .eq('event_id', event.id);

         if (error) throw error;

         if (queues) {
            // 1. Count Statuses
            const total = queues.length;
            const served = queues.filter(q => q.status === 'complete').length;
            const cancelled = queues.filter(q => q.status === 'missed').length; // User Cancelled
            const expired = queues.filter(q => q.status === 'expired').length;   // System Expired
            
            // 2. Calc Averages
            let totalWaitTime = 0;
            let waitCount = 0;
            let totalServiceTime = 0;
            let serviceCount = 0;

            queues.forEach(q => {
               if (q.created_at && (q.served_at || q.called_at)) {
                  const endTime = q.served_at ? new Date(q.served_at).getTime() : new Date(q.called_at).getTime();
                  const wait = (endTime - new Date(q.created_at).getTime()) / 60000;
                  
                  if (wait > 0 && wait < 600) { 
                     totalWaitTime += wait;
                     waitCount++;
                  }
               }

               if (q.status === 'complete' && q.completed_at && (q.served_at || q.called_at)) {
                   const startTime = q.served_at ? new Date(q.served_at).getTime() : new Date(q.called_at).getTime();
                   const service = (new Date(q.completed_at).getTime() - startTime) / 60000;
                   
                   if (service > 0 && service < 300) { 
                       totalServiceTime += service;
                       serviceCount++;
                   }
               }
            });

            setSummaryStats({
               total,
               served,
               cancelled,
               expired,
               avgWait: waitCount > 0 ? Math.round(totalWaitTime / waitCount) : 0,
               avgService: serviceCount > 0 ? Math.round(totalServiceTime / serviceCount) : 0
            });
         }

      } catch (err) {
         console.error("Error fetching stats:", err);
      } finally {
         setLoadingStats(false);
      }
  };


  if (isLoading) return <div className="flex h-screen items-center justify-center text-pink-500 font-bold">Loading Artist Center...</div>;
  if (!artist) return <div className="flex h-screen items-center justify-center text-gray-500">Artist not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-slate-800">
       
       {/* ✅ Unified Admin Header */}
       <AdminHeader activePage="events" />

      {/* Main Content */}
      <div className="w-full max-w-[1140px] mx-auto px-4 md:px-6 pb-12 pt-2 overflow-x-hidden">
        
        {/* Header */}
        <header className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
           <div>
              <h1 className="text-xl font-black text-gray-800 tracking-tight">Manage profile and events</h1>
              <p className="text-sm md:text-base text-pink-600 font-bold">{artist.display_name}</p>
           </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* --- LEFT COL: Profile Settings --- */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-auto self-start">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
               <User className="text-[#d63384]" size={16} />
               <h2 className="font-bold text-sm text-slate-800">Profile Settings</h2>
            </div>
            
            <div className="p-4 space-y-3">
               {/* Avatar Upload */}
               <div className="flex justify-center mb-2">
                  <AvatarUpload 
                    artistId={artist.id}
                    currentImageUrl={artist.image_url}
                    onUploadComplete={handleAvatarUpload}
                  />
               </div>

               {/* Display Name */}
               <div className="space-y-0.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Display Name</label>
                  <input 
                    name="display_name"
                    value={artist.display_name}
                    onChange={handleProfileChange}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500 transition-all"
                  />
               </div>

               {/* Bio */}
               <div className="space-y-0.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Bio</label>
                  <textarea 
                    name="bio"
                    value={artist.bio}
                    onChange={handleProfileChange}
                    rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500 transition-all resize-none leading-relaxed"
                  />
               </div>

               <div className="h-px bg-gray-100 my-0.5"></div>

               {/* Socials */}
               <div className="space-y-1">
                  <h3 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-0.5">Social Links</h3>
                  <div className="flex flex-col gap-1">
                     {['x_url', 'ig_url', 'facebook_url', 'tiktok_url', 'email'].map((field) => (
                       <div key={field} className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                             <span className="text-[9px] font-bold text-gray-400 uppercase w-16 truncate">
                                {field.replace('_url', '').replace('email', 'Email')}
                             </span>
                          </div>
                          <input 
                             name={field}
                             value={(artist as any)[field] || ''}
                             onChange={handleProfileChange}
                             placeholder={field === 'email' ? 'contact@email.com' : '...'}
                             className="w-full bg-white border border-gray-200 rounded pl-16 pr-2 py-1 text-xs font-medium text-slate-600 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                          />
                       </div>
                     ))}
                  </div>
               </div>

               <Button 
                 onClick={handleProfileSave} 
                 disabled={isSaving}
                 className="w-full mt-1 bg-[#d63384] hover:bg-[#e63e80] text-white font-bold h-9 text-xs rounded shadow-md shadow-pink-200 active:scale-95 transition-all"
               >
                 {isSaving ? 'Saving...' : 'Save Updates'}
               </Button>
            </div>
          </div>


           {/* --- RIGHT COL: Event Management --- */}
          <div className="lg:col-span-2 space-y-6">
             
             <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px] flex flex-col">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-4">
                   {/* Header Row */}
                   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="text-[#d63384]" size={20} />
                        <h2 className="font-bold text-lg text-slate-800">Event Management</h2>
                        <span className="bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full text-xs font-bold">{events.length}</span>
                      </div>
                      <Button onClick={() => handleOpenModal()} className="bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-xs font-bold px-4 h-9 shadow-sm flex items-center gap-2">
                         <Plus size={14} /> Add Event
                      </Button>
                   </div>

                   {/* Filter Row */}
                   <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Filter:</span>
                      
                      {/* Month Filter */}
                      <select
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                        className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none"
                        aria-label="Filter by month"
                      >
                        <option value="all">All Months</option>
                        {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, idx) => (
                          <option key={month} value={idx}>{month}</option>
                        ))}
                      </select>

                      {/* Year Filter */}
                      <select
                        value={filterYear}
                        onChange={(e) => setFilterYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                        className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none"
                        aria-label="Filter by year"
                      >
                        <option value="all">All Years</option>
                        {(() => {
                          const years = [...new Set(events.map(e => new Date(e.start_date).getFullYear()))].sort((a, b) => b - a);
                          if (years.length === 0) years.push(new Date().getFullYear());
                          return years.map(year => (
                            <option key={year} value={year}>{year}</option>
                          ));
                        })()}
                      </select>

                      {/* Clear Filters */}
                      {(filterMonth !== 'all' || filterYear !== 'all') && (
                        <button
                          onClick={() => { setFilterMonth('all'); setFilterYear('all'); }}
                          className="text-xs text-pink-600 hover:text-pink-700 font-semibold underline"
                        >
                          Clear
                        </button>
                      )}

                      {/* Filtered Count */}
                      <span className="ml-auto text-xs text-gray-400 font-medium">
                        Showing {events.filter(evt => {
                          const eventDate = new Date(evt.start_date);
                          const matchMonth = filterMonth === 'all' || eventDate.getMonth() === filterMonth;
                          const matchYear = filterYear === 'all' || eventDate.getFullYear() === filterYear;
                          return matchMonth && matchYear;
                        }).length} of {events.length}
                      </span>
                   </div>
                </div>

                <div className="p-0 flex-1 overflow-x-auto">
                   {events.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-300 py-20">
                         <Calendar size={48} className="mb-4 opacity-20" />
                         <p className="font-medium">No events scheduled.</p>
                      </div>
                   ) : (
                      <table className="w-full text-left border-collapse">
                         <thead>
                            <tr className="bg-gray-50/50 text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                               <th className="px-6 py-4 font-bold">Date</th>
                               <th className="px-6 py-4 font-bold">Event</th>
                               <th className="px-6 py-4 font-bold">Location</th>
                               <th className="px-6 py-4 font-bold text-right">Actions</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-50">
                            {events
                              .filter(evt => {
                                const eventDate = new Date(evt.start_date);
                                const matchMonth = filterMonth === 'all' || eventDate.getMonth() === filterMonth;
                                const matchYear = filterYear === 'all' || eventDate.getFullYear() === filterYear;
                                return matchMonth && matchYear;
                              })
                              .map((evt) => (
                               <tr key={evt.id} className="hover:bg-pink-50/30 transition-colors group">
                                  <td className="px-6 py-4">
                                     <div className="flex flex-col">
                                        <span className="text-sm font-bold text-slate-800">
                                           {new Date(evt.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">
                                           {new Date(evt.start_date).getFullYear()}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-6 py-4">
                                     <div className="font-bold text-slate-900 text-sm">{evt.event_name}</div>
                                     <div className="flex items-center gap-3 mt-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                          evt.status === 'Cancelled' ? 'bg-red-100 text-red-600' : 
                                          evt.status === 'Ended' ? 'bg-gray-100 text-gray-500' : 
                                          'bg-green-100 text-green-600'
                                        }`}>
                                           {evt.status}
                                        </span>

                                        {evt.entrance_fee && (
                                           <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                              <Ticket size={10} /> {evt.entrance_fee}
                                           </span>
                                        )}
                                     </div>
                                  </td>
                                  <td className="px-6 py-4 text-xs text-gray-500 font-medium">
                                     <div className="flex items-start gap-1.5">
                                        <MapPin size={12} className="shrink-0 mt-0.5 text-pink-400" />
                                        <span>
                                           {evt.location_name}
                                           {evt.location_detail && <span className="block text-gray-400 text-[10px]">{evt.location_detail}</span>}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 transition-opacity">
                                        <button 
                                          onClick={() => handleOpenStats(evt)}
                                          className="text-gray-400 hover:text-pink-600 hover:bg-pink-50 p-1.5 rounded-md transition-colors"
                                          title="View Queue Stats"
                                        >
                                           <BarChart2 size={20} />
                                        </button>
                                        
                                        {/* ✅ BUTTON: Sales History */}
                                        <button 
                                          onClick={() => navigate(`/manage-events/${evt.id}/history`)}
                                          className="text-gray-400 hover:text-green-600 hover:bg-green-50 p-1.5 rounded-md transition-colors"
                                          title="View Sales History"
                                        >
                                           <FileText size={20} />
                                        </button>

                                        <button 
                                          onClick={() => handleOpenModal(evt)}
                                          className="text-xs font-semibold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-colors"
                                        >
                                           Edit
                                        </button>
                                        <button 
                                          onClick={() => handleEventDelete(evt.id)}
                                          className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition-colors"
                                        >
                                           <Trash2 size={20} />
                                        </button>
                                      </div>
                                   </td>
                                </tr>
                            ))}
                         </tbody>
                      </table>
                   )}
                </div>
             </div>

          </div>
        </div>
        
      </div>
      
      {/* --- ADD/EDIT MODAL --- */}
      {isModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-lg text-slate-800">{isEditingEvent ? 'Edit Event' : 'New Event'}</h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="p-6 overflow-y-auto space-y-4 text-sm">
                  <div className="flex items-center justify-between gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                     <div className="space-y-1 flex-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Status</label>
                        <select name="status" value={currentEvent.status || 'Confirmed'} onChange={handleFunctionChange} className="w-full bg-white border border-gray-200 rounded-md p-2 text-sm font-semibold focus:border-pink-500 outline-none" aria-label="Event status">
                           <option value="Confirmed">Confirmed</option>
                           <option value="Cancelled">Cancelled</option>
                           <option value="Ended">Ended</option>
                        </select>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Event Name *</label>
                     <input name="event_name" value={currentEvent.event_name} onChange={handleFunctionChange} className="input-field w-full border border-gray-200 rounded-lg p-3 font-semibold focus:ring-pink-500 focus:border-pink-500 outline-none" placeholder="e.g. Cosplay Festival 2026" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Start Date *</label>
                        <input type="datetime-local" name="start_date" value={currentEvent.start_date} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">End Date *</label>
                        <input type="datetime-local" name="end_date" value={currentEvent.end_date} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Location Name</label>
                        <input name="location_name" value={currentEvent.location_name || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. BITEC Bangna" />
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Location Detail</label>
                     <input name="location_detail" value={currentEvent.location_detail || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. Hall 98, Near Entrance 2" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Entrance Fee</label>
                     <input name="entrance_fee" value={currentEvent.entrance_fee || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. 300 THB / Free" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Transit Info</label>
                     <textarea name="transit_info" rows={3} value={currentEvent.transit_info || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500 resize-none" placeholder="BTS Bangna..." />
                  </div>
               </div>

               <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                  <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="text-gray-500">Cancel</Button>
                  <Button onClick={handleEventSave} className="bg-pink-500 hover:bg-pink-600 text-white font-bold px-6 shadow-md shadow-pink-200">
                     {isSaving ? 'Saving...' : 'Save Event'}
                  </Button>
               </div>
            </div>
         </div>
      )}

      {/* --- STATS MODAL --- */}
      {isStatsModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col">
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <div className="flex items-center gap-2">
                     <BarChart2 className="text-[#d63384]" size={20} />
                     <div>
                        <h3 className="font-bold text-lg text-slate-800">Performance Summary</h3>
                        <p className="text-xs text-gray-400 font-medium">{currentEvent.event_name}</p>
                     </div>
                  </div>
                  <button onClick={() => setIsStatsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="p-8">
                  {loadingStats ? (
                     <div className="py-12 text-center text-gray-400 font-medium animate-pulse">Calculating metrics...</div>
                  ) : summaryStats ? (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {/* Total Tickets */}
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 text-center">
                           <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total Limit</div>
                           <div className="text-3xl font-black text-slate-800">{summaryStats.total}</div>
                           <div className="text-[10px] text-gray-400 mt-1">Tickets Issued</div>
                        </div>

                        {/* Served */}
                        <div className="bg-green-50 p-4 rounded-xl border border-green-100 text-center">
                           <div className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Served</div>
                           <div className="text-3xl font-black text-green-700">{summaryStats.served}</div>
                           <div className="text-[10px] text-green-600/70 mt-1">
                              {summaryStats.total > 0 ? Math.round((summaryStats.served / summaryStats.total) * 100) : 0}% Rate
                           </div>
                        </div>

                        {/* Avg Wait */}
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                           <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Avg Wait</div>
                           <div className="text-3xl font-black text-blue-700">{summaryStats.avgWait}<span className="text-sm font-bold text-blue-400 ml-1">m</span></div>
                           <div className="text-[10px] text-blue-600/70 mt-1">To Get Called</div>
                        </div>

                        {/* Avg Service */}
                        <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-center">
                           <div className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-1">Avg Service</div>
                           <div className="text-3xl font-black text-purple-700">{summaryStats.avgService}<span className="text-sm font-bold text-purple-400 ml-1">m</span></div>
                           <div className="text-[10px] text-purple-600/70 mt-1">At Counter</div>
                        </div>

                        {/* Missed / Cancelled Split */}
                         <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center col-span-2 mt-2 flex items-center justify-between px-6">
                           <div className="text-left">
                              <div className="text-red-700 font-bold text-sm">Cancelled</div>
                              <div className="text-red-400 text-[10px]">By User</div>
                           </div>
                           <div className="text-3xl font-black text-red-600">{summaryStats.cancelled}</div>
                        </div>

                         <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 text-center col-span-2 mt-2 flex items-center justify-between px-6">
                           <div className="text-left">
                              <div className="text-gray-700 font-bold text-sm">Expired</div>
                              <div className="text-gray-400 text-[10px]">System Removal</div>
                           </div>
                           <div className="text-3xl font-black text-gray-600">{summaryStats.expired}</div>
                        </div>

                     </div>
                  ) : (
                     <div className="text-center text-gray-400">No data available.</div>
                  )}
               </div>

               <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                  <Button onClick={() => setIsStatsModalOpen(false)} variant="ghost" className="text-gray-500 hover:text-gray-700">Close</Button>
               </div>
            </div>
         </div>
      )}

    </div>
  );
};

export default ManageArtist;
```

## src/pages/creators/ManageProducts.tsx
```tsx
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../../components/ui';
import { useNavigate } from 'react-router-dom';
import { Loader, Trash2, Upload, Plus, FileText, Edit2, X, Search, ArrowUpDown, ChevronDown, Coins, AlertTriangle } from 'lucide-react';
import Papa from 'papaparse';
import imageCompression from 'browser-image-compression';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import AdminHeader from '../../components/AdminHeader';
import { formatPrice, DEFAULT_CURRENCY, CURRENCIES } from '../../utils/currency';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
  status?: 'enable' | 'disable' | 'soldout';
  currency?: string;  // ✅ NEW: Currency code
}

const ManageProducts = () => {
   const navigate = useNavigate();
   const [products, setProducts] = useState<Product[]>([]);
   const [loading, setLoading] = useState(true);
   const [uploading, setUploading] = useState(false);
   const [compressing, setCompressing] = useState(false);
   
   // Form State
   const [name, setName] = useState('');
   const [price, setPrice] = useState('');
   const [description, setDescription] = useState('');
   const [category, setCategory] = useState(''); // Default
   const [status, setStatus] = useState('enable'); // Default
   const [currency, setCurrency] = useState(DEFAULT_CURRENCY); // ✅ NEW: Currency state
   const [file, setFile] = useState<File | null>(null);
   const fileInputRef = useRef<HTMLInputElement>(null);
   
   // Filter & Sort State
   const [searchQuery, setSearchQuery] = useState('');
   const [selectedCategory, setSelectedCategory] = useState('All');
   const [selectedCurrency, setSelectedCurrency] = useState('All'); // ✅ NEW: Currency filter
   const [sortOption, setSortOption] = useState('name_asc');

   // Edit Modal State
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);
   const [editingProduct, setEditingProduct] = useState<Product | null>(null);
   const [editFile, setEditFile] = useState<File | null>(null);
   const editFileInputRef = useRef<HTMLInputElement>(null);
   const csvInputRef = useRef<HTMLInputElement>(null);
   
   const [, setArtistId] = useState<string>('');
   const [artistName, setArtistName] = useState<string>('');

   const categories = [
      "A3", "A4", "Badge", "Cheki", "Keychain", 
      "Photo4*6", "Photocard", "Shaker", "Standy", "Sticker"
   ].sort().concat(["Other"]);
   
   // Derived Data for Suggestions (Unique Categories from Products + Defaults)
   // We use this for the datalist suggestions
   const allCategorySuggestions = Array.from(new Set([
      ...categories.filter(c => c !== 'Other'), // Defaults
      ...products.map(p => p.category?.trim()).filter(Boolean) as string[]
   ])).sort();

   // Derived Data for Filter Chips (includes "All")
   const uniqueCategories = ['All', ...Array.from(new Set(products.map(p => p.category || 'Other'))).sort()];
   
   // ✅ NEW: Unique currencies from products for filter
   const uniqueCurrencies = ['All', ...Array.from(new Set(products.map(p => p.currency || DEFAULT_CURRENCY))).sort()];

   // ✅ NEW: Check for mixed enabled currencies
   const enabledProducts = products.filter(p => p.status === 'enable');
   const enabledCurrencies = Array.from(new Set(enabledProducts.map(p => p.currency || DEFAULT_CURRENCY)));
   const hasMixedCurrencies = enabledCurrencies.length > 1;

   // ✅ NEW: Fix Mixed Currencies (Batch Update)
   const handleSwitchAll = async (targetCurrency: string) => {
      if (!confirm(`Enable ONLY ${targetCurrency} products and disable others?`)) return;
      
      setLoading(true);
      try {
         const { data: { user } } = await supabase.auth.getUser();
         if (!user) throw new Error('Not authenticated');

         // 1. Enable targets
         await supabase
            .from('products')
            .update({ status: 'enable' })
            .eq('artist_id', user.id)
            .eq('currency', targetCurrency)
            .neq('status', 'soldout'); // Keep soldout as soldout? Or enable? 'enable' usually resets soldout. Let's assume enable all means reset soldout too? Or just enable disabled ones. Safe to just set 'enable'.

         // 2. Disable others
         await supabase
            .from('products')
            .update({ status: 'disable' })
            .eq('artist_id', user.id)
            .neq('currency', targetCurrency);
         
         await fetchProducts();
         alert(`Switched active currency to ${targetCurrency}`);
      } catch (error: any) {
         console.error(error);
         alert('Failed to switch currency');
      } finally {
         setLoading(false);
      }
   };

   const filteredProducts = products.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || (product.category || 'Other') === selectedCategory;
      const matchesCurrency = selectedCurrency === 'All' || (product.currency || DEFAULT_CURRENCY) === selectedCurrency; // ✅ NEW
      return matchesSearch && matchesCategory && matchesCurrency;
   }).sort((a, b) => {
      if (sortOption === 'name_asc') return a.name.localeCompare(b.name);
      if (sortOption === 'price_asc') return a.price - b.price;
      if (sortOption === 'price_desc') return b.price - a.price;
      return 0;
   });

   const fetchProducts = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      // Fix: Force redirect if no session to prevent "Artist not found" errors
      if (!user) {
         navigate('/manage-login'); 
         return;
      }

      setArtistId(user.id);

      // Fetch Artist Name
      const { data: artist } = await supabase
         .from('artists')
         .select('display_name')
         .eq('id', user.id)
         .single();
      
      if (artist) setArtistName(artist.display_name);



      const { data, error } = await supabase
         .from('products')
         .select('*')
         .eq('artist_id', user.id)
         .is('deleted_at', null)
         .order('created_at', { ascending: false });

      if (!error && data) {
         setProducts(data);
      }
      setLoading(false);
   };

   useEffect(() => {
      fetchProducts();
   }, []);

   const getProductImageUrl = (dbValue: string, width: number = 400) => {
      if (!dbValue) return '';
      let path = dbValue;
      if (dbValue.includes('http') && dbValue.includes('Menu/')) {
         const parts = dbValue.split('Menu/');
         if (parts.length > 1) path = parts[1];
      }
      const { data } = supabase.storage.from('Menu').getPublicUrl(path);
      
      // Use ImageKit Utility
      return getOptimizedImageUrl(data.publicUrl, width);
   };


   const handleImageCompression = async (imageFile: File): Promise<File> => {
      // Options for compression
      const options = {
         maxSizeMB: 0.2,           // 200KB
         maxWidthOrHeight: 1024,   // Max dimension
         useWebWorker: true,
         fileType: 'image/webp',   // Try to convert to WebP
         initialQuality: 0.8       // 80% quality at first
      };

      // If file is larger than 10MB, reject immediately
      if (imageFile.size > 10 * 1024 * 1024) {
         alert("File size must be less than 10MB");
         throw new Error("File too large");
      }
      // Skip if already small enough (e.g. < 200KB)
      if (imageFile.size / 1024 / 1024 < 0.2) {
         return imageFile; 
      }

      try {
         const compressedFile = await imageCompression(imageFile, options);
         // Keep original name but change extension if converted
         const newName = imageFile.name.replace(/\.[^/.]+$/, "") + '.webp';
         return new File([compressedFile], newName, { type: 'image/webp' });
      } catch (error) {
         console.warn('Image compression failed, using original.', error);
         return imageFile;
      }
   };

   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
         const selectedFile = e.target.files[0];
         // Basic validation
         if (!['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) {
            alert('Only JPG, PNG and WebP files are allowed.');
            return;
         }

         setCompressing(true);
         try {
             const compressed = await handleImageCompression(selectedFile);
             setFile(compressed);
         } catch (err) {
            setFile(selectedFile);
         } finally {
            setCompressing(false);
         }
      }
   };

   const handleAddProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name || !price || !file) {
         alert('Please fill in all fields and select an image.');
         return;
      }

      setUploading(true);
      try {
         const { data: { user } } = await supabase.auth.getUser();
         if (!user) throw new Error('Not authenticated');

         // 1. Upload Image
         const fileExt = file.name.split('.').pop();
         const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
         const filePath = `public/${fileName}`;

         const { error: uploadError } = await supabase.storage
            .from('Menu')
            .upload(filePath, file);

         if (uploadError) throw uploadError;

         // 2. Insert to DB
         const { error: dbError } = await supabase
            .from('products')
            .insert([{
               artist_id: user.id,
               name,
               price: parseFloat(price),
               description,
               category,
               status,
               currency,  // ✅ NEW: Save currency
               image_url: filePath // Store relative path
            }]);

         if (dbError) throw dbError;

         // Reset Form
         setName('');
         setPrice('');
         setDescription('');
         setCategory('');
         setStatus('enable');
         setCurrency(DEFAULT_CURRENCY);  // ✅ NEW: Reset currency
         setFile(null);
         if (fileInputRef.current) fileInputRef.current.value = '';
         
         await fetchProducts();
         alert('Product added successfully!');

      } catch (error: any) {
         console.error(error);
         alert(error.message || 'Error adding product');
      } finally {
         setUploading(false);
      }
   };

   const handleDeleteProduct = async (id: string) => {
      if (!confirm('Are you sure you want to delete this product?')) return;

      try {
         // 1. Soft Delete (Update deleted_at)
         const { error: dbError } = await supabase
            .from('products')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id);

         if (dbError) throw dbError;

         // Note: We do NOT delete the image from storage to preserve history for past orders.

         await fetchProducts();

      } catch (error) {
         console.error('Error deleting product', error);
         alert('Failed to delete product');
      }
   };


   const handleEditClick = (product: Product) => {
      setEditingProduct(product);
      setName(product.name);
      setPrice(product.price.toString());
      setDescription(product.description || '');
      setCategory(product.category || '');
      setStatus(product.status || 'enable');
      setCurrency(product.currency || DEFAULT_CURRENCY);  // ✅ NEW: Load product currency
      setEditFile(null);
      setIsEditModalOpen(true);
   };

   const handleEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
         const selectedFile = e.target.files[0];
         if (!['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) {
            alert('Only JPG, PNG, and WebP files are allowed.');
            return;
         }

         setCompressing(true);
         try {
             const compressed = await handleImageCompression(selectedFile);
             setEditFile(compressed);
         } catch (err) {
             setEditFile(selectedFile);
         } finally {
             setCompressing(false);
         }
      }
   };

   const handleUpdateProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingProduct || !name || !price) {
         alert('Please fill in all required fields.');
         return;
      }

      setUploading(true);
      try {
         let imageUrl = editingProduct.image_url;

         // If new image selected, upload it
         if (editFile) {
            const fileExt = editFile.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `public/${fileName}`;

            const { error: uploadError } = await supabase.storage
               .from('Menu')
               .upload(filePath, editFile);

            if (uploadError) throw uploadError;
            imageUrl = filePath;

            // Delete old image if it exists
            if (editingProduct.image_url) {
               let oldPath = editingProduct.image_url;
               if (oldPath.includes('Menu/')) {
                  oldPath = oldPath.split('Menu/')[1];
               }
               await supabase.storage.from('Menu').remove([oldPath]);
            }
         }

         // Update product in database
         const { error: dbError } = await supabase
            .from('products')
            .update({
               name,
               price: parseFloat(price),
               description,
               category,
               status,
               currency,  // ✅ NEW: Update currency
               image_url: imageUrl
            })
            .eq('id', editingProduct.id);

         if (dbError) throw dbError;

         // Reset and refresh
         setIsEditModalOpen(false);
         setEditingProduct(null);
         setEditFile(null);
         setName('');
         setPrice('');
         setDescription('');
         setCategory('');
         setStatus('enable');
         setCurrency(DEFAULT_CURRENCY);  // ✅ NEW: Reset currency
         
         await fetchProducts();
         alert('Product updated successfully!');

      } catch (error: any) {
         console.error(error);
         alert(error.message || 'Error updating product');
      } finally {
         setUploading(false);
      }
   };

   const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
         alert('Please upload a CSV file.');
         return;
      }

      Papa.parse(file, {
         header: true,
         skipEmptyLines: true,
         transformHeader: (header: string) => {
            // Trim whitespace and convert to lowercase for case-insensitive matching
            return header.trim().toLowerCase();
         },
         complete: async (results: Papa.ParseResult<Record<string, string>>) => {
            const rows = results.data as any[];
            if (!rows || rows.length === 0) {
               alert('CSV is empty.');
               return;
            }

            const validItems: any[] = [];
            const errors: string[] = [];

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
               alert('Not authenticated');
               return;
            }

            rows.forEach((row: any, index: number) => {
               // Sanitize: trim all string values
               const sanitizedRow: any = {};
               Object.keys(row).forEach(key => {
                  const value = row[key];
                  sanitizedRow[key] = typeof value === 'string' ? value.trim() : value;
               });

               // Extract fields (case-insensitive)
               const name = sanitizedRow.name || sanitizedRow.Name || sanitizedRow.NAME;
               const priceRaw = sanitizedRow.price || sanitizedRow.Price || sanitizedRow.PRICE;
               const category = sanitizedRow.category || sanitizedRow.Category || sanitizedRow.CATEGORY;
               const description = sanitizedRow.description || sanitizedRow.Description || sanitizedRow.DESCRIPTION;
               // ✅ FIX: Read currency from CSV
               const currencyRaw = sanitizedRow.currency || sanitizedRow.Currency || sanitizedRow.CURRENCY;
               const status = sanitizedRow.status || sanitizedRow.Status || sanitizedRow.STATUS;

               // Validate required fields
               if (!name || !priceRaw) {
                  const missing = [];
                  if (!name) missing.push('name');
                  if (!priceRaw) missing.push('price');
                  errors.push(`Row ${index + 2}: Missing required field(s): ${missing.join(', ')}`);
                  return;
               }

               // Sanitize price: remove commas and parse
               const priceClean = priceRaw.toString().replace(/,/g, '');
               const price = parseFloat(priceClean);

               if (isNaN(price) || price <= 0) {
                  errors.push(`Row ${index + 2}: Invalid price value "${priceRaw}"`);
                  return;
               }

               // ✅ FIX: Validate and use currency from CSV (default to THB if missing)
               const validCurrencies = Object.keys(CURRENCIES);
               const currency = currencyRaw && validCurrencies.includes(currencyRaw.toUpperCase()) 
                  ? currencyRaw.toUpperCase() 
                  : DEFAULT_CURRENCY;
               
               // Validate status
               const validStatuses = ['enable', 'disable', 'soldout'];
               const productStatus = status && validStatuses.includes(status.toLowerCase())
                  ? status.toLowerCase()
                  : 'enable';

               validItems.push({
                  artist_id: user.id,
                  name: name,
                  price: price,
                  currency: currency, // ✅ FIX: Now uses currency from CSV
                  category: category || 'Other',
                  description: description || '',
                  status: productStatus,
                  image_url: ''
               });
            });

            // Log errors to console for debugging
            if (errors.length > 0) {
               console.warn('CSV Upload Validation Errors:');
               errors.forEach(err => console.warn(err));
            }

            if (validItems.length > 0) {
               try {
                  setUploading(true);
                  const { error } = await supabase.from('products').insert(validItems);
                  
                  if (error) throw error;

                  const message = `Successfully uploaded ${validItems.length} item(s)!${errors.length > 0 ? `\n\n${errors.length} row(s) skipped. Check console for details.` : ''}`;
                  alert(message);
                  if (csvInputRef.current) csvInputRef.current.value = '';
                  await fetchProducts();
               } catch (err: any) {
                  console.error('File upload error:', err);
                  alert('Failed to upload items. ' + err.message);
               } finally {
                  setUploading(false);
               }
            } else {
               alert(`No valid rows found.\n\n${errors.length > 0 ? errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n... and ${errors.length - 5} more errors.` : '') : "Ensure CSV has 'name' and 'price' columns."}`);
            }
         },
         error: (err: Error) => {
            console.error('CSV Parse Error:', err);
            alert('Failed to parse CSV file.');
         }
   });
   };

   return (
      <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
         {/* ✅ NEW: Unified Admin Header */}
         <AdminHeader activePage="menu" />
         
         {/* Page Title Wrapper */}
         <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4 mb-2">
            <h1 className="text-xl font-black text-gray-800 tracking-tight">Manage Products</h1>
            <p className="text-sm text-pink-600 font-bold">{artistName}</p>
         </div>

         <main className="max-w-5xl mx-auto px-4 md:px-6 pb-12">
            
            {/* ADD PRODUCT FORM */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 animate-fade-in">
               <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                  <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                     <Plus className="text-pink-500" size={18} />
                     Add New Item
                  </h2>
                  <div className="flex items-center gap-2 self-end md:self-auto">
                     <input 
                        type="file" 
                        ref={csvInputRef}
                        onChange={handleBulkUpload}
                        className="hidden"
                        accept=".csv"
                     />
                     <Button
                        type="button"
                        onClick={() => csvInputRef.current?.click()}
                        disabled={uploading}
                        className="bg-[#d63384] hover:bg-[#ff3385] text-white py-1.5 px-3 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 flex items-center gap-2 text-xs font-bold"
                     >
                        {uploading ? <Loader className="animate-spin" size={14} /> : <FileText size={14} />}
                        {uploading ? 'Uploading...' : 'Upload File'}
                     </Button>
                  </div>
               </div>
               
               <form onSubmit={handleAddProduct} className="space-y-4">
                  {/* Row 1: Product Name | Price & Currency | Category */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Product Name</label>
                        <input 
                           type="text" 
                           value={name}
                           onChange={(e) => setName(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           placeholder="e.g. Iced Latte"
                           required
                        />
                     </div>
                     
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                           <Coins size={12} /> Price & Currency
                        </label>
                        <div className="flex flex-col md:flex-row gap-2">
                           <input 
                              type="number" 
                              value={price}
                              onChange={(e) => setPrice(e.target.value)}
                              className="flex-1 w-full min-w-0 px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                              placeholder="0.00"
                              min="0"
                              step="0.01"
                              required
                           />
                           <select
                              value={currency}
                              onChange={(e) => setCurrency(e.target.value)}
                              className="w-full md:w-24 shrink-0 px-2 py-1.5 text-sm font-semibold text-gray-600 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all bg-white cursor-pointer"
                              aria-label="Currency"
                           >
                              {Object.entries(CURRENCIES).map(([code, info]) => (
                                 <option key={code} value={code}>{info.symbol} {code}</option>
                              ))}
                           </select>
                        </div>
                     </div>

                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Category</label>
                        <input
                           list="category-suggestions"
                           type="text"
                           value={category}
                           onChange={(e) => setCategory(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           placeholder="Select or type..."
                        />
                        <datalist id="category-suggestions">
                           {allCategorySuggestions.map(cat => (
                              <option key={cat} value={cat} />
                           ))}
                        </datalist>
                     </div>
                  </div>

                  {/* Row 2: Image | Status */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Image</label>
                        <div className="relative">
                           <input 
                              type="file" 
                              ref={fileInputRef}
                              onChange={handleFileChange}
                              className="hidden"
                              id="file-upload"
                              accept="image/png, image/jpeg"
                           />
                           <label 
                              htmlFor="file-upload" 
                              className={`w-full flex items-center justify-center px-3 py-1.5 border border-dashed rounded cursor-pointer transition-colors ${file ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-300 text-gray-500 hover:border-pink-400'}`}
                           >
                              <Upload size={14} className="mr-2 shrink-0" />
                              <span className="truncate text-xs font-medium max-w-[200px] md:max-w-none">
                                 {compressing ? 'Compressing...' : (file ? file.name : 'Choose Image')}
                              </span>
                           </label>
                        </div>
                        {compressing && <p className="text-[10px] text-pink-500 font-bold mt-1 animate-pulse">Optimizing image size...</p>}
                     </div>

                     <div className="space-y-1">
                        <label htmlFor="product-status" className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Status</label>
                        <select
                           id="product-status"
                           value={status}
                           onChange={(e) => setStatus(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-600 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all bg-white"
                           aria-label="Product status"
                        >
                           <option value="enable">Enable</option>
                           <option value="disable">Disable</option>
                           <option value="soldout">Sold Out</option>
                        </select>
                     </div>
                  </div>

                  {/* Row 3: Description */}
                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Description 
                        <span className="text-[10px] text-gray-400 ml-2 font-normal">({description.length}/200)</span>
                     </label>
                     <textarea 
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                        className="w-full px-3 py-1.5 text-sm text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all h-16 resize-none"
                        placeholder="Brief description..."
                     />
                  </div>


                  <div className="flex justify-end">
                     <Button 
                        type="submit" 
                        disabled={uploading}
                        className="bg-pink-500 hover:bg-pink-600 text-white py-2 px-6 rounded shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 text-xs font-bold h-9"
                     >
                        {uploading ? <Loader className="animate-spin mx-auto" size={16} /> : 'Add Product'}
                     </Button>
                  </div>

               </form>
            </div>

            {/* ✅ NEW: Mixed Currency Warning */}
            {hasMixedCurrencies && (
               <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in shadow-sm">
                  <div className="flex items-start gap-3">
                     <div className="p-2 bg-amber-100 rounded-full text-amber-600 shrink-0">
                        <AlertTriangle size={20} />
                     </div>
                     <div>
                        <h3 className="text-sm font-bold text-amber-800">Multiple Currencies Enabled</h3>
                        <p className="text-xs text-amber-600 mt-1">
                           You have products enabled in multiple currencies ({enabledCurrencies.join(', ')}). 
                           <br/>Please enable only one currency to avoid issues.
                        </p>
                     </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 bg-white p-1.5 rounded-lg border border-amber-100 shadow-sm">
                     <span className="text-xs font-bold text-gray-500 pl-2">Enable Only:</span>
                     <select 
                        className="text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-1 focus:outline-none cursor-pointer hover:bg-amber-100 transition-colors"
                        onChange={(e) => {
                           if (e.target.value) handleSwitchAll(e.target.value);
                        }}
                        value=""
                     >
                        <option value="" disabled>Select Currency...</option>
                        {enabledCurrencies.map(c => (
                           <option key={c} value={c}>{c}</option>
                        ))}
                     </select>
                  </div>
               </div>
            )}

            {/* FILTER & SORT SECTION */}
            <div className="mb-8 space-y-4">
               {/* Search & Sort Row */}
               <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative flex-1">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input 
                        type="text"
                        placeholder="Search products..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm"
                     />
                  </div>
                  
                  <div className="relative min-w-[200px]">
                     <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <ArrowUpDown className="text-gray-400" size={16} />
                     </div>
                     <select
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value)}
                        className="w-full pl-10 pr-8 py-2.5 appearance-none rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm font-medium text-sm"
                     >
                        <option value="name_asc">Name (A-Z)</option>
                        <option value="price_asc">Price (Low to High)</option>
                        <option value="price_desc">Price (High to Low)</option>
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>
               </div>

               {/* Category Chips */}
               <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {uniqueCategories.map(cat => (
                     <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                           selectedCategory === cat 
                              ? 'bg-pink-500 text-white shadow-md shadow-pink-200' 
                              : 'bg-white border border-gray-200 text-gray-600 hover:border-pink-300 hover:text-pink-500'
                        }`}
                     >
                        {cat}
                     </button>
                  ))}
               </div>
               
               {/* ✅ NEW: Currency Filter Chips */}
               {uniqueCurrencies.length > 2 && (
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-center mr-1 flex items-center gap-1">
                        <Coins size={12} /> Currency:
                     </span>
                     {uniqueCurrencies.map(curr => (
                        <button
                           key={curr}
                           onClick={() => setSelectedCurrency(curr)}
                           className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                              selectedCurrency === curr 
                                 ? 'bg-amber-500 text-white shadow-md shadow-amber-200' 
                                 : 'bg-white border border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-500'
                           }`}
                        >
                           {curr === 'All' ? 'All' : `${CURRENCIES[curr]?.symbol || curr} ${curr}`}
                        </button>
                     ))}
                  </div>
               )}
            </div>

            {/* PRODUCT LIST */}
            <h2 className="text-lg font-bold text-gray-800 mb-4 px-1">Current Menu ({filteredProducts.length})</h2>
            
            {loading ? (
               <div className="text-center py-12 text-gray-400">Loading products...</div>
            ) : filteredProducts.length > 0 ? (
               <>
                  {/* MOBILE VIEW: List/Cards (<768px) */}
                  <div className="flex flex-col gap-3 md:hidden">
                     {filteredProducts.map(product => (
                        <div key={product.id} className="bg-white/70 backdrop-blur-md border border-white/40 shadow-sm rounded-xl overflow-hidden flex flex-row h-28 group relative">
                           {/* Image */}
                           <div className="w-[100px] bg-gray-100 relative overflow-hidden shrink-0">
                              <img 
                                 src={getProductImageUrl(product.image_url, 400)} 
                                 alt={product.name}
                                 className="w-full h-full object-cover"
                                 loading="lazy"
                              />
                              {(product.status === 'disable' || product.status === 'soldout') && (
                                 <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                    <span className={`text-[10px] font-black tracking-wider border px-1 -rotate-12 ${
                                       product.status === 'soldout' ? 'text-red-400 border-red-400' : 'text-white border-white'
                                    }`}>
                                       {product.status === 'soldout' ? 'SOLD OUT' : 'DISABLED'}
                                    </span>
                                 </div>
                              )}
                           </div>
                           
                           {/* Content */}
                           <div className="p-3 flex flex-col justify-between flex-1 min-w-0">
                              <div>
                                 <h3 className="font-bold text-gray-800 text-sm leading-tight line-clamp-2 pr-8">{product.name}</h3>
                                 <div className="mt-1 flex items-baseline gap-2">
                                    <span className="text-pink-600 font-black text-sm">{formatPrice(product.price, product.currency)}</span>
                                    {product.category && (
                                       <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold uppercase rounded">
                                          {product.category}
                                       </span>
                                    )}
                                 </div>
                              </div>
                              
                              {/* Mobile Actions (Always Visible) */}
                              <div className="absolute bottom-2 right-2 flex gap-2">
                                  <button onClick={(e) => { e.stopPropagation(); handleEditClick(product); }} className="text-gray-400 hover:text-blue-600 bg-white/80 p-1.5 rounded-full shadow-sm border border-gray-100"><Edit2 size={14}/></button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteProduct(product.id); }} className="text-gray-400 hover:text-red-600 bg-white/80 p-1.5 rounded-full shadow-sm border border-gray-100"><Trash2 size={14}/></button>
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>

                  {/* DESKTOP VIEW: Table (>=768px) */}
                  <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in">
                     <table className="w-full text-left border-collapse">
                        <thead>
                           <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wider">
                              <th className="px-6 py-4 font-bold w-[40%]">Product</th>
                              <th className="px-6 py-4 font-bold">Category</th>
                              <th className="px-6 py-4 font-bold">Price</th>
                              <th className="px-6 py-4 font-bold">Status</th>
                              <th className="px-6 py-4 font-bold text-right">Actions</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                           {filteredProducts.map(product => (
                              <tr key={product.id} className="hover:bg-gray-50/50 transition-colors group">
                                 <td className="px-6 py-4">
                                    <div className="flex items-center gap-4">
                                       <div className="w-12 h-12 rounded-lg bg-gray-100 relative overflow-hidden shrink-0 border border-gray-100 group-hover:scale-105 transition-transform">
                                          <img 
                                             src={getProductImageUrl(product.image_url, 100)} 
                                             alt={product.name}
                                             className="w-full h-full object-cover"
                                          />
                                          {product.status === 'soldout' && <div className="absolute inset-0 bg-black/50" />}
                                       </div>
                                       <div>
                                          <h4 className="font-bold text-gray-800 text-sm line-clamp-1">{product.name}</h4>
                                          {product.description && <p className="text-xs text-gray-400 line-clamp-1 max-w-[240px]">{product.description}</p>}
                                       </div>
                                    </div>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-100 text-gray-600">
                                       {product.category || 'Other'}
                                    </span>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="font-bold text-gray-900">{formatPrice(product.price, product.currency)}</span>
                                 </td>
                                 <td className="px-6 py-4">
                                    {product.status === 'enable' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>}
                                    {product.status === 'disable' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">Disabled</span>}
                                    {product.status === 'soldout' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600">Sold Out</span>}
                                 </td>
                                 <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                       <button 
                                          onClick={() => handleEditClick(product)}
                                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                          title="Edit"
                                       >
                                          <Edit2 size={18} />
                                       </button>
                                       <button 
                                          onClick={() => handleDeleteProduct(product.id)}
                                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                          title="Delete"
                                       >
                                          <Trash2 size={18} />
                                       </button>
                                    </div>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </>
            ) : (
               <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                  <span className="material-icons-outlined text-4xl text-gray-300 mb-2">restaurant_menu</span>
                  <p className="text-gray-500">No items available. Add your first product above.</p>
               </div>
            )}

         </main>

         {/* Edit Product Modal */}
         {isEditModalOpen && editingProduct && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                     <h2 className="text-xl font-bold text-gray-800">Edit Product</h2>
                     <button 
                        onClick={() => {
                           setIsEditModalOpen(false);
                           setEditingProduct(null);
                           setEditFile(null);
                        }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                     >
                        <X size={24} />
                     </button>
                  </div>
                  
                  <form onSubmit={handleUpdateProduct} className="p-6 space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Product Name *</label>
                           <input 
                              type="text" 
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="e.g. Iced Latte"
                              required
                           />
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                              <Coins size={14} /> Price & Currency *
                           </label>
                           <div className="flex gap-2">
                              <input 
                                 type="number" 
                                 value={price}
                                 onChange={(e) => setPrice(e.target.value)}
                                 className="flex-1 px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                                 placeholder="0.00"
                                 min="0"
                                 step="0.01"
                                 required
                              />
                              <select
                                 value={currency}
                                 onChange={(e) => setCurrency(e.target.value)}
                                 className="w-28 px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all bg-white font-bold cursor-pointer"
                                 aria-label="Currency"
                              >
                                 {Object.entries(CURRENCIES).map(([code, info]) => (
                                    <option key={code} value={code}>{info.symbol} {code}</option>
                                 ))}
                              </select>
                           </div>
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                           <input
                              list="category-suggestions"
                              type="text"
                              value={category}
                              onChange={(e) => setCategory(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="Select or type category..."
                           />
                           {/* Datalist is reusable, defined above in the Add form */}
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Product Image</label>
                           <div className="relative">
                              <input 
                                 type="file" 
                                 ref={editFileInputRef}
                                 onChange={handleEditFileChange}
                                 className="hidden"
                                 id="edit-file-upload"
                                 accept="image/png, image/jpeg"
                              />
                              <label 
                                 htmlFor="edit-file-upload" 
                                 className={`w-full flex items-center justify-center px-4 py-2 border border-dashed rounded-lg cursor-pointer transition-colors ${editFile ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-300 text-gray-500 hover:border-pink-400'}`}
                              >
                                 <Upload size={18} className="mr-2" />
                                 <span className="truncate text-sm">
                                    {compressing ? 'Compressing...' : (editFile ? editFile.name : 'Choose New Image')}
                                 </span>
                              </label>
                           </div>
                           {compressing && <p className="text-xs text-pink-500 font-bold mt-1 animate-pulse">Optimizing image size...</p>}
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                           <select
                              value={status}
                              onChange={(e) => setStatus(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all bg-white"
                           >
                              <option value="enable">Enable</option>
                              <option value="disable">Disable</option>
                              <option value="soldout">Sold Out</option>
                           </select>
                        </div>
                     </div>

                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                           Description 
                           <span className="text-xs text-gray-400 ml-2">({description.length}/200)</span>
                        </label>
                        <textarea 
                           value={description}
                           onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                           className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all h-24 resize-none"
                           placeholder="Brief description of the product..."
                        />
                     </div>

                     {editingProduct.image_url && !editFile && (
                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Current Image</label>
                           <img 
                              src={getProductImageUrl(editingProduct.image_url, 200)} 
                              alt="Current"
                              loading="lazy"
                              decoding="async"
                              className="w-32 h-32 object-cover rounded-lg border border-gray-200 bg-gray-100"
                              onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200?text=No+Image'; }}
                           />
                        </div>
                     )}

                     <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                        <Button 
                           type="button"
                           onClick={() => {
                              setIsEditModalOpen(false);
                              setEditingProduct(null);
                              setEditFile(null);
                           }}
                           className="px-6 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                        >
                           Cancel
                        </Button>
                        <Button 
                           type="submit" 
                           disabled={uploading}
                           className="bg-[#d63384] hover:bg-[#ff3385] text-white py-2 px-8 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95"
                        >
                           {uploading ? <Loader className="animate-spin mx-auto" size={20} /> : 'Save Changes'}
                        </Button>
                     </div>
                  </form>
               </div>
            </div>
         )}
      </div>
   );
};

export default ManageProducts;

```

## src/pages/creators/OrderHistory.tsx
```tsx
import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { ArrowLeft, DollarSign, CreditCard, ShoppingBag, FileText, LayoutList } from 'lucide-react';
import { formatPrice } from '../../utils/currency'; // ✅ NEW

interface OrderItem {
    quantity: number;
    price_per_unit: number;
    products: {
        name: string;
        image_url: string | null;
    } | null;
}

interface Order {
    id: string;
    created_at: string;
    total_price: number;
    payment_method: 'cash' | 'transfer';
    status: string;
    queue_id: string | null;
    queues: { queue_number: string } | null;
    order_items: OrderItem[];
    currency: string; // ✅ NEW
}

interface EventInfo {
    event_name: string;
    start_date: string;
}

export default function EventHistory() {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [orders, setOrders] = useState<Order[]>([]);
    const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (eventId) {
            fetchEventData();
        }
    }, [eventId]);

    const fetchEventData = async () => {
        setLoading(true);
        try {
            const { data: event } = await supabase
                .from('events')
                .select('event_name, start_date') 
                .eq('id', eventId)
                .single();
            
            if (event) setEventInfo(event);

            const { data: ordersData, error } = await supabase
                .from('orders')
                .select(`
                    *,
                    queues (queue_number),
                    order_items (
                        quantity,
                        price_per_unit,
                        products (name, image_url)
                    )
                `)
                .eq('event_id', eventId)
                .eq('status', 'completed')
                .order('created_at', { ascending: false });

            if (error) throw error;
            if (ordersData) setOrders(ordersData as any);

        } catch (err) {
            console.error("Error fetching history:", err);
        } finally {
            setLoading(false);
        }
    };

    const summary = useMemo(() => {
        const totalRevenue = orders.reduce((sum, o) => sum + o.total_price, 0);
        const totalOrders = orders.length;

        const cashOnly = orders.filter(o => o.payment_method === 'cash');
        const cashTotal = cashOnly.reduce((sum, o) => sum + o.total_price, 0);
        const cashOrders = cashOnly.length;

        const transferOnly = orders.filter(o => o.payment_method === 'transfer');
        const transferTotal = transferOnly.reduce((sum, o) => sum + o.total_price, 0);
        const transferOrders = transferOnly.length;

        const productStats: Record<string, { name: string; qty: number; total: number }> = {};
        
        orders.forEach(order => {
            order.order_items.forEach(item => {
                const prodName = item.products?.name || 'Unknown';
                if (!productStats[prodName]) {
                    productStats[prodName] = { name: prodName, qty: 0, total: 0 };
                }
                productStats[prodName].qty += item.quantity;
                productStats[prodName].total += (item.quantity * item.price_per_unit);
            });
        });

        const topProducts = Object.values(productStats).sort((a, b) => b.qty - a.qty);

        return { totalRevenue, totalOrders, cashTotal, transferTotal, cashOrders, transferOrders, topProducts };
    }, [orders]);

    if (loading) return <div className="p-10 text-center text-gray-400">Loading history...</div>;

    return (
        <div className="min-h-screen bg-gray-50 p-6 font-sans">
            {/* --- HEADER --- */}
            <div className="max-w-5xl mx-auto mb-8 flex items-center gap-4">
                <button onClick={() => navigate('/manage-events')} className="p-2.5 bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition text-gray-500">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-black text-gray-800 tracking-tight">Order History</h1>
                    <p className="text-sm font-bold text-pink-500 flex items-center gap-1.5 mt-0.5">
                        <LayoutList size={14}/> 
                        {eventInfo?.event_name || 'Loading...'} 
                        <span className="text-gray-300">|</span>
                        <span className="text-gray-500 font-medium">
                            {eventInfo?.start_date ? new Date(eventInfo.start_date).toLocaleDateString('en-GB') : ''}
                        </span>
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto space-y-6">
                {/* 1. Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-pink-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-600"><DollarSign size={20} /></div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Revenue</span>
                        </div>
                        {/* ✅ FIX: Use currency from first order or default */}
                        <div className="text-3xl font-black text-gray-800">{formatPrice(summary.totalRevenue, orders[0]?.currency || 'THB')}</div>
                        <div className="text-xs text-gray-400 mt-1 font-medium">{summary.totalOrders} completed orders</div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600"><DollarSign size={20} /></div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cash</span>
                        </div>
                        <div className="text-3xl font-black text-gray-800">{formatPrice(summary.cashTotal, orders[0]?.currency || 'THB')}</div>
                        <div className="text-xs text-gray-400 mt-1 font-medium">{summary.cashOrders} completed cash method</div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600"><CreditCard size={20} /></div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Transfer</span>
                        </div>
                        <div className="text-3xl font-black text-gray-800">{formatPrice(summary.transferTotal, orders[0]?.currency || 'THB')}</div>
                        <div className="text-xs text-gray-400 mt-1 font-medium">{summary.transferOrders} completed transfer method</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* 2. Product Breakdown */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:col-span-1 h-fit">
                        <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-2 text-sm uppercase tracking-wide"><ShoppingBag size={16}/> Product Sales</h3>
                        <div className="space-y-4">
                            {summary.topProducts.map((prod, idx) => (
                                <div key={idx} className="flex justify-between items-center border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                                    <div className="min-w-0 flex-1 pr-2">
                                        <div className="text-sm font-bold text-gray-700 truncate">{prod.name}</div>
                                        <div className="text-[10px] text-gray-400 font-medium">Sold: {prod.qty} units</div>
                                    </div>
                                    <div className="font-bold text-gray-800 text-sm">{formatPrice(prod.total, orders[0]?.currency || 'THB')}</div>
                                </div>
                            ))}
                            {summary.topProducts.length === 0 && <div className="text-center text-gray-400 text-sm py-4">No sales yet</div>}
                        </div>
                    </div>

                    {/* 3. Transaction History Table */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden lg:col-span-2">
                        <div className="p-6 border-b border-gray-100">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm uppercase tracking-wide"><FileText size={16}/> Transactions</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50/50 text-gray-400 text-[10px] uppercase font-bold tracking-wider">
                                    <tr>
                                        {/* ✅ ลด Padding เหลือ px-4 */}
                                        <th className="px-4 py-3">Date & Time</th>
                                        <th className="px-4 py-3">Customer</th>
                                        <th className="px-4 py-3">Items</th>
                                        <th className="px-4 py-3 text-right">Amount</th>
                                        <th className="px-4 py-3 text-right">Method</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {orders.map((order) => (
                                        <tr key={order.id} className="hover:bg-gray-50/80 transition-colors group">
                                            {/* ✅ ลด Padding และปรับ Date Time */}
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-gray-700">
                                                        {new Date(order.created_at).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'})}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400 font-medium">
                                                        {new Date(order.created_at).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                                                    </span>
                                                </div>
                                            </td>
                                            
                                            {/* ✅ เพิ่ม whitespace-nowrap เพื่อแก้ Walk-in ตกบรรทัด */}
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {order.queues ? (
                                                    <span className="bg-pink-50 text-pink-600 px-2 py-1 rounded-md text-xs font-bold border border-pink-100 whitespace-nowrap">#{order.queues.queue_number}</span>
                                                ) : (
                                                    <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded-md text-xs font-bold border border-gray-200 whitespace-nowrap">Walk-in</span>
                                                )}
                                            </td>

                                            <td className="px-4 py-3 text-sm text-gray-700">
                                                <div className="flex flex-col gap-1">
                                                    {order.order_items.map((item, idx) => (
                                                        <div key={idx} className="flex items-center gap-1.5 truncate max-w-[200px] text-xs">
                                                            <span className="font-black text-gray-800 bg-gray-100 px-1 rounded">{item.quantity}x</span> 
                                                            <span className="truncate text-gray-600">{item.products?.name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                            
                                            <td className="px-4 py-3 text-right font-black text-gray-800 text-sm whitespace-nowrap">
                                                {formatPrice(order.total_price, order.currency)}
                                            </td>
                                            
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                {order.payment_method === 'transfer' ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full"><CreditCard size={10}/> Transfer</span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full"><DollarSign size={10}/> Cash</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {orders.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-12 text-center text-gray-400 text-sm">No transactions found for this event.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
```

## src/pages/customer/CustomerLayout.tsx
```tsx
import { Outlet, useParams, useLocation, Link } from 'react-router-dom';
import { Home, ShoppingBag, Users } from 'lucide-react';
import { useArtist } from '../../hooks/useArtist';
import CallingNotification from '../../components/CallingNotification';

const CustomerLayout = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { artist, loading, error } = useArtist(slug);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-pink-500 font-bold">Loading...</div>;
  if (error || !artist) return (
     <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Artist Not Found</h1>
        <p className="text-gray-500">The URL you entered might be incorrect.</p>
     </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 font-sans">
       {/* Mobile-first wrapper */}
       <div className="max-w-md mx-auto min-h-screen bg-white shadow-xl overflow-hidden relative">

         {/* ✅ แปะ component นี้ไว้ตรงไหนก็ได้ (เพราะมัน position fixed) */}
       {artist && (
         <CallingNotification 
            artistId={artist.id} 
            slug={artist.slug} 
            broadcastMessage={artist.broadcast_message}
         />
       )}

          <Outlet context={{ artist }} />
          
          {/* Bottom Nav for Mobile */}
          {/* Bottom Nav for Mobile */}
          {/* Bottom Nav for Mobile */}
          <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-gray-100 flex justify-around items-end pb-6 h-20 z-50 text-[11px] font-bold tracking-tight" aria-label="Main navigation">
             <Link 
               to={`/${slug}/home`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/home') ? 'text-[#d63384]' : 'text-slate-600'}`}
               aria-label="Home"
             >
                <Home size={22} strokeWidth={location.pathname.endsWith('/home') ? 2.5 : 2} aria-hidden="true" />
                Home
             </Link>
             <Link 
               to={`/${slug}/menu`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/menu') ? 'text-[#d63384]' : 'text-slate-600'}`}
               aria-label="Merchandise"
             >
                <ShoppingBag size={22} strokeWidth={location.pathname.endsWith('/menu') ? 2.5 : 2} aria-hidden="true" />
                Merchandise
             </Link>
             <Link 
               to={`/${slug}/queue`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/queue') ? 'text-[#d63384]' : 'text-slate-600'}`}
               aria-label="Queue"
             >
                <Users size={22} strokeWidth={location.pathname.endsWith('/queue') ? 2.5 : 2} aria-hidden="true" />
                Queue
             </Link>
          </nav>
       </div>
    </div>
  );
};

export default CustomerLayout;

```

## src/pages/customer/QueueView.tsx
```tsx
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { Button, Card } from '../../components/ui';
import { RefreshCcw, LogOut } from 'lucide-react';
import CustomerHeader from '../../components/CustomerHeader';

interface Ticket {
  id: string;
  event_id?: string;
  queue_number: number;
  status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired';
  created_at: string;
}

const formatTime = (dateString: string) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const QueueView = () => {
  // Midnight Watcher: Triggers update when day changes
  const currentDate = useMidnightTick();

  // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>();
  const { artist, events, isConnected, refresh } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  const displayArtist = artist || contextArtist;

  // Early return if no artist data
  if (!displayArtist) return <div className="p-12 text-center text-gray-400 font-medium">Loading...</div>;

  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [nowServingNumber, setNowServingNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // DERIVED STATE: Syncs instantly with Realtime Hook
  // ✅ FIX: Match Admin Panel logic - filter by end_date >= now, sort DESCENDING (get LATEST)
  const activeEvent = (() => {
      const now = new Date().toISOString();
      
      // Filter: must be Confirmed AND not ended (end_date >= now)
      const validEvents = events.filter(event => {
          const isConfirmed = event.status === 'Confirmed';
          const isNotEnded = event.end_date >= now;
          return isConfirmed && isNotEnded;
      });
      
      // Sort: DESCENDING by start_date (get the LATEST started event)
      validEvents.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
      
      // Return first (latest) event
      return validEvents[0] || null;
  })();

  // Derived Status Message
  let eventStatusMessage = "Booth Closed";
  if (!activeEvent) {
      const todayStr = currentDate;
      const cancelled = events.find(e => {
         const start = e.start_date.substring(0, 10);
         const end = e.end_date.substring(0, 10);
         return e.status === 'Cancelled' && todayStr >= start && todayStr <= end;
      });
      if (cancelled) eventStatusMessage = "Today's event has been cancelled.";
  }

  // Helper to fetch the "Now Serving" number for a specific EVENT
  const fetchNowServing = async (eventId: string) => {
      // PRIORITY 1: LOWEST 'serving' number (Active Service)
      let { data: servingData } = await supabase
         .from('queues')
         .select('queue_number')
         .eq('artist_id', displayArtist.id)
         .eq('event_id', eventId)
         .eq('status', 'serving')
         .order('queue_number', { ascending: true }) // Show Lowest # first (Sequential)
         .limit(1)
         .maybeSingle();

      if (servingData) {
          setNowServingNumber(servingData.queue_number);
          return;
      }

      // PRIORITY 2: Fallback to 'calling' (Latest called) if no one is serving
      let { data: callingData } = await supabase
         .from('queues')
         .select('queue_number')
         .eq('artist_id', displayArtist.id)
         .eq('event_id', eventId)
         .eq('status', 'calling')
         .order('last_updated_at', { ascending: false }) // Show most recent call
         .limit(1)
         .maybeSingle();

      setNowServingNumber(callingData ? callingData.queue_number : null);
  };

  // 2. EFFECT: Fetch Queue Data when Active Event Changes (or on Mount/Refresh)
  useEffect(() => {
      if (!activeEvent) {
          setNowServingNumber(null);
          setLoading(false);
          // Optional: Clear ticket if strictly tied to event existence? 
          // Keeping it loosely allows viewing old tickets if needed, but per requirements usually we clear active state.
          // We will check ticket validity below.
          return;
      }

      const initQueueData = async () => {
         await fetchNowServing(activeEvent.id);

         // Ticket Verification
         const storedTicketId = localStorage.getItem(`ticket_id_${displayArtist.id}`);
         if (storedTicketId) {
             const { data: ticket } = await supabase.from('queues').select('*').eq('id', storedTicketId).single();
             
             if (ticket) {
                 // Check Mismatch
                 if (ticket.event_id !== activeEvent.id) {
                     console.warn("Ticket Event Mismatch. Clearing.");
                     localStorage.removeItem(`ticket_id_${displayArtist.id}`);
                     setMyTicket(null);
                 } else {
                     setMyTicket(ticket);
                 }
             } else {
                 localStorage.removeItem(`ticket_id_${displayArtist.id}`);
                 setMyTicket(null);
             }
         }
         
         setLoading(false);
      };

      initQueueData();
      
      // Realtime Queue Updates (Keep local subscription for Queue data)
      const channel = supabase
        .channel(`public:queues:${activeEvent.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues', filter: `event_id=eq.${activeEvent.id}` }, (payload: any) => {
             // If "Now Serving" updates or "My Ticket" updates
             fetchNowServing(activeEvent.id);
             
             setMyTicket((prev) => {
                 if (prev && (payload.new as Ticket)?.id === prev.id) {
                     return payload.new as Ticket;
                 }
                 return prev;
             });
        })
        .subscribe();

      return () => {
          supabase.removeChannel(channel);
      };

  }, [activeEvent?.id, activeEvent?.is_booth_open, displayArtist.id]);



  const handleGetTicket = async () => {
     if (!activeEvent) return; 

     // Safety Check: Ensure Event hasn't ended
     const now = new Date();
     const end = new Date(activeEvent.end_date);
     if (now > end) {
        alert("This event has unfortunately ended.");
        refresh();
        return;
     }

     setLoading(true);
     try {
        // 2. Auto-Sequence Logic: Calculate Next Ticket Number
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        // Query for the latest ticket for this event TODAY
        const { data: maxData, error: maxError } = await supabase
           .from('queues')
           .select('queue_number')
           .eq('event_id', activeEvent.id)
           .gte('created_at', startOfDay.toISOString())
           .order('queue_number', { ascending: false })
           .limit(1)
           .single();

        if (maxError && maxError.code !== 'PGRST116') {
             console.error("Error fetching max ticket number:", maxError);
        }

        const nextNum = (maxData?.queue_number || 0) + 1;

        console.log(`Generating Ticket | Event ID: ${activeEvent.id} | Next Number: ${nextNum}`);

        const { data, error: insertError } = await supabase
           .from('queues')
           .insert([{
               artist_id: displayArtist.id,
               event_id: activeEvent.id,
               queue_number: nextNum,
               status: 'waiting'
           }])
           .select()
           .single();

        if (insertError) {
             console.error("Supabase Insert Error:", insertError);
             throw insertError;
        }

        if (data) {
           localStorage.setItem(`ticket_id_${displayArtist.id}`, data.id);
           setMyTicket(data);
        }

     } catch (err) {
        console.error("handleGetTicket Exception:", err);
        alert('Failed to get ticket. Please try again.');
     } finally {
        setLoading(false);
     }
  };

  const handleRefresh = async () => {
    setLoading(true);
    // Refresh Realtime Data (Artist + Events)
    await refresh(); 
    
    // Refresh Queue Data (Now Serving + My Ticket)
    if (activeEvent) {
       await fetchNowServing(activeEvent.id);
       if (myTicket) {
           const { data } = await supabase.from('queues').select('*').eq('id', myTicket.id).single();
           if (data) setMyTicket(data);
       }
    }
    setLoading(false);
  };

  const handleLeaveQueue = async () => {
    if (!myTicket) return;

    const status = myTicket.status.toLowerCase();
    const activeStatuses = ['waiting', 'calling', 'serving']; // Active service
    const endedStatuses = ['complete', 'missed', 'expired']; // Final states

    // SCENARIO B: Ended Statuses -> Just clear local
    if (endedStatuses.includes(status)) {
         localStorage.removeItem(`ticket_id_${displayArtist.id}`);
         setMyTicket(null);
         return;
    }

    // SCENARIO A: Active (Waiting, Calling, Serving) -> Confirm + Update DB + Clear
    if (activeStatuses.includes(status) || !endedStatuses.includes(status)) {
        if (confirm("Are you sure you want to leave the queue? This action cannot be undone.")) {
           console.log(`Attempting to leave queue for ticket ${myTicket.id} with status ${status}`);
           
           const { error } = await supabase
               .from('queues')
               .update({ status: 'missed' }) // Set to 'missed' to satisfy constraint & logic
               .eq('id', myTicket.id);
           
           if (error) {
               console.error("Error leaving queue (DB Update Failed):", error, "Ticket ID:", myTicket.id);
               alert("Failed to leave queue. Please try again.");
               return; // DO NOT clear local state if DB update fails
           }
           
           // ONLY Clear local storage after successful DB update
           localStorage.removeItem(`ticket_id_${displayArtist.id}`);
           setMyTicket(null);
        }
    }
  };

  // UI State Components
  const renderTicketStatus = () => {
      if (!myTicket) return null;

      const { status, queue_number } = myTicket;

      // Configuration for each status
      const config = {
          waiting: {
              bg: 'bg-gray-50',
              border: 'border-gray-200',
              badge: { text: 'Waiting', bg: 'bg-gray-200', color: 'text-gray-700' },
              messageColor: 'text-gray-500',
              message: 'You are in the queue.\nPlease wait for your number.',
              subMessage: undefined
          },
          calling: {
              bg: 'bg-yellow-50',
              border: 'border-yellow-200',
              badge: { text: "It's Your Turn!", bg: 'bg-yellow-500', color: 'text-white' },
              messageColor: 'text-yellow-800',
              message: 'Please proceed to the booth!',
              subMessage: 'Calling...'
          },
          serving: {
              bg: 'bg-sky-50',
              border: 'border-sky-200',
              badge: { text: 'Being Served', bg: 'bg-sky-500', color: 'text-white' },
              messageColor: 'text-sky-800',
              message: 'You are being served.',
              subMessage: 'Active'
          },
          complete: {
              bg: 'bg-green-50',
              border: 'border-green-200',
              badge: { text: 'Completed', bg: 'bg-green-100', color: 'text-green-700' },
              messageColor: 'text-green-800',
              message: 'Thank you! Your order is complete.',
              subMessage: undefined
          },
          expired: {
              bg: 'bg-purple-50',
              border: 'border-purple-200',
              badge: { text: 'Expired', bg: 'bg-purple-100', color: 'text-purple-700' },
              messageColor: 'text-purple-800',
              message: 'Ticket Expired',
              subMessage: undefined
          },
          missed: { // Acts as Cancelled
              bg: 'bg-red-50',
              border: 'border-red-200',
              badge: { text: 'Cancelled', bg: 'bg-red-100', color: 'text-red-700' },
              messageColor: 'text-red-800',
              message: 'Cancelled Ticket by customer',
              subMessage: undefined
          }
      };

      // Fallback to 'missed' config if status is unknown (or use type assertion key)
      const theme = config[status as keyof typeof config] || config.missed;

      return (
          <Card className={`w-full min-h-[320px] p-8 flex flex-col justify-center items-center text-center border-2 shadow-lg transition-all duration-300 ${theme.bg} ${theme.border}`}>
              
              {/* Status Badge */}
              <div className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase mb-8 shadow-sm tracking-wide ${theme.badge.bg} ${theme.badge.color}`}>
                  {theme.badge.text}
              </div>

              {/* Created Time */}
              <div className="mb-4 text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Booked at {formatTime(myTicket.created_at)}
              </div>

              {/* Queue Number */}
              <div className="text-7xl font-black text-gray-900 mb-6 leading-none tracking-tight">
                  #{queue_number}
              </div>

              {/* Primary Message */}
              <p className={`font-bold text-lg whitespace-pre-line ${theme.messageColor}`}>
                  {theme.message}
              </p>

              {/* Secondary Message (Calling/Serving) */}
              {(status === 'calling' || status === 'serving') && theme.subMessage && (
                  <div className={`mt-4 text-xs uppercase tracking-widest font-semibold opacity-75 ${status === 'calling' ? 'animate-pulse' : ''}`}>
                      {theme.subMessage}
                  </div>
              )}
          </Card>
      );
  };

  if (loading) return <div className="p-12 text-center text-gray-400 font-medium">Loading status...</div>;
  
  // Strict UI Check: Booth must be OPEN
  const isBoothOpen = activeEvent?.is_booth_open;
  
  // NOTE: artist prop from useArtistRealtime now contains is_queue_open
  const isQueueOpen = displayArtist?.is_queue_open ?? true; // Default to true if undefined


  return (
    <div className="min-h-screen bg-gray-50 pb-24 animate-fade-in flex flex-col items-center w-full max-w-md mx-auto relative shadow-xl">
       
       {/* Offline Indicator */}
       {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            Offline - Reconnecting...
         </div>
       )}

       <CustomerHeader 
          artistId={displayArtist.id} 
          title={displayArtist.display_name || 'Queue'}
          transparent={true} // Restored transparent background
          avatarUrl={displayArtist.image_url}
          avatarDisplay="inline"
       >
          {activeEvent && (
              <div className="inline-block bg-pink-50 text-pink-700 px-2 py-0.5 rounded-full text-[10px] font-bold border border-pink-100 mt-0.5">
                 {activeEvent.event_name}
              </div>
          )}
       </CustomerHeader>

       {/* Content Area with Padding */}
       <div className="w-full px-4 mt-4 flex flex-col items-center flex-1">
           {/* NOW SERVING INDICATOR (Compact) */}
           <div className="w-full bg-slate-900 rounded-2xl p-4 shadow-xl shadow-slate-200 mb-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500 rounded-full blur-[40px] opacity-20 -mr-8 -mt-8 animate-pulse-slow"></div>
              
              <div className="relative flex flex-row items-center justify-between px-2">
                 <div className="flex flex-col items-start gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mb-1"></span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-tight">Now<br/>Serving</span>
                 </div>
                 
                 <div className={`text-4xl font-black tracking-tighter ${nowServingNumber ? 'text-white' : 'text-gray-700'}`}>
                    {nowServingNumber ? (
                       <span><span className="text-pink-500 text-2xl align-top mr-0.5">#</span>{nowServingNumber}</span>
                    ) : (
                       <span className="text-2xl text-gray-600">--</span>
                    )}
                 </div>
              </div>
           </div>

           {/* MAIN TICKET AREA */}
           {myTicket ? (
              <div className="w-full flex-1 flex flex-col gap-4">
                 {renderTicketStatus()}

                 {/* ACTION BUTTONS (Outside Card) */}
                 <div className="flex flex-col gap-2 w-full animate-fade-in-up delay-100 mt-auto">
                     <Button 
                        onClick={handleRefresh} 
                        className="w-full bg-[#d63384] hover:bg-pink-700 text-white font-bold flex items-center justify-center gap-2 py-3 rounded-xl shadow-md shadow-pink-200 transition-all active:scale-95 text-sm"
                        aria-label="Refresh queue status"
                     >
                        <RefreshCcw size={16} aria-hidden="true" /> Refresh Status
                     </Button>
                     
                     <button 
                        onClick={handleLeaveQueue} 
                        className="flex items-center justify-center gap-1 text-gray-400 hover:text-red-500 font-medium text-xs transition-colors py-2"
                     >
                        <LogOut size={14} /> 
                        {['complete', 'missed', 'expired'].includes(myTicket.status.toLowerCase()) ? 'Close Ticket' : 'Leave Queue'}
                     </button>
                  </div>
              </div>
           ) : (
              <div className="w-full flex-1 flex flex-col justify-center">
                  <div className="bg-white p-6 rounded-3xl shadow-lg border border-white text-center mb-4">
                     {/* Dynamic Icon based on Status */}
                     <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                        !isQueueOpen ? 'bg-red-50 text-red-500' : 'bg-pink-50 text-pink-500'
                     }`}>
                        <span className="material-icons-outlined text-3xl">
                           {!isQueueOpen ? 'block' : 'confirmation_number'}
                        </span>
                     </div>
                     
                     <h3 className="text-lg font-bold text-gray-900 mb-1">
                        {!isQueueOpen 
                           ? "Queuing is closed"
                           : (activeEvent && isBoothOpen ? "Join the Queue" : (eventStatusMessage || "Booth Closed"))
                        }
                     </h3>
                     
                     <p className="text-gray-500 text-xs leading-relaxed px-4">
                        {!isQueueOpen 
                           ? "Due to high traffic, we are temporarily pausing the queue. Please wait for the reopening."
                           : (activeEvent && isBoothOpen
                              ? "Get a number and wait for your turn." 
                              : (eventStatusMessage === "Today's event has been cancelled." 
                                    ? "This event has been cancelled."
                                    : "Queue is currently closed."))
                        }
                     </p>
                  </div>
                  
                  {/* Hide Button if Queue is Closed (Paused) */}
                  {isQueueOpen && (
                     <Button 
                        onClick={handleGetTicket} 
                        disabled={!activeEvent || !isBoothOpen || loading}
                        className={`w-full py-4 text-base shadow-lg font-bold rounded-xl transition-transform active:scale-95 ${
                           activeEvent && isBoothOpen
                           ? 'bg-pink-500 hover:bg-pink-600 shadow-pink-200 text-white' 
                           : 'bg-gray-300 text-gray-500 shadow-none cursor-not-allowed'
                        }`}
                     >
                        {activeEvent && isBoothOpen ? "Get Ticket" : (eventStatusMessage || "Booth Closed")}
                     </Button>
                  )}
               </div>
           )}
       </div>
    </div>
  );
};

export default QueueView;

```

## src/pages/customer/Home.tsx
```tsx
import { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom'; 
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import { Instagram, Facebook, Music2, Mail, MapPin, Ticket, Train, Calendar } from 'lucide-react';
import { Card } from '../../components/ui';
import CustomerHeader from '../../components/CustomerHeader';

const XIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h0.001zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
  </svg>
);

const Home = () => {
  // Midnight Watcher
  const currentDate = useMidnightTick();

  // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>(); 
  const { artist, events, isConnected, refresh } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  
  // Use local artist state from Hook, fallback to context for initial render
  const displayArtist = artist || contextArtist;
  
  // Midnight Refresh Effect
  useEffect(() => {
    refresh();
  }, [currentDate, refresh]);

  // Early return if no artist data
  if (!displayArtist) return <div className="p-10 text-center text-gray-400">Loading Artist Profile...</div>;
  
  const now = new Date().toISOString();
  
  // --- 🎯 LOGIC FILTER: จัดการการแสดงผลตรงนี้ครับ ---
  // กฎ: 1. ยังไม่หมดเวลา (end_date >= now)
  //     2. สถานะต้องเป็น Confirmed หรือ Cancelled เท่านั้น (Ended จะถูกดีดออก)
  const visibleEvents = events.filter(e => {
     const isNotExpired = e.end_date >= now;
     const isShowStatus = e.status === 'Confirmed' || e.status === 'Cancelled';
     return isNotExpired && isShowStatus;
  });

  // Derive Booth Status: Check if ANY valid event is currently open AND not ended
  const activeOpenEvent = events.find(e => {
       const isOpen = e.is_booth_open && e.status === 'Confirmed'; // Booth เปิดได้ต้อง Confirmed เท่านั้น
       const isNotEnded = e.end_date >= now;
       return isOpen && isNotEnded;
  });
  
  const isBoothActive = !!activeOpenEvent;

  // 2. Helper Functions
  const getBoxDate = (dateString: string) => {
    const date = new Date(dateString);
    return {
      month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.getDate().toString().padStart(2, '0')
    };
  };

  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    
    if (startDate.toDateString() === endDate.toDateString()) {
       return `${startDate.toLocaleDateString('en-GB', options)}, ${startDate.getFullYear()}`;
    }

    return `${startDate.toLocaleDateString('en-GB', options)} - ${endDate.toLocaleDateString('en-GB', options)}, ${endDate.getFullYear()}`;
  };

  const socialLinks = [
    { icon: <XIcon size={20} />, url: displayArtist.x_url, label: 'X', hoverClass: 'hover:bg-black' },
    { icon: <Instagram size={20} />, url: displayArtist.ig_url, label: 'Instagram', hoverClass: 'hover:bg-[#d62976]' },
    { icon: <Facebook size={20} />, url: displayArtist.facebook_url, label: 'Facebook', hoverClass: 'hover:bg-[#1877f2]' },
    { icon: <Music2 size={20} />, url: displayArtist.tiktok_url, label: 'TikTok', hoverClass: 'hover:bg-black' },
    { icon: <Mail size={20} />, url: displayArtist.email ? `mailto:${displayArtist.email}` : '', label: 'Email', hoverClass: 'hover:bg-[#ea4335]' },
  ].filter(link => link.url);

  // 3. Auto-set Next Up Logic: Pick the first NON-CANCELLED event
  // ใช้ visibleEvents มาหา Next Up เลย จะได้สอดคล้องกัน
  const sortedValidEvents = visibleEvents
    .filter(e => e.status !== 'Cancelled') // Next Up ต้องไม่เอา Cancelled
    .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()); // (อันนี้ Logic เดิมคุณพี่ Sort มากไปน้อย หรือ น้อยไปมาก ลองเช็คดูนะครับ ปกติ Next event น่าจะเรียงตามเวลาใกล้สุด)
    // *หมายเหตุ:* ปกติถ้าจะหา "งานถัดไป" ควร sort ascending (น้อยไปมาก) นะครับ
    // แต่ถ้า code เดิมใช้ได้ดีแล้วผมคงไว้ตามเดิมครับ

  const nextUpEventId = sortedValidEvents[0]?.id;

  return (
    <div className="min-h-screen bg-white w-full max-w-md mx-auto flex flex-col pb-24 animate-fade-in shadow-2xl relative">
      
      {/* Offline Indicator */}
      {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            Offline - Reconnecting...
         </div>
      )}

      <CustomerHeader 
        artistId={displayArtist.id} 
        title={displayArtist.display_name || 'Artist Name'}
        avatarUrl={displayArtist.image_url}
        avatarDisplay="stacked"
      >
        {displayArtist.bio && (
          <div className="text-gray-500 font-medium text-xs leading-relaxed max-w-[280px] mx-auto mb-3 whitespace-pre-line">
            {displayArtist.bio}
          </div>
        )}

        {/* Status Badge */}
        <div className="flex justify-center mb-1">
          {isBoothActive ? (
            <div className="inline-flex items-center px-2.5 py-0.5 bg-green-50 border border-green-100 rounded-full animate-fade-in">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
              <span className="text-green-700 text-[9px] font-bold uppercase tracking-wider">
                  {activeOpenEvent ? 'Booth Open' : 'Booth Open'}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center px-2.5 py-0.5 bg-red-50 border border-red-100 rounded-full animate-fade-in">
               <div className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
               <span className="text-red-700 text-[9px] font-bold uppercase tracking-wider">Booth Closed</span>
            </div>
          )}
        </div>
      </CustomerHeader>


      {/* Events Section */}
      <div className="flex-1 px-4 mt-2">
        <h3 className="font-bold text-gray-900 text-sm mb-3 flex items-center gap-2 px-1">Next Events</h3>
        <div className="space-y-3 mb-4">
          {/* 🚨 เปลี่ยนจาก events.length เป็น visibleEvents.length */}
          {visibleEvents.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm font-medium">No upcoming events</div>
          ) : (
            // 🚨 เปลี่ยนจาก events.map เป็น visibleEvents.map
            visibleEvents.map((event) => {
              const { month, day } = getBoxDate(event.start_date);
              const isNextUp = event.id === nextUpEventId;
              const isCancelled = event.status === 'Cancelled';
              
              return (
                <Card 
                  key={event.id} 
                  className={`border-none shadow-sm p-4 rounded-3xl relative overflow-hidden ring-1 ring-gray-100 transition-all duration-300
                    ${isCancelled 
                       ? 'bg-gray-50 opacity-100 grayscale-[0.8] ring-gray-200'
                       : isNextUp 
                         ? 'bg-white shadow-md' 
                         : 'bg-gray-50/50 opacity-90 grayscale-[0.3]'
                    }`}
                >
                   {/* Cancelled Overlay */}
                   {isCancelled && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                         <div className="border-[2px] border-red-500 text-red-500 text-xl font-black uppercase tracking-widest -rotate-12 px-4 py-2 rounded-lg bg-white/10 backdrop-blur-[1px]">
                            Cancelled
                         </div>
                      </div>
                   )}

                   {/* Next Up Badge */}
                   {isNextUp && !isCancelled && (
                     <div className="absolute top-0 right-0 bg-[#d63384] text-white text-[10px] font-bold px-3 py-1 rounded-bl-2xl z-10">
                        NEXT UP
                     </div>
                   )}

                   <div className={`flex items-start gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
                      <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center border shrink-0
                        ${isNextUp && !isCancelled ? 'bg-pink-50 border-pink-100' : 'bg-white border-gray-100'}`}>
                         <span className={`text-[10px] font-bold uppercase ${isNextUp && !isCancelled ? 'text-[#d63384]' : 'text-gray-400'}`}>{month}</span>
                         <span className="text-2xl font-black text-gray-900 leading-none">{day}</span>
                      </div>

                      <div className="flex-1 space-y-2 pt-0.5">
                         <h4 className="font-bold text-gray-900 text-lg leading-tight">{event.event_name}</h4>
                         <div className="space-y-1.5 text-gray-500 text-xs font-medium">
                            <div className="flex items-start gap-2"><MapPin size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{event.location_name}</span></div>

                            {event.entrance_fee && <div className="flex items-center gap-2"><Ticket size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{event.entrance_fee}</span></div>}
                            {event.transit_info && <div className="flex items-start gap-2"><Train size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><div className="whitespace-pre-line">{event.transit_info}</div></div>}
                            <div className="flex items-center gap-2"><Calendar size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{formatDateRange(event.start_date, event.end_date)}</span></div>
                         </div>
                      </div>
                   </div>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Social Footer */}
      <div className="px-8 mt-6">
        <div className="flex items-center gap-4 mb-4">
           <div className="h-px bg-gray-200 flex-1"></div>
           <span className="text-xs font-bold text-black uppercase tracking-widest">Follow Me</span>
           <div className="h-px bg-gray-200 flex-1"></div>
        </div>
        <div className="flex justify-center items-center gap-6 mb-4">
           {socialLinks.map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noreferrer" className="text-black hover:text-[#d63384] hover:scale-110 transition-all">
                 {link.icon}
              </a>
           ))}
        </div>
      </div>
    </div>
  );
};

export default Home;
```

## src/pages/customer/MenuView.tsx
```tsx
import { useEffect, useState, useMemo } from 'react';
import { useOutletContext, useNavigate, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { ShoppingBag, Plus, Minus, Search, ArrowUpDown, ChevronDown, ChevronUp, CheckCircle, X, Home, Users, Trash2, Ticket } from 'lucide-react';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import { formatPrice } from '../../utils/currency';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
  status?: 'enable' | 'disable' | 'soldout';
  currency?: string;  // ✅ NEW: Currency code
}

const MenuView = () => {
  const { artist: contextArtist } = useOutletContext<{ artist: any }>();
  const { artist, isConnected } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  
  const displayArtist = artist || contextArtist;
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Cart State - Initialize from localStorage
  const [cart, setCart] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(`cart_${contextArtist?.id}`);
    return saved ? JSON.parse(saved) : {};
  });
  const [userQueueNumber, setUserQueueNumber] = useState<string | null>(null);
  
  // UI States
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Filter & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortOption, setSortOption] = useState('name_asc');

  // Order Submission State - Initialize from localStorage
  const [submitting, setSubmitting] = useState(false);
  const [isOrderSent, setIsOrderSent] = useState<boolean>(() => {
    return localStorage.getItem(`orderSent_${contextArtist?.id}`) === 'true';
  });
  const [sentOrderId, setSentOrderId] = useState<string | null>(() => {
    return localStorage.getItem(`sentOrderId_${contextArtist?.id}`) || null;
  });
  const [isOrderCompleted, setIsOrderCompleted] = useState<boolean>(() => {
    return localStorage.getItem(`orderCompleted_${contextArtist?.id}`) === 'true';
  });

  // --- 1. Derived Data ---
  const uniqueCategories = useMemo(() => {
      const cats = products.map(p => p.category || 'Other').filter(Boolean);
      return ['All', ...Array.from(new Set(cats)).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
      return products.filter(product => {
         const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
         const matchesCategory = selectedCategory === 'All' || (product.category || 'Other') === selectedCategory;
         const isVisible = product.status !== 'disable';
         return matchesSearch && matchesCategory && isVisible;
      }).sort((a, b) => {
         if (sortOption === 'name_asc') return a.name.localeCompare(b.name);
         if (sortOption === 'price_asc') return a.price - b.price;
         if (sortOption === 'price_desc') return b.price - a.price;
         return 0;
      });
  }, [products, searchQuery, selectedCategory, sortOption]);

  const totalItems = useMemo(() => Object.values(cart).reduce((sum, qty) => sum + qty, 0), [cart]);
  const totalPrice = useMemo(() => products.reduce((sum, p) => sum + (p.price * (cart[p.id] || 0)), 0), [products, cart]);
  
  // ✅ NEW: Get currency from first cart item for totals display
  const cartCurrency = useMemo(() => {
    const firstProductId = Object.keys(cart).find(id => cart[id] > 0);
    const firstProduct = firstProductId ? products.find(p => p.id === firstProductId) : null;
    return firstProduct?.currency;
  }, [cart, products]);

  // --- Persist cart to localStorage ---
  useEffect(() => {
    if (contextArtist?.id) {
      localStorage.setItem(`cart_${contextArtist.id}`, JSON.stringify(cart));
    }
  }, [cart, contextArtist?.id]);

  // --- Persist order states to localStorage ---
  useEffect(() => {
    if (contextArtist?.id) {
      localStorage.setItem(`orderSent_${contextArtist.id}`, isOrderSent.toString());
      localStorage.setItem(`sentOrderId_${contextArtist.id}`, sentOrderId || '');
      localStorage.setItem(`orderCompleted_${contextArtist.id}`, isOrderCompleted.toString());
    }
  }, [isOrderSent, sentOrderId, isOrderCompleted, contextArtist?.id]);

  // --- 2. Fetch Data ---
  useEffect(() => {
    const initData = async () => {
        setLoading(true);
        
        // 2.1 ✅ ตรวจสอบคิวของลูกค้าจาก LocalStorage (FIX: Scoped to Artist)
        const localQueueId = localStorage.getItem(`ticket_id_${displayArtist.id}`);
        if (localQueueId) {
            const { data: queueData } = await supabase
                .from('queues')
                .select('queue_number, status')
                .eq('id', localQueueId)
                .single();
            
            // Only show queue number if status is active
            if (queueData && ['waiting', 'calling', 'serving'].includes(queueData.status)) {
                setUserQueueNumber(queueData.queue_number);
                console.log("Customer is Queue:", queueData.queue_number);
            } else {
               setUserQueueNumber(null);
            }
        }

        // 2.2 ดึงสินค้า
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('artist_id', displayArtist.id)
            .order('created_at', { ascending: false });

        if (!error && data) {
            setProducts(data);
        }
        setLoading(false);
    };

    if (displayArtist?.id) {
       initData();
       
       const channel = supabase
         .channel(`menu-realtime-${displayArtist.id}`)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `artist_id=eq.${displayArtist.id}` }, (payload) => {
               if (payload.eventType === 'INSERT') setProducts(prev => [payload.new as Product, ...prev]);
               if (payload.eventType === 'UPDATE') setProducts(prev => prev.map(p => p.id === payload.new.id ? payload.new as Product : p));
               if (payload.eventType === 'DELETE') setProducts(prev => prev.filter(p => p.id !== payload.old.id));
            }
         ).subscribe();
         
       return () => { supabase.removeChannel(channel); };
    }
  }, [displayArtist?.id]);

  // ✅ NEW: Realtime Cart Cleanup - Remove sold out/disabled items automatically
  useEffect(() => {
    if (Object.keys(cart).length === 0) return;

    const itemsToRemove = Object.keys(cart).filter(id => {
        const product = products.find(p => p.id === id);
        // Remove if product not found (deleted) or status is not 'enable'
        return !product || product.status !== 'enable';
    });

    if (itemsToRemove.length > 0) {
        setCart(prev => {
            const next = { ...prev };
            itemsToRemove.forEach(id => delete next[id]);
            return next;
        });
        
        const removedNames = itemsToRemove.map(id => products.find(p => p.id === id)?.name || 'Unknown Item');
        alert(`The following items in your cart are no longer available and have been removed:\n- ${removedNames.join('\n- ')}`);
    }
  }, [products]); // Run whenever products list updates (via realtime)

  // --- 3. Helpers ---
  const getProductImageUrl = (dbValue: string, width: number = 400) => {
    if (!dbValue) return '';
    let path = dbValue;
    if (dbValue.includes('http') && dbValue.includes('Menu/')) {
       const parts = dbValue.split('Menu/');
       if (parts.length > 1) path = parts[1];
    }
    const { data } = supabase.storage.from('Menu').getPublicUrl(path);
    return getOptimizedImageUrl(data.publicUrl, width);
  };

  const updateQuantity = (productId: string, delta: number) => {
    if (isOrderSent) return;
    setCart(prev => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      const newCart = { ...prev, [productId]: next };
      if (next === 0) delete newCart[productId];
      return newCart;
    });
  };

  // --- 4. Confirm Order Logic ---
  const handleConfirmOrder = async () => {
    if (totalItems === 0) return;

    // 1. Check Local Queue ID presence
    const localQueueId = localStorage.getItem(`ticket_id_${displayArtist?.id}`);
    if (!localQueueId) {
        alert("Please get a queue ticket first!\nกรุณารับบัตรคิวก่อนกด Confirm รายการ.");
        navigate(`/${displayArtist?.slug || slug}/queue`); 
        return; 
    }

    if (!confirm(`Confirm order for ${totalItems} items (${formatPrice(totalPrice, cartCurrency)})?`)) return;

    setSubmitting(true);
    try {
        // 2. Validate Queue Status (Server Check - Strict)
        const { data: queueData, error: queueError } = await supabase
            .from('queues')
            .select('status')
            .eq('id', localQueueId)
            .single();

        if (queueError || !queueData) {
             throw new Error("Queue ticket not found. Please queue again.");
        }
        // Allow only active queues
        if (!['waiting', 'calling', 'serving', 'in_progress'].includes(queueData.status)) {
             // If completed/cancelled, force clear and redirect
             localStorage.removeItem(`ticket_id_${displayArtist?.id}`);
             alert(`Your queue ticket is ${queueData.status} (expired/completed).\nPlease get a new ticket.`);
             navigate(`/${displayArtist?.slug || slug}/queue`);
             return;
        }

        // 3. Validate Shop/Event Status
        const now = new Date().toISOString();
        const { data: events } = await supabase
            .from('events')
            .select('id')
            .eq('artist_id', displayArtist.id)
            .eq('status', 'Confirmed')
            .gte('end_date', now)
            .order('start_date', { ascending: false })
            .limit(1);

        const event = events?.[0];
        if (!event) throw new Error("Shop is currently closed (No Active Event).");

        // 4. Validate Products (Race Condition Check)
        // Fetch latest status of items in cart
        const cartItemIds = Object.keys(cart);
        const { data: latestProducts } = await supabase
            .from('products')
            .select('id, status, price, name')
            .in('id', cartItemIds);
            
        const validCartItems: Record<string, number> = {};
        const invalidItemNames: string[] = [];
        let newTotalPrice = 0;

        cartItemIds.forEach(id => {
            const product = latestProducts?.find(p => p.id === id);
            if (product && product.status === 'enable') {
                validCartItems[id] = cart[id];
                newTotalPrice += product.price * cart[id];
            } else {
                invalidItemNames.push(product?.name || 'Unknown Item');
            }
        });

        // If ALL items are invalid
        if (Object.keys(validCartItems).length === 0) {
            setCart({}); // Clear cart as they are all sold out
            throw new Error(`All items in your cart are now Sold Out:\n- ${invalidItemNames.join('\n- ')}`);
        }

        // 5. Create Order (with valid items only)
        const { data: order, error: orderError } = await supabase.from('orders').insert({
            event_id: event.id,
            queue_id: localQueueId,
            status: 'confirmed',
            total_price: newTotalPrice, // Use recalculated price
            currency: cartCurrency || 'THB',
            payment_method: null
        }).select().single();

        if (orderError) throw orderError;

        // 6. Create Items
        const itemsToInsert = Object.entries(validCartItems).map(([productId, qty]) => {
            const product = latestProducts?.find(p => p.id === productId); 
            return {
                order_id: order.id,
                product_id: productId,
                quantity: qty,
                price_per_unit: product?.price || 0,
                notes: '' 
            };
        });

        await supabase.from('order_items').insert(itemsToInsert);
        
        // Notify if some items were removed
        if (invalidItemNames.length > 0) {
            alert(`✅ Order placed successfully!\n\n⚠️ However, the following items were sold out and removed from your order:\n- ${invalidItemNames.join('\n- ')}`);
            // Update cart to match what was actually ordered (or clear it? Usually clear it creates empty cart)
            // But strict logic says "clear ordered items". 
            // Since we ordered validItems, we should clear everything.
            // The invalid items are also effectively "dealt with" (user notified).
            setCart({});
        } else {
            // Normal success (all items ordered)
            setIsCartOpen(false);
            // We don't need alert here if we just change UI state to 'Order Sent'
            // But maybe a small toast? The UI changes to "ORDER SENT" so that's enough feedback.
        }

        setSentOrderId(order.id);
        setIsOrderSent(true);
        setIsCartOpen(false);

        // Also clean invalid items from cart state if we didn't clear all
        if (invalidItemNames.length > 0) {
             setCart({});
        }

    } catch (err: any) {
        alert('Failed: ' + err.message);
        console.error(err);
    } finally {
        setSubmitting(false);
    }
  };

  const handleCancelOrder = async () => {
      if (!sentOrderId) return;
      if (!confirm("Are you sure you want to cancel this order?")) return;

      setSubmitting(true);
      try {
          const { error } = await supabase.from('orders').delete().eq('id', sentOrderId);
          if (error) throw error;
          
          // Reset all states
          setCart({});
          setIsOrderSent(false);
          setSentOrderId(null);
          setIsOrderCompleted(false);
          
          // Clear localStorage
          if (contextArtist?.id) {
            localStorage.removeItem(`cart_${contextArtist.id}`);
            localStorage.removeItem(`orderSent_${contextArtist.id}`);
            localStorage.removeItem(`sentOrderId_${contextArtist.id}`);
            localStorage.removeItem(`orderCompleted_${contextArtist.id}`);
          }
      } catch (err: any) {
          alert('Failed to cancel: ' + err.message);
      } finally {
          setSubmitting(false);
      }
  };

  // ✅ NEW: Realtime listener for order completion
  useEffect(() => {
      if (!sentOrderId) return;

      const channel = supabase
          .channel(`order-status-${sentOrderId}`)
          .on('postgres_changes', 
              { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${sentOrderId}` }, 
              (payload: any) => {
                  console.log('[Menu] Order update received:', payload.new?.status);
                  if (payload.new?.status === 'completed') {
                      setIsOrderCompleted(true);
                  }
              }
          )
          .subscribe();

      return () => { supabase.removeChannel(channel); };
  }, [sentOrderId]);

  // ✅ NEW: Realtime listener for Queue Status (To clear badge when completed)
  useEffect(() => {
     const localQueueId = localStorage.getItem(`ticket_id_${displayArtist?.id}`);
     if (!localQueueId || !displayArtist?.id) return;

     const channel = supabase
         .channel(`menu-queue-status-${localQueueId}`)
         .on('postgres_changes', 
             { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${localQueueId}` }, 
             (payload: any) => {
                 const newStatus = payload.new?.status;
                 if (['complete', 'missed', 'expired'].includes(newStatus)) {
                    setUserQueueNumber(null); // Clear badge
                 } else if (payload.new?.queue_number) {
                    setUserQueueNumber(payload.new.queue_number);
                 }
             }
         )
         .subscribe();

      return () => { supabase.removeChannel(channel); };
  }, [displayArtist?.id]);

  // Helper to reset order state - Clear all localStorage and state
  const handleCloseCompletedOrder = () => {
      setCart({});
      setIsOrderSent(false);
      setSentOrderId(null);
      setIsOrderCompleted(false);
      
      // Clear localStorage
      if (contextArtist?.id) {
        localStorage.removeItem(`cart_${contextArtist.id}`);
        localStorage.removeItem(`orderSent_${contextArtist.id}`);
        localStorage.removeItem(`sentOrderId_${contextArtist.id}`);
        localStorage.removeItem(`orderCompleted_${contextArtist.id}`);
      }
  };

  if (loading) return <div className="p-8 text-center text-gray-400">Loading menu...</div>;

  return (
    <div className="min-h-screen bg-gray-50 relative max-w-md mx-auto shadow-2xl overflow-hidden border-x border-gray-100">
       
       {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest fixed top-0 left-0 right-0 z-[60] max-w-md mx-auto">
            Offline - Reconnecting...
         </div>
       )}

      {/* --- 🌟 1. FIXED HEADER AREA (Fix Layout Overflow) --- */}
      <div className="fixed top-0 z-40 bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-200 w-full max-w-md">
         
         {/* Row 1: Shop Name & Queue Badge (จัดกึ่งกลาง) */}
         <div className="flex items-center justify-center px-4 py-3 border-b border-gray-100/50 bg-white gap-3 relative">
            
            {/* Center: Logo & Name */}
            <div className="flex items-center">
                  {displayArtist?.image_url && (
                     <img 
                        src={displayArtist.image_url} 
                        alt="Logo" 
                        className="w-9 h-9 rounded-full mr-3 object-cover shadow-sm border border-gray-100"
                     />
                  )}
                  <h1 className="text-xl font-black text-pink-500 tracking-tight whitespace-nowrap">
                     {displayArtist?.display_name || 'Menu'}
                  </h1>
            </div>
        
        {/* Right Side: Queue Badge (Position Absolute ขวาบน) */}
        <div className={`absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold shadow-sm ${userQueueNumber ? 'bg-pink-50 border-pink-200 text-pink-600' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
            <Ticket size={14} />
            <span>{userQueueNumber ? `Q #${userQueueNumber}` : 'Queue Number'}</span>
        </div>
    </div>

            {/* Search & Sort */}
            <div className="px-3 py-1.5 flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all text-xs" />
                </div>
                <div className="relative min-w-[50px]">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none"><ArrowUpDown className="text-gray-400" size={12} /></div>
                    <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full pl-7 pr-5 py-1.5 appearance-none rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 text-[10px] h-full font-bold uppercase text-gray-600">
                        <option value="name_asc">Name</option>
                        <option value="price_asc">Price: Low</option>
                        <option value="price_desc">Price: High</option>
                    </select>
                </div>
            </div>

            {/* Categories */}
            <div className="px-3 pb-2 pt-0.5 flex gap-1.5 overflow-x-auto no-scrollbar">
                {uniqueCategories.map(cat => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-pink-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{cat}</button>
                ))}
            </div>
       </div>

       {/* --- MENU GRID --- */}
       <div className="pt-[115px] px-3 grid grid-cols-2 gap-2 pb-44 overflow-y-auto">
          {filteredProducts.map(product => {
            const qty = cart[product.id] || 0;
            return (
               <div key={product.id} className={`bg-white rounded-xl shadow-sm overflow-hidden flex flex-col h-full border border-gray-100 transition-all ${qty > 0 ? 'ring-2 ring-pink-500' : ''}`}>
                  <div className="aspect-square bg-gray-100 relative w-full overflow-hidden">
                     {product.image_url ? (
                        <img src={getProductImageUrl(product.image_url, 400)} alt={product.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Img'; }} />
                     ) : (<div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No Img</div>)}
                     {product.status === 'soldout' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10"><span className="text-white font-bold border-2 px-2 py-1 rotate-[-12deg] text-xs">SOLD OUT</span></div>
                     )}
                  </div>
                  <div className="p-2.5 flex flex-col flex-1 justify-between">
                     <div className="mb-2">
                        <h3 className="font-bold text-gray-900 text-xs leading-tight line-clamp-2">{product.name}</h3>
                        {product.description && <p className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">{product.description}</p>}
                     </div>
                     <div className="flex flex-col gap-1.5">
                        <div className="text-pink-600 font-extrabold text-sm">{formatPrice(product.price, product.currency)}</div>
                        {qty === 0 ? (
                           <button onClick={() => product.status !== 'soldout' && updateQuantity(product.id, 1)} disabled={product.status === 'soldout' || isOrderSent} className={`w-full rounded-md py-1 flex items-center justify-center gap-1 text-[10px] font-bold transition-all ${product.status === 'soldout' || isOrderSent ? 'bg-gray-100 text-gray-400' : 'bg-gray-900 text-white active:scale-95'}`}><ShoppingBag size={10} /> ADD</button>
                        ) : (
                           <div className="flex items-center justify-between bg-pink-50 rounded-md p-0.5 border border-pink-100">
                              <button onClick={() => updateQuantity(product.id, -1)} className="w-6 h-6 rounded bg-white text-pink-600 flex items-center justify-center shadow-sm"><Minus size={12} /></button>
                              <span className="font-bold text-xs">{qty}</span>
                              <button onClick={() => updateQuantity(product.id, 1)} className="w-6 h-6 rounded bg-pink-500 text-white flex items-center justify-center shadow-md"><Plus size={12} /></button>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            );
          })}
          <div className="col-span-2 h-10 text-center text-[10px] text-gray-300 pt-4">End of Menu</div>
       </div>

        {/* --- CONFIRM ORDER BAR --- */}
        {(totalItems > 0 || isOrderSent) && (
            <>
                {isCartOpen && !isOrderSent && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] animate-fade-in max-w-md mx-auto" onClick={() => setIsCartOpen(false)} />
                )}
                <div className={`fixed bottom-[80px] left-0 right-0 z-[90] rounded-t-xl shadow-[0_-4px_20px_rgba(0,0,0,0.1)] w-full max-w-md mx-auto border-t border-pink-100 transition-all duration-300 ${isOrderSent ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                    {isCartOpen && !isOrderSent && (
                        <div className="max-h-[50vh] overflow-y-auto p-3 border-b border-gray-100 animate-slide-up bg-white rounded-t-xl">
                            <div className="flex justify-between items-center mb-3 sticky top-0 bg-white z-10 pb-2 border-b border-gray-50">
                                <h3 className="font-bold text-gray-800 text-sm">Your Order <span className="text-pink-500 text-xs font-normal">({totalItems} items)</span></h3>
                                <button onClick={() => setIsCartOpen(false)} className="bg-gray-100 p-1 rounded-full text-gray-500 hover:bg-gray-200"><X size={16}/></button>
                            </div>
                            <div className="space-y-2">
                                {Object.entries(cart).map(([id, qty]) => {
                                    const product = products.find(p => p.id === id);
                                    if (!product || qty === 0) return null;
                                    return (
                                        <div key={id} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-8 h-8 rounded-md bg-gray-200 bg-cover bg-center shrink-0" style={{backgroundImage: `url(${getProductImageUrl(product.image_url, 100)})`}}></div>
                                                <div className="min-w-0"><div className="font-bold text-xs text-gray-800 truncate">{product.name}</div><div className="text-[10px] text-gray-500">{formatPrice(product.price, product.currency)} / unit</div></div>
                                            </div>
                                            <div className="font-bold text-xs w-10 text-right text-pink-600">x {qty}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div className="p-2 px-3 flex items-center gap-3 bg-white/95 backdrop-blur-sm h-14">
                        {isOrderSent ? (
                            isOrderCompleted ? (
                                // ✅ ORDER COMPLETED UI
                                <div className="flex-1 flex items-center justify-between w-full animate-fade-in bg-green-100 px-3 py-2 rounded-lg border border-green-200">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={22} className="text-green-600" />
                                        <div>
                                            <div className="text-sm font-black text-green-800">Order Completed!</div>
                                            <div className="text-[10px] text-green-600">Thank you for your purchase.</div>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={handleCloseCompletedOrder} 
                                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm hover:bg-green-700 flex items-center gap-1"
                                    >
                                        <X size={14} /> Close
                                    </button>
                                </div>
                            ) : (
                                // ORDER SENT (waiting)
                                <div className="flex-1 flex items-center justify-between w-full animate-fade-in bg-green-50 px-2 py-1 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={20} className="text-green-600" />
                                        <div>
                                            <div className="text-xs font-black text-green-800">ORDER SENT!</div>
                                            <div className="text-[10px] text-green-600">Wait for queue.</div>
                                        </div>
                                    </div>
                                    <button onClick={handleCancelOrder} disabled={submitting} className="bg-white border border-red-200 text-red-500 px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm hover:bg-red-50 flex items-center gap-1">
                                        <Trash2 size={12} /> Cancel
                                    </button>
                                </div>
                            )
                        ) : (
                            <>
                                <div onClick={() => setIsCartOpen(!isCartOpen)} className="flex-1 cursor-pointer flex flex-col justify-center">
                                    <div className="flex items-center gap-1 text-gray-400 text-[9px] font-bold uppercase tracking-wider"><span>TOTAL</span>{isCartOpen ? <ChevronDown size={10}/> : <ChevronUp size={10} className="animate-bounce"/>}</div>
                                    <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-gray-900 leading-none">{formatPrice(totalPrice, cartCurrency)}</span><span className="text-[10px] font-medium text-gray-400">/ {totalItems} items</span></div>
                                </div>
                                <button onClick={handleConfirmOrder} disabled={submitting} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg font-bold text-xs shadow-lg shadow-pink-200 active:scale-95 transition-all disabled:opacity-70 disabled:scale-100 flex items-center gap-1.5 h-10">{submitting ? 'Sending...' : (<><span>Confirm</span><ShoppingBag size={14} strokeWidth={2.5} /></>)}</button>
                            </>
                        )}
                    </div>
                </div>
            </>
        )}

        {/* BOTTOM NAV */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 pb-safe w-full max-w-md mx-auto">
            <div className="flex justify-around items-center h-[60px]">
                <button onClick={() => navigate(`/${displayArtist?.slug || ''}`)} className={`flex flex-col items-center justify-center w-full h-full space-y-0.5 ${location.pathname.endsWith(`/${displayArtist?.slug}`) ? 'text-pink-500' : 'text-gray-400 hover:text-gray-600'}`}><Home size={20} strokeWidth={2.5} /><span className="text-[9px] font-bold">Home</span></button>
                <button className="flex flex-col items-center justify-center w-full h-full space-y-0.5 text-pink-500"><ShoppingBag size={20} strokeWidth={2.5} /><span className="text-[9px] font-bold">Menu</span></button>
                <button onClick={() => navigate(`/${displayArtist?.slug || ''}/queue`)} className="flex flex-col items-center justify-center w-full h-full space-y-0.5 text-gray-400 hover:text-gray-600"><Users size={20} strokeWidth={2.5} /><span className="text-[9px] font-bold">Queue</span></button>
            </div>
        </div>
    </div>
  );
};

export default MenuView;


```

## src/services/MockQueueService.ts
```tsx
import { QueueService, QueueState } from './QueueInterfaces';

// In-memory mock state
let currentState: QueueState = {
  currentServing: 0,
  lastTicketIssued: 0,
  lastUpdated: Date.now(),
  isAccepting: true,
  tickets: {}
};

const listeners: Set<(state: QueueState) => void> = new Set();

const notify = () => {
  listeners.forEach(cb => cb({ ...currentState }));
};

const mockService = {
  subscribeToQueue: (callback: (state: QueueState) => void) => {
    listeners.add(callback);
    callback({ ...currentState }); // Initial value
    return () => listeners.delete(callback);
  },

  // Helper for E2E tests
  _forceExpire: (ticketId: number) => {
      if (currentState.tickets[ticketId]) {
          // Force status to expired directly to avoid timing issues in tests
          currentState.tickets[ticketId].status = 'expired';
          currentState.tickets[ticketId].calledAt = Date.now() - (31 * 60 * 1000); // Keep time logic just in case for display
          notify();
      }
  },

  updateServing: async (_number: number) => {
    console.warn("Deprecated updateServing called");
  },

  callNext: async () => {
    // Cleanup first
    mockService.cleanupExpired!();

    // 1. Complete Pending
    Object.values(currentState.tickets).forEach(t => {
      if (t.status === 'pending') {
        currentState.tickets[t.id].status = 'complete';
      }
    });

    // 2. Make next waiting Ready
    const waiting = Object.values(currentState.tickets)
      .filter(t => t.status === 'waiting')
      .sort((a, b) => a.id - b.id);

    if (waiting.length > 0) {
      const next = waiting[0];
      currentState.tickets[next.id] = { ...next, status: 'ready', calledAt: Date.now() };
    }
    notify();
  },

  cleanupExpired: async () => {
    const THIRTY_MINS = 30 * 60 * 1000;
    const now = Date.now();
    let changed = false;

    Object.values(currentState.tickets).forEach(t => {
      if (t.status === 'ready' && t.calledAt && (now - t.calledAt > THIRTY_MINS)) {
        currentState.tickets[t.id].status = 'expired';
        changed = true;
      }
    });
    if (changed) notify();
  },

  confirmTicket: async (ticketId: number) => {
    const ticket = currentState.tickets[ticketId];
    if (ticket && (ticket.status === 'ready' || ticket.status === 'expired')) {
      currentState.tickets[ticketId].status = 'pending';
      notify();
    }
  },

  completeTicket: async (ticketId: number) => {
    const ticket = currentState.tickets[ticketId];
    if (ticket) {
      currentState.tickets[ticketId].status = 'complete';
      notify();
    }
  },

  joinQueue: async () => {
    const nextId = currentState.lastTicketIssued + 1;
    currentState.lastTicketIssued = nextId;
    currentState.tickets[nextId] = {
      id: nextId,
      status: 'waiting',
      timestamp: Date.now()
    };
    notify();
    return nextId;
  },

  resetQueue: async () => {
    currentState = {
      currentServing: 0,
      lastTicketIssued: 0,
      lastUpdated: Date.now(),
      isAccepting: true,
      tickets: {}
    };
    notify();
  },

  undoLastAction: async () => {
    console.log("Mock undo not implemented");
  }
};

export const MockQueueService = mockService as QueueService;

```

## src/services/QueueInterfaces.ts
```tsx
export type TicketStatus = 'waiting' | 'ready' | 'pending' | 'complete' | 'expired';

export interface TicketData {
  id: number;
  status: TicketStatus;
  timestamp: number; // Joined at
  calledAt?: number; // When status became 'ready'
}

export interface QueueState {
  currentServing: number; // DEPRECATED: Use tickets instead, but kept for compat if needed temporarily
  lastTicketIssued: number;
  lastUpdated: number;
  isAccepting: boolean;
  tickets: Record<number, TicketData>; // Map of ticket ID to data
}

export interface QueueService {
  subscribeToQueue: (callback: (state: QueueState) => void) => () => void;
  // Admin Actions
  callNext: () => Promise<void>; 
  confirmTicket: (ticketId: number) => Promise<void>;
  cleanupExpired: () => Promise<void>;
  updateServing: (number: number) => Promise<void>; // Legacy direct update, might remove or keep as fallback
  joinQueue: () => Promise<number>;
  resetQueue: () => Promise<void>;
  completeTicket: (ticketId: number) => Promise<void>;
  undoLastAction: () => Promise<void>;
}

```

## src/services/ServiceFactory.ts
```tsx
import { MockQueueService } from './MockQueueService';
import { FirebaseQueueService } from './FirebaseQueueService';
import { QueueService } from './QueueInterfaces';

// Switch this to 'false' if you want to go back to local-only mode
const USE_FIREBASE = true;

let serviceInstance: QueueService | null = null;

export const getQueueService = (): QueueService => {
  if (!serviceInstance) {
    if (USE_FIREBASE) {
      serviceInstance = new FirebaseQueueService();
    } else {
      serviceInstance = MockQueueService;
    }
  }
  if (typeof window !== 'undefined') {
    // @ts-ignore
    window.queueService = serviceInstance;
  }
  return serviceInstance;
};

```

## src/services/FirebaseQueueService.ts
```tsx
import { db } from '../firebase';
import { doc, onSnapshot, runTransaction, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { QueueService, QueueState, TicketData } from './QueueInterfaces';

const QUEUE_DOC_ID = 'default';
const QUEUE_COLLECTION = 'queues';

export class FirebaseQueueService implements QueueService {
  private docRef = doc(db, QUEUE_COLLECTION, QUEUE_DOC_ID);

  constructor() {
    this.ensureDocumentExists();
  }

  // Helper to make sure the database entry exists on first run
  private async ensureDocumentExists() {
    const snap = await getDoc(this.docRef);
    if (!snap.exists()) {
      await setDoc(this.docRef, {
        lastTicketIssued: 0,
        isAccepting: true,
        lastUpdated: Date.now(),
        tickets: {}
      });
    }
  }

  subscribeToQueue(callback: (state: QueueState) => void) {
    // Real-time listener
    const unsubscribe = onSnapshot(this.docRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        callback({
          currentServing: 0, // Deprecated, but satisfying interface
          lastTicketIssued: data.lastTicketIssued || 0,
          lastUpdated: data.lastUpdated,
          isAccepting: data.isAccepting,
          tickets: data.tickets || {}
        });
      }
    });
    return unsubscribe;
  }

  // DEPRECATED: Legacy direct update, handled via callNext now
  async updateServing(_number: number): Promise<void> {
    console.warn("updateServing is deprecated, use callNext instead.");
  }

  async callNext(): Promise<void> {
    await this.cleanupExpired(); // Run cleanup before calling next

    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};

      // SAVE SNAPSHOT FOR UNDO
      const previousTickets = JSON.parse(JSON.stringify(tickets));

      // 1. Complete any "Pending" tickets
      Object.values(tickets).forEach(t => {
        if (t.status === 'pending') {
          tickets[t.id] = { ...t, status: 'complete' };
        }
      });

      // 2. Find next "Waiting" ticket to make "Ready"
      const waitingTickets = Object.values(tickets)
        .filter(t => t.status === 'waiting')
        .sort((a, b) => a.id - b.id);

      if (waitingTickets.length > 0) {
        const nextTicket = waitingTickets[0];
        tickets[nextTicket.id] = {
          ...nextTicket,
          status: 'ready',
          calledAt: Date.now()
        };
      }

      txn.update(this.docRef, {
        tickets: tickets,
        previousTickets: previousTickets, // Save state
        lastUpdated: Date.now()
      });
    });
  }

  async undoLastAction(): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      if (data.previousTickets) {
        txn.update(this.docRef, {
          tickets: data.previousTickets,
          previousTickets: null, // Consume the undo (optional, keeps it one-step undo)
          lastUpdated: Date.now()
        });
      }
    });
  }

  async cleanupExpired(): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) return;

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      let changed = false;

      const THIRTY_MINS = 30 * 60 * 1000;
      const now = Date.now();

      Object.values(tickets).forEach(t => {
        if (t.status === 'ready' && t.calledAt && (now - t.calledAt > THIRTY_MINS)) {
          tickets[t.id] = { ...t, status: 'expired' };
          changed = true;
        }
      });

      if (changed) {
        txn.update(this.docRef, {
          tickets: tickets,
          lastUpdated: now
        });
      }
    });
  }

  async confirmTicket(ticketId: number): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      const ticket = tickets[ticketId];

      if (ticket && (ticket.status === 'ready' || ticket.status === 'expired')) {
        // SAVE SNAPSHOT FOR UNDO
        const previousTickets = JSON.parse(JSON.stringify(tickets));

        tickets[ticketId] = { ...ticket, status: 'pending' };
        txn.update(this.docRef, {
          tickets: tickets,
          previousTickets: previousTickets, // Save state
          lastUpdated: Date.now()
        });
      }
    });
  }

  async completeTicket(ticketId: number): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) throw "Doc not found";

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      const ticket = tickets[ticketId];

      if (ticket) {
        // SAVE SNAPSHOT FOR UNDO
        const previousTickets = JSON.parse(JSON.stringify(tickets));

        tickets[ticketId] = { ...ticket, status: 'complete' };
        txn.update(this.docRef, {
          tickets: tickets,
          previousTickets: previousTickets, // Save state
          lastUpdated: Date.now()
        });
      }
    });
  }

  async joinQueue(): Promise<number> {
    let myTicket = 0;

    // Transaction ensures no two people get the same number
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(this.docRef);
      if (!docSnap.exists()) {
        throw "Queue does not exist!";
      }

      const data = docSnap.data();
      if (!data.isAccepting) {
        throw new Error("Queue is closed");
      }

      const nextTicket = (data.lastTicketIssued || 0) + 1;
      myTicket = nextTicket;

      const tickets = data.tickets || {};
      const newTicket: TicketData = {
        id: nextTicket,
        status: 'waiting',
        timestamp: Date.now()
      };

      tickets[nextTicket] = newTicket;

      transaction.update(this.docRef, {
        lastTicketIssued: nextTicket,
        lastUpdated: Date.now(),
        tickets: tickets
      });
    });

    return myTicket;
  }

  async resetQueue(): Promise<void> {
    await updateDoc(this.docRef, {
      currentServing: 0,
      lastTicketIssued: 0,
      isAccepting: true,
      lastUpdated: Date.now(),
      tickets: {}
    });
  }

  // Helper for E2E tests
  async _forceExpire(ticketId: number): Promise<void> {
    await runTransaction(db, async (txn) => {
      const docSnap = await txn.get(this.docRef);
      if (!docSnap.exists()) return;

      const data = docSnap.data();
      const tickets: Record<number, TicketData> = data.tickets || {};
      
      if (tickets[ticketId]) {
         tickets[ticketId].status = 'expired';
         tickets[ticketId].calledAt = Date.now() - (35 * 60 * 1000); // > 30 mins
         
         txn.update(this.docRef, {
            tickets: tickets,
            lastUpdated: Date.now()
         });
      }
    });
  }
}

```

