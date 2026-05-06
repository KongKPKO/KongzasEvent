import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../../components/ui';
import { useNavigate } from 'react-router-dom';
import { Loader, Trash2, Upload, Plus, FileText, Edit2, X, Search, ArrowUpDown, ChevronDown, ChevronUp, Coins, AlertTriangle, Filter, PackageSearch, Tag as TagIcon, Sparkles, CalendarDays, Save } from 'lucide-react';
import Papa from 'papaparse';
import imageCompression from 'browser-image-compression';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import AdminHeader from '../../components/AdminHeader';
import { formatPrice, DEFAULT_CURRENCY, CURRENCIES } from '../../utils/currency';
import { getAuthUserSafe } from '../../utils/auth';
import { normalizeProductRecord } from '../../utils/schemaCompat';
import PromotionManager from '../../components/promotions/PromotionManager';
import ProductImageCropModal from '../../components/ProductImageCropModal';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
  tags?: string[];
  status?: 'enable' | 'disable' | 'soldout';
  currency?: string;  // ✅ NEW: Currency code
  stock_total?: number | null;
  stock_reserved?: number;
  stock_sold?: number;
  is_unlimited?: boolean;
}

interface EventOption {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface EventProductRecord {
  id?: string;
  event_id: string;
  product_id: string;
  artist_id: string;
  is_enabled: boolean;
  price_override?: number | null;
  stock_total?: number | null;
  stock_reserved?: number;
  stock_sold?: number;
  is_unlimited: boolean;
}

type EventCatalogDraft = Record<string, {
  id?: string;
  is_enabled: boolean;
  price_override: string;
  is_unlimited: boolean;
  stock_total: string;
}>;

type ProductImageTarget = 'add' | 'edit';
type ProductConfirmAction =
   | { type: 'switch_currency'; currency: string }
   | { type: 'delete_product'; id: string; name: string }
   | null;

const PRODUCT_IMAGE_ACCEPT = 'image/png, image/jpeg, image/webp, image/heic, image/heif, .heic, .heif';
const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const PRODUCT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];

const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || '';

const isHeicImage = (imageFile: File) => {
   const extension = getFileExtension(imageFile.name);
   return imageFile.type === 'image/heic' || imageFile.type === 'image/heif' || extension === 'heic' || extension === 'heif';
};

const isAllowedProductImage = (imageFile: File) => {
   const extension = getFileExtension(imageFile.name);
   return PRODUCT_IMAGE_TYPES.includes(imageFile.type) || PRODUCT_IMAGE_EXTENSIONS.includes(extension);
};

const convertHeicToEditableImage = async (imageFile: File) => {
   if (!isHeicImage(imageFile)) return imageFile;

   const { default: heic2any } = await import('heic2any');
   const converted = await heic2any({
      blob: imageFile,
      toType: 'image/jpeg',
      quality: 0.92
   });
   const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
   const fileName = imageFile.name.replace(/\.[^/.]+$/, '') || 'iphone-image';
   return new File([convertedBlob], `${fileName}.jpg`, { type: 'image/jpeg' });
};

const normalizeTag = (value: string) => value.trim().replace(/\s+/g, ' ');

const parseTagsInput = (value: string) =>
   Array.from(
      new Set(
         value
            .split(/[,\n|;]/)
            .map(normalizeTag)
            .filter(Boolean)
      )
   );

const formatTagsInput = (tags?: string[]) => (tags || []).join(', ');

const getCsvValue = (row: Record<string, unknown>, aliases: string[]) => {
   for (const alias of aliases) {
      const value = row[alias];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
         return value;
      }
   }
   return '';
};

const buildProductDuplicateKey = (input: {
   name?: string;
   category?: string;
   currency?: string;
   tags?: string[];
}) => {
   const normalizedTags = Array.from(
      new Set((input.tags || []).map(normalizeTag).filter(Boolean).map(tag => tag.toLowerCase()))
   ).sort();

   return [
      String(input.name || '').trim().toLowerCase(),
      String(input.category || 'Other').trim().toLowerCase(),
      String(input.currency || DEFAULT_CURRENCY).trim().toUpperCase(),
      normalizedTags.join('|')
   ].join('::');
};

const ManageProducts = () => {
   const navigate = useNavigate();
   const [products, setProducts] = useState<Product[]>([]);
   const [loading, setLoading] = useState(true);
   const [uploading, setUploading] = useState(false);
   const [compressing, setCompressing] = useState(false);
   
   // Form State
   const [name, setName] = useState('');
   const [price, setPrice] = useState('');
   const [description, setDescription] = useState('');
   const [category, setCategory] = useState(''); // Default
   const [tagsInput, setTagsInput] = useState('');
   const [status, setStatus] = useState('enable'); // Default
   const [currency, setCurrency] = useState(DEFAULT_CURRENCY); // ✅ NEW: Currency state
   const [stockTotal, setStockTotal] = useState('');
   const [isUnlimited, setIsUnlimited] = useState(true);
   const [file, setFile] = useState<File | null>(null);
   const [cropRequest, setCropRequest] = useState<{ file: File; target: ProductImageTarget } | null>(null);
   const fileInputRef = useRef<HTMLInputElement>(null);
   
   // Filter & Sort State
   const [searchQuery, setSearchQuery] = useState('');
   const [selectedCategory, setSelectedCategory] = useState('All');
   const [selectedCurrency, setSelectedCurrency] = useState('All'); // ✅ NEW: Currency filter
   const [selectedTag, setSelectedTag] = useState('All');
   const [sortOption, setSortOption] = useState('name_asc');
   const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
   const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
   const [isPromotionSectionOpen, setIsPromotionSectionOpen] = useState(false);
   const [isEventCatalogOpen, setIsEventCatalogOpen] = useState(true);
   const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
   const [selectedEventId, setSelectedEventId] = useState('');
   const [eventCatalogDraft, setEventCatalogDraft] = useState<EventCatalogDraft>({});
   const [eventCatalogSavedDraft, setEventCatalogSavedDraft] = useState<EventCatalogDraft>({});
   const [eventCatalogLoading, setEventCatalogLoading] = useState(false);
   const [eventCatalogSaving, setEventCatalogSaving] = useState(false);
   const [eventCatalogSearch, setEventCatalogSearch] = useState('');
   const [eventCatalogCategory, setEventCatalogCategory] = useState('All');
   const [eventCatalogTag, setEventCatalogTag] = useState('All');
   const [eventCatalogView, setEventCatalogView] = useState<'all' | 'selling' | 'hidden' | 'overrides'>('all');
   const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
   const [confirmAction, setConfirmAction] = useState<ProductConfirmAction>(null);

   // Edit Modal State
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);
   const [editingProduct, setEditingProduct] = useState<Product | null>(null);
   const [editFile, setEditFile] = useState<File | null>(null);
   const editFileInputRef = useRef<HTMLInputElement>(null);
   const csvInputRef = useRef<HTMLInputElement>(null);
   
   const [artistId, setArtistId] = useState<string>('');
   const [artistName, setArtistName] = useState<string>('');

   const categories = [
      "A3", "A4", "Badge", "Cheki", "Keychain", 
      "Photo4*6", "Photocard", "Shaker", "Standy", "Sticker"
   ].sort().concat(["Other"]);
   
   // Derived Data for Suggestions (Unique Categories from Products + Defaults)
   // We use this for the datalist suggestions
   const allCategorySuggestions = Array.from(new Set([
      ...categories.filter(c => c !== 'Other'), // Defaults
      ...products.map(p => p.category?.trim()).filter(Boolean) as string[]
   ])).sort();
   const allTagSuggestions = Array.from(new Set(products.flatMap((p) => p.tags || []).map(normalizeTag).filter(Boolean))).sort();

   // Derived Data for Filter Chips (includes "All")
   const uniqueCategories = ['All', ...Array.from(new Set(products.map(p => p.category || 'Other'))).sort()];
   
   // ✅ NEW: Unique currencies from products for filter
   const uniqueCurrencies = ['All', ...Array.from(new Set(products.map(p => p.currency || DEFAULT_CURRENCY))).sort()];
   const uniqueTags = ['All', ...Array.from(new Set(products.flatMap((p) => p.tags || []).map(normalizeTag).filter(Boolean))).sort()];
   const quickCategoryChips = uniqueCategories.slice(0, 8);
   const hasMoreCategories = uniqueCategories.length > quickCategoryChips.length;

   // ✅ NEW: Check for mixed enabled currencies
   const getAvailableUnits = (product: Product) => {
      if (product.is_unlimited) return Number.POSITIVE_INFINITY;
      const total = product.stock_total || 0;
      const reserved = product.stock_reserved || 0;
      const sold = product.stock_sold || 0;
      return Math.max(0, total - reserved - sold);
   };

   const getEffectiveStatus = (product: Product): 'enable' | 'disable' | 'soldout' => {
      if (product.status === 'disable') return 'disable';
      if (product.status === 'soldout') return 'soldout';
      if (!product.is_unlimited && getAvailableUnits(product) <= 0) return 'soldout';
      return 'enable';
   };

   const enabledProducts = products.filter(p => getEffectiveStatus(p) === 'enable');
   const enabledCurrencies = Array.from(new Set(enabledProducts.map(p => p.currency || DEFAULT_CURRENCY)));
   const hasMixedCurrencies = enabledCurrencies.length > 1;

   const showToast = (message: { tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string }) => {
      setToast(message);
   };

   // ✅ NEW: Fix Mixed Currencies (Batch Update)
   const handleSwitchAll = async (targetCurrency: string) => {
      setLoading(true);
      try {
         const user = await getAuthUserSafe();
         if (!user) throw new Error('Not authenticated');

         // 1. Enable targets
         await supabase
            .from('products')
            .update({ status: 'enable' })
            .eq('artist_id', user.id)
            .eq('currency', targetCurrency)
            .neq('status', 'soldout'); // Keep soldout as soldout? Or enable? 'enable' usually resets soldout. Let's assume enable all means reset soldout too? Or just enable disabled ones. Safe to just set 'enable'.

         // 2. Disable others
         await supabase
            .from('products')
            .update({ status: 'disable' })
            .eq('artist_id', user.id)
            .neq('currency', targetCurrency);
         
         await fetchProducts();
         showToast({ tone: 'success', title: 'Active currency switched', detail: `Only ${targetCurrency} products are enabled now.` });
      } catch (error: any) {
         console.error(error);
         showToast({ tone: 'error', title: 'Failed to switch currency', detail: error.message });
      } finally {
         setLoading(false);
      }
   };

   const filteredProducts = products.filter(product => {
      const query = searchQuery.trim().toLowerCase();
      const tagHaystack = (product.tags || []).join(' ').toLowerCase();
      const matchesSearch =
         query.length === 0 ||
         product.name.toLowerCase().includes(query) ||
         (product.category || '').toLowerCase().includes(query) ||
         (product.description || '').toLowerCase().includes(query) ||
         tagHaystack.includes(query);
      const matchesCategory = selectedCategory === 'All' || (product.category || 'Other') === selectedCategory;
      const matchesCurrency = selectedCurrency === 'All' || (product.currency || DEFAULT_CURRENCY) === selectedCurrency; // ✅ NEW
      const matchesTag =
         selectedTag === 'All' ||
         (product.tags || []).some(tag => normalizeTag(tag).toLowerCase() === selectedTag.toLowerCase());
      return matchesSearch && matchesCategory && matchesCurrency && matchesTag;
   }).sort((a, b) => {
      if (sortOption === 'name_asc') return a.name.localeCompare(b.name);
      if (sortOption === 'price_asc') return a.price - b.price;
      if (sortOption === 'price_desc') return b.price - a.price;
      return 0;
   });

   const hasActiveFilters =
      searchQuery.trim().length > 0 ||
      selectedCategory !== 'All' ||
      selectedCurrency !== 'All' ||
      selectedTag !== 'All' ||
      sortOption !== 'name_asc';

   const filteredEventCatalogProducts = products.filter((product) => {
      const draft = eventCatalogDraft[product.id];
      const query = eventCatalogSearch.trim().toLowerCase();
      const tagHaystack = (product.tags || []).join(' ').toLowerCase();
      const matchesSearch =
         query.length === 0 ||
         product.name.toLowerCase().includes(query) ||
         (product.category || '').toLowerCase().includes(query) ||
         tagHaystack.includes(query);
      const matchesCategory = eventCatalogCategory === 'All' || (product.category || 'Other') === eventCatalogCategory;
      const matchesTag =
         eventCatalogTag === 'All' ||
         (product.tags || []).some(tag => normalizeTag(tag).toLowerCase() === eventCatalogTag.toLowerCase());
      const matchesView =
         eventCatalogView === 'all' ||
         (eventCatalogView === 'selling' && draft?.is_enabled) ||
         (eventCatalogView === 'hidden' && draft && !draft.is_enabled) ||
         (eventCatalogView === 'overrides' && !!draft && (draft.price_override.trim() !== '' || (!draft.is_unlimited && draft.stock_total.trim() !== '')));

      return matchesSearch && matchesCategory && matchesTag && matchesView;
   });
   const selectedEventOption = eventOptions.find((event) => event.id === selectedEventId);
   const hasEventCatalogChanges = JSON.stringify(eventCatalogDraft) !== JSON.stringify(eventCatalogSavedDraft);

   const clearAllFilters = () => {
      setSearchQuery('');
      setSelectedCategory('All');
      setSelectedCurrency('All');
      setSelectedTag('All');
      setSortOption('name_asc');
   };

   const buildDefaultCatalogDraft = (catalogRows: EventProductRecord[] = []) => {
      const rowByProductId = new Map(catalogRows.map((row) => [row.product_id, row]));
      const nextDraft: EventCatalogDraft = {};

      for (const product of products) {
         const row = rowByProductId.get(product.id);
         nextDraft[product.id] = {
            id: row?.id,
            is_enabled: row?.is_enabled ?? getEffectiveStatus(product) === 'enable',
            price_override: row?.price_override != null ? String(row.price_override) : '',
            is_unlimited: row?.is_unlimited ?? Boolean(product.is_unlimited),
            stock_total: row?.stock_total != null ? String(row.stock_total) : (product.stock_total != null ? String(product.stock_total) : ''),
         };
      }

      return nextDraft;
   };

   const fetchEventOptions = async (artistIdValue: string) => {
      const { data, error } = await supabase
         .from('events')
         .select('id, event_name, start_date, end_date, status')
         .eq('artist_id', artistIdValue)
         .in('status', ['Confirmed', 'confirmed'])
         .order('start_date', { ascending: true });

      if (error) {
         console.error('[ManageProducts] fetchEventOptions failed:', error);
         setEventOptions([]);
         return;
      }

      const events = (data || []) as EventOption[];
      setEventOptions(events);
      setSelectedEventId((current) => current || events[0]?.id || '');
   };

   const fetchEventCatalog = async (eventId: string) => {
      if (!eventId || products.length === 0) {
         setEventCatalogDraft({});
         setEventCatalogSavedDraft({});
         return;
      }

      setEventCatalogLoading(true);
      try {
         const { data, error } = await supabase
            .from('event_products')
            .select('id, event_id, product_id, artist_id, is_enabled, price_override, stock_total, stock_reserved, stock_sold, is_unlimited')
            .eq('event_id', eventId);

         if (error) throw error;
         const nextDraft = buildDefaultCatalogDraft((data || []) as EventProductRecord[]);
         setEventCatalogDraft(nextDraft);
         setEventCatalogSavedDraft(nextDraft);
      } catch (error) {
         console.error('[ManageProducts] fetchEventCatalog failed:', error);
         showToast({ tone: 'error', title: 'Event catalog failed to load' });
      } finally {
         setEventCatalogLoading(false);
      }
   };

   const updateEventCatalogDraft = (
      productId: string,
      updates: Partial<EventCatalogDraft[string]>
   ) => {
      setEventCatalogDraft((prev) => {
         const product = products.find((item) => item.id === productId);
         const fallback = {
            is_enabled: product ? getEffectiveStatus(product) === 'enable' : true,
            price_override: '',
            is_unlimited: product?.is_unlimited ?? true,
            stock_total: product?.stock_total != null ? String(product.stock_total) : '',
         };
         return {
            ...prev,
            [productId]: {
               ...fallback,
               ...(prev[productId] || {}),
               ...updates,
            },
         };
      });
   };

   const updateFilteredEventCatalogDraft = (updates: Partial<EventCatalogDraft[string]>) => {
      if (filteredEventCatalogProducts.length === 0) return;
      setEventCatalogDraft((prev) => {
         const next = { ...prev };
         for (const product of filteredEventCatalogProducts) {
            const fallback = {
               is_enabled: getEffectiveStatus(product) === 'enable',
               price_override: '',
               is_unlimited: product.is_unlimited ?? true,
               stock_total: product.stock_total != null ? String(product.stock_total) : '',
            };
            next[product.id] = {
               ...fallback,
               ...(prev[product.id] || {}),
               ...updates,
            };
         }
         return next;
      });
   };

   const saveEventCatalog = async () => {
      if (!selectedEventId || !artistId) return;

      const invalidProduct = products.find((product) => {
         const draft = eventCatalogDraft[product.id];
         if (!draft) return false;
         if (draft.price_override.trim() !== '' && Number(draft.price_override) < 0) return true;
         if (!draft.is_unlimited && (draft.stock_total.trim() === '' || Number(draft.stock_total) < 0 || !Number.isInteger(Number(draft.stock_total)))) return true;
         return false;
      });

      if (invalidProduct) {
         showToast({ tone: 'warning', title: 'Invalid event catalog value', detail: `Check price/stock for ${invalidProduct.name}.` });
         return;
      }

      setEventCatalogSaving(true);
      try {
         const payload = products.map((product) => {
            const draft = eventCatalogDraft[product.id] || {
               is_enabled: getEffectiveStatus(product) === 'enable',
               price_override: '',
               is_unlimited: product.is_unlimited ?? true,
               stock_total: product.stock_total != null ? String(product.stock_total) : '',
            };

            return {
               event_id: selectedEventId,
               product_id: product.id,
               artist_id: artistId,
               is_enabled: draft.is_enabled,
               price_override: draft.price_override.trim() === '' ? null : Number(draft.price_override),
               is_unlimited: draft.is_unlimited,
               stock_total: draft.is_unlimited ? null : Number(draft.stock_total || 0),
            };
         });

         const { error } = await supabase
            .from('event_products')
            .upsert(payload, { onConflict: 'event_id,product_id' });

         if (error) throw error;
         showToast({ tone: 'success', title: 'Event catalog saved', detail: 'POS will use this event-specific menu and stock.' });
         await fetchEventCatalog(selectedEventId);
      } catch (error: any) {
         console.error('[ManageProducts] saveEventCatalog failed:', error);
         showToast({ tone: 'error', title: 'Failed to save event catalog', detail: error.message });
      } finally {
         setEventCatalogSaving(false);
      }
   };

   const fetchProducts = async () => {
      setLoading(true);
      try {
         const user = await getAuthUserSafe();
         
         // Fix: Force redirect if no session to prevent "Artist not found" errors
         if (!user) {
            navigate('/manage-login');
            return;
         }

         setArtistId(user.id);
         await fetchEventOptions(user.id);

         // Fetch Artist Name
         const { data: artist } = await supabase
            .from('artists')
            .select('display_name')
            .eq('id', user.id)
            .single();
         
         if (artist) setArtistName(artist.display_name);

         const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('artist_id', user.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

         if (!error && data) {
            setProducts((data || []).map((product) => normalizeProductRecord(product) as Product));
         }
      } catch (error) {
         console.error('[ManageProducts] fetchProducts failed:', error);
      } finally {
         setLoading(false);
      }
   };

   useEffect(() => {
      fetchProducts();
   }, []);

   useEffect(() => {
      if (selectedEventId && products.length > 0) {
         void fetchEventCatalog(selectedEventId);
      } else {
         setEventCatalogDraft({});
      }
   }, [selectedEventId, products.length]);

   const getProductImageUrl = (dbValue: string, width: number = 400) => {
      if (!dbValue) return '';
      let path = dbValue;
      if (dbValue.includes('http') && dbValue.includes('Menu/')) {
         const parts = dbValue.split('Menu/');
         if (parts.length > 1) path = parts[1];
      }
      const { data } = supabase.storage.from('Menu').getPublicUrl(path);
      
      // Use ImageKit Utility
      return getOptimizedImageUrl(data.publicUrl, width);
   };


   const handleImageCompression = async (imageFile: File): Promise<File> => {
      // Options for compression
      const options = {
         maxSizeMB: 0.2,           // 200KB
         maxWidthOrHeight: 1024,   // Max dimension
         useWebWorker: true,
         fileType: 'image/webp',   // Try to convert to WebP
         initialQuality: 0.8       // 80% quality at first
      };

      // If file is larger than 10MB, reject immediately
      if (imageFile.size > 10 * 1024 * 1024) {
         throw new Error("File too large");
      }
      // Skip if already small enough (e.g. < 200KB)
      if (imageFile.size / 1024 / 1024 < 0.2) {
         return imageFile; 
      }

      try {
         const compressedFile = await imageCompression(imageFile, options);
         // Keep original name but change extension if converted
         const newName = imageFile.name.replace(/\.[^/.]+$/, "") + '.webp';
         return new File([compressedFile], newName, { type: 'image/webp' });
      } catch (error) {
         console.warn('Image compression failed, using original.', error);
         return imageFile;
      }
   };

   const prepareImageForCrop = async (selectedFile: File, target: ProductImageTarget) => {
      if (!isAllowedProductImage(selectedFile)) {
         showToast({ tone: 'warning', title: 'Unsupported image type', detail: 'Use JPG, PNG, WebP, HEIC, or HEIF.' });
         return;
      }

      setCompressing(true);
      try {
         const editableFile = await convertHeicToEditableImage(selectedFile);
         setCropRequest({ file: editableFile, target });
      } catch (error) {
         console.error('[ManageProducts] HEIC conversion failed:', error);
         showToast({ tone: 'error', title: 'Could not read this iPhone image', detail: 'Please try saving it as JPG, PNG, or WebP.' });
      } finally {
         setCompressing(false);
      }
   };

   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (!selectedFile) return;
      await prepareImageForCrop(selectedFile, 'add');
      e.target.value = '';
   };

   const handleCroppedImage = async (croppedFile: File) => {
      if (!cropRequest) return;

      setCompressing(true);
      try {
         const compressed = await handleImageCompression(croppedFile);
         if (cropRequest.target === 'add') {
            setFile(compressed);
         } else {
            setEditFile(compressed);
         }
         setCropRequest(null);
      } catch (error) {
         console.error('[ManageProducts] cropped image compression failed:', error);
         if (cropRequest.target === 'add') {
            setFile(croppedFile);
         } else {
            setEditFile(croppedFile);
         }
         setCropRequest(null);
      } finally {
         setCompressing(false);
      }
   };

   const handleAddProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !price || !category.trim()) {
         showToast({ tone: 'warning', title: 'Required fields missing', detail: 'Fill in Product Name, Price & Currency, and Category.' });
         return;
      }

      if (!isUnlimited && (stockTotal === '' || Number(stockTotal) < 0 || !Number.isInteger(Number(stockTotal)))) {
         showToast({ tone: 'warning', title: 'Invalid stock quantity', detail: 'Enter a whole number greater than or equal to 0, or mark the item as Unlimited.' });
         return;
      }

      const normalizedTags = parseTagsInput(tagsInput);
      const duplicateKey = buildProductDuplicateKey({
         name,
         category: category || 'Other',
         currency,
         tags: normalizedTags
      });
      const hasDuplicate = products.some(product =>
         buildProductDuplicateKey({
            name: product.name,
            category: product.category || 'Other',
            currency: product.currency || DEFAULT_CURRENCY,
            tags: product.tags || []
         }) === duplicateKey
      );

      if (hasDuplicate) {
         showToast({ tone: 'warning', title: 'Duplicate product', detail: 'A product with the same name, category, currency, and tags already exists.' });
         return;
      }

      setUploading(true);
      try {
         const user = await getAuthUserSafe();
         if (!user) throw new Error('Not authenticated');

         // 1. Upload image if provided
         let filePath = '';

         if (file) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            filePath = `public/${fileName}`;

            const { error: uploadError } = await supabase.storage
               .from('Menu')
               .upload(filePath, file);

            if (uploadError) throw uploadError;
         }

         // 2. Insert to DB
         const { error: dbError } = await supabase
            .from('products')
            .insert([{
               artist_id: user.id,
               name,
               price: parseFloat(price),
               description,
               category,
               tags: normalizedTags,
               status,
               currency,  // ✅ NEW: Save currency
               stock_total: isUnlimited ? null : Number(stockTotal || 0),
               is_unlimited: isUnlimited,
               image_url: filePath
            }]);

         if (dbError) throw dbError;

         // Reset Form
         setName('');
         setPrice('');
         setDescription('');
         setCategory('');
         setTagsInput('');
         setStatus('enable');
         setCurrency(DEFAULT_CURRENCY);  // ✅ NEW: Reset currency
         setStockTotal('');
         setIsUnlimited(true);
         setFile(null);
         if (fileInputRef.current) fileInputRef.current.value = '';
         
         await fetchProducts();
         showToast({ tone: 'success', title: 'Product added', detail: name });

      } catch (error: any) {
         console.error(error);
         showToast({ tone: 'error', title: 'Error adding product', detail: error.message });
      } finally {
         setUploading(false);
      }
   };

   const handleDeleteProduct = async (id: string) => {
      try {
         // 1. Soft Delete (Update deleted_at)
         const { error: dbError } = await supabase
            .from('products')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id);

         if (dbError) throw dbError;

         // Note: We do NOT delete the image from storage to preserve history for past orders.

         await fetchProducts();
         showToast({ tone: 'success', title: 'Product deleted' });

      } catch (error) {
         console.error('Error deleting product', error);
         showToast({ tone: 'error', title: 'Failed to delete product' });
      }
   };

   const requestDeleteProduct = (product: Product) => {
      setConfirmAction({ type: 'delete_product', id: product.id, name: product.name });
   };


   const handleEditClick = (product: Product) => {
      setEditingProduct(product);
      setName(product.name);
      setPrice(product.price.toString());
      setDescription(product.description || '');
      setCategory(product.category || '');
      setTagsInput(formatTagsInput(product.tags));
      setStatus(product.status || 'enable');
      setCurrency(product.currency || DEFAULT_CURRENCY);  // ✅ NEW: Load product currency
      setIsUnlimited(product.is_unlimited ?? true);
      setStockTotal(product.stock_total ? String(product.stock_total) : '');
      setEditFile(null);
      setIsEditModalOpen(true);
   };

   const handleEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (!selectedFile) return;
      await prepareImageForCrop(selectedFile, 'edit');
      e.target.value = '';
   };

   const handleUpdateProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingProduct || !name || !price) {
         showToast({ tone: 'warning', title: 'Required fields missing', detail: 'Please fill in all required fields.' });
         return;
      }

      setUploading(true);
      try {
         let imageUrl = editingProduct.image_url;

         // If new image selected, upload it
         if (editFile) {
            const fileExt = editFile.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `public/${fileName}`;

            const { error: uploadError } = await supabase.storage
               .from('Menu')
               .upload(filePath, editFile);

            if (uploadError) throw uploadError;
            imageUrl = filePath;

            // Delete old image if it exists
            if (editingProduct.image_url) {
               let oldPath = editingProduct.image_url;
               if (oldPath.includes('Menu/')) {
                  oldPath = oldPath.split('Menu/')[1];
               }
               await supabase.storage.from('Menu').remove([oldPath]);
            }
         }

         // Update product in database
         const { error: dbError } = await supabase
            .from('products')
            .update({
               name,
               price: parseFloat(price),
               description,
               category,
               tags: parseTagsInput(tagsInput),
               status,
               currency,  // ✅ NEW: Update currency
               stock_total: isUnlimited ? null : Number(stockTotal || 0),
               is_unlimited: isUnlimited,
               image_url: imageUrl
            })
            .eq('id', editingProduct.id);

         if (dbError) throw dbError;

         // Reset and refresh
         setIsEditModalOpen(false);
         setEditingProduct(null);
         setEditFile(null);
         setName('');
         setPrice('');
         setDescription('');
         setCategory('');
         setTagsInput('');
         setStatus('enable');
         setCurrency(DEFAULT_CURRENCY);  // ✅ NEW: Reset currency
         setStockTotal('');
         setIsUnlimited(true);
         
         await fetchProducts();
         showToast({ tone: 'success', title: 'Product updated', detail: name });

      } catch (error: any) {
         console.error(error);
         showToast({ tone: 'error', title: 'Error updating product', detail: error.message });
      } finally {
         setUploading(false);
      }
   };

   const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
         showToast({ tone: 'warning', title: 'Invalid file type', detail: 'Please upload a CSV file.' });
         return;
      }

      Papa.parse(file, {
         header: true,
         skipEmptyLines: true,
         transformHeader: (header: string) => {
            return header.trim().toLowerCase().replace(/[\s-]+/g, '_');
         },
         complete: async (results: Papa.ParseResult<Record<string, string>>) => {
            const rows = results.data as any[];
            if (!rows || rows.length === 0) {
               showToast({ tone: 'warning', title: 'CSV is empty' });
               return;
            }

            const validItems: any[] = [];
            const errors: string[] = [];

            const existingKeys = new Set(
               products.map(product => buildProductDuplicateKey({
                  name: product.name,
                  category: product.category || 'Other',
                  currency: product.currency || DEFAULT_CURRENCY,
                  tags: product.tags || []
               }))
            );
            const importedKeys = new Set<string>();

            const user = await getAuthUserSafe();
            if (!user) {
               showToast({ tone: 'error', title: 'Not authenticated' });
               return;
            }

            rows.forEach((row: any, index: number) => {
               // Sanitize: trim all string values
               const sanitizedRow: any = {};
               Object.keys(row).forEach(key => {
                  const value = row[key];
                  sanitizedRow[key] = typeof value === 'string' ? value.trim() : value;
               });

               // Extract fields (case-insensitive)
               const name = getCsvValue(sanitizedRow, ['name', 'product_name', 'item_name', 'product', 'item']);
               const priceRaw = getCsvValue(sanitizedRow, ['price', 'unit_price']);
               const category = getCsvValue(sanitizedRow, ['category', 'product_category', 'type']);
               const tagsRaw = getCsvValue(sanitizedRow, ['tags', 'tag', 'product_tag', 'product_tags']);
               const description = getCsvValue(sanitizedRow, ['description', 'details', 'note']);
               const currencyRaw = getCsvValue(sanitizedRow, ['currency']);
               const status = getCsvValue(sanitizedRow, ['status']);
               const stockRaw = getCsvValue(sanitizedRow, ['stock', 'stock_total', 'stocktotal', 'qty', 'quantity']);
               const unlimitedRaw = getCsvValue(sanitizedRow, ['is_unlimited', 'unlimited', 'isunlimited']);

               // Validate required fields
               if (!name || !priceRaw) {
                  const missing = [];
                  if (!name) missing.push('name');
                  if (!priceRaw) missing.push('price');
                  errors.push(`Row ${index + 2}: Missing required field(s): ${missing.join(', ')}`);
                  return;
               }

               // Sanitize price: remove commas and parse
               const priceClean = priceRaw.toString().replace(/,/g, '');
               const price = parseFloat(priceClean);

               if (isNaN(price) || price <= 0) {
                  errors.push(`Row ${index + 2}: Invalid price value "${priceRaw}"`);
                  return;
               }

               // ✅ FIX: Validate and use currency from CSV (default to THB if missing)
               const validCurrencies = Object.keys(CURRENCIES);
               const normalizedCurrencyRaw = String(currencyRaw || '').trim().toUpperCase();
               const currency = normalizedCurrencyRaw && validCurrencies.includes(normalizedCurrencyRaw) 
                  ? normalizedCurrencyRaw
                  : DEFAULT_CURRENCY;

               // ✅ NEW: Optional stock columns
               const parseBoolean = (value: unknown): boolean | null => {
                  if (value === undefined || value === null || value === '') return null;
                  const normalized = String(value).trim().toLowerCase();
                  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
                  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
                  return null;
               };

               const hasStockValue = stockRaw !== undefined && stockRaw !== null && String(stockRaw).trim() !== '';
               let parsedStock: number | null = null;
               if (hasStockValue) {
                  const stockClean = String(stockRaw).replace(/,/g, '');
                  const stockNumber = Number(stockClean);
                  if (!Number.isInteger(stockNumber) || stockNumber < 0) {
                     errors.push(`Row ${index + 2}: Invalid stock value "${stockRaw}" (must be integer >= 0)`);
                     return;
                  }
                  parsedStock = stockNumber;
               }

               const parsedUnlimited = parseBoolean(unlimitedRaw);
               if (unlimitedRaw !== undefined && unlimitedRaw !== null && String(unlimitedRaw).trim() !== '' && parsedUnlimited === null) {
                  errors.push(`Row ${index + 2}: Invalid is_unlimited value "${unlimitedRaw}" (use true/false, 1/0, yes/no)`);
                  return;
               }

               let isUnlimitedItem = true;
               let stockTotalItem: number | null = null;

               if (parsedUnlimited === true) {
                  isUnlimitedItem = true;
                  stockTotalItem = null;
               } else if (parsedUnlimited === false) {
                  if (parsedStock === null) {
                     errors.push(`Row ${index + 2}: Missing stock value while is_unlimited is false`);
                     return;
                  }
                  isUnlimitedItem = false;
                  stockTotalItem = parsedStock;
               } else if (parsedStock !== null) {
                  isUnlimitedItem = false;
                  stockTotalItem = parsedStock;
               }
               
               // Validate status
               const validStatuses = ['enable', 'disable', 'soldout'];
               const normalizedStatus = String(status || '').trim().toLowerCase();
               const productStatus = normalizedStatus && validStatuses.includes(normalizedStatus)
                  ? normalizedStatus
                  : 'enable';

               const normalizedTags = parseTagsInput(String(tagsRaw || ''));
               const duplicateKey = buildProductDuplicateKey({
                  name: String(name),
                  category: String(category || 'Other'),
                  currency: String(currency),
                  tags: normalizedTags
               });

               if (existingKeys.has(duplicateKey)) {
                  errors.push(`Row ${index + 2}: Duplicate product already exists`);
                  return;
               }

               if (importedKeys.has(duplicateKey)) {
                  errors.push(`Row ${index + 2}: Duplicate row in CSV upload`);
                  return;
               }

               importedKeys.add(duplicateKey);

               validItems.push({
                  artist_id: user.id,
                  name: name,
                  price: price,
                  currency: currency, // ✅ FIX: Now uses currency from CSV
                  category: category || 'Other',
                  tags: normalizedTags,
                  description: description || '',
                  status: productStatus,
                  is_unlimited: isUnlimitedItem,
                  stock_total: stockTotalItem,
                  image_url: ''
               });
            });

            // Log errors to console for debugging
            if (errors.length > 0) {
               console.warn('CSV Upload Validation Errors:');
               errors.forEach(err => console.warn(err));
            }

            if (validItems.length > 0) {
               try {
                  setUploading(true);
                  const { error } = await supabase.from('products').insert(validItems);
                  
                  if (error) throw error;

                  const message = `Successfully uploaded ${validItems.length} item(s)!${errors.length > 0 ? `\n\n${errors.length} row(s) skipped. Check console for details.` : ''}`;
                  showToast({ tone: 'success', title: 'CSV upload complete', detail: message });
                  if (csvInputRef.current) csvInputRef.current.value = '';
                  await fetchProducts();
               } catch (err: any) {
                  console.error('File upload error:', err);
                  showToast({ tone: 'error', title: 'Failed to upload items', detail: err.message });
               } finally {
                  setUploading(false);
               }
            } else {
               showToast({
                  tone: 'warning',
                  title: 'No valid rows found',
                  detail: errors.length > 0
                     ? errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n... and ${errors.length - 5} more errors.` : '')
                     : "Ensure CSV has 'name' and 'price' columns (optional: stock, is_unlimited)."
               });
            }
         },
         error: (err: Error) => {
            console.error('CSV Parse Error:', err);
            showToast({ tone: 'error', title: 'Failed to parse CSV file' });
         }
   });
   };

   const handleConfirmAction = async () => {
      if (!confirmAction) return;

      const action = confirmAction;
      setConfirmAction(null);

      if (action.type === 'switch_currency') {
         await handleSwitchAll(action.currency);
         return;
      }

      if (action.type === 'delete_product') {
         await handleDeleteProduct(action.id);
      }
   };

   return (
      <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
         {/* ✅ NEW: Unified Admin Header */}
         <AdminHeader activePage="menu" />
         <Toast message={toast} onClose={() => setToast(null)} />
         <ConfirmDialog
            open={!!confirmAction}
            title={
               confirmAction?.type === 'switch_currency'
                  ? `Enable only ${confirmAction.currency}?`
                  : 'Delete product?'
            }
            detail={
               confirmAction?.type === 'switch_currency'
                  ? `Products in other currencies will be disabled. Sold out items stay unchanged.`
                  : confirmAction?.type === 'delete_product'
                    ? `${confirmAction.name} will be hidden from the active menu. Past orders keep their history.`
                    : undefined
            }
            confirmLabel={confirmAction?.type === 'delete_product' ? 'Delete' : 'Confirm'}
            tone={confirmAction?.type === 'delete_product' ? 'danger' : 'default'}
            loading={loading || uploading}
            onConfirm={() => void handleConfirmAction()}
            onCancel={() => setConfirmAction(null)}
         />
         {cropRequest && (
            <ProductImageCropModal
               file={cropRequest.file}
               onCancel={() => setCropRequest(null)}
               onConfirm={handleCroppedImage}
               onError={(message) => showToast({ tone: 'error', title: 'Image export failed', detail: message })}
            />
         )}
         
         {/* Page Title Wrapper */}
         <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4 mb-2">
            <h1 className="text-xl font-black text-gray-800 tracking-tight">Manage Products</h1>
            <p className="text-sm text-pink-600 font-bold">{artistName}</p>
         </div>

         <main className="max-w-5xl mx-auto px-4 md:px-6 pb-12">
            <section className="workspace-card mb-4 p-3">
               <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                     <p className="text-xs font-black uppercase tracking-wide text-gray-400">Quick actions</p>
                     <p className="text-sm font-semibold text-gray-700">Jump to the creator task you need right now.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                     <button
                        type="button"
                        onClick={() => setIsAddSectionOpen(true)}
                        className="workspace-action inline-flex items-center justify-center gap-2 border border-pink-200 bg-pink-50 px-3 py-2 text-sm font-black text-pink-700 hover:bg-pink-100"
                     >
                        <Plus size={16} aria-hidden="true" />
                        Add Product
                     </button>
                     <button
                        type="button"
                        onClick={() => setIsBulkUploadOpen(true)}
                        className="workspace-action inline-flex items-center justify-center gap-2 border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-700 hover:bg-gray-50"
                     >
                        <Upload size={16} aria-hidden="true" />
                        Import CSV
                     </button>
                     <button
                        type="button"
                        onClick={() => setIsEventCatalogOpen(true)}
                        className="workspace-action inline-flex items-center justify-center gap-2 border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-700 hover:bg-gray-50"
                     >
                        <CalendarDays size={16} aria-hidden="true" />
                        Event Catalog
                     </button>
                  </div>
               </div>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
               <button
                  type="button"
                  onClick={() => setIsAddSectionOpen((prev) => !prev)}
                  className="w-full px-4 py-4 flex items-start justify-between gap-4 text-left"
               >
                  <div>
                     <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <Plus className="text-pink-500" size={18} />
                        Add New Item
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">Fast path for single item creation with stock and tags.</p>
                  </div>
                  {isAddSectionOpen ? <ChevronUp className="text-gray-400 shrink-0" size={18} /> : <ChevronDown className="text-gray-400 shrink-0" size={18} />}
               </button>

               {isAddSectionOpen && (
               <div className="border-t border-gray-100 p-4 animate-fade-in">
               <form onSubmit={handleAddProduct} className="space-y-4">
                  {/* Row 1: Product Name | Price & Currency | Category */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Product Name *</label>
                        <input 
                           type="text" 
                           value={name}
                           onChange={(e) => setName(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           placeholder="e.g. Iced Latte"
                           required
                        />
                     </div>
                     
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                           <Coins size={12} /> Price & Currency *
                        </label>
                        <div className="flex flex-col md:flex-row gap-2">
                           <input 
                              type="number" 
                              value={price}
                              onChange={(e) => setPrice(e.target.value)}
                              className="flex-1 w-full min-w-0 px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                              placeholder="0.00"
                              min="0"
                              step="0.01"
                              required
                           />
                           <select
                              value={currency}
                              onChange={(e) => setCurrency(e.target.value)}
                              className="w-full md:w-24 shrink-0 px-2 py-1.5 text-sm font-semibold text-gray-600 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all bg-white cursor-pointer"
                              aria-label="Currency"
                           >
                              {Object.entries(CURRENCIES).map(([code, info]) => (
                                 <option key={code} value={code}>{info.symbol} {code}</option>
                              ))}
                           </select>
                        </div>
                     </div>

                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Category *</label>
                        <input
                           list="category-suggestions"
                           type="text"
                           value={category}
                           onChange={(e) => setCategory(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           placeholder="Select or type..."
                           required
                        />
                        <datalist id="category-suggestions">
                           {allCategorySuggestions.map(cat => (
                              <option key={cat} value={cat} />
                           ))}
                        </datalist>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Tags</label>
                     <input
                        list="tag-suggestions"
                        type="text"
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                        placeholder="e.g. Genshin Impact, Flins, Fontaine"
                     />
                     <datalist id="tag-suggestions">
                        {allTagSuggestions.map(tag => (
                           <option key={tag} value={tag} />
                        ))}
                     </datalist>
                     <p className="text-[11px] text-gray-400">Separate tags with comma, pipe, or semicolon.</p>
                  </div>

                  {/* Row 2: Image | Status | Stock */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Image</label>
                        <div className="relative">
                           <input 
                              type="file" 
                              ref={fileInputRef}
                              onChange={handleFileChange}
                              className="hidden"
                              id="file-upload"
                              accept={PRODUCT_IMAGE_ACCEPT}
                           />
                           <label 
                              htmlFor="file-upload" 
                              className={`w-full flex items-center justify-center px-3 py-1.5 border border-dashed rounded cursor-pointer transition-colors ${file ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-300 text-gray-500 hover:border-pink-400'}`}
                           >
                              <Upload size={14} className="mr-2 shrink-0" />
                              <span className="truncate text-xs font-medium max-w-[200px] md:max-w-none">
                                 {compressing ? 'Compressing...' : (file ? file.name : 'Choose Image')}
                              </span>
                           </label>
                        </div>
                        <p className="text-[10px] text-gray-400">JPG, PNG, WebP, HEIC, or HEIF. Crop before upload.</p>
                        {compressing && <p className="text-[10px] text-pink-500 font-bold mt-1 animate-pulse">Preparing image...</p>}
                     </div>

                     <div className="space-y-1">
                        <label htmlFor="product-status" className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Status *</label>
                        <select
                           id="product-status"
                           value={status}
                           onChange={(e) => setStatus(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-600 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all bg-white"
                           aria-label="Product status"
                           required
                        >
                           <option value="enable">Enable</option>
                           <option value="disable">Disable</option>
                           <option value="soldout">Sold Out</option>
                        </select>
                     </div>

                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Stock *</label>
                        <div className="flex items-center gap-2 mb-2">
                           <input
                              id="is-unlimited"
                              type="checkbox"
                              checked={isUnlimited}
                              onChange={(e) => setIsUnlimited(e.target.checked)}
                           />
                           <label htmlFor="is-unlimited" className="text-xs text-gray-600 font-semibold">Unlimited</label>
                        </div>
                        <input
                           type="number"
                           value={stockTotal}
                           onChange={(e) => setStockTotal(e.target.value)}
                           disabled={isUnlimited}
                           min="0"
                           step="1"
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all disabled:bg-gray-100 disabled:text-gray-400"
                           placeholder={isUnlimited ? 'Unlimited stock' : 'Enter stock quantity'}
                           required={!isUnlimited}
                        />
                     </div>
                  </div>

                  {/* Row 3: Description */}
                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Description 
                        <span className="text-[10px] text-gray-400 ml-2 font-normal">({description.length}/200)</span>
                     </label>
                     <textarea 
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                        className="w-full px-3 py-1.5 text-sm text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all h-16 resize-none"
                        placeholder="Brief description..."
                     />
                  </div>


                  <div className="flex justify-end">
                     <Button 
                        type="submit" 
                        disabled={uploading}
                        className="bg-pink-500 hover:bg-pink-600 text-white py-2 px-6 rounded shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 text-xs font-bold h-9"
                     >
                        {uploading ? <Loader className="animate-spin mx-auto" size={16} /> : 'Add Product'}
                     </Button>
                  </div>

               </form>
               </div>
               )}
            </section>

            <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
               <button
                  type="button"
                  onClick={() => setIsBulkUploadOpen((prev) => !prev)}
                  className="w-full px-4 py-4 flex items-start justify-between gap-4 text-left"
               >
                  <div>
                     <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <FileText className="text-pink-500" size={18} />
                        Bulk Upload
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">Import many items at once. Duplicate rows are skipped automatically.</p>
                  </div>
                  {isBulkUploadOpen ? <ChevronUp className="text-gray-400 shrink-0" size={18} /> : <ChevronDown className="text-gray-400 shrink-0" size={18} />}
               </button>

               {isBulkUploadOpen && (
                  <div className="border-t border-gray-100 p-4 animate-fade-in">
                     <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                           <p className="text-xs text-gray-500">
                              CSV columns: <span className="font-semibold">name, price</span> (optional: category, tags, description, currency, status, stock, is_unlimited)
                           </p>
                           <p className="mt-1 text-[11px] text-gray-400">Use this for large menu setup. Existing duplicates will be ignored instead of inserted twice.</p>
                        </div>
                        <div className="flex items-center gap-2">
                           <input
                              type="file"
                              ref={csvInputRef}
                              onChange={handleBulkUpload}
                              className="hidden"
                              accept=".csv"
                           />
                           <Button
                              type="button"
                              onClick={() => csvInputRef.current?.click()}
                              disabled={uploading}
                              className="bg-[#d63384] hover:bg-[#ff3385] text-white py-2 px-4 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 flex items-center gap-2 text-xs font-bold"
                           >
                              {uploading ? <Loader className="animate-spin" size={14} /> : <Upload size={14} />}
                              {uploading ? 'Uploading...' : 'Upload CSV'}
                           </Button>
                        </div>
                     </div>
                  </div>
               )}
            </section>

            <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
               <button
                  type="button"
                  onClick={() => setIsPromotionSectionOpen((prev) => !prev)}
                  className="w-full px-4 py-4 flex items-start justify-between gap-4 text-left"
               >
                  <div>
                     <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <Sparkles className="text-pink-500" size={18} />
                        Promotions
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">Manage pricing rules separately from daily product maintenance.</p>
                  </div>
                  {isPromotionSectionOpen ? <ChevronUp className="text-gray-400 shrink-0" size={18} /> : <ChevronDown className="text-gray-400 shrink-0" size={18} />}
               </button>

               {isPromotionSectionOpen && (
                  <div className="border-t border-gray-100 p-4 animate-fade-in">
                     <PromotionManager
                        artistId={artistId}
                        products={products}
                        eventOptions={eventOptions}
                        categorySuggestions={allCategorySuggestions}
                        tagSuggestions={allTagSuggestions}
                     />
                  </div>
               )}
            </section>

            <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
               <button
                  type="button"
                  onClick={() => setIsEventCatalogOpen((prev) => !prev)}
                  className="w-full px-4 py-4 flex items-start justify-between gap-4 text-left"
               >
                  <div>
                     <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <CalendarDays className="text-pink-500" size={18} />
                        Event Catalog
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">Choose which products, price, and stock are available for each event booth.</p>
                  </div>
                  {isEventCatalogOpen ? <ChevronUp className="text-gray-400 shrink-0" size={18} /> : <ChevronDown className="text-gray-400 shrink-0" size={18} />}
               </button>

               {isEventCatalogOpen && (
                  <div className="border-t border-gray-100 p-4 animate-fade-in space-y-4">
                     <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                           <label className="text-xs font-black uppercase tracking-wide text-gray-500">Event</label>
                           <select
                              value={selectedEventId}
                              onChange={(event) => setSelectedEventId(event.target.value)}
                              className="min-w-[260px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200"
                              disabled={eventOptions.length === 0}
                              aria-label="Select event catalog"
                           >
                              {eventOptions.length === 0 && <option value="">No confirmed events</option>}
                              {eventOptions.map((event) => (
                                 <option key={event.id} value={event.id}>{event.event_name}</option>
                              ))}
                           </select>
                           {selectedEventOption && (
                              <span className="rounded-full bg-pink-50 px-3 py-1 text-xs font-black text-pink-700">
                                 {new Date(selectedEventOption.start_date).toLocaleDateString('en-GB')}
                              </span>
                           )}
                        </div>
                        <button
                           type="button"
                           onClick={() => void saveEventCatalog()}
                           disabled={!selectedEventId || eventCatalogSaving || eventCatalogLoading || products.length === 0}
                           className="inline-flex items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 py-2 text-xs font-black text-white shadow-md shadow-pink-100 transition-colors hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
                        >
                           {eventCatalogSaving ? <Loader className="animate-spin" size={14} /> : <Save size={14} />}
                           {hasEventCatalogChanges ? 'Save Changes' : 'Saved'}
                        </button>
                     </div>

                     <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                        hasEventCatalogChanges
                           ? 'border-pink-200 bg-pink-50 text-pink-800'
                           : 'border-gray-200 bg-gray-50 text-gray-600'
                     }`}>
                        {hasEventCatalogChanges
                           ? 'You have unsaved event catalog changes. Save before opening POS for this event.'
                           : 'Event catalog is saved. POS and customer menu will use this setup.'}
                     </div>

                     <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_180px_180px] gap-2">
                        <div className="relative">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                           <input
                              value={eventCatalogSearch}
                              onChange={(event) => setEventCatalogSearch(event.target.value)}
                              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-pink-200"
                              placeholder="Search event products..."
                           />
                        </div>
                        <select
                           value={eventCatalogCategory}
                           onChange={(event) => setEventCatalogCategory(event.target.value)}
                           className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-pink-200"
                           aria-label="Filter event catalog category"
                        >
                           {uniqueCategories.map((item) => <option key={item} value={item}>{item === 'All' ? 'All categories' : item}</option>)}
                        </select>
                        <select
                           value={eventCatalogTag}
                           onChange={(event) => setEventCatalogTag(event.target.value)}
                           className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-pink-200"
                           aria-label="Filter event catalog tag"
                        >
                           {uniqueTags.map((item) => <option key={item} value={item}>{item === 'All' ? 'All tags' : item}</option>)}
                        </select>
                     </div>

                     <div className="flex flex-wrap items-center gap-2">
                        {(['all', 'selling', 'hidden', 'overrides'] as const).map((view) => (
                           <button
                              key={view}
                              type="button"
                              onClick={() => setEventCatalogView(view)}
                              className={`rounded-full px-3 py-1.5 text-xs font-black capitalize transition-colors ${
                                 eventCatalogView === view
                                    ? 'bg-pink-600 text-white shadow-sm shadow-pink-100'
                                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                              }`}
                           >
                              {view}
                           </button>
                        ))}
                        <span className="ml-auto rounded-full bg-gray-100 px-3 py-1.5 text-xs font-black text-gray-600">
                           {filteredEventCatalogProducts.length} of {products.length}
                        </span>
                     </div>

                     <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <span className="text-xs font-black uppercase tracking-wide text-gray-500">Bulk visible</span>
                        <button
                           type="button"
                           onClick={() => updateFilteredEventCatalogDraft({ is_enabled: true })}
                           className="workspace-action min-h-9 rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-black text-pink-700 hover:bg-pink-50"
                        >
                           Sell visible
                        </button>
                        <button
                           type="button"
                           onClick={() => updateFilteredEventCatalogDraft({ is_enabled: false })}
                           className="workspace-action min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-700 hover:bg-gray-100"
                        >
                           Hide visible
                        </button>
                        <button
                           type="button"
                           onClick={() => updateFilteredEventCatalogDraft({ price_override: '' })}
                           className="workspace-action min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-black text-gray-700 hover:bg-gray-100"
                        >
                           Reset visible prices
                        </button>
                     </div>

                     {!selectedEventId ? (
                        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-semibold text-gray-500">
                           Create or confirm an event before assigning products.
                        </div>
                     ) : (
                        <div className="overflow-hidden rounded-xl border border-gray-200">
                           <div className="hidden md:grid grid-cols-[minmax(240px,1.4fr)_110px_140px_160px] gap-3 bg-gray-50 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-gray-500">
                              <div>Product</div>
                              <div>Sell</div>
                              <div>Event Price</div>
                              <div>Event Stock</div>
                           </div>
                           <div className="divide-y divide-gray-100">
                              {filteredEventCatalogProducts.map((product) => {
                                 const draft = eventCatalogDraft[product.id] || {
                                    is_enabled: getEffectiveStatus(product) === 'enable',
                                    price_override: '',
                                    is_unlimited: product.is_unlimited ?? true,
                                    stock_total: product.stock_total != null ? String(product.stock_total) : '',
                                 };
                                 return (
                                    <div key={`event-catalog-${product.id}`} className="grid grid-cols-1 md:grid-cols-[minmax(240px,1.4fr)_110px_140px_160px] gap-3 px-4 py-3 items-center">
                                       <div className="min-w-0 flex items-center gap-3">
                                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-100">
                                             {product.image_url ? (
                                                <img
                                                   src={getProductImageUrl(product.image_url, 120)}
                                                   alt={product.name}
                                                   className="h-full w-full object-cover"
                                                   loading="lazy"
                                                   decoding="async"
                                                />
                                             ) : (
                                                <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-gray-400">No image</div>
                                             )}
                                          </div>
                                          <div className="min-w-0">
                                             <div className="text-sm font-bold text-gray-800 truncate">{product.name}</div>
                                             <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                {draft.price_override.trim() !== '' || (!draft.is_unlimited && draft.stock_total.trim() !== '') ? (
                                                   <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
                                                      Custom
                                                   </span>
                                                ) : (
                                                   <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-black text-gray-500">
                                                      Global
                                                   </span>
                                                )}
                                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-black text-gray-600">
                                                   {product.category || 'Other'}
                                                </span>
                                                {(product.tags || []).slice(0, 3).map((tag) => (
                                                   <span key={`${product.id}-event-${tag}`} className="rounded bg-pink-50 px-1.5 py-0.5 text-[10px] font-black text-pink-600">
                                                      #{tag}
                                                   </span>
                                                ))}
                                                {(product.tags || []).length > 3 && (
                                                   <span className="text-[10px] font-bold text-gray-400">+{(product.tags || []).length - 3}</span>
                                                )}
                                             </div>
                                             <div className="mt-1 text-[11px] font-semibold text-gray-500">
                                                Global: {formatPrice(product.price, product.currency)} · {product.is_unlimited ? 'Unlimited' : `${product.stock_total || 0} stock`}
                                             </div>
                                          </div>
                                       </div>

                                       <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700">
                                          <input
                                             type="checkbox"
                                             checked={draft.is_enabled}
                                             onChange={(event) => updateEventCatalogDraft(product.id, { is_enabled: event.target.checked })}
                                             className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                                          />
                                          Sell
                                       </label>

                                       <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={draft.price_override}
                                          onChange={(event) => updateEventCatalogDraft(product.id, { price_override: event.target.value })}
                                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200"
                                          placeholder={String(product.price)}
                                          aria-label={`Event price for ${product.name}`}
                                       />

                                       <div className="space-y-2">
                                          <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700">
                                             <input
                                                type="checkbox"
                                                checked={draft.is_unlimited}
                                                onChange={(event) => updateEventCatalogDraft(product.id, { is_unlimited: event.target.checked })}
                                                className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                                             />
                                             Unlimited
                                          </label>
                                          <input
                                             type="number"
                                             min="0"
                                             step="1"
                                             value={draft.stock_total}
                                             onChange={(event) => updateEventCatalogDraft(product.id, { stock_total: event.target.value })}
                                             disabled={draft.is_unlimited}
                                             className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200 disabled:bg-gray-100 disabled:text-gray-400"
                                             placeholder={draft.is_unlimited ? 'Unlimited' : 'Qty'}
                                             aria-label={`Event stock for ${product.name}`}
                                          />
                                       </div>
                                    </div>
                                 );
                              })}
                           </div>
                        </div>
                     )}
                  </div>
               )}
            </section>

            {hasEventCatalogChanges && selectedEventId && (
               <div className="sticky bottom-4 z-30 mb-6 rounded-2xl border border-pink-200 bg-white/95 p-3 shadow-xl shadow-pink-100/70 backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div>
                        <p className="text-sm font-black text-gray-900">Unsaved event catalog</p>
                        <p className="text-xs font-semibold text-gray-500">Save before using POS or sharing the customer menu for this event.</p>
                     </div>
                     <button
                        type="button"
                        onClick={() => void saveEventCatalog()}
                        disabled={eventCatalogSaving || eventCatalogLoading}
                        className="workspace-action inline-flex items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 py-2 text-sm font-black text-white shadow-md shadow-pink-100 hover:bg-pink-700 disabled:bg-gray-300"
                     >
                        {eventCatalogSaving ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
                        Save catalog
                     </button>
                  </div>
               </div>
            )}

            {/* ✅ NEW: Mixed Currency Warning */}
            {hasMixedCurrencies && (
               <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in shadow-sm">
                  <div className="flex items-start gap-3">
                     <div className="p-2 bg-amber-100 rounded-full text-amber-600 shrink-0">
                        <AlertTriangle size={20} />
                     </div>
                     <div>
                        <h3 className="text-sm font-bold text-amber-800">Multiple Currencies Enabled</h3>
                        <p className="text-xs text-amber-600 mt-1">
                           You have products enabled in multiple currencies ({enabledCurrencies.join(', ')}). 
                           <br/>Please enable only one currency to avoid issues.
                        </p>
                     </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 bg-white p-1.5 rounded-lg border border-amber-100 shadow-sm">
                     <span className="text-xs font-bold text-gray-500 pl-2">Enable Only:</span>
                     <select 
                        className="text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-1 focus:outline-none cursor-pointer hover:bg-amber-100 transition-colors"
                        onChange={(e) => {
                           if (e.target.value) setConfirmAction({ type: 'switch_currency', currency: e.target.value });
                        }}
                        value=""
                     >
                        <option value="" disabled>Select Currency...</option>
                        {enabledCurrencies.map(c => (
                           <option key={c} value={c}>{c}</option>
                        ))}
                     </select>
                  </div>
               </div>
            )}

            {/* FILTER & SORT SECTION */}
            <div className="mb-8 space-y-4 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
               <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                     <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <PackageSearch className="text-pink-500" size={18} />
                        Browse Current Menu
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">Search, filter, and sort the catalog before editing or removing items.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                     <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600">
                        <Filter size={12} />
                        {filteredProducts.length} of {products.length} items
                     </div>
                     {hasActiveFilters && (
                        <button
                           type="button"
                           onClick={clearAllFilters}
                           className="inline-flex items-center gap-2 rounded-full border border-pink-200 bg-pink-50 px-3 py-1.5 text-xs font-bold text-pink-600 hover:bg-pink-100 transition-colors"
                        >
                           Clear all filters
                        </button>
                     )}
                  </div>
               </div>

               {/* Search & Sort Row */}
               <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative flex-1">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input 
                        type="text"
                        placeholder="Search products..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm"
                     />
                  </div>
                  
                  <div className="relative min-w-[200px]">
                     <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <ArrowUpDown className="text-gray-400" size={16} />
                     </div>
                     <select
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value)}
                        className="w-full pl-10 pr-8 py-2.5 appearance-none rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm font-medium text-sm"
                     >
                        <option value="name_asc">Name (A-Z)</option>
                        <option value="price_asc">Price (Low to High)</option>
                        <option value="price_desc">Price (High to Low)</option>
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>
               </div>

               {/* Category Chips + More Dropdown */}
               <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Category:</span>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 flex-1">
                  {quickCategoryChips.map(cat => (
                     <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                           selectedCategory === cat 
                              ? 'bg-pink-500 text-white shadow-md shadow-pink-200' 
                              : 'bg-white border border-gray-200 text-gray-600 hover:border-pink-300 hover:text-pink-500'
                        }`}
                     >
                        {cat}
                     </button>
                  ))}
                  </div>
                  {hasMoreCategories && (
                     <div className="relative min-w-[180px]">
                        <select
                           value={quickCategoryChips.includes(selectedCategory) ? 'More categories' : selectedCategory}
                           onChange={(e) => {
                              const nextValue = e.target.value;
                              if (nextValue !== 'More categories') setSelectedCategory(nextValue);
                           }}
                           className="w-full rounded-full border border-gray-200 bg-white px-3 py-1.5 pr-8 text-xs font-bold text-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                           aria-label="Select category from all categories"
                        >
                           <option value="More categories" disabled>More categories</option>
                           {uniqueCategories.filter((cat) => !quickCategoryChips.includes(cat)).map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                           ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
                     </div>
                  )}
               </div>
               
               {/* ✅ NEW: Currency Filter Chips */}
               {uniqueCurrencies.length > 2 && (
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-center mr-1 flex items-center gap-1">
                        <Coins size={12} /> Currency:
                     </span>
                     {uniqueCurrencies.map(curr => (
                        <button
                           key={curr}
                           onClick={() => setSelectedCurrency(curr)}
                           className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                              selectedCurrency === curr 
                                 ? 'bg-amber-500 text-white shadow-md shadow-amber-200' 
                                 : 'bg-white border border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-500'
                           }`}
                        >
                           {curr === 'All' ? 'All' : `${CURRENCIES[curr]?.symbol || curr} ${curr}`}
                        </button>
                     ))}
                  </div>
               )}

               {uniqueTags.length > 1 && (
                  <div className="flex flex-col md:flex-row md:items-center gap-2">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 shrink-0">
                        <TagIcon size={12} /> Tag:
                     </span>
                     <div className="relative w-full md:max-w-sm">
                        <select
                           value={selectedTag}
                           onChange={(e) => setSelectedTag(e.target.value)}
                           className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-sm font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                           aria-label="Filter by tag"
                        >
                           {uniqueTags.map(tag => (
                              <option key={tag} value={tag}>{tag === 'All' ? 'All tags' : tag}</option>
                           ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                     </div>
                  </div>
               )}

               {hasActiveFilters && (
                  <div className="flex flex-wrap gap-2">
                     {searchQuery.trim() && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                           Search: {searchQuery.trim()}
                        </span>
                     )}
                     {selectedCategory !== 'All' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-600">
                           Category: {selectedCategory}
                        </span>
                     )}
                     {selectedCurrency !== 'All' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                           Currency: {selectedCurrency}
                        </span>
                     )}
                     {selectedTag !== 'All' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                           Tag: {selectedTag}
                        </span>
                     )}
                  </div>
               )}
            </div>

            {/* PRODUCT LIST */}
            <h2 className="text-lg font-bold text-gray-800 mb-4 px-1">Current Menu ({filteredProducts.length})</h2>
            
            {loading ? (
               <div className="text-center py-12 text-gray-400">Loading products...</div>
            ) : filteredProducts.length > 0 ? (
               <>
                  {/* MOBILE VIEW: List/Cards (<768px) */}
                  <div className="flex flex-col gap-3 md:hidden">
                     {filteredProducts.map(product => {
                        const effectiveStatus = getEffectiveStatus(product);
                        return (
                        <div key={product.id} className="bg-white/70 backdrop-blur-md border border-white/40 shadow-sm rounded-xl overflow-hidden flex flex-row h-28 group relative">
                           {/* Image */}
                           <div className="w-[100px] bg-gray-100 relative overflow-hidden shrink-0">
                              <img 
                                 src={getProductImageUrl(product.image_url, 400)} 
                                 alt={product.name}
                                 className="w-full h-full object-cover"
                                 loading="lazy"
                                 decoding="async"
                              />
                              {(effectiveStatus === 'disable' || effectiveStatus === 'soldout') && (
                                 <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                    <span className={`text-[10px] font-black tracking-wider border px-1 -rotate-12 ${
                                       effectiveStatus === 'soldout' ? 'text-red-400 border-red-400' : 'text-white border-white'
                                    }`}>
                                       {effectiveStatus === 'soldout' ? 'SOLD OUT' : 'DISABLED'}
                                    </span>
                                 </div>
                              )}
                           </div>
                           
                           {/* Content */}
                           <div className="p-3 flex flex-col justify-between flex-1 min-w-0">
                              <div>
                                 <h3 className="font-bold text-gray-800 text-sm leading-tight line-clamp-2 pr-8">{product.name}</h3>
                                 <div className="mt-1 flex items-baseline gap-2">
                                    <span className="text-pink-600 font-black text-sm">{formatPrice(product.price, product.currency)}</span>
                                    {product.category && (
                                       <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold uppercase rounded">
                                          {product.category}
                                       </span>
                                    )}
                                 </div>
                                 {!!product.tags?.length && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                       {product.tags.slice(0, 3).map((tag) => (
                                          <span key={`${product.id}-${tag}`} className="px-1.5 py-0.5 bg-pink-50 text-pink-600 text-[9px] font-bold rounded">
                                             #{tag}
                                          </span>
                                       ))}
                                       {product.tags.length > 3 && (
                                          <span className="text-[9px] font-bold text-gray-400">+{product.tags.length - 3}</span>
                                       )}
                                    </div>
                                 )}
                                 <p className="text-[10px] font-semibold text-gray-500 mt-1">
                                    Stock: {product.is_unlimited ? 'Unlimited' : `${getAvailableUnits(product)} available`}
                                 </p>
                              </div>
                              
                              {/* Mobile Actions (Always Visible) */}
                              <div className="absolute bottom-2 right-2 flex gap-2">
                                  <button onClick={(e) => { e.stopPropagation(); handleEditClick(product); }} className="icon-touch inline-flex items-center justify-center text-gray-400 hover:text-blue-600 bg-white/80 rounded-full shadow-sm border border-gray-100" aria-label={`Edit ${product.name}`}><Edit2 size={14}/></button>
                                  <button onClick={(e) => { e.stopPropagation(); requestDeleteProduct(product); }} className="icon-touch inline-flex items-center justify-center text-gray-400 hover:text-red-600 bg-white/80 rounded-full shadow-sm border border-gray-100" aria-label={`Delete ${product.name}`}><Trash2 size={14}/></button>
                              </div>
                           </div>
                        </div>
                     )})}
                  </div>

                  {/* DESKTOP VIEW: Table (>=768px) */}
                  <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in">
                     <table className="w-full text-left border-collapse">
                        <thead>
                           <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wider">
                              <th className="px-6 py-4 font-bold w-[40%]">Product</th>
                              <th className="px-6 py-4 font-bold">Category</th>
                              <th className="px-6 py-4 font-bold">Price</th>
                              <th className="px-6 py-4 font-bold">Stock</th>
                              <th className="px-6 py-4 font-bold">Status</th>
                              <th className="px-6 py-4 font-bold text-right">Actions</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                           {filteredProducts.map(product => {
                              const effectiveStatus = getEffectiveStatus(product);
                              return (
                              <tr key={product.id} className="hover:bg-gray-50/50 transition-colors group">
                                 <td className="px-6 py-4">
                                    <div className="flex items-center gap-4">
                                       <div className="w-12 h-12 rounded-lg bg-gray-100 relative overflow-hidden shrink-0 border border-gray-100 group-hover:scale-105 transition-transform">
                                          <img 
                                             src={getProductImageUrl(product.image_url, 100)} 
                                             alt={product.name}
                                             className="w-full h-full object-cover"
                                             loading="lazy"
                                             decoding="async"
                                          />
                                          {effectiveStatus === 'soldout' && <div className="absolute inset-0 bg-black/50" />}
                                       </div>
                                       <div>
                                          <h4 className="font-bold text-gray-800 text-sm line-clamp-1">{product.name}</h4>
                                          {product.description && <p className="text-xs text-gray-400 line-clamp-1 max-w-[240px]">{product.description}</p>}
                                          {!!product.tags?.length && (
                                             <div className="mt-1 flex flex-wrap gap-1 max-w-[260px]">
                                                {product.tags.slice(0, 3).map((tag) => (
                                                   <span key={`${product.id}-${tag}`} className="px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 text-[10px] font-bold">
                                                      #{tag}
                                                   </span>
                                                ))}
                                             </div>
                                          )}
                                       </div>
                                    </div>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-100 text-gray-600">
                                       {product.category || 'Other'}
                                    </span>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="font-bold text-gray-900">{formatPrice(product.price, product.currency)}</span>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="font-semibold text-gray-700 text-sm">
                                       {product.is_unlimited
                                          ? 'Unlimited'
                                          : `${getAvailableUnits(product)} / ${product.stock_total || 0}`}
                                    </span>
                                 </td>
                                 <td className="px-6 py-4">
                                    {effectiveStatus === 'enable' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>}
                                    {effectiveStatus === 'disable' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">Disabled</span>}
                                    {effectiveStatus === 'soldout' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600">Sold Out</span>}
                                 </td>
                                 <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 transition-opacity">
                                       <button 
                                          onClick={() => handleEditClick(product)}
                                          className="icon-touch inline-flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                          title="Edit"
                                          aria-label={`Edit ${product.name}`}
                                       >
                                          <Edit2 size={18} />
                                       </button>
                                       <button 
                                          onClick={() => requestDeleteProduct(product)}
                                          className="icon-touch inline-flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                          title="Delete"
                                          aria-label={`Delete ${product.name}`}
                                       >
                                          <Trash2 size={18} />
                                       </button>
                                    </div>
                                 </td>
                              </tr>
                           )})}
                        </tbody>
                     </table>
                  </div>
               </>
            ) : (
               <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                  <span className="material-icons-outlined text-4xl text-gray-300 mb-2">restaurant_menu</span>
                  <p className="text-gray-500">No items available. Add your first product above.</p>
               </div>
            )}

         </main>

         {/* Edit Product Modal */}
         {isEditModalOpen && editingProduct && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                     <h2 className="text-xl font-bold text-gray-800">Edit Product</h2>
                     <button 
                        onClick={() => {
                           setIsEditModalOpen(false);
                           setEditingProduct(null);
                           setEditFile(null);
                        }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                     >
                        <X size={24} />
                     </button>
                  </div>
                  
                  <form onSubmit={handleUpdateProduct} className="p-6 space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Product Name *</label>
                           <input 
                              type="text" 
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="e.g. Iced Latte"
                              required
                           />
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                              <Coins size={14} /> Price & Currency *
                           </label>
                           <div className="flex gap-2">
                              <input 
                                 type="number" 
                                 value={price}
                                 onChange={(e) => setPrice(e.target.value)}
                                 className="flex-1 px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                                 placeholder="0.00"
                                 min="0"
                                 step="0.01"
                                 required
                              />
                              <select
                                 value={currency}
                                 onChange={(e) => setCurrency(e.target.value)}
                                 className="w-28 px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all bg-white font-bold cursor-pointer"
                                 aria-label="Currency"
                              >
                                 {Object.entries(CURRENCIES).map(([code, info]) => (
                                    <option key={code} value={code}>{info.symbol} {code}</option>
                                 ))}
                              </select>
                           </div>
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                           <input
                              list="category-suggestions"
                              type="text"
                              value={category}
                              onChange={(e) => setCategory(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="Select or type category..."
                           />
                           {/* Datalist is reusable, defined above in the Add form */}
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                           <input
                              list="tag-suggestions"
                              type="text"
                              value={tagsInput}
                              onChange={(e) => setTagsInput(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="e.g. Genshin Impact, Flins"
                           />
                           <p className="mt-1 text-xs text-gray-400">Separate tags with comma, pipe, or semicolon.</p>
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Product Image</label>
                           <div className="relative">
                              <input 
                                 type="file" 
                                 ref={editFileInputRef}
                                 onChange={handleEditFileChange}
                                 className="hidden"
                                 id="edit-file-upload"
                                 accept={PRODUCT_IMAGE_ACCEPT}
                              />
                              <label 
                                 htmlFor="edit-file-upload" 
                                 className={`w-full flex items-center justify-center px-4 py-2 border border-dashed rounded-lg cursor-pointer transition-colors ${editFile ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-300 text-gray-500 hover:border-pink-400'}`}
                              >
                                 <Upload size={18} className="mr-2" />
                                 <span className="truncate text-sm">
                                    {compressing ? 'Compressing...' : (editFile ? editFile.name : 'Choose New Image')}
                                 </span>
                              </label>
                           </div>
                           <p className="mt-1 text-xs text-gray-400">JPG, PNG, WebP, HEIC, or HEIF. Crop before upload.</p>
                           {compressing && <p className="text-xs text-pink-500 font-bold mt-1 animate-pulse">Preparing image...</p>}
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                           <select
                              value={status}
                              onChange={(e) => setStatus(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all bg-white"
                           >
                              <option value="enable">Enable</option>
                              <option value="disable">Disable</option>
                              <option value="soldout">Sold Out</option>
                           </select>
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Stock</label>
                           <div className="flex items-center gap-2 mb-2">
                              <input
                                 id="edit-is-unlimited"
                                 type="checkbox"
                                 checked={isUnlimited}
                                 onChange={(e) => setIsUnlimited(e.target.checked)}
                              />
                              <label htmlFor="edit-is-unlimited" className="text-sm text-gray-600">Unlimited</label>
                           </div>
                           <input
                              type="number"
                              value={stockTotal}
                              onChange={(e) => setStockTotal(e.target.value)}
                              disabled={isUnlimited}
                              min="0"
                              step="1"
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all disabled:bg-gray-100 disabled:text-gray-400"
                              placeholder={isUnlimited ? 'Unlimited stock' : 'Enter stock quantity'}
                           />
                        </div>
                     </div>

                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                           Description 
                           <span className="text-xs text-gray-400 ml-2">({description.length}/200)</span>
                        </label>
                        <textarea 
                           value={description}
                           onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                           className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all h-24 resize-none"
                           placeholder="Brief description of the product..."
                        />
                     </div>

                     {editingProduct.image_url && !editFile && (
                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Current Image</label>
                           <div className="flex items-end gap-3">
                              <img 
                                 src={getProductImageUrl(editingProduct.image_url, 200)} 
                                 alt="Current"
                                 loading="lazy"
                                 decoding="async"
                                 className="h-32 w-32 rounded-lg border border-gray-200 bg-gray-100 object-cover"
                                 onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200?text=No+Image'; }}
                              />
                              <Button
                                 type="button"
                                 onClick={() => editFileInputRef.current?.click()}
                                 className="rounded-lg border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-bold text-pink-700 hover:bg-pink-100"
                              >
                                 Change image
                              </Button>
                           </div>
                        </div>
                     )}

                     <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                        <Button 
                           type="button"
                           onClick={() => {
                              setIsEditModalOpen(false);
                              setEditingProduct(null);
                              setEditFile(null);
                           }}
                           className="px-6 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                        >
                           Cancel
                        </Button>
                        <Button 
                           type="submit" 
                           disabled={uploading}
                           className="bg-[#d63384] hover:bg-[#ff3385] text-white py-2 px-8 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95"
                        >
                           {uploading ? <Loader className="animate-spin mx-auto" size={20} /> : 'Save Changes'}
                        </Button>
                     </div>
                  </form>
               </div>
            </div>
         )}
      </div>
   );
};

export default ManageProducts;
