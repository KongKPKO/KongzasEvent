
  create table "public"."order_items" (
    "id" uuid not null default gen_random_uuid(),
    "order_id" uuid not null,
    "product_id" uuid not null,
    "quantity" integer default 1,
    "price_per_unit" numeric default 0,
    "notes" text,
    "currency" text not null default 'THB'::text
      );


alter table "public"."order_items" enable row level security;


  create table "public"."orders" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "event_id" uuid not null,
    "queue_id" uuid,
    "status" text default 'draft'::text,
    "total_price" numeric default 0,
    "payment_method" text,
    "currency" text not null default 'THB'::text
      );


alter table "public"."orders" enable row level security;

alter table "public"."products" add column "currency" text not null default 'THB'::text;

CREATE UNIQUE INDEX order_items_pkey ON public.order_items USING btree (id);

CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id);

alter table "public"."order_items" add constraint "order_items_pkey" PRIMARY KEY using index "order_items_pkey";

alter table "public"."orders" add constraint "orders_pkey" PRIMARY KEY using index "orders_pkey";

alter table "public"."events" add constraint "events_status_check" CHECK ((status = ANY (ARRAY['Confirmed'::text, 'Cancelled'::text, 'Ended'::text]))) not valid;

alter table "public"."events" validate constraint "events_status_check";

alter table "public"."order_items" add constraint "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE not valid;

alter table "public"."order_items" validate constraint "order_items_order_id_fkey";

alter table "public"."order_items" add constraint "order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) not valid;

alter table "public"."order_items" validate constraint "order_items_product_id_fkey";

alter table "public"."orders" add constraint "orders_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) not valid;

alter table "public"."orders" validate constraint "orders_event_id_fkey";

alter table "public"."orders" add constraint "orders_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES public.queues(id) not valid;

alter table "public"."orders" validate constraint "orders_queue_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_active_currency_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    current_active_currency TEXT;
BEGIN
    -- เช็คเฉพาะสินค้าที่จะเซ็ตเป็น 'Enable' (หรือ 'Sold Out' ที่ยังโชว์หน้าร้าน)
    -- ถ้าสินค้าเป็น 'Disable' เราปล่อยผ่านได้เลย (เพราะไม่ได้ขาย)
    IF NEW.status = 'Enable' THEN
        
        -- ค้นหาว่าในร้านนี้ (artist_id) มีสินค้าตัวอื่นที่ Enable อยู่ ใช้สกุลเงินอะไร?
        SELECT currency INTO current_active_currency
        FROM products
        WHERE artist_id = NEW.artist_id 
          AND status = 'Enable' 
          AND id != NEW.id -- ไม่นับตัวเอง (กรณี Update)
        LIMIT 1;

        -- ถ้าเจอว่ามีสินค้า Active อยู่แล้ว และสกุลเงิน "ไม่ตรง" กับตัวที่กำลังจะบันทึก
        IF current_active_currency IS NOT NULL AND current_active_currency != NEW.currency THEN
            RAISE EXCEPTION 'Conflict Currency: ร้านนี้มีเมนูที่ขายเป็นสกุลเงิน % อยู่แล้ว ไม่สามารถเปิดขายเมนูที่เป็น % ผสมกันได้', current_active_currency, NEW.currency;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$
;

grant delete on table "public"."order_items" to "anon";

grant insert on table "public"."order_items" to "anon";

grant references on table "public"."order_items" to "anon";

grant select on table "public"."order_items" to "anon";

grant trigger on table "public"."order_items" to "anon";

grant truncate on table "public"."order_items" to "anon";

grant update on table "public"."order_items" to "anon";

grant delete on table "public"."order_items" to "authenticated";

grant insert on table "public"."order_items" to "authenticated";

grant references on table "public"."order_items" to "authenticated";

grant select on table "public"."order_items" to "authenticated";

grant trigger on table "public"."order_items" to "authenticated";

grant truncate on table "public"."order_items" to "authenticated";

grant update on table "public"."order_items" to "authenticated";

grant delete on table "public"."order_items" to "postgres";

grant insert on table "public"."order_items" to "postgres";

grant references on table "public"."order_items" to "postgres";

grant select on table "public"."order_items" to "postgres";

grant trigger on table "public"."order_items" to "postgres";

grant truncate on table "public"."order_items" to "postgres";

grant update on table "public"."order_items" to "postgres";

grant delete on table "public"."order_items" to "service_role";

grant insert on table "public"."order_items" to "service_role";

grant references on table "public"."order_items" to "service_role";

grant select on table "public"."order_items" to "service_role";

grant trigger on table "public"."order_items" to "service_role";

grant truncate on table "public"."order_items" to "service_role";

grant update on table "public"."order_items" to "service_role";

grant delete on table "public"."orders" to "anon";

grant insert on table "public"."orders" to "anon";

grant references on table "public"."orders" to "anon";

grant select on table "public"."orders" to "anon";

grant trigger on table "public"."orders" to "anon";

grant truncate on table "public"."orders" to "anon";

grant update on table "public"."orders" to "anon";

grant delete on table "public"."orders" to "authenticated";

grant insert on table "public"."orders" to "authenticated";

grant references on table "public"."orders" to "authenticated";

grant select on table "public"."orders" to "authenticated";

grant trigger on table "public"."orders" to "authenticated";

grant truncate on table "public"."orders" to "authenticated";

grant update on table "public"."orders" to "authenticated";

grant delete on table "public"."orders" to "postgres";

grant insert on table "public"."orders" to "postgres";

grant references on table "public"."orders" to "postgres";

grant select on table "public"."orders" to "postgres";

grant trigger on table "public"."orders" to "postgres";

grant truncate on table "public"."orders" to "postgres";

grant update on table "public"."orders" to "postgres";

grant delete on table "public"."orders" to "service_role";

grant insert on table "public"."orders" to "service_role";

grant references on table "public"."orders" to "service_role";

grant select on table "public"."orders" to "service_role";

grant trigger on table "public"."orders" to "service_role";

grant truncate on table "public"."orders" to "service_role";

grant update on table "public"."orders" to "service_role";


  create policy "Allow All OrderItems"
  on "public"."order_items"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "Allow All Orders"
  on "public"."orders"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "Public Read Products"
  on "public"."products"
  as permissive
  for select
  to public
using (true);



  create policy "Public Write Products"
  on "public"."products"
  as permissive
  for all
  to public
using (true)
with check (true);


CREATE TRIGGER ensure_single_active_currency BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.check_active_currency_consistency();


