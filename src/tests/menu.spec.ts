import { test } from '@playwright/test';
import { MenuPage } from '../pages/MenuPage';

test.describe('Menu Page', () => {
    test('displays menu items and cart summary', async ({ page }) => {
        const menuPage = new MenuPage(page);
        await menuPage.goto();
        await menuPage.expectLoaded();
    });
});
