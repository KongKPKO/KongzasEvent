import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test('admin can suspend and resume without hiding the public store', async ({ page, browser }) => {
  const env = resolveSupabaseTestEnv();
  expect(new URL(env.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const email='suspension-ui@test.local', password='LocalSupport123!';
  const { userId, service }=await ensureOwnerArtistFixture({email,password,slug:'suspension-ui-admin',displayName:'Suspension UI Admin'});
  const id=randomUUID(), slug=`suspension-${id.slice(0,8)}`;
  const must=(result: {error: unknown})=>{if(result.error) throw result.error;};
  const errors: string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    must(await service.from('platform_admins').upsert({admin_email:email,auth_user_id:userId},{onConflict:'admin_email'}));
    must(await service.from('artists').insert({id,slug,display_name:slug,is_public:true,is_verified:true,published_at:new Date().toISOString()}));
    await page.goto('/manage-login?redirect=/admin/support');
    await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);
    await page.getByRole('textbox',{name:'Password',exact:true}).fill(password);
    await page.getByRole('button',{name:'Login to Dashboard',exact:true}).click();
    await expect(page).toHaveURL(/\/admin\/support$/);
    await page.getByLabel('Store name / slug / email',{exact:true}).fill(slug);
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await expect(page.getByRole('button',{name:'View details',exact:true})).toBeVisible();
    await page.getByLabel('Reason for detail access (5–500 characters)',{exact:true}).fill('Store requested support');
    await page.getByRole('button',{name:'View details',exact:true}).click();
    const controls=page.getByRole('region',{name:'Store business access',exact:true});
    const suspend=controls.getByRole('button',{name:'Suspend new orders and queues',exact:true});
    await expect(suspend).toBeDisabled();
    await controls.getByRole('textbox').fill('Store suspension test');
    await expect(suspend).toBeEnabled();
    page.once('dialog',d=>d.dismiss());
    await suspend.click();
    await expect(suspend).toBeEnabled();
    page.once('dialog',d=>d.accept());
    await suspend.click();
    await expect(controls.getByRole('status')).toHaveText('Status and audit saved.');
    await expect(controls).toContainText('New orders and queue tickets suspended');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`/tmp/store-suspension-${test.info().project.name}.png`,fullPage:true});
    const customer=await browser.newPage();
    await customer.goto(new URL(`/${slug}`,page.url()).href);
    await expect(customer.getByRole('status')).toContainText('This store is not accepting new orders');
    await controls.getByRole('textbox').fill('Support case resolved');
    page.once('dialog',d=>d.accept());
    await controls.getByRole('button',{name:'Resume new orders and queues',exact:true}).click();
    await expect(controls).toContainText('New orders and queue tickets follow store settings');
    await customer.reload();
    await expect(customer.getByText('This store is not accepting new orders',{exact:false})).toHaveCount(0);
    await customer.close();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    // Only this randomly generated local fixture; audit remains immutable through the API.
    execFileSync('docker',['exec','supabase_db_EventWebQueue','psql','-U','postgres','-d','postgres','-c',`delete from private.store_restrictions where artist_id='${id}';`],{stdio:'ignore'});
    await service.from('artists').delete().eq('id',id);
    await service.from('platform_admins').delete().eq('admin_email',email);
  }
});
