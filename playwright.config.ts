import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './src/tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: 'http://localhost:5173',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    {
      name: 'chrome',
      use: { ...devices['Mobile Chrome'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Mobile Safari'] },
    },
    {
      name: 'edge',
      use: { ...devices['Mobile Edge'] },
    },

    // --- 📱 Mobile (ที่ควรเทส!) ---
    
    // 1. ตัวแทน iOS (iPhone ยอดฮิต)
    // จำลองขนาดหน้าจอ 390x844 และ User Agent ของ iPhone 13
    {
      name: 'Mobile Chrome', // Android
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Chrome', // Android
      use: { ...devices['Samsung Galaxy S25'] },
    },

    // 2. ตัวแทน Android (Pixel)
    // จำลองขนาดหน้าจอ 393x851 และ User Agent ของ Android
    {
      name: 'Mobile Safari', // iOS
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'Mobile Safari', // iOS
      use: { ...devices['iPhone 17'] },
    },
    // --- 📱 Tablets (จอใหญ่กว่ามือถือ แต่ยังเป็น Touch Screen) ---
    {
      name: 'iPad Pro', // จอใหญ่ แนวนอน (Landscape) เหมาะเทส Dashboard ร้านค้า
      use: { 
        ...devices['iPad Pro 11'], 
        // ปกติ iPad ร้านค้ามักวางแนวนอน เราบังคับ Landscape ได้เลย
        viewport: { width: 1194, height: 834 } // หรือใช้ default ก็ได้ครับ
      }, 
    },
    {
      name: 'iPad Mini', // จอเล็ก แนวตั้ง (Portrait) คล้ายมือถือเครื่องใหญ่
      use: { ...devices['iPad Mini'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    // เพิ่ม Environment Variables ให้ Server ที่รัน
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg', // ก๊อป key จาก npx supabase status มาใส่ถ้าจำเป็น
    }
  },
});
