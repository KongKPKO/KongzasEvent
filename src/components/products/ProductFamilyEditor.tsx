import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader, Plus, Save, Trash2, X } from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useI18n } from '../../i18n';
import { getMenuImageUrl } from '../../utils/imageUtils';
import { CURRENCIES, DEFAULT_CURRENCY } from '../../utils/currency';
import type { BundleItem, FamilyVariant, ProductKind, ProductParent } from '../../types/productFamily';

type EditableVariant = {
  key: string;
  id?: string;
  updatedAt?: string;
  name: string;
  sku: string;
  priceOverride: string;
  stockTotal: string;
  isUnlimited: boolean;
  imageUrl: string;
  status: 'enable' | 'disable' | 'soldout';
};

export interface ProductFamilySaveInput {
  parent: Omit<ProductParent, 'id' | 'created_at'> & { id?: string };
  variants: Array<{
    id?: string;
    updated_at?: string;
    name: string;
    sku: string | null;
    price_override: number | null;
    stock_total: number | null;
    is_unlimited: boolean;
    image_url: string | null;
    status: 'enable' | 'disable' | 'soldout';
    variant_sort_order: number;
  }>;
}

interface ProductFamilyEditorProps {
  open: boolean;
  artistId: string;
  parent: ProductParent | null;
  variants: FamilyVariant[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: ProductFamilySaveInput) => Promise<void>;
  onUploadImage?: (file: File) => Promise<string>;
}

const newVariant = (index = 0): EditableVariant => ({
  key: `new-${Date.now()}-${index}`,
  name: index === 0 ? 'Default' : '',
  sku: '',
  priceOverride: '',
  stockTotal: '0',
  isUnlimited: true,
  imageUrl: '',
  status: 'enable',
});

const toEditableVariant = (variant: FamilyVariant, index: number): EditableVariant => ({
  key: variant.id || `existing-${index}`,
  id: variant.id,
  updatedAt: variant.updated_at,
  name: variant.variant_name || (index === 0 ? 'Default' : ''),
  sku: variant.sku || '',
  priceOverride: variant.price_override == null ? '' : String(variant.price_override),
  stockTotal: variant.stock_total == null ? '0' : String(variant.stock_total),
  isUnlimited: Boolean(variant.is_unlimited),
  imageUrl: variant.image_url || '',
  status: variant.status || 'enable',
});

const toLocalDateTimeInput = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const inputClass = 'min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-pink-300 focus:ring-2 focus:ring-pink-100';
const labelClass = 'mb-1.5 block text-[11px] font-black uppercase tracking-wide text-gray-500';

const editorCopy = {
  en: {
    product: 'Product', editProduct: (name: string) => `Edit ${name}`, createProduct: 'Create product',
    intro: 'Add your designs or characters here. Each option has its own price and stock.', closeEditor: 'Close product editor',
    sharedDetails: 'Shared product details', sharedDetailsHint: 'Shown once across every design, character, or color.',
    productName: 'Product name *', productNamePlaceholder: 'Traveler acrylic stand', productType: 'Product type', category: 'Category',
    kindSingle: 'Single item', kindPhoto: 'Photo / image set', kindBundle: 'Bundle', kindPreorder: 'Pre-order', kindService: 'Service',
    basePrice: 'Base price *', currency: 'Currency', tags: 'Tags', tagsPlaceholder: 'Genshin, Traveler, Event exclusive',
    description: 'Description', descriptionPlaceholder: 'Size, material, and anything customers should know.', coverImage: 'Cover image', imagePath: 'Image path or URL', uploadCover: 'Upload cover image',
    photoGallery: 'Photo gallery', photoGalleryHint: 'One image path or URL per line. The product card counts these automatically.', addPhotos: 'Add photos', uploadGallery: 'Upload gallery photos', galleryPhoto: (index: number) => `Gallery photo ${index}`,
    includedItems: 'Included items', includedItemsHint: 'The card will show the item count and contents.', item: 'Item', bundleItemName: (index: number) => `Name for bundle item ${index}`, bundleItemQuantity: (index: number) => `Quantity for bundle item ${index}`, removeBundleItem: (index: number) => `Remove bundle item ${index}`,
    preorderTiming: 'Pre-order timing', ordersClose: 'Orders close', estimatedDelivery: 'Estimated delivery', etaPlaceholder: 'Ships late November',
    serviceSetup: 'Service setup', service: 'Service', serviceCheki: 'Cheki / photo', serviceSigning: 'Signing', serviceCommission: 'Commission', other: 'Other', minutes: 'Minutes', slotsPerSession: 'Slots per session',
    variants: 'Variants', inventoryItem: 'Inventory item', variantsHint: 'One dimension only, such as character, design, or color. Every row has its own stock.', addVariant: 'Add variant',
    priceOverride: 'Price override', basePlaceholder: (price: number) => `Base ${price}`, applyPrice: 'Apply price', stock: 'Stock', applyStock: 'Apply stock',
    existingSku: 'Existing SKU', newSku: 'New SKU', variantFallback: (index: number) => `variant ${index}`, moveUp: (name: string) => `Move ${name} up`, moveDown: (name: string) => `Move ${name} down`, removeVariant: (name: string) => `Remove ${name}`,
    variantName: 'Variant name *', sku: 'SKU', price: 'Price', inheritsPrice: (price: number) => `Inherits ${price}`, inheritHint: 'Leave blank to inherit the base price.', unlimited: 'Unlimited', stockFor: (name: string) => `Stock for ${name}`,
    image: 'Image', imageFor: (name: string) => `Image for ${name}`, imagePlaceholder: 'Optional variant image', uploadImageFor: (name: string) => `Upload image for ${name}`, availability: 'Availability', active: 'Active', hidden: 'Hidden', soldOut: 'Sold out',
    cancel: 'Cancel', saveFamily: 'Save family',
    errorProduct: 'Add a product name and a valid base price.', errorVariantName: 'Every variant needs a name.', errorDuplicateVariant: 'Variant names must be unique inside this product.', errorVariantPrice: (name: string) => `Enter a valid price for ${name}.`, errorVariantStock: (name: string) => `Enter a whole-number stock quantity for ${name}.`,
    errorService: 'Use a positive whole number for duration and a nonnegative whole number for slots.', errorBundle: 'Each included item needs a whole-number quantity of at least one.', errorGalleryLimit: 'Use up to 50 gallery images.', errorGalleryUpload: 'Gallery upload failed.', errorImageUpload: 'Image upload failed.', errorSave: 'Could not save this product family.',
  },
  th: {
    product: 'สินค้า', editProduct: (name: string) => `แก้ไข ${name}`, createProduct: 'เพิ่มสินค้า',
    intro: 'เพิ่มแบบ ลาย หรือตัวละครของสินค้านี้ แต่ละตัวเลือกกำหนดราคาและสต็อกแยกกันได้', closeEditor: 'ปิดหน้าต่างสินค้า',
    sharedDetails: 'ข้อมูลหลักของสินค้า', sharedDetailsHint: 'ข้อมูลส่วนนี้ใช้ร่วมกันกับทุกแบบ ตัวละคร หรือสี',
    productName: 'ชื่อสินค้า *', productNamePlaceholder: 'อะคริลิกสแตนด์ Traveler', productType: 'ประเภทสินค้า', category: 'หมวดหมู่',
    kindSingle: 'สินค้าชิ้นเดียว', kindPhoto: 'ชุดรูปภาพ', kindBundle: 'ชุดสินค้า', kindPreorder: 'พรีออเดอร์', kindService: 'บริการ',
    basePrice: 'ราคาหลัก *', currency: 'สกุลเงิน', tags: 'แท็ก', tagsPlaceholder: 'Genshin, Traveler, เฉพาะงาน',
    description: 'รายละเอียด', descriptionPlaceholder: 'ขนาด วัสดุ และข้อมูลที่ลูกค้าควรรู้', coverImage: 'รูปปกสินค้า', imagePath: 'พาธรูปภาพหรือ URL', uploadCover: 'อัปโหลดรูปปก',
    photoGallery: 'แกลเลอรีรูปภาพ', photoGalleryHint: 'ใส่พาธหรือ URL รูปละหนึ่งบรรทัด ระบบจะนับจำนวนรูปบนการ์ดให้อัตโนมัติ', addPhotos: 'เพิ่มรูป', uploadGallery: 'อัปโหลดรูปเข้าแกลเลอรี', galleryPhoto: (index: number) => `รูปในแกลเลอรี ${index}`,
    includedItems: 'ของที่รวมในชุด', includedItemsHint: 'การ์ดสินค้าจะแสดงจำนวนและรายการของในชุด', item: 'เพิ่มรายการ', bundleItemName: (index: number) => `ชื่อของชิ้นที่ ${index}`, bundleItemQuantity: (index: number) => `จำนวนของชิ้นที่ ${index}`, removeBundleItem: (index: number) => `ลบของชิ้นที่ ${index}`,
    preorderTiming: 'กำหนดเวลาพรีออเดอร์', ordersClose: 'ปิดรับออเดอร์', estimatedDelivery: 'กำหนดส่งโดยประมาณ', etaPlaceholder: 'จัดส่งช่วงปลายเดือนพฤศจิกายน',
    serviceSetup: 'ตั้งค่าบริการ', service: 'ประเภทบริการ', serviceCheki: 'เชกิ / ถ่ายรูป', serviceSigning: 'เซ็นลายเซ็น', serviceCommission: 'คอมมิชชัน', other: 'อื่น ๆ', minutes: 'ระยะเวลา (นาที)', slotsPerSession: 'จำนวนคิวต่อรอบ',
    variants: 'ตัวเลือกสินค้า', inventoryItem: 'ข้อมูลสต็อก', variantsHint: 'ใช้ตัวเลือกหนึ่งมิติ เช่น ตัวละคร ลาย หรือสี แต่ละแถวมีสต็อกของตัวเอง', addVariant: 'เพิ่มตัวเลือก',
    priceOverride: 'ราคาสำหรับตัวเลือก', basePlaceholder: (price: number) => `ราคาหลัก ${price}`, applyPrice: 'ใช้ราคานี้ทั้งหมด', stock: 'สต็อก', applyStock: 'ใช้สต็อกนี้ทั้งหมด',
    existingSku: 'SKU ที่มีอยู่', newSku: 'SKU ใหม่', variantFallback: (index: number) => `ตัวเลือกที่ ${index}`, moveUp: (name: string) => `เลื่อน ${name} ขึ้น`, moveDown: (name: string) => `เลื่อน ${name} ลง`, removeVariant: (name: string) => `ลบ ${name}`,
    variantName: 'ชื่อตัวเลือก *', sku: 'SKU', price: 'ราคา', inheritsPrice: (price: number) => `ใช้ราคาหลัก ${price}`, inheritHint: 'เว้นว่างเพื่อใช้ราคาหลักของสินค้า', unlimited: 'ไม่จำกัด', stockFor: (name: string) => `สต็อกของ ${name}`,
    image: 'รูปภาพ', imageFor: (name: string) => `รูปของ ${name}`, imagePlaceholder: 'รูปเฉพาะตัวเลือก (ไม่บังคับ)', uploadImageFor: (name: string) => `อัปโหลดรูปของ ${name}`, availability: 'สถานะการขาย', active: 'เปิดขาย', hidden: 'ซ่อน', soldOut: 'หมด',
    cancel: 'ยกเลิก', saveFamily: 'บันทึกสินค้า',
    errorProduct: 'กรอกชื่อสินค้าและราคาหลักที่ถูกต้อง', errorVariantName: 'ตัวเลือกสินค้าทุกแถวต้องมีชื่อ', errorDuplicateVariant: 'ชื่อตัวเลือกสินค้าต้องไม่ซ้ำกัน', errorVariantPrice: (name: string) => `กรอกราคาที่ถูกต้องสำหรับ ${name}`, errorVariantStock: (name: string) => `กรอกสต็อกเป็นจำนวนเต็มสำหรับ ${name}`,
    errorService: 'ระยะเวลาต้องเป็นจำนวนเต็มมากกว่าศูนย์ และจำนวนคิวต้องเป็นจำนวนเต็มตั้งแต่ศูนย์ขึ้นไป', errorBundle: 'ของแต่ละรายการในชุดต้องมีจำนวนเต็มอย่างน้อยหนึ่งชิ้น', errorGalleryLimit: 'เพิ่มรูปในแกลเลอรีได้ไม่เกิน 50 รูป', errorGalleryUpload: 'อัปโหลดรูปในแกลเลอรีไม่สำเร็จ', errorImageUpload: 'อัปโหลดรูปไม่สำเร็จ', errorSave: 'บันทึกสินค้านี้ไม่สำเร็จ',
  },
} as const;

export default function ProductFamilyEditor({
  open,
  artistId,
  parent,
  variants: initialVariants,
  saving,
  onClose,
  onSave,
  onUploadImage,
}: ProductFamilyEditorProps) {
  const { language } = useI18n();
  const copy = editorCopy[language];
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Other');
  const [tags, setTags] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [basePrice, setBasePrice] = useState('');
  const [kind, setKind] = useState<ProductKind>('single');
  const [imageUrl, setImageUrl] = useState('');
  const [galleryImages, setGalleryImages] = useState('');
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([]);
  const [preorderClosesAt, setPreorderClosesAt] = useState('');
  const [preorderEta, setPreorderEta] = useState('');
  const [serviceKind, setServiceKind] = useState('cheki');
  const [serviceDuration, setServiceDuration] = useState('');
  const [serviceSlots, setServiceSlots] = useState('');
  const [variants, setVariants] = useState<EditableVariant[]>([newVariant()]);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [error, setError] = useState('');
  const [uploadingKey, setUploadingKey] = useState('');

  const initializedFor = useRef<string | null>(null);
  const initialParent = useRef<ProductParent | null>(null);
  const dialogRef = useDialogFocus<HTMLElement>(open, () => { if (!saving && !uploadingKey) onClose(); });

  useEffect(() => {
    if (!open) { initializedFor.current = null; return; }
    const identity = parent?.id || 'new';
    if (initializedFor.current === identity) return;
    initializedFor.current = identity;
    initialParent.current = parent;
    setName(parent?.name || '');
    setDescription(parent?.description || '');
    setCategory(parent?.category || 'Other');
    setTags((parent?.tags || []).join(', '));
    setCurrency(parent?.currency || DEFAULT_CURRENCY);
    setBasePrice(parent == null ? '' : String(parent.base_price));
    setKind(parent?.product_kind || 'single');
    setImageUrl(parent?.image_url || '');
    setGalleryImages((parent?.gallery_images || []).join('\n'));
    setBundleItems(parent?.bundle_items?.length ? parent.bundle_items : [{ name: '', quantity: 1 }]);
    setPreorderClosesAt(parent?.preorder_closes_at ? toLocalDateTimeInput(parent.preorder_closes_at) : '');
    setPreorderEta(parent?.preorder_eta || '');
    setServiceKind(parent?.service_kind || 'cheki');
    setServiceDuration(parent?.service_duration_minutes == null ? '' : String(parent.service_duration_minutes));
    setServiceSlots(parent?.service_slots == null ? '' : String(parent.service_slots));
    setVariants(initialVariants.length ? initialVariants.map(toEditableVariant) : [newVariant()]);
    setBulkPrice('');
    setBulkStock('');
    setError('');
  }, [open, parent, initialVariants]);

  const hasMultipleVariants = variants.length > 1 || variants.some((variant) => variant.name.trim() !== 'Default');
  const parsedBasePrice = Number(basePrice);
  const effectivePriceLabel = useMemo(() => Number.isFinite(parsedBasePrice) ? parsedBasePrice : 0, [parsedBasePrice]);

  if (!open) return null;

  const updateVariant = (key: string, update: Partial<EditableVariant>) => {
    setVariants((current) => current.map((variant) => variant.key === key ? { ...variant, ...update } : variant));
  };

  const moveVariant = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= variants.length) return;
    setVariants((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const uploadGallery = async (files: FileList) => {
    if (!onUploadImage || uploadingKey) return;
    setUploadingKey('gallery');
    setError('');
    try {
      for (const file of Array.from(files)) {
        const path = await onUploadImage(file);
        setGalleryImages((current) => current ? `${current}\n${path}` : path);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : copy.errorGalleryUpload);
    } finally {
      setUploadingKey('');
    }
  };

  const uploadImage = async (file: File, target: 'parent' | string) => {
    if (!onUploadImage) return;
    setUploadingKey(target);
    setError('');
    try {
      const path = await onUploadImage(file);
      if (target === 'parent') setImageUrl(path);
      else updateVariant(target, { imageUrl: path });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : copy.errorImageUpload);
    } finally {
      setUploadingKey('');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!name.trim() || basePrice.trim() === '' || !Number.isFinite(parsedBasePrice) || parsedBasePrice < 0) {
      setError(copy.errorProduct);
      return;
    }
    if (variants.length === 0 || variants.some((variant) => !variant.name.trim())) {
      setError(copy.errorVariantName);
      return;
    }
    const normalizedNames = variants.map((variant) => variant.name.trim().toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setError(copy.errorDuplicateVariant);
      return;
    }
    for (const variant of variants) {
      if (variant.priceOverride !== '' && (!Number.isFinite(Number(variant.priceOverride)) || Number(variant.priceOverride) < 0)) {
        setError(copy.errorVariantPrice(variant.name));
        return;
      }
      if (!variant.isUnlimited && (!Number.isInteger(Number(variant.stockTotal)) || Number(variant.stockTotal) < 0)) {
        setError(copy.errorVariantStock(variant.name));
        return;
      }
    }

    if (kind === 'service' && ((serviceDuration !== '' && (!Number.isInteger(Number(serviceDuration)) || Number(serviceDuration) <= 0)) || (serviceSlots !== '' && (!Number.isInteger(Number(serviceSlots)) || Number(serviceSlots) < 0)))) {
      setError(copy.errorService);
      return;
    }
    if (kind === 'bundle' && bundleItems.some((item) => item.name.trim() && (!Number.isInteger(item.quantity) || item.quantity < 1))) {
      setError(copy.errorBundle);
      return;
    }
    const cleanBundleItems = bundleItems
      .map((item) => ({ name: item.name.trim(), quantity: item.quantity }))
      .filter((item) => item.name);
    const cleanGallery = Array.from(new Set(galleryImages.split('\n').map((item) => item.trim()).filter(Boolean)));
    if (cleanGallery.length > 50) { setError(copy.errorGalleryLimit); return; }
    const cleanTags = Array.from(new Set(tags.split(',').map((item) => item.trim()).filter(Boolean)));

    try {
      await onSave({
        parent: {
        ...(parent?.id ? { id: parent.id } : {}),
        ...(initialParent.current?.updated_at ? { updated_at: initialParent.current.updated_at } : {}),
        artist_id: artistId,
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || 'Other',
        tags: cleanTags,
        image_url: imageUrl.trim() || null,
        currency,
        base_price: parsedBasePrice,
        product_kind: kind,
        gallery_images: kind === 'photo' ? cleanGallery : [],
        bundle_items: kind === 'bundle' ? cleanBundleItems : [],
        preorder_closes_at: kind === 'preorder' && preorderClosesAt ? new Date(preorderClosesAt).toISOString() : null,
        preorder_eta: kind === 'preorder' ? preorderEta.trim() || null : null,
        service_duration_minutes: kind === 'service' && serviceDuration !== '' ? Number(serviceDuration) : null,
        service_slots: kind === 'service' && serviceSlots !== '' ? Number(serviceSlots) : null,
        service_kind: kind === 'service' ? serviceKind.trim() || null : null,
        },
        variants: variants.map((variant, index) => ({
        ...(variant.id ? { id: variant.id } : {}),
        ...(variant.updatedAt ? { updated_at: variant.updatedAt } : {}),
        name: variant.name.trim(),
        sku: variant.sku.trim() || null,
        price_override: variant.priceOverride === '' ? null : Number(variant.priceOverride),
        stock_total: variant.isUnlimited ? null : Number(variant.stockTotal),
        is_unlimited: variant.isUnlimited,
        image_url: variant.imageUrl.trim() || null,
        status: variant.status,
        variant_sort_order: index,
        })),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.errorSave);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="family-editor-title" ref={dialogRef} className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-gray-50 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-pink-600">{copy.product}</p>
            <h2 id="family-editor-title" className="mt-1 text-xl font-black text-gray-950">{parent ? copy.editProduct(parent.name) : copy.createProduct}</h2>
            <p className="mt-1 text-xs font-semibold text-gray-500">{copy.intro}</p>
          </div>
          <button type="button" onClick={() => { if (!saving && !uploadingKey) onClose(); }} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100" aria-label={copy.closeEditor}><X size={20} /></button>
        </header>

        <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.45fr)]">
            <div className="space-y-4">
              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-sm font-black text-gray-900">{copy.sharedDetails}</h3>
                  <p className="mt-1 text-xs font-semibold text-gray-500">{copy.sharedDetailsHint}</p>
                </div>
                <div className="space-y-3">
                  <div><label className={labelClass}>{copy.productName}</label><input aria-label={copy.productName} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder={copy.productNamePlaceholder} autoFocus /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelClass}>{copy.productType}</label><select aria-label={copy.productType} value={kind} onChange={(event) => setKind(event.target.value as ProductKind)} className={inputClass}><option value="single">{copy.kindSingle}</option><option value="photo">{copy.kindPhoto}</option><option value="bundle">{copy.kindBundle}</option><option value="preorder">{copy.kindPreorder}</option><option value="service">{copy.kindService}</option></select></div>
                    <div><label className={labelClass}>{copy.category}</label><input aria-label={copy.category} value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} /></div>
                  </div>
                  <div className="grid grid-cols-[1fr_112px] gap-3">
                    <div><label className={labelClass}>{copy.basePrice}</label><input aria-label={copy.basePrice} type="number" min="0" step="0.01" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} className={inputClass} placeholder="120" /></div>
                    <div><label className={labelClass}>{copy.currency}</label><select aria-label={copy.currency} value={currency} onChange={(event) => setCurrency(event.target.value)} className={inputClass}>{Object.entries(CURRENCIES).map(([code, info]) => <option key={code} value={code}>{info.symbol} {code}</option>)}</select></div>
                  </div>
                  <div><label className={labelClass}>{copy.tags}</label><input aria-label={copy.tags} value={tags} onChange={(event) => setTags(event.target.value)} className={inputClass} placeholder={copy.tagsPlaceholder} /></div>
                  <div><label className={labelClass}>{copy.description}</label><textarea aria-label={copy.description} value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} min-h-24 py-3`} placeholder={copy.descriptionPlaceholder} /></div>
                  <div>
                    <label className={labelClass}>{copy.coverImage}</label>
                    <div className="flex gap-2">
                      <input aria-label={copy.coverImage} value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} className={inputClass} placeholder={copy.imagePath} />
                      {onUploadImage && <label className="inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100" aria-label={copy.uploadCover}>{uploadingKey === 'parent' ? <Loader className="animate-spin" size={17} /> : <ImagePlus size={17} />}<input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void uploadImage(selected, 'parent'); event.target.value = ''; }} /></label>}
                    </div>
                  </div>
                </div>
              </section>

              {kind === 'photo' && <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><h3 className="text-sm font-black text-gray-900">{copy.photoGallery}</h3><p className="mt-1 text-xs font-semibold text-gray-500">{copy.photoGalleryHint}</p><textarea aria-label={copy.photoGallery} value={galleryImages} onChange={(event) => setGalleryImages(event.target.value)} className={`${inputClass} mt-3 min-h-36 py-3 font-mono text-xs`} placeholder={'public/photo-1.webp\npublic/photo-2.webp'} />
                {onUploadImage && <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-3 text-xs font-black text-pink-700">{uploadingKey === 'gallery' ? <Loader size={16} className="animate-spin" /> : <ImagePlus size={16} />}{copy.addPhotos}<input aria-label={copy.uploadGallery} type="file" accept="image/*,.heic,.heif" multiple className="sr-only" disabled={Boolean(uploadingKey) || saving} onChange={(event) => { if (event.target.files?.length) void uploadGallery(event.target.files); event.target.value = ''; }} /></label>}
                <div className="mt-3 flex flex-wrap gap-2">{galleryImages.split('\n').map((value) => value.trim()).filter(Boolean).map((image, index) => <img key={`${image}-${index}`} src={getMenuImageUrl(image)} alt={copy.galleryPhoto(index + 1)} className="h-16 w-16 rounded-lg object-cover" />)}</div>
              </section>}

              {kind === 'bundle' && <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-sm font-black text-gray-900">{copy.includedItems}</h3><p className="mt-1 text-xs font-semibold text-gray-500">{copy.includedItemsHint}</p></div><button type="button" onClick={() => setBundleItems((items) => [...items, { name: '', quantity: 1 }])} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-pink-200 px-3 text-xs font-black text-pink-700"><Plus size={14} /> {copy.item}</button></div><div className="mt-3 space-y-2">{bundleItems.map((item, index) => <div key={index} className="grid grid-cols-[1fr_76px_44px] gap-2"><input aria-label={copy.bundleItemName(index + 1)} value={item.name} onChange={(event) => setBundleItems((items) => items.map((current, itemIndex) => itemIndex === index ? { ...current, name: event.target.value } : current))} className={inputClass} placeholder="Postcard" /><input type="number" min="1" value={item.quantity} onChange={(event) => setBundleItems((items) => items.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: Number(event.target.value) } : current))} className={inputClass} aria-label={copy.bundleItemQuantity(index + 1)} /><button type="button" onClick={() => setBundleItems((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="inline-flex h-11 items-center justify-center rounded-xl text-red-500 hover:bg-red-50" aria-label={copy.removeBundleItem(index + 1)}><Trash2 size={16} /></button></div>)}</div></section>}

              {kind === 'preorder' && <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><h3 className="text-sm font-black text-gray-900">{copy.preorderTiming}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>{copy.ordersClose}</label><input aria-label={copy.ordersClose} type="datetime-local" value={preorderClosesAt} onChange={(event) => setPreorderClosesAt(event.target.value)} className={inputClass} /></div><div><label className={labelClass}>{copy.estimatedDelivery}</label><input aria-label={copy.estimatedDelivery} value={preorderEta} onChange={(event) => setPreorderEta(event.target.value)} className={inputClass} placeholder={copy.etaPlaceholder} /></div></div></section>}

              {kind === 'service' && <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><h3 className="text-sm font-black text-gray-900">{copy.serviceSetup}</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><label className={labelClass}>{copy.service}</label><select aria-label={copy.service} value={serviceKind} onChange={(event) => setServiceKind(event.target.value)} className={inputClass}><option value="cheki">{copy.serviceCheki}</option><option value="signing">{copy.serviceSigning}</option><option value="commission">{copy.serviceCommission}</option><option value="other">{copy.other}</option></select></div><div><label className={labelClass}>{copy.minutes}</label><input aria-label={copy.minutes} type="number" min="1" value={serviceDuration} onChange={(event) => setServiceDuration(event.target.value)} className={inputClass} placeholder="5" /></div><div><label className={labelClass}>{copy.slotsPerSession}</label><input aria-label={copy.slotsPerSession} type="number" min="0" value={serviceSlots} onChange={(event) => setServiceSlots(event.target.value)} className={inputClass} placeholder="20" /></div></div></section>}
            </div>

            <section className="self-start rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div><h3 className="text-sm font-black text-gray-900">{hasMultipleVariants ? copy.variants : copy.inventoryItem}</h3><p className="mt-1 text-xs font-semibold text-gray-500">{copy.variantsHint}</p></div>
                <button type="button" onClick={() => setVariants((current) => [...current, newVariant(current.length)])} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800"><Plus size={14} /> {copy.addVariant}</button>
              </div>

              <div className="my-4 grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
                <div><label className={labelClass}>{copy.priceOverride}</label><input aria-label={copy.priceOverride} type="number" min="0" step="0.01" value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value)} className={inputClass} placeholder={copy.basePlaceholder(effectivePriceLabel)} /></div>
                <button type="button" onClick={() => setVariants((current) => current.map((variant) => ({ ...variant, priceOverride: bulkPrice })))} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:border-pink-200">{copy.applyPrice}</button>
                <div><label className={labelClass}>{copy.stock}</label><input aria-label={copy.stock} type="number" min="0" step="1" value={bulkStock} onChange={(event) => setBulkStock(event.target.value)} className={inputClass} placeholder="10" /></div>
                <button type="button" onClick={() => { if (bulkStock !== '' && Number.isInteger(Number(bulkStock)) && Number(bulkStock) >= 0) setVariants((current) => current.map((variant) => ({ ...variant, isUnlimited: false, stockTotal: bulkStock }))); }} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:border-pink-200">{copy.applyStock}</button>
              </div>

              <div className="space-y-3">
                {variants.map((variant, index) => (
                  <article key={variant.key} className="rounded-2xl border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2"><span className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-pink-50 px-2 text-xs font-black text-pink-700">{index + 1}</span><span className="text-xs font-black text-gray-500">{variant.id ? copy.existingSku : copy.newSku}</span></div>
                      <div className="flex items-center gap-1"><button type="button" onClick={() => moveVariant(index, -1)} disabled={index === 0} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30" aria-label={copy.moveUp(variant.name || copy.variantFallback(index + 1))}><ArrowUp size={16} /></button><button type="button" onClick={() => moveVariant(index, 1)} disabled={index === variants.length - 1} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30" aria-label={copy.moveDown(variant.name || copy.variantFallback(index + 1))}><ArrowDown size={16} /></button><button type="button" onClick={() => setVariants((current) => current.filter((item) => item.key !== variant.key))} disabled={variants.length === 1} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30" aria-label={copy.removeVariant(variant.name || copy.variantFallback(index + 1))}><Trash2 size={16} /></button></div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div><label className={labelClass}>{copy.variantName}</label><input aria-label={copy.variantName} value={variant.name} onChange={(event) => updateVariant(variant.key, { name: event.target.value })} className={inputClass} placeholder="Aether" /></div>
                      <div><label className={labelClass}>{copy.sku}</label><input aria-label={copy.sku} value={variant.sku} onChange={(event) => updateVariant(variant.key, { sku: event.target.value })} className={`${inputClass} font-mono`} placeholder="TRAVELER-AETHER" /></div>
                      <div><label className={labelClass}>{copy.price}</label><input aria-label={copy.price} type="number" min="0" step="0.01" value={variant.priceOverride} onChange={(event) => updateVariant(variant.key, { priceOverride: event.target.value })} className={inputClass} placeholder={copy.inheritsPrice(effectivePriceLabel)} /><p className="mt-1 text-[10px] font-semibold text-gray-400">{copy.inheritHint}</p></div>
                      <div><label className={labelClass}>{copy.stock}</label><div className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3"><label className="flex items-center gap-2 text-xs font-black text-gray-600"><input type="checkbox" checked={variant.isUnlimited} onChange={(event) => updateVariant(variant.key, { isUnlimited: event.target.checked })} className="h-4 w-4 rounded border-gray-300 text-pink-600" /> {copy.unlimited}</label><input type="number" min="0" step="1" value={variant.stockTotal} onChange={(event) => updateVariant(variant.key, { stockTotal: event.target.value })} disabled={variant.isUnlimited} className="ml-auto w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm font-bold disabled:bg-gray-100 disabled:text-gray-400" aria-label={copy.stockFor(variant.name || copy.variantFallback(index + 1))} /></div></div>
                      <div><label className={labelClass}>{copy.image}</label><div className="flex gap-2"><input aria-label={copy.imageFor(variant.name || copy.variantFallback(index + 1))} value={variant.imageUrl} onChange={(event) => updateVariant(variant.key, { imageUrl: event.target.value })} className={inputClass} placeholder={copy.imagePlaceholder} />{onUploadImage && <label className="inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:border-pink-200 hover:text-pink-700" aria-label={copy.uploadImageFor(variant.name || copy.variantFallback(index + 1))}>{uploadingKey === variant.key ? <Loader className="animate-spin" size={16} /> : <ImagePlus size={16} />}<input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void uploadImage(selected, variant.key); event.target.value = ''; }} /></label>}</div></div>
                      <div><label className={labelClass}>{copy.availability}</label><select aria-label={copy.availability} value={variant.status} onChange={(event) => updateVariant(variant.key, { status: event.target.value as EditableVariant['status'] })} className={inputClass}><option value="enable">{copy.active}</option><option value="disable">{copy.hidden}</option><option value="soldout">{copy.soldOut}</option></select></div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-gray-200 bg-white/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div>{error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}</div>
            <div className="flex gap-2"><button type="button" onClick={() => { if (!saving && !uploadingKey) onClose(); }} className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-black text-gray-700 hover:bg-gray-50">{copy.cancel}</button><button type="submit" disabled={saving || Boolean(uploadingKey)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-black text-white shadow-sm hover:bg-pink-700 disabled:bg-pink-300">{saving ? <Loader className="animate-spin" size={17} /> : <Save size={17} />}{parent ? copy.saveFamily : copy.createProduct}</button></div>
          </footer>
        </form>
      </section>
    </div>
  );
}
