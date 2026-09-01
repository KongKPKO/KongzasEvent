import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';

const envMode = process.env.PLAYWRIGHT_ENV || process.env.MODE || 'local';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const usesLocalWebServer = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/|$)/.test(baseURL);

dotenv.config({ path: `.env.${envMode}` });
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

if (envMode === 'local' && (process.env.VITE_SUPABASE_URL || '').includes('127.0.0.1')) {
  try {
    const statusEnv = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const parsed = Object.fromEntries(
      statusEnv
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
        })
    );
    process.env.VITE_SUPABASE_ANON_KEY ||= parsed.ANON_KEY;
    process.env.TEST_SUPABASE_SERVICE_KEY ||= parsed.SERVICE_ROLE_KEY;
  } catch {
    // Local Supabase may be stopped; individual tests will surface the missing fixture access.
  }
}

export default defineConfig({
  testDir: './src/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Desktop browsers
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop-webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'desktop-edge',
      use: { ...devices['Desktop Edge'] },
    },

    // Mobile - Android (Chrome)
    {
      name: 'mobile-android-chrome-pixel5',
      use: { ...devices['Pixel 5'] },
    },

    // Mobile - iOS (Safari)
    {
      name: 'mobile-ios-safari-iphone12',
      use: { ...devices['iPhone 12'] },
    },

    // Tablets (Safari)
    {
      name: 'tablet-ipad-pro-11-landscape',
      use: {
        ...devices['iPad Pro 11'],
        viewport: { width: 1194, height: 834 },
      },
    },
    {
      name: 'tablet-ipad-mini-portrait',
      use: { ...devices['iPad Mini'] },
    },
  ],

  // Test Server
  webServer: usesLocalWebServer ? {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY:
        process.env.VITE_SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_KEY ||
        '',
    },
  } : undefined,

  
});
