import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export default defineConfig({
  testDir: './src/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
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
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY:
        process.env.VITE_SUPABASE_ANON_KEY ||
        'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg',
    },
  },

  
});
