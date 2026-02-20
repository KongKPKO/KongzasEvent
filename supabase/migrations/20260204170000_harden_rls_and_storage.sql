-- Harden RLS policies and storage access; fix currency consistency trigger

-- 1) Drop existing policies on core tables to avoid permissive access
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname AS polname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('artists', 'events', 'products', 'queues', 'orders', 'order_items')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.polname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- 2) Drop existing storage policies to rebuild safely
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname AS polname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.polname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- 3) Artists
CREATE POLICY "artists_public_read"
  ON public.artists
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "artists_insert_self"
  ON public.artists
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "artists_update_self"
  ON public.artists
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 4) Events
CREATE POLICY "events_public_read"
  ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "events_owner_insert"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = artist_id);

CREATE POLICY "events_owner_update"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = artist_id)
  WITH CHECK (auth.uid() = artist_id);

CREATE POLICY "events_owner_delete"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (auth.uid() = artist_id);

-- 5) Products
CREATE POLICY "products_public_read"
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND status IN ('enable', 'soldout')
  );

CREATE POLICY "products_owner_read"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (auth.uid() = artist_id);

CREATE POLICY "products_owner_insert"
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = artist_id);

CREATE POLICY "products_owner_update"
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = artist_id)
  WITH CHECK (auth.uid() = artist_id);

CREATE POLICY "products_owner_delete"
  ON public.products
  FOR DELETE
  TO authenticated
  USING (auth.uid() = artist_id);

-- 6) Queues
CREATE POLICY "queues_public_read_active_event"
  ON public.queues
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = queues.event_id
        AND e.artist_id = queues.artist_id
        AND e.status = 'Confirmed'
        AND e.start_date <= now()
        AND e.end_date >= now()
    )
  );

CREATE POLICY "queues_public_insert_open_booth"
  ON public.queues
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'waiting'
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = queues.event_id
        AND e.artist_id = queues.artist_id
        AND e.status = 'Confirmed'
        AND e.is_booth_open = true
        AND e.start_date <= now()
        AND e.end_date >= now()
    )
  );

CREATE POLICY "queues_public_mark_missed"
  ON public.queues
  FOR UPDATE
  TO anon
  USING (
    status IN ('waiting', 'calling', 'serving')
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = queues.event_id
        AND e.artist_id = queues.artist_id
        AND e.status = 'Confirmed'
        AND e.start_date <= now()
        AND e.end_date >= now()
    )
  )
  WITH CHECK (status = 'missed');

CREATE POLICY "queues_owner_manage"
  ON public.queues
  FOR ALL
  TO authenticated
  USING (auth.uid() = artist_id)
  WITH CHECK (auth.uid() = artist_id);

-- 7) Orders
CREATE POLICY "orders_public_read_active_queue"
  ON public.orders
  FOR SELECT
  TO anon
  USING (
    queue_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = orders.event_id
        AND e.status = 'Confirmed'
        AND e.start_date <= now()
        AND e.end_date >= now()
    )
  );

CREATE POLICY "orders_public_insert_active_queue"
  ON public.orders
  FOR INSERT
  TO anon
  WITH CHECK (
    status IN ('confirmed', 'draft')
    AND queue_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = orders.event_id
        AND e.status = 'Confirmed'
        AND e.start_date <= now()
        AND e.end_date >= now()
    )
    AND EXISTS (
      SELECT 1
      FROM public.queues q
      WHERE q.id = orders.queue_id
        AND q.event_id = orders.event_id
    )
  );

CREATE POLICY "orders_public_delete_pending"
  ON public.orders
  FOR DELETE
  TO anon
  USING (
    status IN ('confirmed', 'draft')
    AND queue_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = orders.event_id
        AND e.status = 'Confirmed'
        AND e.start_date <= now()
        AND e.end_date >= now()
    )
  );

CREATE POLICY "orders_owner_manage"
  ON public.orders
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = orders.event_id
        AND e.artist_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = orders.event_id
        AND e.artist_id = auth.uid()
    )
  );

-- 8) Order Items
CREATE POLICY "order_items_public_insert"
  ON public.order_items
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      WHERE o.id = order_items.order_id
        AND o.queue_id IS NOT NULL
        AND o.status IN ('confirmed', 'draft')
        AND e.status = 'Confirmed'
        AND e.start_date <= now()
        AND e.end_date >= now()
    )
  );

CREATE POLICY "order_items_owner_manage"
  ON public.order_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      WHERE o.id = order_items.order_id
        AND e.artist_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      WHERE o.id = order_items.order_id
        AND e.artist_id = auth.uid()
    )
  );

-- 9) Storage policies (Menu + Avatar)
CREATE POLICY "menu_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (
    bucket_id = 'Menu'
    AND name LIKE 'public/%'
  );

CREATE POLICY "menu_owner_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'Menu'
    AND name LIKE 'public/%'
    AND owner = auth.uid()
  );

CREATE POLICY "menu_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'Menu'
    AND owner = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'Menu'
    AND owner = auth.uid()
  );

CREATE POLICY "menu_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'Menu'
    AND owner = auth.uid()
  );

CREATE POLICY "avatar_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (
    bucket_id = 'Avatar'
  );

CREATE POLICY "avatar_owner_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'Avatar'
    AND name LIKE (auth.uid()::text || '/%')
    AND owner = auth.uid()
  );

CREATE POLICY "avatar_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'Avatar'
    AND owner = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'Avatar'
    AND owner = auth.uid()
  );

CREATE POLICY "avatar_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'Avatar'
    AND owner = auth.uid()
  );

-- 10) Fix currency consistency function (status values are lowercase)
CREATE OR REPLACE FUNCTION public.check_active_currency_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_active_currency TEXT;
BEGIN
  -- Enforce single active currency for visible products (enable/soldout)
  IF NEW.status IN ('enable', 'soldout') THEN
    SELECT currency INTO current_active_currency
    FROM products
    WHERE artist_id = NEW.artist_id
      AND status IN ('enable', 'soldout')
      AND id != NEW.id
    LIMIT 1;

    IF current_active_currency IS NOT NULL AND current_active_currency != NEW.currency THEN
      RAISE EXCEPTION 'Conflict Currency: ร้านนี้มีเมนูที่ขายเป็นสกุลเงิน % อยู่แล้ว ไม่สามารถเปิดขายเมนูที่เป็น % ผสมกันได้', current_active_currency, NEW.currency;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
