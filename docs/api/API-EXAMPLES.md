# NireQ API Examples

Examples use the existing browser client from `src/supabaseClient.ts`. Never place a service-role key in browser code or any `VITE_*` variable.

## 1. Load The Signed-in Actor

```ts
const { data, error } = await supabase.rpc('get_actor_context');
if (error) throw error;

const actor = Array.isArray(data) ? data[0] : data;
```

## 2. Check Event Access

```ts
const { data: allowed, error } = await supabase.rpc('has_event_role', {
  p_event_id: eventId,
  p_allowed_roles: ['owner', 'manager', 'seller'],
});

if (error || allowed !== true) {
  throw new Error('permission denied');
}
```

## 3. Load An Event Catalog

```ts
const { data: products, error } = await supabase.rpc('list_event_products', {
  p_event_id: eventId,
});

if (error) throw error;
```

## 4. Create A Customer Queue Ticket

Keep the browser-generated customer fingerprint stable so retrying one logical queue request does not create duplicates.

```ts
const { data: ticket, error } = await supabase.rpc('create_queue_ticket', {
  p_artist_id: artistId,
  p_event_id: eventId,
  p_customer_fingerprint: customerFingerprint,
});

if (error) throw error;
```

## 5. Create A Pre-order

```ts
const { data, error } = await supabase.rpc('create_preorder_with_stock', {
  p_event_id: eventId,
  p_customer_name: customerName,
  p_customer_email: customerEmail,
  p_customer_contact: customerContact,
  p_customer_note: note,
  p_client_request_id: requestId,
  p_items: items.map(({ productId, quantity }) => ({
    product_id: productId,
    quantity,
  })),
});

if (error) {
  if (error.message.includes('insufficient_stock')) {
    // Refresh the catalog and ask the customer to adjust quantities.
  }
  throw error;
}

const order = Array.isArray(data) ? data[0] : data;
// Save order.pickup_code and display order.payment_deadline_at.
```

## 6. Retrieve Public Order Status

```ts
const { data, error } = await supabase.rpc('get_public_preorder_by_code', {
  p_artist_slug: artistSlug,
  p_pickup_code: orderCode.trim().toUpperCase(),
});

if (error) throw error;
const order = Array.isArray(data) ? data[0] : data;
```

Treat the returned code as customer proof. Do not display private emails, unmasked contacts, or storage-internal evidence paths on public pages.

## 7. Call An Edge Function

```ts
const { data, error } = await supabase.functions.invoke('notify-team-invitation', {
  body: { invitation_id: invitationId },
});

if (error) {
  // The invitation may still exist. Report notification failure separately.
  console.error(error);
}
```

## 8. Subscribe To Realtime Changes

```ts
const channel = supabase
  .channel(`event-orders-${eventId}`)
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: `event_id=eq.${eventId}`,
    },
    () => refreshOrders(),
  )
  .subscribe();

// On component cleanup:
await supabase.removeChannel(channel);
```

Realtime is a refresh signal, not an authorization mechanism. The follow-up query still passes through RLS.

## 9. Error Handling Pattern

```ts
try {
  const { data, error } = await supabase.rpc('some_rpc', params);
  if (error) throw error;
  return data;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Request failed';

  if (message.includes('permission denied')) {
    // Route away or show a role-specific access message.
  } else if (message.includes('insufficient_stock')) {
    // Refresh catalog availability.
  } else if (message.includes('payment_expired')) {
    // Ask the customer to place a new order.
  } else {
    // Show a safe retry message; log only sanitized context.
  }
}
```

## 10. Release Verification

Before promoting API-related changes:

```bash
npm run verify
npm run test:security
supabase test db
```

Run the focused stock, money, authentication, authorization, or RLS regression whenever the changed API touches that boundary. Remote migrations and Production deployment require explicit approval.
