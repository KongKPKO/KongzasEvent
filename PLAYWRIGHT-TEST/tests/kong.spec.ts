import { test, expect } from '@playwright/test'

//คำสั่งตระกูล behavior
test('has title', async ({ page }) => {
    await page.goto('https://mikelopster.dev')

    //delay 10 seconds
    await page.waitForTimeout(10000)

    //click on "Post" Link
    await page
        .getByLabel('Main menu', { exact: true })
        .getByRole('link', { name: 'Posts' })
        .click()

    // await page.locator('a[href="/posts/"]').click();

    // //click on "New Post" button
    // await page.getByRole('button', {name: 'New Post' }).click();
    
    // // fill in the title
    // await page.getByRole('textbox', { name: 'Title' }).fill('Test Post');

    //คำสั่งตระกูล expect
    await expect(page).toHaveTitle(/Mikelopster/)
})

