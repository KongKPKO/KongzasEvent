import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('offline receipts survive reload and a lost sync response without duplicate stock', async ({ page, context }) => {
  const suffix = randomUUID().slice(0,8), email=`offline-${suffix}@example.com`, password='LocalOffline123!';
  const fixture = await ensureOwnerArtistFixture({email,password,slug:`offline-${suffix}`,displayName:'Offline test'});
  const eventId=randomUUID(), productId=randomUUID();
  try {
    const event = await fixture.service.from('events').insert({id:eventId,artist_id:fixture.userId,event_name:'Offline event',start_date:new Date(Date.now()-3600000).toISOString(),end_date:new Date(Date.now()+86400000).toISOString(),status:'Confirmed',is_booth_open:true});
    if(event.error) throw event.error;
    const product = await fixture.service.from('products').insert({id:productId,artist_id:fixture.userId,name:'Offline item',price:100,stock_total:10,is_unlimited:false});
    if(product.error) throw product.error;
    const allocation=await fixture.service.from('event_products').insert({event_id:eventId,artist_id:fixture.userId,product_id:productId,stock_total:10,is_unlimited:false,is_enabled:true});
    if(allocation.error) throw allocation.error;
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button',{name:/Login to Dashboard|Sign in|Login/i}).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/offline?eventId=${eventId}`);
    await page.getByRole('button',{name:/Prepare this device|เตรียมเครื่อง/}).click();
    await expect(page.getByRole('heading',{name:'Offline event'})).toBeVisible();
    if (process.env.OFFLINE_PWA_TEST === '1') {
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await context.setOffline(true);
    } else {
      // Development has no service worker; keep Vite reachable while cutting backend access.
      await context.route('http://127.0.0.1:54321/**',route=>route.abort('internetdisconnected'));
    }
    await page.getByRole('spinbutton',{name:'Offline item',exact:true}).fill('2');
    await page.getByLabel(/Actual amount collected|ยอดรับจริง/).fill('200');
    await page.getByRole('button',{name:/Cash received|รับเงินสดแล้ว/}).click();
    await expect(page.getByRole('status')).toContainText(/Saved on this device|เก็บรายการในเครื่องแล้ว/);
    await page.reload();
    await expect(page.getByText(/1 รายการรอตรวจ|1 pending/)).toBeVisible();
    await context.setOffline(false);
    await context.unroute('http://127.0.0.1:54321/**');
    let lost=false;
    await page.route('**/rest/v1/rpc/apply_offline_operation',async route=>{if(!lost){lost=true;await route.fetch();await route.abort();}else await route.continue();});
    await page.getByRole('button',{name:/Synchronize when connected|ส่งรายการเมื่อเชื่อมต่อ/}).click();
    await expect(page.getByRole('status')).toContainText(/Not synchronized|ยังส่งไม่สำเร็จ/);
    await page.getByRole('button',{name:/Synchronize when connected|ส่งรายการเมื่อเชื่อมต่อ/}).click();
    await expect(page.getByText(/0 รายการรอตรวจ|0 pending/)).toBeVisible();
    const sales=await fixture.service.from('orders').select('id,total_price').eq('event_id',eventId);
    expect(sales.data).toHaveLength(1); expect(sales.data?.[0].total_price).toBe(200);
    const stock=await fixture.service.from('event_products').select('stock_sold').eq('product_id',productId).eq('event_id',eventId).single();expect(stock.data?.stock_sold).toBe(2);
    const serviceDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date());
    const ticket=await fixture.service.from('queues').insert({event_id:eventId,artist_id:fixture.userId,queue_number:321,queue_service_date:serviceDate,status:'waiting'}).select('id').single();
    if(ticket.error) throw ticket.error;
    await page.getByLabel(/Missing queue number|คิวที่ยังไม่อยู่ในเครื่อง/).fill('321');
    await page.getByRole('button',{name:/Record as served|บันทึกว่าบริการแล้ว/}).click();
    await page.getByRole('button',{name:/Synchronize when connected|ส่งรายการเมื่อเชื่อมต่อ/}).click();
    await expect(page.getByText(/0 รายการรอตรวจ|0 pending/)).toBeVisible();
    expect((await fixture.service.from('queues').select('status').eq('id',ticket.data.id).single()).data?.status).toBe('complete');
    const raceTicket=await fixture.service.from('queues').insert({event_id:eventId,artist_id:fixture.userId,queue_number:322,queue_service_date:serviceDate,status:'waiting'}).select('id').single();
    if(raceTicket.error) throw raceTicket.error;
    await page.goto(`/live/queue?eventId=${eventId}`);
    await page.route('**/rest/v1/queues?**',async route=>{
      if(route.request().method()==='PATCH') {
        const changed=await fixture.service.from('queues').update({status:'complete'}).eq('id',raceTicket.data.id);
        if(changed.error) throw changed.error;
      }
      await route.continue();
    });
    await page.getByRole('button',{name:/Call Next/i}).first().click();
    await expect(page.getByText(/Queue changed or connection unavailable/)).toBeVisible();
    expect((await fixture.service.from('queues').select('status').eq('id',raceTicket.data.id).single()).data?.status).toBe('complete');
    await page.goto(`/live/pos?eventId=${eventId}`);
    await expect(page.getByTestId('booth-toggle')).toHaveText('Close Booth');
    await expect(page.getByText('Cart is empty', {exact:true})).toBeVisible();
    await page.getByRole('button',{name:/Offline item/}).first().click();
    await page.getByRole('button',{name:/Charge/i}).first().click();
    await page.route('**/rest/v1/rpc/create_walkin_order_with_stock',async route=>{await route.fetch();await route.abort();});
    await page.getByRole('button',{name:/Cash/i}).click();
    await expect(page.getByRole('status').getByText('Payment status unknown',{exact:true})).toBeVisible();
    await page.goto(`/offline?eventId=${eventId}`);
    await expect(page.getByText(/1 รายการรอตรวจ|1 pending/)).toBeVisible();
    await page.getByRole('button',{name:/Synchronize when connected|ส่งรายการเมื่อเชื่อมต่อ/}).click();
    await expect(page.getByText(/0 รายการรอตรวจ|0 pending/)).toBeVisible();
    expect((await fixture.service.from('orders').select('id').eq('event_id',eventId)).data).toHaveLength(2);
    expect((await fixture.service.from('event_products').select('stock_sold').eq('product_id',productId).eq('event_id',eventId).single()).data?.stock_sold).toBe(3);
    await page.unroute('**/rest/v1/rpc/create_walkin_order_with_stock');
    await page.goto(`/live/pos?eventId=${eventId}`);
    await page.getByRole('button',{name:/Offline item/}).first().click();
    await page.getByRole('button',{name:/Charge/i}).first().click();
    await page.getByRole('button',{name:/Cash/i}).click();
    await expect(page.getByText('Payment completed',{exact:true})).toBeVisible();
    expect((await fixture.service.from('orders').select('id').eq('event_id',eventId)).data).toHaveLength(3);
    expect((await fixture.service.from('event_products').select('stock_sold').eq('product_id',productId).eq('event_id',eventId).single()).data?.stock_sold).toBe(4);




  } finally {
    await context.setOffline(false);
    await context.unroute('http://127.0.0.1:54321/**');
    await fixture.service.from('offline_operations').delete().eq('event_id',eventId);
    await fixture.service.from('offline_devices').delete().eq('event_id',eventId);
    await fixture.service.from('orders').delete().eq('event_id',eventId);
    await fixture.service.from('queues').delete().eq('event_id',eventId);
    await fixture.service.from('events').delete().eq('id',eventId);
    await fixture.service.from('products').delete().eq('id',productId);
    await fixture.service.from('artists').delete().eq('id',fixture.userId);
    await fixture.service.auth.admin.deleteUser(fixture.userId);
  }
});
