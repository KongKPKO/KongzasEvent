// Local-only release fixture and simultaneous purchased/gift stock regression.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(execFileSync('supabase',['status','-o','env'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
assert.match(env.API_URL,/^http:\/\/(127\.0\.0\.1|localhost):54321$/);
const db=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const anon=createClient(env.API_URL,env.ANON_KEY,{auth:{persistSession:false}});
const email='release-gifts@example.local', password='LocalReleaseGifts123!';
const must=({data,error})=>{if(error)throw error;return data;};
const users=must(await db.auth.admin.listUsers({perPage:1000}));
let owner=users.users.find(u=>u.email===email);
if(!owner) owner=must(await db.auth.admin.createUser({email,password,email_confirm:true})).user;
const artist=owner.id;
const command=process.argv[2]||'race';
const cleanup=async()=>{
  const campaigns=must(await db.from('online_campaigns').select('id').eq('artist_id',artist)).map(x=>x.id);
  const events=must(await db.from('events').select('id').eq('artist_id',artist)).map(x=>x.id);
  const orders=[...(campaigns.length?must(await db.from('orders').select('id').in('campaign_id',campaigns)):[]),...(events.length?must(await db.from('orders').select('id').in('event_id',events)):[])].map(x=>x.id);
  for(const table of ['payment_review_events','order_payments','order_items']) if(orders.length) must(await db.from(table).delete().in('order_id',orders));
  if(orders.length) must(await db.from('orders').delete().in('id',orders));
  must(await db.from('promotion_assignments').delete().eq('artist_id',artist));
  must(await db.from('artist_promotions').delete().eq('artist_id',artist));
  must(await db.from('online_campaigns').delete().eq('artist_id',artist));
  must(await db.from('events').delete().eq('artist_id',artist));
  must(await db.from('products').delete().eq('artist_id',artist));
};
if(command==='cleanup'){await cleanup();console.log('Local fixture removed');process.exit(0);}
if(['preorder','postorder','live','partial'].includes(command)){
  const now=Date.now(),iso=ms=>new Date(ms).toISOString();
  if(command==='partial') must(await db.from('event_products').update({stock_total:0}).eq('artist_id',artist).eq('product_id',must(await db.from('products').select('id').eq('artist_id',artist).eq('name','Gift B').single()).id));
  else must(await db.from('events').update({start_date:iso(now+(command==='preorder'?86400000:-86400000)),end_date:iso(now+(command==='postorder'?-3600000:172800000)),preorder_enabled:command==='preorder',postorder_enabled:command==='postorder',preorder_opens_at:iso(now-3600000),preorder_closes_at:iso(now+43200000),postorder_opens_at:iso(now-3600000),postorder_closes_at:iso(now+43200000),is_booth_open:command==='live'}).eq('artist_id',artist));
  console.log('Local fixture phase:',command);process.exit(0);
}
await cleanup();
must(await db.from('artists').upsert({id:artist,email,slug:'release-gifts',display_name:'Release gifts',is_public:true,is_verified:true,published_at:new Date().toISOString()}));
const product=randomUUID(),a=randomUUID(),b=randomUUID(),event=randomUUID(),campaign=randomUUID(),promo=randomUUID();
try{
  must(await db.from('products').insert([{id:product,name:'Paid Cheki',stock_total:20},{id:a,name:'Gift A',stock_total:1},{id:b,name:'Gift B',stock_total:1}].map(p=>({...p,artist_id:artist,price:100,is_unlimited:false,status:'enable'}))));
  if(command==='setup'){
    const now=Date.now(),iso=ms=>new Date(ms).toISOString();
    must(await db.from('events').insert({id:event,artist_id:artist,event_name:'Release gifts event',status:'Confirmed',start_date:iso(now+86400000),end_date:iso(now+172800000),preorder_enabled:true,preorder_opens_at:iso(now-3600000),preorder_closes_at:iso(now+43200000)}));
    must(await db.from('event_products').insert([{product_id:product,stock_total:10,is_sellable:true},{product_id:a,stock_total:1,is_sellable:false},{product_id:b,stock_total:1,is_sellable:false}].map(p=>({...p,event_id:event,artist_id:artist,is_enabled:true,is_unlimited:false}))));
    must(await db.from('event_payment_methods').insert({event_id:event,artist_id:artist,method_type:'promptpay',display_name:'Test PromptPay',payment_deadline_at:iso(now+86400000)}));
  }else{
    must(await db.from('online_campaigns').insert({id:campaign,artist_id:artist,name:'Race fixture',slug:'race-fixture',opens_at:new Date(Date.now()-3600000).toISOString(),closes_at:new Date(Date.now()+86400000).toISOString(),publication_status:'published',shipping_enabled:true}));
    must(await db.from('online_campaign_products').insert({campaign_id:campaign,artist_id:artist,product_id:product,stock_total:2,is_unlimited:false,is_enabled:true}));
    must(await db.from('campaign_payment_methods').insert({campaign_id:campaign,artist_id:artist,method_type:'promptpay',display_name:'Test PromptPay'}));
  }
  must(await db.from('artist_promotions').insert({id:promo,artist_id:artist,name:'Release gift promo',target_type:'all',rule_type:'free_items',promotion_type:'quantity_gift',buy_quantity:1,reward_quantity:command==='setup'?2:1,reward_selection_mode:command==='setup'?'customer_choice':'fixed',lifecycle_status:'ready'}));
  must(await db.from('promotion_reward_products').insert((command==='setup'?[a,b]:[product]).map(product_id=>({promotion_id:promo,product_id}))));
  must(await db.from('promotion_assignments').insert(command==='setup'?['preorder','postorder','live'].map(event_phase=>({artist_id:artist,promotion_id:promo,event_id:event,event_phase,combination_policy:'combine'})):{artist_id:artist,promotion_id:promo,campaign_id:campaign,combination_policy:'combine'}));
  if(command==='setup'){console.log(JSON.stringify({event,artist,url:'http://127.0.0.1:5173/release-gifts/menu?eventId='+event}));}
  else{
    for(let round=0;round<5;round++){
      const outcomes=await Promise.all(Array.from({length:2},()=>anon.rpc('create_online_campaign_order',{p_campaign_id:campaign,p_items:[{product_id:product,quantity:1}],p_fulfillment_method:'shipping',p_pickup_point_id:null,p_customer_name:'Race buyer',p_customer_email:'race@example.local',p_customer_phone:'0800000000',p_shipping_address:'Bangkok',p_customer_note:'',p_client_request_id:randomUUID(),p_reward_choices:[],p_promotion_choices:[],p_expected_pricing_hash:null,p_accept_exhausted_rewards:false})));
      assert.equal(outcomes.filter(x=>!x.error).length,1,JSON.stringify(outcomes.map(x=>x.error?.message||'created')));
      const stock=must(await db.from('online_campaign_products').select('stock_reserved,stock_sold').eq('campaign_id',campaign).single());
      assert.equal(stock.stock_reserved,2);assert.equal(stock.stock_sold,0);
      const order=outcomes.find(x=>!x.error).data[0].order_id;
      const lines=must(await db.from('order_items').select('quantity,line_type').eq('order_id',order));
      assert.equal(lines.reduce((n,x)=>n+x.quantity,0),2);
      assert.equal(lines.filter(x=>x.line_type==='promotion_reward').length,1);
      // Expiry runs twice to prove idempotent release, through the actual DB function.
      execFileSync('docker',['exec','supabase_db_EventWebQueue','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`update public.order_payments set stock_hold_expires_at=now()-interval '1 second' where order_id='${order}'; select private.expire_online_campaign_hold('${order}'); select private.expire_online_campaign_hold('${order}');`],{stdio:'ignore'});
      assert.equal(must(await db.from('online_campaign_products').select('stock_reserved').eq('campaign_id',campaign).single()).stock_reserved,0);
      console.log(`Race ${round+1}: one success, two units held, idempotent expiry PASS`);
    }
  }
}finally{if(command!=='setup') await cleanup();}
