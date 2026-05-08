# แผนภาพสถาปัตยกรรมระบบ (Architecture) และโฟลว์การทำงาน (User Flow)
**โปรเจกต์:** EventQueueSocial (SaaS V1)

---

## 1. System Architecture Diagram
แผนภาพนี้แสดงโครงสร้างโดยรวมของระบบ ว่าส่วนใดเชื่อมต่อกันอย่างไร

```mermaid
flowchart TB
    %% Definitions
    subgraph Frontend [Frontend Application (React + Vite)]
        WebAdmin["Admin/Staff Web App\n(POS, Event Manage)"]
        WebCust["Customer Web App\n(Queue, Menu)"]
    end

    subgraph Backend [Backend Platform (Supabase)]
        direction TB
        Auth["Supabase Auth"]
        DB[(Supabase Postgres)]
        RT["Supabase Realtime\n(Postgres Changes)"]
        Storage["Supabase Storage\n(Menu Images, Avatars)"]
    end

    %% Connections
    WebAdmin -->|Authenticate| Auth
    WebAdmin -->|Read/Write Data| DB
    WebAdmin -->|Subscribe to updates| RT
    WebAdmin -->|Upload/Read Images| Storage

    WebCust -->|Read Data (Public)| DB
    WebCust -->|Subscribe to queue| RT
    WebCust -->|Read Images| Storage

    DB -.->|Trigger Realtime Events| RT

    %% Styling
    classDef primary fill:#4f46e5,stroke:#fff,stroke-width:2px,color:#fff;
    classDef secondary fill:#0ea5e9,stroke:#fff,stroke-width:2px,color:#fff;
    classDef db fill:#10b981,stroke:#fff,stroke-width:2px,color:#fff;

    class WebAdmin,WebCust primary;
    class Auth,RT,Storage secondary;
    class DB db;
```

---

## 2. Queue & POS Flow (Data Flow)
แผนภาพนี้แสดงลำดับขั้นตอน (Sequence) เมื่อลูกค้าเข้ามารับคิว และสตาฟทำการเรียกคิว/คิดเงินผ่านระบบ POS

```mermaid
sequenceDiagram
    autonumber
    actor Customer as ลูกค้า
    participant WebCust as ระบบลูกค้า<br/>(Customer Web)
    participant RT as Supabase<br/>Realtime
    participant DB as Database<br/>(Postgres)
    participant WebAdmin as ระบบสตาฟ<br/>(Admin/POS Web)
    actor Staff as สตาฟหน้าบูธ

    Note over Customer,Staff: ระยะกดบัตรคิว (Queue Creation)
    Customer->>WebCust: เข้าหน้า /:slug/queue
    WebCust->>DB: ตรวจสอบสถานะบูธ (เปิด/ปิด)
    WebCust->>DB: กดรับคิว (Insert Queue row)
    DB-->>WebCust: คืนหมายเลขคิว (เช่น A012)<br/>Status: waiting
    DB->>RT: Broadcast Event: มีคิวใหม่
    RT->>WebAdmin: อัปเดตตารางคิวให้สตาฟเห็นแบบฉับพลัน

    Note over Customer,Staff: ระยะเรียกคิว (Queue Calling & Serving)
    Staff->>WebAdmin: กดปุ่ม "Call Next" บนแผงควบคุมคิว
    WebAdmin->>DB: Update Queue Status -> calling
    DB->>RT: Broadcast Event: กำลังเรียกคิว
    RT->>WebCust: หน้าจอลูกค้าอัปเดตสถานะเป็น "กำลังเรียกคิว"

    Staff->>WebAdmin: กดยืนยันให้ลูกค้าเข้ารับบริการ "Serving"
    WebAdmin->>DB: Update Queue Status -> serving

    Note over Customer,Staff: ระยะสั่งซื้อและคิดเงิน (POS Checkout)
    Customer->>Staff: สั่งสินค้า หรือแจ้งรายการที่ดูมาจากเมนู
    Staff->>WebAdmin: เลือกสินค้าลงตะกร้าในหน้า POS
    Staff->>WebAdmin: กดบันทึกการชำระเงิน (Charge)
    WebAdmin->>DB: Create Order & Order_Items
    WebAdmin->>DB: Update Queue Status -> complete
    DB->>RT: Broadcast Event: คิวจัดการเสร็จสมบูรณ์
    RT->>WebCust: หน้าจอลูกค้าอัปเดตสถานะการเสร็จสิ้น
```

---

## 3. Pre-Order Flow (กระแสลูกค้าสั่งซื้อผ่านมือถือ)
อธิบายขั้นตอนตั้งแต่ลูกค้าดูเมนู จนระบบบันทึกคำสั่งซื้อล่วงหน้า

```mermaid
flowchart TD
    A([เริ่ม: ลูกค้าเข้าหน้าเมนู /:slug/menu]) --> B{บูธเปิดรับออเดอร์หรือไม่?}
    B -- ไม่เปิด --> C[แสดงข้อความแจ้งเตือน บูธปิด]
    B -- เปิด --> D[เลือกสินค้าใส่ตะกร้า]
    D --> E{สินค้าในสต็อกพอไหม?}
    E -- ไม่พอ --> F[แจ้งเตือนสินค้าหมด]
    E -- พอ --> G[ลูกค้ายืนยันออเดอร์ (Submit)]
    
    G --> H[ระบบบันทึกออเดอร์ลง DB (Draft)]
    H --> I[อัปเดตแสดงที่หน้า POS ของสตาฟ (ผ่าน Realtime)]
    
    I --> J{สตาฟตรวจสอบออเดอร์}
    J -- ชำระเงินสำเร็จ --> K[บันทึก Order -> Completed]
    J -- ยกเลิกออเดอร์ --> L[บันทึก Order -> Cancelled & คืนสต็อก]
    
    K --> M([จบกระบวนการ])
    L --> M
```

---

## 4. Entity Relationship (Data Model)
ความสัมพันธ์ของข้อมูลหลักในระบบ (Core Entities)
```mermaid
erDiagram
    EVENT ||--o{ QUEUE : has
    EVENT ||--o{ ORDER : has
    ARTIST ||--o{ EVENT : hosts
    ARTIST ||--o{ PRODUCT : owns
    ORDER ||--o{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : included_in
    QUEUE ||--o| ORDER : linked_to
    
    ARTIST {
        uuid id PK
        string slug
        string name
    }
    EVENT {
        uuid id PK
        uuid artist_id FK
        string status "Draft, Confirmed, Ended"
        boolean booth_open
        string event_timezone
    }
    PRODUCT {
        uuid id PK
        uuid artist_id FK
        string name
        int price
        string status "Enable, Disable, Sold Out"
    }
    QUEUE {
        uuid id PK
        uuid event_id FK
        string status "waiting, calling, serving, complete, missed"
        int queue_number
    }
    ORDER {
        uuid id PK
        uuid event_id FK
        uuid queue_id FK
        string status "draft, completed, cancelled"
        string payment_method "cash, transfer"
    }
    ORDER_ITEM {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        int quantity
        int price_at_time
    }
```
