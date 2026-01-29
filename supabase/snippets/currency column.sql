-- 1. เพิ่ม currency ให้ตาราง products
-- กำหนด Default เป็น 'THB' เพื่อให้ข้อมูลเก่าไม่พัง
ALTER TABLE products 
ADD COLUMN currency text NOT NULL DEFAULT 'THB';

-- 2. เพิ่ม currency ให้ตาราง orders
ALTER TABLE orders 
ADD COLUMN currency text NOT NULL DEFAULT 'THB';

-- 3. เพิ่ม currency ให้ตาราง order_items
ALTER TABLE order_items 
ADD COLUMN currency text NOT NULL DEFAULT 'THB';

-- 1. สร้างฟังก์ชันสำหรับตรวจสอบสกุลเงิน
CREATE OR REPLACE FUNCTION check_active_currency_consistency()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- 2. สร้าง Trigger เพื่อเรียกใช้ฟังก์ชันก่อน Insert หรือ Update ข้อมูล
DROP TRIGGER IF EXISTS ensure_single_active_currency ON products;

CREATE TRIGGER ensure_single_active_currency
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION check_active_currency_consistency();