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
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'desktop-edge', use: { ...devices['Desktop Edge'] } },
    { name: 'mobile-android-chrome-pixel5', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-ios-safari-iphone12', use: { ...devices['iPhone 12'] } },
    { name: 'tablet-ipad-pro-11-landscape', use: { ...devices['iPad Pro 11'], viewport: { width: 1194, height: 834 } } },
    { name: 'tablet-ipad-mini-portrait', use: { ...devices['iPad Mini'] } },
  ],
});
