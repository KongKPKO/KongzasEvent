import { test } from '@playwright/test';
import { HomePage } from '../pages/HomePage';

test.describe('Home Page', () => {
    test('loads successfully and displays key sections', async ({ page }) => {
        const homePage = new HomePage(page);
        await homePage.goto();
        await homePage.expectLoaded();
        
        // Additional specific checks if needed
        await homePage.waitForUrl('/');
    });
});
