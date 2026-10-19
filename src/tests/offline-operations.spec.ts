import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('new offline work is unavailable while existing receipts remain recoverable', async ({ page, context }) => {
  const suffix = randomUUID().slice(0,8), email=`offline-${suffix}@example.com`, password='LocalOffline123!';
  const fixture = await ensureOwnerArtistFixture({email,password,slug:`offline-${suffix}`,displayName:'Offline test'});
  const eventId=randomUUID(), productId=randomUUID(), deviceId=randomUUID(), operationId=randomUUID();
  const preparedAt = new Date().toISOString();
  const serviceDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date());
  try {
    const event = await fixture.service.from('events').insert({id:eventId,artist_id:fixture.userId,event_name:'Offline event',start_date:new Date(Date.now()-3600000).toISOString(),end_date:new Date(Date.now()+86400000).toISOString(),status:'Confirmed',is_booth_open:true});
    if(event.error) throw event.error;
    const product = await fixture.service.from('products').insert({id:productId,artist_id:fixture.userId,name:'Offline item',price:100,stock_total:10,is_unlimited:false});
    if(product.error) throw product.error;
    const allocation=await fixture.service.from('event_products').insert({event_id:eventId,artist_id:fixture.userId,product_id:productId,stock_total:10,is_unlimited:false,is_enabled:true});
    if(allocation.error) throw allocation.error;
    const device=await fixture.service.from('offline_devices').insert({event_id:eventId,artist_id:fixture.userId,device_id:deviceId,actor_id:fixture.userId,prepared_at:preparedAt,heartbeat_at:preparedAt});
    if(device.error) throw device.error;
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button',{name:/Login to Dashboard|Sign in|Login/i}).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/live/pos?eventId=${eventId}`);
    await expect(page.getByRole('link',{name:/Offline workspace|เตรียมใช้งานออฟไลน์/})).toHaveCount(0);
    await page.goto(`/offline?eventId=${eventId}`);
    await expect(page.getByRole('heading',{name:/Recover existing offline records|กู้คืนรายการออฟไลน์เดิม/})).toBeVisible();
    await expect(page.getByRole('button',{name:/Prepare this device|เตรียมเครื่อง/})).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Cash received|รับเงินสดแล้ว|Record as served|บันทึกว่าบริการแล้ว/})).toHaveCount(0);
    await page.evaluate(({ eventId, productId, deviceId, operationId, actorId, preparedAt, serviceDate }) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nireq-offline-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('snapshots', { keyPath: 'event.id' });
        request.result.createObjectStore('operations', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['snapshots', 'operations'], 'readwrite');
        tx.objectStore('snapshots').put({
          event: { id: eventId, artist_id: actorId, event_name: 'Offline event' },
          device_id: deviceId,
          actor_id: actorId,
          storagePersistent: true,
          prepared_at: preparedAt,
          service_date: serviceDate,
          products: [],
          queues: [],
        });
        tx.objectStore('operations').put({
          id: operationId,
          snapshotPreparedAt: preparedAt,
          sequence: 1,
          eventId,
          deviceId,
          payload: {
            kind: 'sale',
            items: [{ product_id: productId, quantity: 2, notes: '', name: 'Offline item', unit_price: 100, currency: 'THB' }],
            currency: 'THB',
            collected_total: 200,
            method: 'cash',
            queue_number: null,
            service_date: serviceDate,
            recorded_at: preparedAt,
          },
          status: 'pending',
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    }), { eventId, productId, deviceId, operationId, actorId: fixture.userId, preparedAt, serviceDate });
    await page.evaluate(actorId => localStorage.setItem('nireq-offline-authorized', actorId), fixture.userId);
    await page.reload();
    await expect(page.getByRole('heading',{name:'Offline event'})).toBeVisible();
    await expect(page.getByText(/1 รายการรอส่งหรือตรวจ|1 pending/)).toBeVisible();
    let lost=false;
    await page.route('**/rest/v1/rpc/apply_offline_operation',async route=>{if(!lost){lost=true;await route.fetch();await route.abort();}else await route.continue();});
    await page.getByRole('button',{name:/Synchronize existing records|ส่งรายการเดิม/}).click();
    await expect(page.getByRole('status')).toContainText(/Not synchronized|ยังส่งไม่สำเร็จ/);
    await page.getByRole('button',{name:/Synchronize existing records|ส่งรายการเดิม/}).click();
    await expect(page.getByText(/0 รายการรอส่งหรือตรวจ|0 pending/)).toBeVisible();
    const sales=await fixture.service.from('orders').select('id,total_price').eq('event_id',eventId);
    expect(sales.data).toHaveLength(1); expect(sales.data?.[0].total_price).toBe(200);
    const stock=await fixture.service.from('event_products').select('stock_sold').eq('product_id',productId).eq('event_id',eventId).single();expect(stock.data?.stock_sold).toBe(2);
    const raceTicket=await fixture.service.from('queues').insert({event_id:eventId,artist_id:fixture.userId,queue_number:322,queue_service_date:serviceDate,status:'waiting'}).select('id').single();
    if(raceTicket.error) throw raceTicket.error;
    const heartbeatBefore = (await fixture.service.from('offline_devices').select('heartbeat_at').eq('event_id', eventId).single()).data!.heartbeat_at;
    await page.goto(`/live/queue?eventId=${eventId}`);
    await expect.poll(async () => {
      const device = await fixture.service.from('offline_devices').select('heartbeat_at').eq('event_id', eventId).single();
      if (device.error) throw device.error;
      return Date.parse(device.data.heartbeat_at) > Date.parse(heartbeatBefore);
    }).toBe(true);

    await page.route('**/rest/v1/rpc/call_queue_batch',async route=>{
      const changed=await fixture.service.from('queues').update({status:'complete'}).eq('id',raceTicket.data.id);
      if(changed.error) throw changed.error;
      await route.continue();
    }, { times: 1 });
    const racedCall = page.waitForResponse(response => response.url().includes('/rpc/call_queue_batch'));
    await page.getByRole('button',{name:/Call Next/i}).first().click();
    expect(await (await racedCall).json()).toEqual([]);
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
    await expect(page.getByText(/1 รายการรอส่งหรือตรวจ|1 pending/)).toBeVisible();
    await page.getByRole('button',{name:/Synchronize existing records|ส่งรายการเดิม/}).click();
    await expect(page.getByText(/0 รายการรอส่งหรือตรวจ|0 pending/)).toBeVisible();
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
