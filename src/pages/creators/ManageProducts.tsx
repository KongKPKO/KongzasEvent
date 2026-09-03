import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../../components/ui';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader, Trash2, Upload, Plus, FileText, Edit2, X, Search, ArrowUpDown, ChevronDown, Coins, AlertTriangle, Filter, PackageSearch, Sparkles, CalendarDays, Save, Download, Copy, LayoutGrid, List } from 'lucide-react';
import Papa from 'papaparse';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import AdminHeader from '../../components/AdminHeader';
import EventNavTabs from '../../components/EventNavTabs';
import { formatPrice, DEFAULT_CURRENCY, CURRENCIES } from '../../utils/currency';
import { getAuthUserSafe } from '../../utils/auth';
import { fetchActorContext } from '../../utils/access';
import type { ActorContext } from '../../types/access';
import { normalizeProductRecord } from '../../utils/schemaCompat';
import { useI18n } from '../../i18n';
import { listMyOnlineCampaigns, saveCampaignProducts } from '../../lib/onlineCampaigns';
import type { OnlineCampaignSummary } from '../../types/onlineCampaign';
import PromotionManager from '../../components/promotions/PromotionManager';
import ProductImageCropModal from '../../components/ProductImageCropModal';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import {
   addCatalogStock,
   addEventStock,
   fetchProductStockSummaries,
   getStockAdjustmentErrorMessage,
   removeCatalogStock,
   removeEventStock,
   type ProductStockSummary,
} from '../../lib/stockAdjustments';

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
  variant_group_name?: string | null;
  variant_name?: string | null;
  variant_sort_order?: number;
  product_template_id?: string | null;
  product_template_variant_id?: string | null;
  sku?: string | null;
}

interface ProductTemplateVariant {
  id: string;
  template_id: string;
  artist_id: string;
  variant_name: string;
  variant_sort_order: number;
  tags?: string[];
  price_override?: number | null;
  image_url?: string;
  status?: 'enable' | 'disable' | 'soldout';
}

interface ProductTemplate {
  id: string;
  artist_id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  tags?: string[];
  description?: string;
  is_unlimited: boolean;
  stock_total?: number | null;
  status: 'active' | 'archived';
  image_url?: string;
  product_template_variants?: ProductTemplateVariant[];
}

interface EventOption {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  status: string;
  currency_override?: string | null;
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
  stock_reserved?: number;
  stock_sold?: number;
}>;

type ProductImageTarget = 'add' | 'edit';
type CatalogWorkspaceTab = 'catalog' | 'event-catalog' | 'promotions' | 'templates' | 'import';
interface ManageProductsProps {
   initialTab?: CatalogWorkspaceTab;
}
type ProductConfirmAction =
   | { type: 'switch_currency'; currency: string }
   | { type: 'delete_product'; id: string; name: string }
   | null;
type StockAction =
   | { scope: 'catalog'; kind: 'add' | 'remove'; product: Product }
   | { scope: 'event'; kind: 'add' | 'remove'; product: Product; eventProductId: string }
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
const normalizeOptionalText = (value: string) => {
   const normalized = value.trim().replace(/\s+/g, ' ');
   return normalized || null;
};
const parseSortOrder = (value: string) => {
   const parsed = Number(value);
   return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

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

const parseTemplateVariantsInput = (value: string, existingNames: string[] = [], baseSortOrder = 0) => {
   const seen = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
   return value
      .split(/\r?\n/)
      .map((line, index) => {
         const parts = line.split('|').map((part) => part.trim());
         const variantName = normalizeOptionalText(parts[0] || '');
         if (!variantName) return null;

         const key = variantName.toLowerCase();
         if (seen.has(key)) return null;
         seen.add(key);

         const priceOverrideRaw = parts[2] || '';
         const sortRaw = parts[3] || '';
         const priceOverride = priceOverrideRaw && Number.isFinite(Number(priceOverrideRaw))
            ? Number(priceOverrideRaw)
            : null;
         const sortOrder = sortRaw && Number.isFinite(Number(sortRaw))
            ? Math.trunc(Number(sortRaw))
            : baseSortOrder + index + 1;

         return {
            variant_name: variantName,
            tags: parseTagsInput(parts[1] || ''),
            price_override: priceOverride,
            variant_sort_order: sortOrder,
            status: 'enable' as const,
            image_url: '',
         };
      })
      .filter((variant): variant is {
         variant_name: string;
         tags: string[];
         price_override: number | null;
         variant_sort_order: number;
         status: 'enable';
         image_url: string;
      } => Boolean(variant));
};

const parseDuplicateVariantRows = (value: string, existingNames: string[] = []) => {
   const seen = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
   const errors: string[] = [];
   const rows = value
      .split(/\r?\n/)
      .map((line, index) => {
         const parts = line.split('|').map((part) => part.trim());
         const variantName = normalizeOptionalText(parts[0] || '');
         if (!variantName) return null;

         const key = variantName.toLowerCase();
         if (seen.has(key)) {
            errors.push(`Line ${index + 1}: duplicate variant "${variantName}"`);
            return null;
         }
         seen.add(key);

         const stockRaw = parts[1] || '';
         let stockTotal: number | null = null;
         let stockMode: 'copy' | 'limited' | 'unlimited' = 'copy';

         if (stockRaw) {
            if (stockRaw.toLowerCase() === 'unlimited') {
               stockMode = 'unlimited';
            } else {
               const parsedStock = Number(stockRaw);
               if (!Number.isInteger(parsedStock) || parsedStock < 0) {
                  errors.push(`Line ${index + 1}: stock must be a whole number or Unlimited`);
                  return null;
               }
               stockMode = 'limited';
               stockTotal = parsedStock;
            }
         }

         const priceRaw = parts[3] || '';
         const priceOverride = priceRaw && Number.isFinite(Number(priceRaw))
            ? Number(priceRaw)
            : null;

         return {
            variantName,
            stockMode,
            stockTotal,
            tags: parseTagsInput(parts[2] || ''),
            priceOverride,
            sortOrder: index + 1,
         };
      })
      .filter((row): row is {
         variantName: string;
         stockMode: 'copy' | 'limited' | 'unlimited';
         stockTotal: number | null;
         tags: string[];
         priceOverride: number | null;
         sortOrder: number;
      } => Boolean(row));

   return { rows, errors };
};

const getEventCatalogSaveErrorMessage = (error: unknown) => {
   const message = error instanceof Error ? error.message : String(error || '');
   if (message.includes('event_stock_exceeds_catalog_stock')) {
      return 'This product has already been added to the event. Use Remove to return units to central stock first, then remove them from central stock if needed.';
   }
   return message || 'Event catalog could not be saved.';
};

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
   variantGroupName?: string | null;
   variantName?: string | null;
}) => {
   const normalizedTags = Array.from(
      new Set((input.tags || []).map(normalizeTag).filter(Boolean).map(tag => tag.toLowerCase()))
   ).sort();

   return [
      String(input.name || '').trim().toLowerCase(),
      String(input.category || 'Other').trim().toLowerCase(),
      String(input.currency || DEFAULT_CURRENCY).trim().toUpperCase(),
      String(input.variantGroupName || '').trim().toLowerCase(),
      String(input.variantName || '').trim().toLowerCase(),
      normalizedTags.join('|')
   ].join('::');
};

const ManageProducts = ({ initialTab = 'catalog' }: ManageProductsProps) => {
   const { t } = useI18n();
   const navigate = useNavigate();
   const { eventId: routeEventId } = useParams();
   const [searchParams] = useSearchParams();
   const [products, setProducts] = useState<Product[]>([]);
   const [productTemplates, setProductTemplates] = useState<ProductTemplate[]>([]);
   const [loading, setLoading] = useState(true);
   const [uploading, setUploading] = useState(false);
   const [compressing, setCompressing] = useState(false);
   
   // Form State
   const [name, setName] = useState('');
   const [price, setPrice] = useState('');
   const [description, setDescription] = useState('');
   const [category, setCategory] = useState('Other');
   const [tagsInput, setTagsInput] = useState('');
   const [status, setStatus] = useState('enable'); // Default
   const [currency, setCurrency] = useState(DEFAULT_CURRENCY); // ✅ NEW: Currency state
   const [stockTotal, setStockTotal] = useState('');
   const [isUnlimited, setIsUnlimited] = useState(true);
   const [variantGroupName, setVariantGroupName] = useState('');
   const [variantName, setVariantName] = useState('');
   const [variantSortOrder, setVariantSortOrder] = useState('0');
   const [sku, setSku] = useState('');
   const [file, setFile] = useState<File | null>(null);
   const [cropRequest, setCropRequest] = useState<{ file: File; target: ProductImageTarget } | null>(null);
   const fileInputRef = useRef<HTMLInputElement>(null);
   
   // Filter & Sort State
   const [searchQuery, setSearchQuery] = useState('');
   const [selectedCategory, setSelectedCategory] = useState('All');
   const [selectedCurrency, setSelectedCurrency] = useState('All'); // ✅ NEW: Currency filter
   const [selectedTag, setSelectedTag] = useState('All');
   const [sortOption, setSortOption] = useState('name_asc');
   const [catalogFocus, setCatalogFocus] = useState<'all' | 'missing-images' | 'low-stock' | 'inactive'>('all');
   const [catalogDisplayMode, setCatalogDisplayMode] = useState<'visual' | 'operations'>('visual');
   const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<CatalogWorkspaceTab>(initialTab);
   const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
   const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
   const [selectedEventId, setSelectedEventId] = useState('');
   const [eventCatalogDraft, setEventCatalogDraft] = useState<EventCatalogDraft>({});
   const [eventCatalogSavedDraft, setEventCatalogSavedDraft] = useState<EventCatalogDraft>({});
   const [eventCatalogStockLimitByProduct, setEventCatalogStockLimitByProduct] = useState<Record<string, number>>({});
   const [eventCurrencyDraft, setEventCurrencyDraft] = useState('');
   const [eventCurrencySaved, setEventCurrencySaved] = useState('');
   const [eventCatalogLoading, setEventCatalogLoading] = useState(false);
   const [eventCatalogSaving, setEventCatalogSaving] = useState(false);
   const [eventCatalogSearch, setEventCatalogSearch] = useState('');
   const [eventCatalogCategory, setEventCatalogCategory] = useState('All');
   const [eventCatalogTag, setEventCatalogTag] = useState('All');
   const [eventCatalogView, setEventCatalogView] = useState<'all' | 'selling' | 'hidden' | 'overrides'>('all');
   const [eventCatalogDisplayMode, setEventCatalogDisplayMode] = useState<'visual' | 'operations'>('visual');
   const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
   const [confirmAction, setConfirmAction] = useState<ProductConfirmAction>(null);
   const [stockSummaries, setStockSummaries] = useState<Record<string, ProductStockSummary>>({});
   const [stockAction, setStockAction] = useState<StockAction>(null);
   const [stockActionQuantity, setStockActionQuantity] = useState('');
   const [stockActionReason, setStockActionReason] = useState('');
   const [stockActionSaving, setStockActionSaving] = useState(false);
   const [stockActionError, setStockActionError] = useState('');
   const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
   const [templatesLoading, setTemplatesLoading] = useState(false);
   const [templateSaving, setTemplateSaving] = useState(false);
   const [templateApplyId, setTemplateApplyId] = useState('');
   const [templateApplySaving, setTemplateApplySaving] = useState(false);
   const [templateName, setTemplateName] = useState('');
   const [templateCategory, setTemplateCategory] = useState('');
   const [templatePrice, setTemplatePrice] = useState('');
   const [templateCurrency, setTemplateCurrency] = useState(DEFAULT_CURRENCY);
   const [templateTagsInput, setTemplateTagsInput] = useState('');
   const [templateDescription, setTemplateDescription] = useState('');
   const [templateIsUnlimited, setTemplateIsUnlimited] = useState(true);
   const [templateStockTotal, setTemplateStockTotal] = useState('');
   const [templateVariantsInput, setTemplateVariantsInput] = useState('');
   const [templateVariantDrafts, setTemplateVariantDrafts] = useState<Record<string, string>>({});
   const [templateVariantSavingId, setTemplateVariantSavingId] = useState('');
   const [variantSourceProduct, setVariantSourceProduct] = useState<Product | null>(null);
   const [duplicateVariantsInput, setDuplicateVariantsInput] = useState('');
   const [duplicateVariantsSaving, setDuplicateVariantsSaving] = useState(false);
   const [addToSaleProduct, setAddToSaleProduct] = useState<Product | null>(null);
   const [addToSaleType, setAddToSaleType] = useState<'event' | 'campaign'>('campaign');
   const [addToSaleId, setAddToSaleId] = useState('');
   const [addToSaleStock, setAddToSaleStock] = useState('');
   const [addToSalePrice, setAddToSalePrice] = useState('');
   const [addToSaleSaving, setAddToSaleSaving] = useState(false);
   const [campaignOptions, setCampaignOptions] = useState<OnlineCampaignSummary[]>([]);

   // Edit Modal State
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);
   const [editingProduct, setEditingProduct] = useState<Product | null>(null);
   const [editFile, setEditFile] = useState<File | null>(null);
   const editFileInputRef = useRef<HTMLInputElement>(null);
   const csvInputRef = useRef<HTMLInputElement>(null);
   
   const [artistId, setArtistId] = useState<string>('');
   const [artistName, setArtistName] = useState<string>('');
   const [actorContext, setActorContext] = useState<ActorContext | null>(null);
   const isEventScopedWorkspace = Boolean(routeEventId);

   const categories = [
      "A3", "A4", "Badge", "Cheki", "Keychain", 
      "Photo4*6", "Photocard", "Shaker", "Standy", "Sticker"
   ].sort().concat(["Other"]);
   
   // Derived Data for Suggestions (Unique Categories from Products + Defaults)
   // We use this for the datalist suggestions
   const allCategorySuggestions = Array.from(new Set([
      ...categories.filter(c => c !== 'Other'), // Defaults
      ...products.map(p => p.category?.trim()).filter(Boolean) as string[],
      ...productTemplates.map(t => t.category?.trim()).filter(Boolean) as string[]
   ])).sort();
   const allTagSuggestions = Array.from(new Set([
      ...products.flatMap((p) => p.tags || []).map(normalizeTag).filter(Boolean),
      ...productTemplates.flatMap((template) => template.tags || []).map(normalizeTag).filter(Boolean),
      ...productTemplates.flatMap((template) => template.product_template_variants || []).flatMap((variant) => variant.tags || []).map(normalizeTag).filter(Boolean),
   ])).sort();
   const allVariantGroupSuggestions = Array.from(new Set(
      products.map((p) => p.variant_group_name?.trim()).filter(Boolean) as string[]
   )).sort();

   useEffect(() => {
      if (routeEventId) {
         setSelectedEventId(routeEventId);
         setActiveWorkspaceTab(initialTab);
         return;
      }

      const requestedTab = searchParams.get('tab');
      if (requestedTab === 'catalog' || requestedTab === 'promotions' || requestedTab === 'import') {
         setActiveWorkspaceTab(requestedTab);
      } else {
         setActiveWorkspaceTab(initialTab);
      }

      const requestedEventId = searchParams.get('eventId');
      if (requestedEventId) {
         setSelectedEventId(requestedEventId);
      }
   }, [initialTab, routeEventId, searchParams]);

   // Derived Data for Filter Chips (includes "All")
   const uniqueCategories = ['All', ...Array.from(new Set(products.map(p => p.category || 'Other'))).sort()];
   
   // ✅ NEW: Unique currencies from products for filter
   const uniqueCurrencies = ['All', ...Array.from(new Set(products.map(p => p.currency || DEFAULT_CURRENCY))).sort()];
   const uniqueTags = ['All', ...Array.from(new Set(products.flatMap((p) => p.tags || []).map(normalizeTag).filter(Boolean))).sort()];
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
   const getProductStockSummary = (product: Product) => stockSummaries[product.id] || {
      product_id: product.id,
      on_hand: product.stock_total || 0,
      allocated: 0,
      available: getAvailableUnits(product),
   };

   const enabledProducts = products.filter(p => getEffectiveStatus(p) === 'enable');
   const enabledCurrencies = Array.from(new Set(enabledProducts.map(p => p.currency || DEFAULT_CURRENCY)));
   const hasMixedCurrencies = enabledCurrencies.length > 1;
   const catalogMissingImages = products.filter((product) => !product.image_url).length;
   const catalogLowStock = products.filter((product) => {
      if (product.is_unlimited) return false;
      const summary = getProductStockSummary(product);
      return summary.available > 0 && summary.available <= 5;
   }).length;
   const catalogInactive = products.filter((product) => getEffectiveStatus(product) !== 'enable').length;
   const catalogVariantGroups = new Set(products.map((product) => product.variant_group_name || '').filter(Boolean)).size;

   const renderCatalogStockFlow = (product: Product, compact = false) => {
      if (product.is_unlimited) {
         return (
            <div className={compact ? 'mt-1 inline-flex rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-600' : 'inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-600'}>
               Unlimited
            </div>
         );
      }

      const summary = getProductStockSummary(product);
      const onHand = Math.max(summary.on_hand || 0, 0);
      const allocated = Math.max(summary.allocated || 0, 0);
      const available = Math.max(summary.available || 0, 0);
      const held = Math.max(onHand - allocated - available, 0);
      const denominator = Math.max(onHand, allocated + available + held, 1);
      const availablePct = Math.max(0, Math.min(100, (available / denominator) * 100));
      const allocatedPct = Math.max(0, Math.min(100, (allocated / denominator) * 100));
      const heldPct = Math.max(0, Math.min(100, (held / denominator) * 100));

      return (
         <div className={compact ? 'mt-1 max-w-[210px]' : 'min-w-[210px]'}>
            <div className={compact ? 'grid grid-cols-3 gap-1 text-[10px]' : 'grid grid-cols-3 gap-1.5 text-[11px]'}>
               <div>
                  <div className="font-black text-gray-900">{onHand}</div>
                  <div className="font-bold uppercase tracking-wide text-gray-400">On hand</div>
               </div>
               <div>
                  <div className="font-black text-emerald-700">{available}</div>
                  <div className="font-bold uppercase tracking-wide text-gray-400">Available</div>
               </div>
               <div>
                  <div className="font-black text-pink-700">{allocated}</div>
                  <div className="font-bold uppercase tracking-wide text-gray-400">Event</div>
               </div>
            </div>
            <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-gray-200">
               <div className="bg-emerald-400" style={{ width: `${availablePct}%` }} />
               <div className="bg-pink-400" style={{ width: `${allocatedPct}%` }} />
               {held > 0 && <div className="bg-amber-400" style={{ width: `${heldPct}%` }} />}
            </div>
            <div className={compact ? 'mt-1 text-[10px] font-bold text-gray-400' : 'mt-1 text-[11px] font-bold text-gray-400'}>
               <span className="text-emerald-600">Available</span>
               <span> / </span>
               <span className="text-pink-600">Allocated</span>
               {held > 0 && (
                  <>
                     <span> / </span>
                     <span className="text-amber-600">Held {held}</span>
                  </>
               )}
            </div>
         </div>
      );
   };

   const renderEventCatalogStockFlow = (product: Product, draft: EventCatalogDraft[string], stockLimit: number, compact = false) => {
      if (product.is_unlimited) {
         return (
            <div className={compact ? 'space-y-1' : 'min-w-[220px] space-y-1.5'}>
               <div className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-600">
                  Central unlimited
               </div>
               <div className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black ${
                  draft.is_unlimited ? 'bg-pink-50 text-pink-700' : 'bg-gray-100 text-gray-600'
               }`}>
                  Event {draft.is_unlimited ? 'unlimited' : `${Number(draft.stock_total || 0)} allocated`}
               </div>
            </div>
         );
      }

      const eventAllocated = draft.is_unlimited ? 0 : Math.max(Number(draft.stock_total || 0), 0);
      const centralAvailable = Number.isFinite(stockLimit)
         ? Math.max(stockLimit - eventAllocated, 0)
         : Math.max((product.stock_total || 0) - eventAllocated, 0);
      const reservedSold = Math.max((draft.stock_reserved || 0) + (draft.stock_sold || 0), 0);
      const pool = Math.max(product.stock_total || 0, centralAvailable + eventAllocated + reservedSold, 1);
      const centralPct = Math.max(0, Math.min(100, (centralAvailable / pool) * 100));
      const eventPct = Math.max(0, Math.min(100, (eventAllocated / pool) * 100));
      const reservedPct = Math.max(0, Math.min(100, (reservedSold / pool) * 100));

      return (
         <div className={compact ? 'min-w-0' : 'min-w-[220px]'}>
            <div className={compact ? 'grid grid-cols-3 gap-1 text-[10px]' : 'grid grid-cols-3 gap-1.5 text-[11px]'}>
               <div>
                  <div className="font-black text-emerald-700">{centralAvailable}</div>
                  <div className="font-bold uppercase tracking-wide text-gray-400">Central</div>
               </div>
               <div>
                  <div className="font-black text-pink-700">{eventAllocated}</div>
                  <div className="font-bold uppercase tracking-wide text-gray-400">Event</div>
               </div>
               <div>
                  <div className="font-black text-amber-700">{reservedSold}</div>
                  <div className="font-bold uppercase tracking-wide text-gray-400">Sold/held</div>
               </div>
            </div>
            <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-gray-200">
               <div className="bg-emerald-400" style={{ width: `${centralPct}%` }} />
               <div className="bg-pink-400" style={{ width: `${eventPct}%` }} />
               {reservedSold > 0 && <div className="bg-amber-400" style={{ width: `${reservedPct}%` }} />}
            </div>
            <div className={compact ? 'mt-1 text-[10px] font-bold text-gray-400' : 'mt-1 text-[11px] font-bold text-gray-400'}>
               Pool {pool} · Move central stock into this event
            </div>
         </div>
      );
   };

   const showToast = (message: { tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string }) => {
      setToast(message);
   };

   const resolveWorkspaceContext = async () => {
      const user = await getAuthUserSafe();
      if (!user) {
         navigate('/manage-login');
         return null;
      }

      const ctx = await fetchActorContext();
      if (!ctx?.artist_id) {
         navigate('/manage-login');
         return null;
      }

      setActorContext(ctx);
      setArtistId(ctx.artist_id);
      return ctx;
   };

   // ✅ NEW: Fix Mixed Currencies (Batch Update)
   const handleSwitchAll = async (targetCurrency: string) => {
      setLoading(true);
      try {
         const ctx = actorContext || await resolveWorkspaceContext();
         if (!ctx) throw new Error('Not authenticated');

         // 1. Enable targets
         await supabase
            .from('products')
            .update({ status: 'enable' })
            .eq('artist_id', ctx.artist_id)
            .eq('currency', targetCurrency)
            .neq('status', 'soldout'); // Keep soldout as soldout? Or enable? 'enable' usually resets soldout. Let's assume enable all means reset soldout too? Or just enable disabled ones. Safe to just set 'enable'.

         // 2. Disable others
         await supabase
            .from('products')
            .update({ status: 'disable' })
            .eq('artist_id', ctx.artist_id)
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
         (product.variant_group_name || '').toLowerCase().includes(query) ||
         (product.variant_name || '').toLowerCase().includes(query) ||
         tagHaystack.includes(query);
      const matchesCategory = selectedCategory === 'All' || (product.category || 'Other') === selectedCategory;
      const matchesCurrency = selectedCurrency === 'All' || (product.currency || DEFAULT_CURRENCY) === selectedCurrency; // ✅ NEW
      const matchesTag =
         selectedTag === 'All' ||
         (product.tags || []).some(tag => normalizeTag(tag).toLowerCase() === selectedTag.toLowerCase());
      const summary = getProductStockSummary(product);
      const matchesFocus =
         catalogFocus === 'all' ||
         (catalogFocus === 'missing-images' && !product.image_url) ||
         (catalogFocus === 'low-stock' && !product.is_unlimited && summary.available > 0 && summary.available <= 5) ||
         (catalogFocus === 'inactive' && getEffectiveStatus(product) !== 'enable');
      return matchesSearch && matchesCategory && matchesCurrency && matchesTag && matchesFocus;
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
      catalogFocus !== 'all' ||
      sortOption !== 'name_asc';

   const filteredEventCatalogProducts = products.filter((product) => {
      const draft = eventCatalogDraft[product.id];
      const query = eventCatalogSearch.trim().toLowerCase();
      const tagHaystack = (product.tags || []).join(' ').toLowerCase();
      const matchesSearch =
         query.length === 0 ||
         product.name.toLowerCase().includes(query) ||
         (product.category || '').toLowerCase().includes(query) ||
         (product.variant_group_name || '').toLowerCase().includes(query) ||
         (product.variant_name || '').toLowerCase().includes(query) ||
         tagHaystack.includes(query);
      const matchesCategory = eventCatalogCategory === 'All' || (product.category || 'Other') === eventCatalogCategory;
      const matchesTag =
         eventCatalogTag === 'All' ||
         (product.tags || []).some(tag => normalizeTag(tag).toLowerCase() === eventCatalogTag.toLowerCase());
      const matchesView =
         eventCatalogView === 'all' ||
         (eventCatalogView === 'selling' && draft?.is_enabled) ||
         (eventCatalogView === 'hidden' && draft && !draft.is_enabled) ||
         (eventCatalogView === 'overrides' && !!draft && (
            draft.price_override.trim() !== '' ||
            (!draft.is_unlimited && draft.stock_total.trim() !== '')
         ));

      return matchesSearch && matchesCategory && matchesTag && matchesView;
   });
   const selectedEventOption = eventOptions.find((event) => event.id === selectedEventId);
   const hasUnsavedNewEventProducts = Boolean(selectedEventId) && products.some((product) => {
      const savedDraft = eventCatalogSavedDraft[product.id];
      if (savedDraft?.id) return false;
      const draft = eventCatalogDraft[product.id];
      return draft ? draft.is_enabled : getEffectiveStatus(product) === 'enable';
   });
   const hasEventCatalogChanges = JSON.stringify(eventCatalogDraft) !== JSON.stringify(eventCatalogSavedDraft) || hasUnsavedNewEventProducts;
   const hasEventCurrencyChange = eventCurrencyDraft !== eventCurrencySaved;
   const hasPendingEventCatalogChanges = hasEventCatalogChanges || hasEventCurrencyChange;
   const getEventCatalogStockLimit = (product: Product) => {
      if (product.is_unlimited) return Number.POSITIVE_INFINITY;
      const calculatedLimit = eventCatalogStockLimitByProduct[product.id];
      if (typeof calculatedLimit === 'number') return calculatedLimit;
      return getAvailableUnits(product);
   };
   const eventCatalogSelling = products.filter((product) => {
      const draft = eventCatalogDraft[product.id];
      return draft ? draft.is_enabled : getEffectiveStatus(product) === 'enable';
   }).length;
   const eventCatalogOverrides = products.filter((product) => {
      const draft = eventCatalogDraft[product.id];
      return !!draft && (
         draft.price_override.trim() !== '' ||
         (!draft.is_unlimited && draft.stock_total.trim() !== '')
      );
   }).length;
   const eventCatalogStockWarnings = products.filter((product) => {
      const draft = eventCatalogDraft[product.id];
      if (!draft || !draft.is_enabled || draft.is_unlimited || product.is_unlimited) return false;
      const stockLimit = getEventCatalogStockLimit(product);
      return Number.isFinite(stockLimit) && Number(draft.stock_total || 0) > stockLimit;
   }).length;

   const clearAllFilters = () => {
      setSearchQuery('');
      setSelectedCategory('All');
      setSelectedCurrency('All');
      setSelectedTag('All');
      setCatalogFocus('all');
      setSortOption('name_asc');
   };

   const buildEventCatalogFallback = (product: Product) => ({
      is_enabled: getEffectiveStatus(product) === 'enable',
      price_override: '',
      is_unlimited: product.is_unlimited ?? true,
      stock_total: product.stock_total != null ? String(product.stock_total) : '',
   });

   const buildDefaultCatalogDraft = (
      catalogRows: EventProductRecord[] = [],
      stockLimitByProduct: Record<string, number> = eventCatalogStockLimitByProduct
   ) => {
      const rowByProductId = new Map(catalogRows.map((row) => [row.product_id, row]));
      const nextDraft: EventCatalogDraft = {};

      for (const product of products) {
         const row = rowByProductId.get(product.id);
         const stockLimit = product.is_unlimited ? Number.POSITIVE_INFINITY : stockLimitByProduct[product.id];
         const defaultStockTotal =
            product.stock_total != null
               ? String(Number.isFinite(stockLimit) ? Math.min(product.stock_total, stockLimit) : product.stock_total)
               : '';
         nextDraft[product.id] = {
            id: row?.id,
            is_enabled: row?.is_enabled ?? getEffectiveStatus(product) === 'enable',
            price_override: row?.price_override != null ? String(row.price_override) : '',
            is_unlimited: row?.is_unlimited ?? Boolean(product.is_unlimited),
            stock_total: row?.stock_total != null ? String(row.stock_total) : defaultStockTotal,
            stock_reserved: row?.stock_reserved || 0,
            stock_sold: row?.stock_sold || 0,
         };
      }

      return nextDraft;
   };

   const fetchEventCatalogStockLimits = async (
      eventId: string,
      catalogRows: EventProductRecord[] = []
   ) => {
      const rowByProductId = new Map(catalogRows.map((row) => [row.product_id, row]));
      const finiteProducts = products.filter((product) => !product.is_unlimited);
      const nextLimits: Record<string, number> = {};

      await Promise.all(finiteProducts.map(async (product) => {
         const { data, error } = await supabase.rpc('calculate_product_event_allocation_available', {
            p_product_id: product.id,
            p_exclude_event_id: eventId,
         });

         if (error) throw error;

         const currentEventSold = rowByProductId.get(product.id)?.stock_sold || 0;
         nextLimits[product.id] = Math.max(0, Number(data || 0) + currentEventSold);
      }));

      for (const product of products) {
         if (product.is_unlimited) {
            nextLimits[product.id] = Number.POSITIVE_INFINITY;
         }
      }

      return nextLimits;
   };

   const fetchEventOptions = async (artistIdValue: string) => {
      const { data, error } = await supabase
         .from('events')
         .select('id, event_name, start_date, end_date, status, currency_override')
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
      setSelectedEventId((current) => routeEventId || current || events[0]?.id || '');
   };

   const fetchEventCatalog = async (eventId: string) => {
      if (!eventId || products.length === 0) {
         setEventCatalogDraft({});
         setEventCatalogSavedDraft({});
         setEventCatalogStockLimitByProduct({});
         setEventCurrencyDraft('');
         setEventCurrencySaved('');
         return;
      }

      setEventCatalogLoading(true);
      try {
         const { data, error } = await supabase
            .from('event_products')
            .select('id, event_id, product_id, artist_id, is_enabled, price_override, stock_total, stock_reserved, stock_sold, is_unlimited')
            .eq('event_id', eventId);

         if (error) throw error;

         const catalogRows = (data || []) as EventProductRecord[];
         const nextStockLimits = await fetchEventCatalogStockLimits(eventId, catalogRows);
         const nextDraft = buildDefaultCatalogDraft(catalogRows, nextStockLimits);
         setEventCatalogDraft(nextDraft);
         setEventCatalogSavedDraft(nextDraft);
         setEventCatalogStockLimitByProduct(nextStockLimits);
         const selectedEvent = eventOptions.find((event) => event.id === eventId);
         const nextEventCurrency = selectedEvent?.currency_override || '';
         setEventCurrencyDraft(nextEventCurrency);
         setEventCurrencySaved(nextEventCurrency);
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
         const fallback = product
            ? buildEventCatalogFallback(product)
            : { is_enabled: true, price_override: '', is_unlimited: true, stock_total: '' };
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
            const fallback = buildEventCatalogFallback(product);
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

      const overAllocatedProduct = products.find((product) => {
         const draft = eventCatalogDraft[product.id];
         if (!draft || !draft.is_enabled || draft.is_unlimited || product.is_unlimited) return false;
         const stockLimit = getEventCatalogStockLimit(product);
         return Number.isFinite(stockLimit) && Number(draft.stock_total || 0) > stockLimit;
      });

      if (overAllocatedProduct) {
         const stockLimit = getEventCatalogStockLimit(overAllocatedProduct);
         showToast({
            tone: 'warning',
            title: 'Event stock exceeds available stock',
            detail: `${overAllocatedProduct.name} can allocate up to ${stockLimit} for this event.`,
         });
         return;
      }

      if (!hasPendingEventCatalogChanges) {
         showToast({ tone: 'success', title: 'Event catalog already saved' });
         return;
      }

      setEventCatalogSaving(true);
      try {
         const hasExistingCatalog = Object.values(eventCatalogSavedDraft).some((draft) => !!draft?.id);
         const payload = products.flatMap((product) => {
            const fallback = buildEventCatalogFallback(product);
            const draft = eventCatalogDraft[product.id] || fallback;
            const savedDraft = eventCatalogSavedDraft[product.id];
            const comparison = savedDraft || fallback;
            const shouldCreateMissingRow = !savedDraft?.id && draft.is_enabled;
            const rowChanged =
               draft.is_enabled !== comparison.is_enabled ||
               draft.price_override !== comparison.price_override ||
               draft.is_unlimited !== comparison.is_unlimited ||
               draft.stock_total !== comparison.stock_total;

            if (hasExistingCatalog && !rowChanged && !shouldCreateMissingRow) {
               return [];
            }

            const stockChanged =
               !savedDraft?.id ||
               draft.is_unlimited !== savedDraft.is_unlimited ||
               draft.stock_total !== savedDraft.stock_total;
            const item: Record<string, string | number | boolean | null> = {
               product_id: product.id,
               is_enabled: draft.is_enabled,
               price_override: draft.price_override.trim() === '' ? null : Number(draft.price_override),
            };

            if (!savedDraft?.id || draft.is_unlimited !== savedDraft.is_unlimited) {
               item.is_unlimited = draft.is_unlimited;
            }

            if (stockChanged) {
               item.stock_total = draft.is_unlimited ? null : Number(draft.stock_total || 0);
            }

            return [item];
         });

         if (payload.length > 0 || hasEventCurrencyChange) {
            const { error } = await supabase.rpc('save_event_catalog', {
               p_event_id: selectedEventId,
               p_items: payload,
               p_currency_override: eventCurrencyDraft || null,
               p_update_event_currency: hasEventCurrencyChange,
            });

            if (error) throw error;
         }

         showToast({ tone: 'success', title: 'Event catalog saved', detail: 'POS will use this event-specific menu and stock.' });
         await fetchEventOptions(artistId);
         await fetchEventCatalog(selectedEventId);
      } catch (error: any) {
         console.error('[ManageProducts] saveEventCatalog failed:', error);
         showToast({
            tone: 'error',
            title: error?.message?.includes('event_stock_exceeds_catalog_stock')
               ? 'Cannot edit allocated event stock directly'
               : 'Failed to save event catalog',
            detail: getEventCatalogSaveErrorMessage(error),
         });
      } finally {
         setEventCatalogSaving(false);
      }
   };

   const fetchProductTemplates = async (artistIdValue: string) => {
      setTemplatesLoading(true);
      try {
         const { data, error } = await supabase
            .from('product_templates')
            .select('*, product_template_variants(*)')
            .eq('artist_id', artistIdValue)
            .eq('status', 'active')
            .order('created_at', { ascending: false });

         if (error) throw error;

         const templates = ((data || []) as ProductTemplate[]).map((template) => ({
            ...template,
            product_template_variants: [...(template.product_template_variants || [])].sort((a, b) => {
               const sortDiff = (a.variant_sort_order || 0) - (b.variant_sort_order || 0);
               if (sortDiff !== 0) return sortDiff;
               return a.variant_name.localeCompare(b.variant_name);
            }),
         }));
         setProductTemplates(templates);
         setTemplateApplyId((current) => current || templates[0]?.id || '');
      } catch (error) {
         console.error('[ManageProducts] fetchProductTemplates failed:', error);
         setProductTemplates([]);
      } finally {
         setTemplatesLoading(false);
      }
   };

   const fetchProducts = async () => {
      setLoading(true);
      try {
         const ctx = await resolveWorkspaceContext();
         if (!ctx) return;

         await fetchEventOptions(ctx.artist_id);

         // Fetch Artist Name
         const { data: artist } = await supabase
            .from('artists')
            .select('display_name')
            .eq('id', ctx.artist_id)
            .maybeSingle();
         
         if (artist) setArtistName(artist.display_name);

         const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('artist_id', ctx.artist_id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

         if (!error && data) {
            setProducts((data || []).map((product) => normalizeProductRecord(product) as Product));
            const summaries = await fetchProductStockSummaries(ctx.artist_id);
            setStockSummaries(Object.fromEntries(summaries.map((summary) => [summary.product_id, summary])));
         }
      } catch (error) {
         console.error('[ManageProducts] fetchProducts failed:', error);
      } finally {
         setLoading(false);
      }
   };
   const openStockAction = (action: StockAction) => {
      setStockAction(action);
      setStockActionQuantity('');
      setStockActionReason('');
      setStockActionError('');
   };
   const closeStockAction = () => {
      setStockAction(null);
      setStockActionQuantity('');
      setStockActionReason('');
      setStockActionError('');
   };
   const handleStockAction = async () => {
      if (!stockAction) return;
      const quantity = Number(stockActionQuantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
         setStockActionError('Enter a whole number greater than zero.');
         return;
      }
      if (stockAction.scope === 'catalog' && stockAction.kind === 'remove' && !stockActionReason.trim()) {
         setStockActionError('Choose a reason before removing stock.');
         return;
      }
      if (stockAction.scope === 'event' && stockAction.kind === 'add') {
         const summary = getProductStockSummary(stockAction.product);
         if (quantity > summary.available) {
            setStockActionError('Not enough central stock available. Add stock to the catalog first, then add it to this event.');
            return;
         }
      }
      setStockActionError('');
      setStockActionSaving(true);
      try {
         if (stockAction.scope === 'catalog') {
            const summary = stockAction.kind === 'add'
               ? await addCatalogStock(stockAction.product.id, quantity, stockActionReason)
               : await removeCatalogStock(stockAction.product.id, quantity, stockActionReason);
            setStockSummaries((prev) => ({ ...prev, [summary.product_id]: summary }));
            await fetchProducts();
         } else {
            if (stockAction.kind === 'add') {
               await addEventStock(stockAction.eventProductId, quantity);
            } else {
               await removeEventStock(stockAction.eventProductId, quantity);
            }
            await fetchProducts();
            await fetchEventCatalog(selectedEventId);
         }
         showToast({ tone: 'success', title: 'Stock updated' });
         closeStockAction();
      } catch (error) {
         setStockActionError(getStockAdjustmentErrorMessage(error));
      } finally {
         setStockActionSaving(false);
      }
   };

   useEffect(() => {
      fetchProducts();
   }, []);

   const productCatalogSignature = products
      .map((product) => [
         product.id,
         product.status || '',
         product.price,
         product.currency || '',
         product.variant_group_name || '',
         product.variant_name || '',
         product.variant_sort_order ?? '',
         product.stock_total ?? '',
         product.stock_reserved ?? '',
         product.stock_sold ?? '',
         product.is_unlimited ?? '',
         product.image_url || '',
      ].join(':'))
      .join('|');

   useEffect(() => {
      if (selectedEventId && products.length > 0) {
         void fetchEventCatalog(selectedEventId);
      } else {
         setEventCatalogDraft({});
      }
   }, [selectedEventId, productCatalogSignature]);

   useEffect(() => {
      if (!selectedEventId) {
         setEventCurrencyDraft('');
         setEventCurrencySaved('');
         return;
      }

      const nextEventCurrency = selectedEventOption?.currency_override || '';
      if (!hasEventCurrencyChange) {
         setEventCurrencyDraft(nextEventCurrency);
      }
      setEventCurrencySaved(nextEventCurrency);
   }, [selectedEventId, selectedEventOption?.currency_override]);

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
         const { default: imageCompression } = await import('browser-image-compression');
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

   const openAddToSale = async (product: Product) => {
      setAddToSaleProduct(product);
      setAddToSaleType('campaign');
      setAddToSaleStock(product.is_unlimited ? '' : String(getProductStockSummary(product).available));
      setAddToSalePrice('');
      try {
         const campaigns = (await listMyOnlineCampaigns()).filter((item) => item.publication_status !== 'archived');
         setCampaignOptions(campaigns);
         setAddToSaleId(campaigns[0]?.id || eventOptions[0]?.id || '');
         if (campaigns.length === 0 && eventOptions.length > 0) setAddToSaleType('event');
      } catch (error) {
         console.error('[ManageProducts] campaigns failed to load:', error);
         setCampaignOptions([]);
         setAddToSaleType('event');
         setAddToSaleId(eventOptions[0]?.id || '');
      }
   };

   const handleAddToSale = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!addToSaleProduct || !addToSaleId) return;
      const isUnlimitedProduct = Boolean(addToSaleProduct.is_unlimited);
      const stockTotal = isUnlimitedProduct ? null : Number(addToSaleStock);
      if (!isUnlimitedProduct && (!Number.isInteger(stockTotal) || Number(stockTotal) < 0)) {
         showToast({ tone: 'warning', title: t('catalogInvalidAllocation') });
         return;
      }

      const item = {
         product_id: addToSaleProduct.id,
         is_enabled: true,
         is_unlimited: isUnlimitedProduct,
         stock_total: stockTotal,
         price_override: addToSalePrice === '' ? null : Number(addToSalePrice),
      };

      setAddToSaleSaving(true);
      try {
         if (addToSaleType === 'campaign') {
            await saveCampaignProducts(addToSaleId, [item]);
         } else {
            const { error } = await supabase.rpc('save_event_catalog', {
               p_event_id: addToSaleId,
               p_items: [item],
               p_currency_override: null,
               p_update_event_currency: false,
            });
            if (error) throw error;
         }
         setAddToSaleProduct(null);
         showToast({
            tone: 'success',
            title: t('catalogAddedToSale'),
            detail: stockTotal === 0 ? t('catalogAddedWithZeroStock') : addToSaleProduct.name,
         });
      } catch (error: any) {
         console.error('[ManageProducts] add to sale failed:', error);
         showToast({
            tone: 'error',
            title: t('catalogAddToSaleFailed'),
            detail: error?.message === 'campaign_stock_exceeds_catalog_stock' ? t('campaignStockExceeded') : error?.message,
         });
      } finally {
         setAddToSaleSaving(false);
      }
   };

   const handleAddProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !price) {
         showToast({ tone: 'warning', title: t('catalogRequiredFields'), detail: t('catalogRequiredFieldsDetail') });
         return;
      }

      if (!isUnlimited && (stockTotal === '' || Number(stockTotal) < 0 || !Number.isInteger(Number(stockTotal)))) {
         showToast({ tone: 'warning', title: 'Invalid stock quantity', detail: 'Enter a whole number greater than or equal to 0, or mark the item as Unlimited.' });
         return;
      }

      const normalizedTags = parseTagsInput(tagsInput);
      const normalizedVariantGroupName = normalizeOptionalText(variantGroupName);
      const normalizedVariantName = normalizeOptionalText(variantName);
      const normalizedVariantSortOrder = parseSortOrder(variantSortOrder);
      const duplicateKey = buildProductDuplicateKey({
         name,
         category: category || 'Other',
         currency,
         tags: normalizedTags,
         variantGroupName: normalizedVariantGroupName,
         variantName: normalizedVariantName
      });
      const hasDuplicate = products.some(product =>
         buildProductDuplicateKey({
            name: product.name,
            category: product.category || 'Other',
            currency: product.currency || DEFAULT_CURRENCY,
            tags: product.tags || [],
            variantGroupName: product.variant_group_name,
            variantName: product.variant_name
         }) === duplicateKey
      );

      if (hasDuplicate) {
         showToast({ tone: 'warning', title: 'Duplicate product', detail: 'A product with the same name, category, currency, and tags already exists.' });
         return;
      }

      setUploading(true);
      try {
         const ctx = actorContext || await resolveWorkspaceContext();
         if (!ctx) throw new Error('Not authenticated');

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
         const { data: createdProduct, error: dbError } = await supabase
            .from('products')
            .insert([{
               artist_id: ctx.artist_id,
               name,
               price: parseFloat(price),
               description,
               category,
               tags: normalizedTags,
               status,
               currency,  // ✅ NEW: Save currency
               stock_total: isUnlimited ? null : Number(stockTotal || 0),
               is_unlimited: isUnlimited,
               variant_group_name: normalizedVariantGroupName,
               variant_name: normalizedVariantName,
               variant_sort_order: normalizedVariantSortOrder,
               sku: sku.trim() || null,
               image_url: filePath
            }])
            .select('*')
            .single();

         if (dbError) throw dbError;

         // Reset Form
         setName('');
         setPrice('');
         setDescription('');
         setCategory('Other');
         setTagsInput('');
         setStatus('enable');
         setCurrency(DEFAULT_CURRENCY);  // ✅ NEW: Reset currency
         setStockTotal('');
         setIsUnlimited(true);
         setVariantGroupName('');
         setVariantName('');
         setVariantSortOrder('0');
         setSku('');
         setFile(null);
         if (fileInputRef.current) fileInputRef.current.value = '';
         
         await fetchProducts();
         showToast({ tone: 'success', title: t('catalogProductAdded'), detail: name });
         setIsAddProductModalOpen(false);
         if (createdProduct) await openAddToSale(normalizeProductRecord(createdProduct) as Product);

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

   const openDuplicateVariants = (product: Product) => {
      setVariantSourceProduct(product);
      setDuplicateVariantsInput('');
   };

   const closeDuplicateVariants = () => {
      setVariantSourceProduct(null);
      setDuplicateVariantsInput('');
      setDuplicateVariantsSaving(false);
   };

   const handleCreateVariantDuplicates = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!variantSourceProduct) return;

      const variantGroupName = normalizeOptionalText(variantSourceProduct.variant_group_name || '') || variantSourceProduct.name.trim();
      const existingVariantNames = products
         .filter((product) => (product.variant_group_name || product.name).trim().toLowerCase() === variantGroupName.toLowerCase())
         .map((product) => product.variant_name || product.name.replace(new RegExp(`^${variantGroupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), ''));
      const { rows, errors } = parseDuplicateVariantRows(duplicateVariantsInput, existingVariantNames);

      if (errors.length > 0) {
         showToast({ tone: 'warning', title: 'Check variant rows', detail: errors[0] });
         return;
      }

      if (rows.length === 0) {
         showToast({ tone: 'warning', title: 'No options', detail: 'Add at least one option name.' });
         return;
      }

      const existingProductNames = new Set(products.map((product) => product.name.trim().toLowerCase()));
      const duplicateProduct = rows.find((row) => existingProductNames.has(`${variantGroupName} ${row.variantName}`.trim().toLowerCase()));
      if (duplicateProduct) {
         showToast({ tone: 'warning', title: 'Duplicate product', detail: `${variantGroupName} ${duplicateProduct.variantName} already exists.` });
         return;
      }

      setDuplicateVariantsSaving(true);
      try {
         const ctx = actorContext || await resolveWorkspaceContext();
         if (!ctx) throw new Error('Not authenticated');

         const baseTags = variantSourceProduct.tags || [];
         const payload = rows.map((row) => {
            const isUnlimited = row.stockMode === 'copy'
               ? variantSourceProduct.is_unlimited ?? true
               : row.stockMode === 'unlimited';
            const stockTotal = row.stockMode === 'copy'
               ? variantSourceProduct.stock_total ?? null
               : row.stockMode === 'unlimited'
                 ? null
                 : row.stockTotal;

            return {
               artist_id: ctx.artist_id,
               name: `${variantGroupName} ${row.variantName}`.trim(),
               price: row.priceOverride ?? variantSourceProduct.price,
               description: variantSourceProduct.description || '',
               category: variantSourceProduct.category || 'Other',
               tags: Array.from(new Set([...baseTags, ...row.tags].map(normalizeTag).filter(Boolean))),
               status: variantSourceProduct.status || 'enable',
               currency: variantSourceProduct.currency || DEFAULT_CURRENCY,
               stock_total: isUnlimited ? null : stockTotal ?? 0,
               is_unlimited: isUnlimited,
               variant_group_name: variantGroupName,
               variant_name: row.variantName,
               variant_sort_order: row.sortOrder,
               image_url: '',
            };
         });

         const { error } = await supabase
            .from('products')
            .insert(payload);

         if (error) throw error;

         await fetchProducts();
         showToast({
            tone: 'success',
            title: 'Variants created',
            detail: `${rows.length} product${rows.length === 1 ? '' : 's'} duplicated from ${variantSourceProduct.name}.`,
         });
         closeDuplicateVariants();
      } catch (error: any) {
         console.error('[ManageProducts] duplicate variants failed:', error);
         showToast({ tone: 'error', title: 'Could not create variants', detail: error.message });
      } finally {
         setDuplicateVariantsSaving(false);
      }
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
      setVariantGroupName(product.variant_group_name || '');
      setVariantName(product.variant_name || '');
      setVariantSortOrder(String(product.variant_sort_order ?? 0));
      setSku(product.sku || '');
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
            const normalizedVariantGroupName = normalizeOptionalText(variantGroupName);
            const normalizedVariantName = normalizeOptionalText(variantName);
            const normalizedVariantSortOrder = parseSortOrder(variantSortOrder);

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
               variant_group_name: normalizedVariantGroupName,
               variant_name: normalizedVariantName,
               variant_sort_order: normalizedVariantSortOrder,
               sku: sku.trim() || null,
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
         setCategory('Other');
         setTagsInput('');
         setStatus('enable');
         setCurrency(DEFAULT_CURRENCY);  // ✅ NEW: Reset currency
         setStockTotal('');
         setIsUnlimited(true);
         setVariantGroupName('');
         setVariantName('');
         setVariantSortOrder('0');
         setSku('');
         
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
                  tags: product.tags || [],
                  variantGroupName: product.variant_group_name,
                  variantName: product.variant_name
               }))
            );
            const importedKeys = new Set<string>();

            const ctx = actorContext || await resolveWorkspaceContext();
            if (!ctx) {
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
               const variantGroupRaw = getCsvValue(sanitizedRow, ['product_line', 'variant_group_name', 'variant_group', 'folder', 'folder_name']);
               const variantNameRaw = getCsvValue(sanitizedRow, ['variant_name', 'variant', 'option', 'option_name']);
               const variantSortRaw = getCsvValue(sanitizedRow, ['variant_sort_order', 'variant_sort', 'sort_order']);

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
               const normalizedVariantGroupName = normalizeOptionalText(String(variantGroupRaw || ''));
               const normalizedVariantName = normalizeOptionalText(String(variantNameRaw || ''));
               const normalizedVariantSortOrder = parseSortOrder(String(variantSortRaw || '0'));
               const duplicateKey = buildProductDuplicateKey({
                  name: String(name),
                  category: String(category || 'Other'),
                  currency: String(currency),
                  tags: normalizedTags,
                  variantGroupName: normalizedVariantGroupName,
                  variantName: normalizedVariantName
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
                  artist_id: ctx.artist_id,
                  name: name,
                  price: price,
                  currency: currency, // ✅ FIX: Now uses currency from CSV
                  category: category || 'Other',
                  tags: normalizedTags,
                  description: description || '',
                  status: productStatus,
                  is_unlimited: isUnlimitedItem,
                  stock_total: stockTotalItem,
                  variant_group_name: normalizedVariantGroupName,
                  variant_name: normalizedVariantName,
                  variant_sort_order: normalizedVariantSortOrder,
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

   const resetTemplateForm = () => {
      setTemplateName('');
      setTemplateCategory('');
      setTemplatePrice('');
      setTemplateCurrency(DEFAULT_CURRENCY);
      setTemplateTagsInput('');
      setTemplateDescription('');
      setTemplateIsUnlimited(true);
      setTemplateStockTotal('');
      setTemplateVariantsInput('');
   };

   const handleCreateTemplate = async (event: React.FormEvent) => {
      event.preventDefault();

      if (!templateName.trim() || !templateCategory.trim() || !templatePrice.trim()) {
         showToast({ tone: 'warning', title: 'Template fields missing', detail: 'Fill in template name, category, and price.' });
         return;
      }

      if (!templateIsUnlimited && (templateStockTotal === '' || Number(templateStockTotal) < 0 || !Number.isInteger(Number(templateStockTotal)))) {
         showToast({ tone: 'warning', title: 'Invalid template stock', detail: 'Enter a whole number greater than or equal to 0, or mark the template as Unlimited.' });
         return;
      }

      const parsedVariants = parseTemplateVariantsInput(templateVariantsInput);
      if (parsedVariants.length === 0) {
         showToast({ tone: 'warning', title: 'No options', detail: 'Add at least one option name.' });
         return;
      }

      setTemplateSaving(true);
      let createdTemplateId: string | null = null;
      try {
         const ctx = actorContext || await resolveWorkspaceContext();
         if (!ctx) throw new Error('Not authenticated');

         const { data: templateData, error: templateError } = await supabase
            .from('product_templates')
            .insert({
               artist_id: ctx.artist_id,
               name: normalizeTag(templateName),
               category: normalizeTag(templateCategory),
               price: Number(templatePrice),
               currency: templateCurrency,
               tags: parseTagsInput(templateTagsInput),
               description: templateDescription.trim(),
               is_unlimited: templateIsUnlimited,
               stock_total: templateIsUnlimited ? null : Number(templateStockTotal || 0),
               status: 'active',
               image_url: '',
            })
            .select('id')
            .single();

         if (templateError) throw templateError;
         createdTemplateId = templateData.id;

         const variantPayload = parsedVariants.map((variant) => ({
            ...variant,
            artist_id: ctx.artist_id,
            template_id: templateData.id,
         }));

         const { error: variantError } = await supabase
            .from('product_template_variants')
            .insert(variantPayload);

         if (variantError) throw variantError;

         await fetchProductTemplates(ctx.artist_id);
         resetTemplateForm();
         setIsTemplateModalOpen(false);
         setActiveWorkspaceTab('templates');
         showToast({ tone: 'success', title: 'Product Template created', detail: `${parsedVariants.length} variant${parsedVariants.length === 1 ? '' : 's'} ready.` });
      } catch (error: any) {
         if (createdTemplateId) {
            await supabase.from('product_templates').delete().eq('id', createdTemplateId);
         }
         console.error('[ManageProducts] create template failed:', error);
         showToast({ tone: 'error', title: 'Template failed', detail: error.message });
      } finally {
         setTemplateSaving(false);
      }
   };

   const handleAddTemplateVariants = async (template: ProductTemplate) => {
      const draft = templateVariantDrafts[template.id] || '';
      const existingVariants = template.product_template_variants || [];
      const maxSortOrder = existingVariants.reduce((max, variant) => Math.max(max, variant.variant_sort_order || 0), 0);
      const parsedVariants = parseTemplateVariantsInput(
         draft,
         existingVariants.map((variant) => variant.variant_name),
         maxSortOrder
      );

      if (parsedVariants.length === 0) {
         showToast({ tone: 'warning', title: 'No new options', detail: 'Add at least one new option name that is not already in this template.' });
         return;
      }

      setTemplateVariantSavingId(template.id);
      try {
         const ctx = actorContext || await resolveWorkspaceContext();
         if (!ctx) throw new Error('Not authenticated');

         const variantPayload = parsedVariants.map((variant) => ({
            ...variant,
            artist_id: ctx.artist_id,
            template_id: template.id,
         }));

         const { error } = await supabase
            .from('product_template_variants')
            .insert(variantPayload);

         if (error) throw error;

         setTemplateVariantDrafts((current) => ({ ...current, [template.id]: '' }));
         await fetchProductTemplates(ctx.artist_id);
         showToast({
            tone: 'success',
            title: 'Variants added',
            detail: `${parsedVariants.length} variant${parsedVariants.length === 1 ? '' : 's'} added to ${template.name}.`,
         });
      } catch (error: any) {
         console.error('[ManageProducts] add template variants failed:', error);
         showToast({ tone: 'error', title: 'Variants failed', detail: error.message });
      } finally {
         setTemplateVariantSavingId('');
      }
   };

   const handleCreateProductsFromTemplate = async (templateId: string, eventId?: string | null) => {
      if (!templateId) return;
      setTemplateApplyId(templateId);
      setTemplateApplySaving(true);
      try {
         const { data, error } = await supabase.rpc('create_products_from_template', {
            p_template_id: templateId,
            p_variant_ids: null,
            p_event_id: eventId || null,
            p_default_event_stock: null,
         });

         if (error) throw error;

         const rows = (data || []) as Array<{ created_product?: boolean; created_event_product?: boolean }>;
         const createdProducts = rows.filter((row) => row.created_product).length;
         const eventRows = rows.filter((row) => row.created_event_product).length;
         await fetchProducts();
         showToast({
            tone: 'success',
            title: eventId ? 'Template applied to event' : 'Products created from template',
            detail: eventId
               ? `${rows.length} variant${rows.length === 1 ? '' : 's'} linked. ${eventRows} new event row${eventRows === 1 ? '' : 's'} created.`
               : `${createdProducts} new product${createdProducts === 1 ? '' : 's'} created. Existing variants were skipped.`,
         });
      } catch (error: any) {
         console.error('[ManageProducts] apply template failed:', error);
         showToast({ tone: 'error', title: 'Template apply failed', detail: error.message });
      } finally {
         setTemplateApplySaving(false);
      }
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

   const selectedEventName = selectedEventOption?.event_name || 'Event';
   const pageTitle = isEventScopedWorkspace
      ? activeWorkspaceTab === 'promotions' ? 'Event Promotion' : 'Event Catalog'
      : activeWorkspaceTab === 'promotions' ? 'Promotion Workspace' : 'Catalog Workspace';
   const pageSubtitle = isEventScopedWorkspace ? selectedEventName : artistName;

   return (
      <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
         {/* ✅ NEW: Unified Admin Header */}
         <AdminHeader
            activePage={activeWorkspaceTab === 'promotions' && !isEventScopedWorkspace ? 'promotion' : 'menu'}
            actorRole={actorContext?.role}
            userEmail={actorContext?.member_email}
         />
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
                    ? `${confirmAction.name} will be hidden from the active catalog. Past orders keep their history.`
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
         {stockAction && (
            <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
               <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
                  <div className="flex items-start justify-between gap-4">
                     <div>
                        <h2 className="text-lg font-black text-gray-900">
                           {stockAction.scope === 'catalog'
                              ? stockAction.kind === 'add' ? 'Add stock' : 'Remove stock'
                              : stockAction.kind === 'add' ? 'Add to event' : 'Remove from event'}
                        </h2>
                        <p className="mt-1 text-sm font-semibold text-gray-500">{stockAction.product.name}</p>
                     </div>
                     <button type="button" onClick={closeStockAction} className="text-gray-400 hover:text-gray-700" aria-label="Close stock action">
                        <X size={20} />
                     </button>
                  </div>
                     <div className="mt-5 space-y-4">
                     <div>
                        <label className="mb-1 block text-xs font-black uppercase tracking-wide text-gray-500">Quantity</label>
                        <input
                           type="number"
                           min="1"
                           step="1"
                           value={stockActionQuantity}
                           onChange={(event) => {
                              setStockActionQuantity(event.target.value);
                              if (stockActionError) setStockActionError('');
                           }}
                           className="w-full rounded-lg border border-gray-200 px-3 py-2 font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-200"
                        />
                     </div>
                     {stockAction.scope === 'catalog' && stockAction.kind === 'remove' && (
                        <div>
                           <label className="mb-1 block text-xs font-black uppercase tracking-wide text-gray-500">Reason</label>
                           <select
                              value={stockActionReason}
                              onChange={(event) => setStockActionReason(event.target.value)}
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-200"
                           >
                              <option value="">Select reason</option>
                              <option value="damaged">Damaged</option>
                              <option value="lost">Lost</option>
                              <option value="count_correction">Count correction</option>
                              <option value="other">Other</option>
                           </select>
                        </div>
                     )}
                     <div className="rounded-xl bg-gray-50 p-3 text-sm font-semibold text-gray-700">
                        {stockAction.scope === 'catalog' ? (
                           (() => {
                              const summary = getProductStockSummary(stockAction.product);
                              const quantity = Number(stockActionQuantity || 0);
                              return (
                                 <>
                                    <div>On hand: {summary.on_hand}</div>
                                    <div>Allocated: {summary.allocated}</div>
                                    <div>Available: {summary.available}</div>
                                    <div className="mt-2 font-black text-gray-900">
                                       After {stockAction.kind === 'add' ? 'add' : 'remove'}: {stockAction.kind === 'add' ? summary.on_hand + quantity : summary.on_hand - quantity}
                                    </div>
                                 </>
                              );
                           })()
                        ) : (
                           (() => {
                              const draft = eventCatalogDraft[stockAction.product.id];
                              const allocated = Number(draft?.stock_total || 0);
                              const reserved = draft?.stock_reserved || 0;
                              const sold = draft?.stock_sold || 0;
                              const removable = Math.max(allocated - reserved - sold, 0);
                              const summary = getProductStockSummary(stockAction.product);
                              return (
                                 <>
                                    {stockAction.kind === 'add' && <div>Central available: {summary.available}</div>}
                                    <div>Allocated to event: {allocated}</div>
                                    <div>Reserved: {reserved}</div>
                                    <div>Sold: {sold}</div>
                                    <div>Available at event: {removable}</div>
                                    {stockAction.kind === 'remove' && <div className="mt-2 font-black text-gray-900">Returned to catalog after remove: {Number(stockActionQuantity || 0)}</div>}
                                 </>
                              );
                           })()
                        )}
                     </div>
                     {stockActionError && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                           {stockActionError}
                        </div>
                     )}
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                     <Button type="button" onClick={closeStockAction} className="rounded-lg border border-gray-200 bg-white px-4 py-2 font-bold text-gray-700 hover:bg-gray-50">
                        Cancel
                     </Button>
                     <Button
                        type="button"
                        onClick={() => void handleStockAction()}
                        disabled={stockActionSaving}
                        className="rounded-lg bg-pink-600 px-4 py-2 font-bold text-white hover:bg-pink-700 disabled:bg-pink-300"
                     >
                        {stockActionSaving
                           ? 'Saving...'
                           : stockAction.scope === 'catalog'
                             ? stockAction.kind === 'add' ? 'Add stock' : 'Remove stock'
                             : stockAction.kind === 'add' ? 'Add to event' : 'Remove from event'}
                     </Button>
                  </div>
               </section>
            </div>
         )}
         
         {addToSaleProduct && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
               <form onSubmit={handleAddToSale} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
                  <div className="flex items-start justify-between gap-3">
                     <div><h2 className="text-lg font-black text-gray-900">{t('catalogAddToSale')}</h2><p className="mt-1 text-sm font-semibold text-gray-500">{addToSaleProduct.name} · {addToSaleProduct.sku}</p></div>
                     <button type="button" onClick={() => setAddToSaleProduct(null)} className="icon-touch text-gray-400" aria-label={t('campaignClose')}><X size={20} /></button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                     <button type="button" onClick={() => { setAddToSaleType('campaign'); setAddToSaleId(campaignOptions[0]?.id || ''); }} className={`min-h-11 rounded-xl border text-sm font-black ${addToSaleType === 'campaign' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600'}`}>{t('catalogOnlineCampaign')}</button>
                     <button type="button" onClick={() => { setAddToSaleType('event'); setAddToSaleId(eventOptions[0]?.id || ''); }} className={`min-h-11 rounded-xl border text-sm font-black ${addToSaleType === 'event' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600'}`}>{t('catalogPhysicalEvent')}</button>
                  </div>
                  <label className="mt-4 block"><span className="text-xs font-black text-gray-600">{t('catalogChooseSale')}</span><select required value={addToSaleId} onChange={(e) => setAddToSaleId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3">
                     <option value="">{t('catalogChooseSalePlaceholder')}</option>
                     {(addToSaleType === 'campaign' ? campaignOptions : eventOptions).map((item) => <option key={item.id} value={item.id}>{'name' in item ? item.name : item.event_name}</option>)}
                  </select></label>
                  {!addToSaleProduct.is_unlimited && <label className="mt-3 block"><span className="text-xs font-black text-gray-600">{t('campaignAllocatedStock')}</span><input required type="number" min="0" max={getProductStockSummary(addToSaleProduct).available} step="1" value={addToSaleStock} onChange={(e) => setAddToSaleStock(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" /></label>}
                  {!addToSaleProduct.is_unlimited && getProductStockSummary(addToSaleProduct).available === 0 && (
                     <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-relaxed text-amber-800">{t('campaignNoUnallocatedStock')}</p>
                  )}
                  <label className="mt-3 block"><span className="text-xs font-black text-gray-600">{t('campaignPriceOverride')}</span><input type="number" min="0" step="0.01" value={addToSalePrice} onChange={(e) => setAddToSalePrice(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" placeholder={formatPrice(addToSaleProduct.price, addToSaleProduct.currency)} /></label>
                  <button disabled={addToSaleSaving || !addToSaleId} className="mt-4 min-h-11 w-full rounded-xl bg-pink-600 text-sm font-black text-white disabled:opacity-50">{addToSaleSaving ? t('campaignCreating') : t('catalogAddToSale')}</button>
               </form>
            </div>
         )}

         {variantSourceProduct && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
               <section className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
                     <div>
                        <h2 className="flex items-center gap-2 text-lg font-black text-gray-900">
                           <Copy className="text-pink-500" size={18} />
                           Duplicate Variants
                        </h2>
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                           Copy category, tags, price, and status from {variantSourceProduct.name}. Add each variant image later.
                        </p>
                     </div>
                     <button
                        type="button"
                        onClick={closeDuplicateVariants}
                        className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Close duplicate variants"
                     >
                        <X size={20} />
                     </button>
                  </div>

                  <form onSubmit={handleCreateVariantDuplicates} className="space-y-4 p-5">
                     <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                           <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-white">
                              {variantSourceProduct.image_url ? (
                                 <img
                                    src={getProductImageUrl(variantSourceProduct.image_url, 160)}
                                    alt={variantSourceProduct.name}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                 />
                              ) : (
                                 <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-gray-400">No image</div>
                              )}
                           </div>
                           <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                 <h3 className="truncate text-base font-black text-gray-900">{variantSourceProduct.name}</h3>
                                 <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-gray-600 ring-1 ring-gray-100">
                                    {variantSourceProduct.category || 'Other'}
                                 </span>
                                 <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-black text-pink-700">
                                    {formatPrice(variantSourceProduct.price, variantSourceProduct.currency)}
                                 </span>
                              </div>
                              <p className="mt-1 text-xs font-semibold text-gray-500">
                                 New option names will stay under product line: <span className="font-black text-gray-800">{variantSourceProduct.variant_group_name || variantSourceProduct.name}</span>
                              </p>
                              {!!variantSourceProduct.tags?.length && (
                                 <div className="mt-2 flex flex-wrap gap-1.5">
                                    {variantSourceProduct.tags.slice(0, 6).map((tag) => (
                                       <span key={`duplicate-base-${tag}`} className="rounded bg-pink-50 px-2 py-1 text-[10px] font-black text-pink-600">#{tag}</span>
                                    ))}
                                    {variantSourceProduct.tags.length > 6 && <span className="text-[10px] font-bold text-gray-400">+{variantSourceProduct.tags.length - 6}</span>}
                                 </div>
                              )}
                           </div>
                        </div>
                     </div>

                     <div className="space-y-2">
                        <div className="flex items-end justify-between gap-3">
                           <label htmlFor="duplicate-variants-input" className="block text-xs font-black uppercase tracking-wide text-gray-500">Option names and stock</label>
                           <span className="text-xs font-black text-pink-600">
                              {parseDuplicateVariantRows(duplicateVariantsInput).rows.length} parsed
                           </span>
                        </div>
                        <textarea
                           id="duplicate-variants-input"
                           value={duplicateVariantsInput}
                           onChange={(event) => setDuplicateVariantsInput(event.target.value)}
                           className="h-56 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200"
                           placeholder={`Paimon | 30\nAether | 30\nLumine | 30`}
                           required
                        />
                        <p className="text-[11px] font-semibold text-gray-400">
                           Format: option name | stock. Optional: option name | stock | extra tags | price override. Leave stock blank to copy this product's stock mode.
                        </p>
                     </div>

                     <div className="flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
                        <Button
                           type="button"
                           onClick={closeDuplicateVariants}
                           className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                           Cancel
                        </Button>
                        <Button
                           type="submit"
                           disabled={duplicateVariantsSaving}
                           className="rounded-lg bg-pink-600 px-5 py-2 text-sm font-black text-white hover:bg-pink-700 disabled:bg-pink-300"
                        >
                           {duplicateVariantsSaving ? <Loader className="animate-spin" size={16} /> : 'Create Variants'}
                        </Button>
                     </div>
                  </form>
               </section>
            </div>
         )}

         {/* Page Title Wrapper */}
         <div className="max-w-6xl mx-auto px-4 md:px-6 pt-4 mb-2">
            <h1 className="text-xl font-black text-gray-800 tracking-tight">{pageTitle}</h1>
            <p className="text-sm text-pink-600 font-bold">{pageSubtitle}</p>
         </div>

         <main className="max-w-6xl mx-auto px-4 md:px-6 pb-12">
            {isEventScopedWorkspace && selectedEventId && (
               <EventNavTabs
                  eventId={selectedEventId}
                  active={activeWorkspaceTab === 'promotions' ? 'promotion' : 'catalog'}
                  actorRole={actorContext?.role}
               />
            )}
            {!isEventScopedWorkspace && activeWorkspaceTab !== 'promotions' && (
            <section className="mb-5 rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm">
               <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                     <p className="text-xs font-black uppercase tracking-wide text-pink-600">Catalog Library</p>
                     <h2 className="mt-1 text-lg font-black text-gray-900">Shared products used across every event</h2>
                     <p className="mt-1 max-w-2xl text-sm font-semibold text-gray-500">Create products once, duplicate variants quickly, then choose which items go into each event catalog.</p>
                     <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-gray-500">
                        {([
                           { label: 'Products', value: products.length, focus: 'all' as const },
                           { label: 'Missing images', value: catalogMissingImages, focus: 'missing-images' as const },
                           { label: 'Low stock', value: catalogLowStock, focus: 'low-stock' as const },
                           { label: 'Inactive', value: catalogInactive, focus: 'inactive' as const },
                        ]).map((item) => (
                           <button
                              key={item.label}
                              type="button"
                              onClick={() => setCatalogFocus(item.focus)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors ${
                                 catalogFocus === item.focus
                                    ? 'bg-pink-50 text-pink-700 ring-1 ring-pink-100'
                                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                              }`}
                           >
                              <span className="font-black text-gray-900">{item.value}</span>
                              <span>{item.label}</span>
                           </button>
                        ))}
                     </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                     <div className="grid grid-cols-2 rounded-xl border border-gray-200 bg-gray-50 p-1 sm:flex">
                        {([
                           ['catalog', 'Catalog'],
                           ['import', 'Import'],
                        ] as const).map(([tab, label]) => (
                           <button
                              key={tab}
                              type="button"
                              onClick={() => setActiveWorkspaceTab(tab)}
                              className={`min-h-10 rounded-lg px-3 py-2 text-xs font-black transition-colors ${
                                 activeWorkspaceTab === tab
                                    ? 'bg-white text-pink-700 shadow-sm ring-1 ring-pink-100'
                                    : 'text-gray-500 hover:bg-white/70 hover:text-gray-800'
                              }`}
                              aria-pressed={activeWorkspaceTab === tab}
                           >
                              {label}
                           </button>
                        ))}
                     </div>
                     {activeWorkspaceTab === 'catalog' && (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                           <button
                              type="button"
                              onClick={() => setIsAddProductModalOpen(true)}
                              className="workspace-action inline-flex items-center justify-center gap-2 border border-pink-200 bg-pink-50 px-3 py-2 text-sm font-black text-pink-700 hover:bg-pink-100"
                           >
                              <Plus size={16} aria-hidden="true" />
                              Add Product
                           </button>
                           <button
                              type="button"
                              onClick={() => setActiveWorkspaceTab('import')}
                              className="workspace-action inline-flex items-center justify-center gap-2 border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-700 hover:bg-gray-50"
                           >
                              <Upload size={16} aria-hidden="true" />
                              Import CSV
                           </button>
                        </div>
                     )}
                     </div>
               </div>
            </section>
            )}
            
            {isAddProductModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
               <section className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-5 py-4">
                     <div>
                        <h2 className="text-lg font-black text-gray-800 flex items-center gap-2">
                           <Plus className="text-pink-500" size={18} />
                           {t('catalogAddProduct')}
                        </h2>
                        <p className="mt-1 text-xs text-gray-500">{t('catalogQuickProductHint')}</p>
                     </div>
                     <button
                        type="button"
                        onClick={() => setIsAddProductModalOpen(false)}
                        className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Close add product"
                     >
                        <X size={20} />
                     </button>
                  </div>

               <div className="p-5 animate-fade-in">
               <form onSubmit={handleAddProduct} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label htmlFor="add-product-name" className="block text-xs font-bold text-gray-500 uppercase tracking-wider">{t('catalogProductName')} *</label>
                        <input 
                           id="add-product-name"
                           type="text" 
                           value={name}
                           onChange={(e) => setName(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           placeholder="e.g. Iced Latte"
                           required
                        />
                     </div>
                     
                     <div className="space-y-1">
                        <label htmlFor="add-product-price" className="block text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                           <Coins size={12} /> {t('catalogPriceCurrency')} *
                        </label>
                        <div className="flex flex-col md:flex-row gap-2">
                           <input 
                              id="add-product-price"
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

                  </div>

                  <details className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                     <summary className="cursor-pointer text-sm font-black text-gray-700">{t('catalogAdvanced')}</summary>
                     <div className="mt-4 space-y-4">
                     <div className="space-y-1">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">{t('catalogCategory')}</label>
                        <input list="category-suggestions" type="text" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700" />
                        <datalist id="category-suggestions">{allCategorySuggestions.map(cat => <option key={cat} value={cat} />)}</datalist>
                     </div>
                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">{t('catalogTags')}</label>
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

                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-4">
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">{t('catalogProductLine')}</label>
                        <input
                           list="variant-group-suggestions"
                           type="text"
                           value={variantGroupName}
                           onChange={(e) => setVariantGroupName(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           placeholder="e.g. Sticker Bualoi"
                        />
                        <datalist id="variant-group-suggestions">
                           {allVariantGroupSuggestions.map(group => (
                              <option key={group} value={group} />
                           ))}
                        </datalist>
                     </div>
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">{t('catalogOptionName')}</label>
                        <input
                           type="text"
                           value={variantName}
                           onChange={(e) => setVariantName(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           placeholder="e.g. Paimon / Blue / 57mm"
                        />
                     </div>
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">{t('catalogSort')}</label>
                        <input
                           type="number"
                           value={variantSortOrder}
                           onChange={(e) => setVariantSortOrder(e.target.value)}
                           className="w-full px-3 py-1.5 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                           step="1"
                        />
                     </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                     <div className="space-y-1">
                        <label htmlFor="product-status" className="block text-xs font-bold uppercase tracking-wider text-gray-500">{t('catalogStatus')}</label>
                        <select id="product-status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600">
                           <option value="enable">{t('catalogActive')}</option>
                           <option value="disable">{t('catalogDisabled')}</option>
                           <option value="soldout">{t('campaignSoldOut')}</option>
                        </select>
                     </div>
                     <div className="space-y-1">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">SKU</label>
                        <input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder={t('catalogSkuGenerated')} className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700" />
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">{t('catalogDescription')} <span className="ml-2 text-[10px] font-normal text-gray-400">({description.length}/200)</span></label>
                     <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 200))} className="h-16 w-full resize-none rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-700" />
                  </div>
                     </div>
                  </details>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">{t('catalogImage')}</label>
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
                              className={[
                                 'w-full flex items-center justify-center px-3 py-1.5 border border-dashed rounded cursor-pointer transition-colors',
                                 file
                                    ? 'border-pink-500 bg-pink-50 text-pink-700'
                                    : 'border-gray-300 text-slate-600 hover:border-pink-400'
                              ].join(' ')}
                           >
                              <Upload size={14} className="mr-2 shrink-0" />
                              <span className="truncate text-xs font-medium max-w-[200px] md:max-w-none">
                                 {compressing ? t('catalogPreparingImage') : (file ? file.name : t('catalogChooseImage'))}
                              </span>
                           </label>
                        </div>
                        <p className="text-[10px] text-gray-400">JPG, PNG, WebP, HEIC, or HEIF. Crop before upload.</p>
                        {compressing && <p className="text-[10px] text-pink-500 font-bold mt-1 animate-pulse">Preparing image...</p>}
                     </div>

                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">{t('catalogStock')} *</label>
                        <div className="flex items-center gap-2 mb-2">
                           <input
                              id="is-unlimited"
                              type="checkbox"
                              checked={isUnlimited}
                              onChange={(e) => setIsUnlimited(e.target.checked)}
                           />
                           <label htmlFor="is-unlimited" className="text-xs text-gray-600 font-semibold">{t('catalogUnlimited')}</label>
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

                  <div className="flex justify-end">
                     <Button 
                        type="submit" 
                        disabled={uploading}
                        className="bg-pink-500 hover:bg-pink-600 text-white py-2 px-6 rounded shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 text-xs font-bold h-9"
                     >
                        {uploading ? <Loader className="animate-spin mx-auto" size={16} /> : t('catalogAddProduct')}
                     </Button>
                  </div>

               </form>
               </div>
               </section>
            </div>
            )}

            {isTemplateModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
               <section className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-5 py-4">
                     <div>
                        <h2 className="text-lg font-black text-gray-800 flex items-center gap-2">
                           <Sparkles className="text-pink-500" size={18} />
                           New Product Template
                        </h2>
                        <p className="mt-1 text-xs text-gray-500">Create one reusable product shape, then paste many variants under it.</p>
                     </div>
                     <button
                        type="button"
                        onClick={() => setIsTemplateModalOpen(false)}
                        className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Close product template"
                     >
                        <X size={20} />
                     </button>
                  </div>

                  <form onSubmit={handleCreateTemplate} className="space-y-5 p-5">
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Template Name *</label>
                           <input
                              value={templateName}
                              onChange={(event) => setTemplateName(event.target.value)}
                              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-200"
                              placeholder="Sticker Bualoi"
                              required
                           />
                        </div>
                        <div className="space-y-1">
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Category *</label>
                           <input
                              list="category-suggestions"
                              value={templateCategory}
                              onChange={(event) => setTemplateCategory(event.target.value)}
                              onKeyDown={(event) => {
                                 if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                 }
                              }}
                              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-200"
                              placeholder="Sticker"
                              required
                           />
                        </div>
                        <div className="space-y-1">
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                              <Coins size={12} /> Default price *
                           </label>
                           <div className="flex gap-2">
                              <input
                                 type="number"
                                 min="0"
                                 step="0.01"
                                 value={templatePrice}
                                 onChange={(event) => setTemplatePrice(event.target.value)}
                                 className="min-w-0 flex-1 px-3 py-2 text-sm font-semibold text-gray-700 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-200"
                                 placeholder="10"
                                 required
                              />
                              <select
                                 value={templateCurrency}
                                 onChange={(event) => setTemplateCurrency(event.target.value)}
                                 className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-200"
                                 aria-label="Template currency"
                              >
                                 {Object.entries(CURRENCIES).map(([code, info]) => (
                                    <option key={code} value={code}>{info.symbol} {code}</option>
                                 ))}
                              </select>
                           </div>
                        </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-4">
                        <div className="space-y-1">
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Default tags</label>
                           <input
                              list="tag-suggestions"
                              value={templateTagsInput}
                              onChange={(event) => setTemplateTagsInput(event.target.value)}
                              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-200"
                              placeholder="Genshin Impact, Hoyoverse"
                           />
                        </div>
                        <div className="space-y-1">
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Default stock</label>
                           <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                              <input
                                 id="template-unlimited"
                                 type="checkbox"
                                 checked={templateIsUnlimited}
                                 onChange={(event) => setTemplateIsUnlimited(event.target.checked)}
                                 className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-200"
                              />
                              <label htmlFor="template-unlimited" className="text-xs font-bold text-gray-600">Unlimited</label>
                              <input
                                 type="number"
                                 min="0"
                                 step="1"
                                 value={templateStockTotal}
                                 onChange={(event) => setTemplateStockTotal(event.target.value)}
                                 disabled={templateIsUnlimited}
                                 className="ml-auto w-24 rounded border border-gray-200 px-2 py-1 text-xs font-bold text-gray-700 disabled:bg-gray-100 disabled:text-gray-400"
                                 placeholder="Qty"
                              />
                           </div>
                        </div>
                     </div>

                     <div className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Description</label>
                        <textarea
                           value={templateDescription}
                           onChange={(event) => setTemplateDescription(event.target.value.slice(0, 200))}
                           className="h-16 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-200"
                           placeholder="A6 sized, hologram laminated, 3cm add-on, etc."
                        />
                     </div>

                     <div className="space-y-1">
                        <div className="flex items-end justify-between gap-3">
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Variants *</label>
                           <span className="text-xs font-black text-pink-600">{parseTemplateVariantsInput(templateVariantsInput).length} parsed</span>
                        </div>
                        <textarea
                           value={templateVariantsInput}
                           onChange={(event) => setTemplateVariantsInput(event.target.value)}
                           className="h-56 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-200"
                           placeholder={`Durin | Genshin Impact | | 1\nWanderer | Genshin Impact | | 2\nTamonUtage | Tamon-kun Devotion | 12 | 3`}
                           required
                        />
                        <p className="text-[11px] font-semibold text-gray-400">Format: name | tags | price override | sort. One name per line also works.</p>
                     </div>

                     <div className="flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
                        <Button
                           type="button"
                           onClick={() => setIsTemplateModalOpen(false)}
                           className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                           Cancel
                        </Button>
                        <Button
                           type="submit"
                           disabled={templateSaving}
                           className="rounded-lg bg-pink-600 px-5 py-2 text-sm font-black text-white hover:bg-pink-700 disabled:bg-pink-300"
                        >
                           {templateSaving ? <Loader className="animate-spin" size={16} /> : 'Create Template'}
                        </Button>
                     </div>
                  </form>
                  <datalist id="category-suggestions">
                     {allCategorySuggestions.map(cat => (
                        <option key={cat} value={cat} />
                     ))}
                  </datalist>
                  <datalist id="tag-suggestions">
                     {allTagSuggestions.map(tag => (
                        <option key={tag} value={tag} />
                     ))}
                  </datalist>
               </section>
            </div>
            )}

            {activeWorkspaceTab === 'templates' && (
            <section className="space-y-4">
               <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div>
                        <h2 className="flex items-center gap-2 text-base font-bold text-gray-800">
                           <Sparkles className="text-pink-500" size={18} />
                           Product Templates
                        </h2>
                        <p className="mt-1 text-xs font-semibold text-gray-500">Reusable product shapes for high-variant merch like stickers, keyrings, and add-on characters.</p>
                     </div>
                     <button
                        type="button"
                        onClick={() => setIsTemplateModalOpen(true)}
                        className="workspace-action inline-flex items-center justify-center gap-2 rounded-lg border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-black text-pink-700 hover:bg-pink-100"
                     >
                        <Plus size={16} /> New Template
                     </button>
                  </div>
               </div>

               {templatesLoading ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm font-bold text-gray-400">Loading templates...</div>
               ) : productTemplates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center">
                     <Sparkles className="mx-auto text-pink-200" size={34} />
                     <p className="mt-3 text-sm font-black text-gray-700">No Product Templates yet</p>
                     <p className="mt-1 text-xs font-semibold text-gray-500">Start with one template such as Sticker Bualoi, then paste variants in bulk.</p>
                  </div>
               ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                     {productTemplates.map((template) => {
                        const variants = template.product_template_variants || [];
                        const existingProducts = products.filter((product) => product.product_template_id === template.id).length;
                        return (
                           <article key={template.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-4">
                                 <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                       <h3 className="truncate text-base font-black text-gray-900">{template.name}</h3>
                                       <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-600">{template.category}</span>
                                    </div>
                                    <p className="mt-1 text-sm font-bold text-pink-600">{formatPrice(template.price, template.currency)}</p>
                                    {template.description && <p className="mt-1 line-clamp-2 text-xs font-semibold text-gray-500">{template.description}</p>}
                                 </div>
                                 <div className="rounded-lg bg-pink-50 px-3 py-2 text-right">
                                    <div className="text-lg font-black text-pink-700">{variants.length}</div>
                                    <div className="text-[10px] font-black uppercase tracking-wide text-pink-500">Variants</div>
                                 </div>
                              </div>

                              {!!template.tags?.length && (
                                 <div className="mt-3 flex flex-wrap gap-1.5">
                                    {template.tags.slice(0, 5).map((tag) => (
                                       <span key={`${template.id}-${tag}`} className="rounded bg-pink-50 px-2 py-1 text-[10px] font-black text-pink-600">#{tag}</span>
                                    ))}
                                    {template.tags.length > 5 && <span className="text-[10px] font-bold text-gray-400">+{template.tags.length - 5}</span>}
                                 </div>
                              )}

                              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                                 <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-xs font-black uppercase tracking-wide text-gray-500">Preview</span>
                                    <span className="text-xs font-bold text-gray-500">{existingProducts}/{variants.length} products created</span>
                                 </div>
                                 <div className="flex flex-wrap gap-1.5">
                                    {variants.slice(0, 12).map((variant) => (
                                       <span key={variant.id} className="rounded bg-white px-2 py-1 text-[11px] font-bold text-gray-700 ring-1 ring-gray-100">
                                          {variant.variant_name}
                                       </span>
                                    ))}
                                    {variants.length > 12 && <span className="px-2 py-1 text-[11px] font-black text-gray-400">+{variants.length - 12}</span>}
                                 </div>
                              </div>

                              <div className="mt-3 rounded-lg border border-dashed border-pink-100 bg-pink-50/30 p-3">
                                 <div className="mb-2 flex items-center justify-between gap-2">
                                    <label htmlFor={`template-variants-${template.id}`} className="text-xs font-black uppercase tracking-wide text-pink-700">Add variants</label>
                                    <span className="text-[11px] font-bold text-gray-400">Creates missing products later</span>
                                 </div>
                                 <textarea
                                    id={`template-variants-${template.id}`}
                                    value={templateVariantDrafts[template.id] || ''}
                                    onChange={(event) => setTemplateVariantDrafts((current) => ({ ...current, [template.id]: event.target.value }))}
                                    className="h-20 w-full resize-none rounded-lg border border-pink-100 bg-white px-3 py-2 font-mono text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-200"
                                    placeholder={`Paimon | Genshin Impact\nAether | Genshin Impact\nLumine | Genshin Impact`}
                                 />
                                 <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-[11px] font-semibold text-gray-400">Format: name | tags | price override | sort</p>
                                    <button
                                       type="button"
                                       onClick={() => void handleAddTemplateVariants(template)}
                                       disabled={templateVariantSavingId === template.id}
                                       className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-pink-200 bg-white px-3 text-xs font-black text-pink-700 hover:bg-pink-50 disabled:text-gray-400"
                                    >
                                       {templateVariantSavingId === template.id ? <Loader className="animate-spin" size={14} /> : <Plus size={14} />}
                                       Add variants
                                    </button>
                                 </div>
                              </div>

                              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                 <div className="text-xs font-semibold text-gray-500">
                                    Stock: {template.is_unlimited ? 'Unlimited' : `${template.stock_total || 0} default`}
                                 </div>
                                 <button
                                    type="button"
                                    onClick={() => void handleCreateProductsFromTemplate(template.id)}
                                    disabled={templateApplySaving}
                                    className="workspace-action inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-black text-white hover:bg-slate-800 disabled:bg-gray-300"
                                 >
                                    {templateApplySaving && templateApplyId === template.id ? <Loader className="animate-spin" size={14} /> : <Plus size={14} />}
                                    Create products
                                 </button>
                              </div>
                           </article>
                        );
                     })}
                  </div>
               )}
            </section>
            )}

            {activeWorkspaceTab === 'import' && (
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
               <div className="px-4 py-4 flex items-start justify-between gap-4 text-left">
                  <div>
                     <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <FileText className="text-pink-500" size={18} />
                        Import CSV
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">Import many items at once. Duplicate rows are skipped automatically.</p>
                  </div>
               </div>

                  <div className="border-t border-gray-100 p-4 animate-fade-in">
                     <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                           <p className="text-xs text-gray-500">
                              CSV columns: <span className="font-semibold">name, price</span> (optional: category, tags, description, currency, status, stock, is_unlimited, product_line/variant_group, option_name/variant_name, sort_order)
                           </p>
                           <p className="mt-1 text-[11px] text-gray-400">Use this for large catalog setup. Existing duplicates will be ignored instead of inserted twice.</p>
                        </div>
                        <div className="flex items-center gap-2">
                           <a
                              href="/samples/catalog-import-sample.csv"
                              download="catalog-import-sample.csv"
                              className="inline-flex h-9 items-center gap-2 rounded-lg border border-pink-200 bg-white px-4 py-2 text-xs font-bold text-pink-700 shadow-sm transition-all active:scale-95 hover:bg-pink-50"
                           >
                              <Download size={14} aria-hidden="true" />
                              Download sample
                           </a>
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
                              className="bg-pink-600 hover:bg-pink-700 text-white py-2 px-4 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 flex items-center gap-2 text-xs font-bold"
                           >
                              {uploading ? <Loader className="animate-spin" size={14} /> : <Upload size={14} />}
                              {uploading ? 'Uploading...' : 'Upload CSV'}
                           </Button>
                        </div>
                     </div>
                  </div>
            </section>
            )}

            {activeWorkspaceTab === 'promotions' && (
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
               <div className="px-4 py-4 flex items-start justify-between gap-4 text-left">
                  <div>
                     <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <Sparkles className="text-pink-500" size={18} />
                        {isEventScopedWorkspace ? 'Event Promotion' : 'Promotions'}
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">
                        {isEventScopedWorkspace
                           ? 'Manage pricing rules for this event only.'
                           : 'Manage shared pricing rules separately from daily product maintenance.'}
                     </p>
                  </div>
               </div>

                  <div className="border-t border-gray-100 p-4 animate-fade-in">
                     <PromotionManager
                        artistId={artistId}
                        products={products}
                        eventOptions={eventOptions}
                        categorySuggestions={allCategorySuggestions}
                        tagSuggestions={allTagSuggestions}
                        lockedEventId={isEventScopedWorkspace ? selectedEventId : undefined}
                        lockedEventName={isEventScopedWorkspace ? selectedEventName : undefined}
                     />
                  </div>
            </section>
            )}

            {activeWorkspaceTab === 'event-catalog' && (
            <section className="mb-6 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
               <div className="border-b border-gray-100 px-4 py-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                     <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-wide text-pink-600">Event Catalog Setup</p>
                        <h2 className="mt-1 flex items-center gap-2 text-lg font-black text-gray-900">
                           <CalendarDays className="text-pink-500" size={18} />
                           {selectedEventName}
                        </h2>
                        <p className="mt-1 text-sm font-semibold text-gray-500">Choose which library products sell in this event, then set event price and event stock.</p>
                     </div>
                     <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        {([
                           { label: 'Selling', value: eventCatalogSelling },
                           { label: 'Overrides', value: eventCatalogOverrides },
                           { label: 'Stock warnings', value: eventCatalogStockWarnings },
                           { label: 'Status', value: hasPendingEventCatalogChanges ? 'Unsaved' : 'Saved' },
                        ]).map((item) => (
                           <div key={item.label} className={`min-w-[120px] rounded-lg border px-3 py-2 ${
                              item.label === 'Stock warnings' && Number(item.value) > 0
                                 ? 'border-red-100 bg-red-50 text-red-700'
                                 : item.label === 'Status' && hasPendingEventCatalogChanges
                                   ? 'border-pink-200 bg-pink-50 text-pink-700'
                                   : 'border-gray-100 bg-gray-50 text-gray-600'
                           }`}>
                              <div className="text-lg font-black leading-none">{item.value}</div>
                              <div className="mt-1 text-[10px] font-black uppercase tracking-wide">{item.label}</div>
                           </div>
                        ))}
                     </div>
                  </div>
               </div>

                  <div className="animate-fade-in space-y-4 p-4">
                     <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-end">
                        <div className="grid gap-3 md:grid-cols-2">
                           <div className="space-y-1">
                              <label className="text-xs font-black uppercase tracking-wide text-gray-500">Event</label>
                              {isEventScopedWorkspace ? (
                                 <div className="min-h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-black text-gray-800">
                                    {selectedEventName}
                                 </div>
                              ) : (
                                 <select
                                    value={selectedEventId}
                                    onChange={(event) => setSelectedEventId(event.target.value)}
                                    className="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200"
                                    disabled={eventOptions.length === 0}
                                    aria-label="Select event catalog"
                                 >
                                    {eventOptions.length === 0 && <option value="">No confirmed events</option>}
                                    {eventOptions.map((event) => (
                                       <option key={event.id} value={event.id}>{event.event_name}</option>
                                    ))}
                                 </select>
                              )}
                              {selectedEventOption && (
                                 <p className="text-[11px] font-bold text-pink-700">
                                    Event starts {new Date(selectedEventOption.start_date).toLocaleDateString('en-GB')}
                                 </p>
                              )}
                           </div>
                           <div className="space-y-1">
                              <label className="text-xs font-black uppercase tracking-wide text-gray-500">Event currency</label>
                              <select
                                 value={eventCurrencyDraft}
                                 onChange={(event) => setEventCurrencyDraft(event.target.value)}
                                 className="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200"
                                 disabled={!selectedEventId}
                                 aria-label="Select event currency"
                              >
                                 <option value="">Use product currency</option>
                                 {Object.keys(CURRENCIES).sort().map((code) => (
                                    <option key={code} value={code}>{code}</option>
                                 ))}
                              </select>
                           </div>
                        </div>
                        <div className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                           hasPendingEventCatalogChanges
                              ? 'border-pink-200 bg-pink-50 text-pink-800'
                              : 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        }`}>
                           {hasPendingEventCatalogChanges
                              ? 'Unsaved changes will not show in POS or customer menu yet.'
                              : 'Saved setup is ready for POS and customer menu.'}
                        </div>
                        <button
                           type="button"
                           onClick={() => void saveEventCatalog()}
                           disabled={!selectedEventId || eventCatalogSaving || eventCatalogLoading || products.length === 0}
                           className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 text-xs font-black text-white shadow-md shadow-pink-100 transition-colors hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
                        >
                           {eventCatalogSaving ? <Loader className="animate-spin" size={14} /> : <Save size={14} />}
                           {hasPendingEventCatalogChanges ? 'Save Changes' : 'Saved'}
                        </button>
                     </div>

                     <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
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

                     <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
                        <span className="mr-1 text-xs font-black uppercase tracking-wide text-gray-500">Show</span>
                        {([
                           ['all', 'All'],
                           ['selling', 'Selling'],
                           ['hidden', 'Hidden'],
                           ['overrides', 'Overrides'],
                        ] as const).map(([view, label]) => (
                           <button
                              key={view}
                              type="button"
                              onClick={() => setEventCatalogView(view)}
                              className={`rounded-full px-3 py-1.5 text-xs font-black transition-colors ${
                                 eventCatalogView === view
                                    ? 'bg-pink-600 text-white shadow-sm shadow-pink-100'
                                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                              }`}
                           >
                              {label}
                           </button>
                        ))}
                        <div className="ml-0 inline-grid grid-cols-2 rounded-lg border border-gray-200 bg-white p-1 sm:ml-2">
                           {([
                              ['visual', LayoutGrid, 'Visual'],
                              ['operations', List, 'Operations'],
                           ] as const).map(([mode, Icon, label]) => (
                              <button
                                 key={mode}
                                 type="button"
                                 onClick={() => setEventCatalogDisplayMode(mode)}
                                 className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-black transition-colors ${
                                    eventCatalogDisplayMode === mode
                                       ? 'bg-pink-50 text-pink-700 ring-1 ring-pink-100'
                                       : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                                 }`}
                                 aria-pressed={eventCatalogDisplayMode === mode}
                              >
                                 <Icon size={14} aria-hidden="true" />
                                 {label}
                              </button>
                           ))}
                        </div>
                        <span className="ml-auto rounded-full bg-gray-100 px-3 py-1.5 text-xs font-black text-gray-600">
                           {filteredEventCatalogProducts.length} of {products.length}
                        </span>
                     </div>

                     <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                           <span className="text-xs font-black uppercase tracking-wide text-gray-500">Bulk actions for visible rows</span>
                           <span className="text-[11px] font-bold text-gray-400">Uses current search and filters</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
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
                     </div>

                     {!selectedEventId ? (
                        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-semibold text-gray-500">
                           Create or confirm an event before assigning products.
                        </div>
                     ) : (
                        <>
	                           {eventCatalogDisplayMode === 'visual' ? (
	                              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
	                                 {filteredEventCatalogProducts.map((product) => {
	                                    const draft = eventCatalogDraft[product.id] || buildEventCatalogFallback(product);
	                                    const stockLimit = getEventCatalogStockLimit(product);
	                                    const eventStockValue = Number(draft.stock_total || 0);
	                                    const hasAllocatedEventStock = !!draft.id && !draft.is_unlimited;
	                                    const hasCustomSetup = draft.price_override.trim() !== '' || (!draft.is_unlimited && draft.stock_total.trim() !== '');
	                                    const displayPrice = draft.price_override.trim() !== '' ? Number(draft.price_override) : product.price;
	                                    const stockOverLimit =
	                                       draft.is_enabled &&
	                                       !product.is_unlimited &&
	                                       !draft.is_unlimited &&
	                                       Number.isFinite(stockLimit) &&
	                                       eventStockValue > stockLimit;

	                                    return (
	                                       <article
	                                          key={`event-catalog-${product.id}`}
	                                          className={`group overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
	                                             stockOverLimit
	                                                ? 'border-red-200'
	                                                : draft.is_enabled
	                                                  ? 'border-pink-100'
	                                                  : 'border-gray-100'
	                                          }`}
	                                       >
	                                          <div className="relative aspect-[4/3] bg-pink-50/50">
	                                             {product.image_url ? (
	                                                <img
	                                                   src={getProductImageUrl(product.image_url, 420)}
	                                                   alt={product.name}
	                                                   className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${draft.is_enabled ? '' : 'grayscale'}`}
	                                                   loading="lazy"
	                                                   decoding="async"
	                                                />
	                                             ) : (
	                                                <div className="flex h-full w-full items-center justify-center bg-gray-100 text-xs font-black text-gray-400">No image</div>
	                                             )}
	                                             <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
	                                                <button
	                                                   type="button"
	                                                   onClick={() => updateEventCatalogDraft(product.id, { is_enabled: !draft.is_enabled })}
	                                                   className={`rounded-full px-3 py-1.5 text-[11px] font-black shadow-sm backdrop-blur ${
	                                                      draft.is_enabled
	                                                         ? 'bg-emerald-50/95 text-emerald-700 ring-1 ring-emerald-100'
	                                                         : 'bg-white/90 text-gray-500 ring-1 ring-gray-200'
	                                                   }`}
	                                                >
	                                                   {draft.is_enabled ? 'Selling' : 'Hidden'}
	                                                </button>
	                                                {hasCustomSetup && (
	                                                   <span className="rounded-full bg-amber-50/95 px-3 py-1.5 text-[11px] font-black text-amber-700 shadow-sm ring-1 ring-amber-100 backdrop-blur">
	                                                      Custom
	                                                   </span>
	                                                )}
	                                             </div>
	                                             <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-3">
	                                                <div className="text-2xl font-black text-white drop-shadow-sm">
	                                                   {formatPrice(displayPrice, eventCurrencyDraft || product.currency)}
	                                                </div>
	                                             </div>
	                                          </div>

	                                          <div className="space-y-3 p-4">
	                                             <div className="min-w-0">
	                                                <h3 className="line-clamp-2 min-h-10 text-base font-black leading-tight text-gray-950">{product.name}</h3>
	                                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
	                                                   {product.variant_group_name && (
	                                                      <span className="rounded-full bg-pink-50 px-2 py-1 text-[10px] font-black text-pink-700">{product.variant_group_name}</span>
	                                                   )}
	                                                   {product.variant_name && (
	                                                      <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-600">{product.variant_name}</span>
	                                                   )}
	                                                   <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-600">{product.category || 'Other'}</span>
	                                                </div>
	                                             </div>

	                                             <div className={`rounded-xl p-3 ${stockOverLimit ? 'bg-red-50 ring-1 ring-red-100' : 'bg-gray-50 ring-1 ring-gray-100'}`}>
	                                                {renderEventCatalogStockFlow(product, draft, stockLimit, true)}
	                                                {stockOverLimit && (
	                                                   <p className="mt-2 text-[11px] font-bold text-red-600">Max {stockLimit} available for this event.</p>
	                                                )}
	                                             </div>

	                                             <div className="grid grid-cols-2 gap-2">
	                                                <label className="min-w-0">
	                                                   <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-gray-400">Event price</span>
	                                                   <input
	                                                      type="number"
	                                                      min="0"
	                                                      step="0.01"
	                                                      value={draft.price_override}
	                                                      onChange={(event) => updateEventCatalogDraft(product.id, { price_override: event.target.value })}
	                                                      className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-black text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-200"
	                                                      placeholder={String(product.price)}
	                                                      aria-label={`Event price for ${product.name}`}
	                                                   />
	                                                </label>
	                                                <label className="min-w-0">
	                                                   <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-gray-400">Event stock</span>
	                                                   <input
	                                                      type="number"
	                                                      min="0"
	                                                      max={Number.isFinite(stockLimit) ? stockLimit : undefined}
	                                                      step="1"
	                                                      value={draft.stock_total}
	                                                      onChange={(event) => updateEventCatalogDraft(product.id, { stock_total: event.target.value })}
	                                                      disabled={draft.is_unlimited || hasAllocatedEventStock}
	                                                      className={`h-10 w-full rounded-lg border bg-white px-3 text-sm font-black text-gray-900 focus:outline-none focus:ring-2 disabled:bg-gray-100 disabled:text-gray-400 ${
	                                                         stockOverLimit ? 'border-red-300 bg-red-50 focus:ring-red-100' : 'border-gray-200 focus:ring-pink-200'
	                                                      }`}
	                                                      placeholder={draft.is_unlimited ? 'Unlimited' : 'Qty'}
	                                                      aria-label={`Event stock for ${product.name}`}
	                                                   />
	                                                </label>
	                                             </div>

	                                             <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
	                                                <label className="inline-flex min-h-9 items-center gap-2 rounded-full bg-gray-50 px-3 text-[11px] font-black text-gray-700 ring-1 ring-gray-100">
	                                                   <input
	                                                      type="checkbox"
	                                                      checked={draft.is_unlimited}
	                                                      onChange={(event) => updateEventCatalogDraft(product.id, { is_unlimited: product.is_unlimited ? event.target.checked : false })}
	                                                      disabled={!product.is_unlimited || hasAllocatedEventStock}
	                                                      className="h-3.5 w-3.5 rounded border-gray-300 text-pink-600 focus:ring-pink-500 disabled:opacity-40"
	                                                   />
	                                                   Unlimited
	                                                </label>
	                                                {draft.id && !draft.is_unlimited ? (
	                                                   <>
	                                                      <button
	                                                         type="button"
	                                                         onClick={() => openStockAction({ scope: 'event', kind: 'add', product, eventProductId: draft.id! })}
	                                                         className="min-h-9 rounded-full bg-emerald-50 px-3 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100"
	                                                      >
	                                                         Add stock
	                                                      </button>
	                                                      <button
	                                                         type="button"
	                                                         onClick={() => openStockAction({ scope: 'event', kind: 'remove', product, eventProductId: draft.id! })}
	                                                         className="min-h-9 rounded-full bg-white px-3 text-[11px] font-black text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
	                                                      >
	                                                         Remove
	                                                      </button>
	                                                   </>
	                                                ) : (
	                                                   <span className="text-[11px] font-bold text-gray-400">Save first to move stock.</span>
	                                                )}
	                                             </div>
	                                          </div>
	                                       </article>
	                                    );
	                                 })}
	                              </div>
                           ) : (
                              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                                 <div className="hidden xl:grid xl:grid-cols-[minmax(230px,1.35fr)_145px_220px_150px_125px] gap-3 bg-gray-50 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-gray-500">
                                    <div>Product</div>
                                    <div>Sell / Price</div>
                                    <div>Central to event</div>
                                    <div>Event stock</div>
                                    <div>Actions</div>
                                 </div>
                                 <div className="divide-y divide-gray-100">
                                    {filteredEventCatalogProducts.map((product) => {
                                       const draft = eventCatalogDraft[product.id] || buildEventCatalogFallback(product);
                                       const stockLimit = getEventCatalogStockLimit(product);
                                       const eventStockValue = Number(draft.stock_total || 0);
                                       const hasAllocatedEventStock = !!draft.id && !draft.is_unlimited;
                                       const stockOverLimit =
                                          draft.is_enabled &&
                                          !product.is_unlimited &&
                                          !draft.is_unlimited &&
                                          Number.isFinite(stockLimit) &&
                                          eventStockValue > stockLimit;

                                       return (
                                          <div
                                             key={`event-catalog-operation-${product.id}`}
                                             className="grid grid-cols-1 gap-3 px-4 py-4 xl:grid-cols-[minmax(230px,1.35fr)_145px_220px_150px_125px] xl:items-start"
                                          >
                                             <div className="min-w-0 flex items-center gap-3">
                                                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-100">
                                                   {product.image_url ? (
                                                      <img
                                                         src={getProductImageUrl(product.image_url, 120)}
                                                         alt={product.name}
                                                         className="h-full w-full object-cover"
                                                         loading="lazy"
                                                         decoding="async"
                                                      />
                                                   ) : (
                                                      <div className="flex h-full w-full items-center justify-center text-[9px] font-black text-gray-400">No image</div>
                                                   )}
                                                </div>
                                                <div className="min-w-0">
                                                   <div className="truncate text-sm font-black text-gray-900">{product.name}</div>
                                                   <div className="mt-1 flex flex-wrap gap-1">
                                                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                                                         draft.is_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                                      }`}>
                                                         {draft.is_enabled ? 'Selling' : 'Hidden'}
                                                      </span>
                                                      {product.category && (
                                                         <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-black text-gray-600">{product.category}</span>
                                                      )}
                                                   </div>
                                                </div>
                                             </div>

                                             <div className="space-y-2">
                                                <label className="flex items-center justify-between gap-2 text-xs font-black text-gray-700">
                                                   <span>Sell</span>
                                                   <input
                                                      type="checkbox"
                                                      checked={draft.is_enabled}
                                                      onChange={(event) => updateEventCatalogDraft(product.id, { is_enabled: event.target.checked })}
                                                      className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                                                   />
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
                                             </div>

                                             <div className={stockOverLimit ? 'rounded-lg bg-red-50 p-2' : 'rounded-lg bg-gray-50 p-2'}>
                                                {renderEventCatalogStockFlow(product, draft, stockLimit, true)}
                                             </div>

                                             <div className="space-y-2">
                                                <label className="flex items-center justify-between gap-2 text-xs font-black text-gray-700">
                                                   <span>Unlimited</span>
                                                   <input
                                                      type="checkbox"
                                                      checked={draft.is_unlimited}
                                                      onChange={(event) => updateEventCatalogDraft(product.id, { is_unlimited: product.is_unlimited ? event.target.checked : false })}
                                                      disabled={!product.is_unlimited || hasAllocatedEventStock}
                                                      className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500 disabled:opacity-40"
                                                   />
                                                </label>
                                                <input
                                                   type="number"
                                                   min="0"
                                                   max={Number.isFinite(stockLimit) ? stockLimit : undefined}
                                                   step="1"
                                                   value={draft.stock_total}
                                                   onChange={(event) => updateEventCatalogDraft(product.id, { stock_total: event.target.value })}
                                                   disabled={draft.is_unlimited || hasAllocatedEventStock}
                                                   className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 disabled:bg-gray-100 disabled:text-gray-400 ${
                                                      stockOverLimit ? 'border-red-300 bg-red-50 focus:ring-red-100' : 'border-gray-200 focus:ring-pink-200'
                                                   }`}
                                                   placeholder={draft.is_unlimited ? 'Unlimited' : 'Qty'}
                                                   aria-label={`Event stock for ${product.name}`}
                                                />
                                             </div>

                                             <div>
                                                {draft.id && !draft.is_unlimited ? (
                                                   <div className="flex flex-col gap-1.5">
                                                      <button
                                                         type="button"
                                                         onClick={() => openStockAction({ scope: 'event', kind: 'add', product, eventProductId: draft.id! })}
                                                         className="rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-black text-emerald-700 hover:bg-emerald-100"
                                                      >
                                                         Add stock
                                                      </button>
                                                      <button
                                                         type="button"
                                                         onClick={() => openStockAction({ scope: 'event', kind: 'remove', product, eventProductId: draft.id! })}
                                                         className="rounded-md bg-gray-100 px-2 py-1.5 text-[11px] font-black text-gray-700 hover:bg-gray-200"
                                                      >
                                                         Remove
                                                      </button>
                                                   </div>
                                                ) : (
                                                   <div className="text-[11px] font-semibold text-gray-400">Save first</div>
                                                )}
                                             </div>
                                          </div>
                                       );
                                    })}
                                 </div>
                              </div>
                           )}
                        </>
                     )}
	                  </div>
	            </section>
            )}

            {activeWorkspaceTab === 'event-catalog' && hasPendingEventCatalogChanges && selectedEventId && (
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

            {activeWorkspaceTab === 'catalog' && (
            <>
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
                        Find products in the library
                     </h2>
                     <p className="mt-1 text-xs text-gray-500">
                        {catalogVariantGroups > 0
                           ? `${catalogVariantGroups} variant group${catalogVariantGroups === 1 ? '' : 's'} in this catalog.`
                           : 'Search, filter, and sort before editing products or creating variants.'}
                     </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                     <div className="inline-grid grid-cols-2 rounded-xl border border-gray-200 bg-gray-50 p-1">
                        {([
                           ['visual', LayoutGrid, 'Visual'],
                           ['operations', List, 'Operations'],
                        ] as const).map(([mode, Icon, label]) => (
                           <button
                              key={mode}
                              type="button"
                              onClick={() => setCatalogDisplayMode(mode)}
                              className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-black transition-colors ${
                                 catalogDisplayMode === mode
                                    ? 'bg-white text-pink-700 shadow-sm ring-1 ring-pink-100'
                                    : 'text-gray-500 hover:bg-white/70 hover:text-gray-800'
                              }`}
                              aria-pressed={catalogDisplayMode === mode}
                           >
                              <Icon size={14} aria-hidden="true" />
                              {label}
                           </button>
                        ))}
                     </div>
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

               <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
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

               <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="relative">
                     <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-sm font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-200"
                        aria-label="Filter by category"
                     >
                        {uniqueCategories.map((cat) => (
                           <option key={cat} value={cat}>{cat === 'All' ? 'All categories' : cat}</option>
                        ))}
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>

                  <div className="relative">
                     <select
                        value={selectedTag}
                        onChange={(e) => setSelectedTag(e.target.value)}
                        className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-sm font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-200"
                        aria-label="Filter by tag"
                     >
                        {uniqueTags.map(tag => (
                           <option key={tag} value={tag}>{tag === 'All' ? 'All tags' : tag}</option>
                        ))}
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>

                  <div className="relative">
                     <select
                        value={catalogFocus}
                        onChange={(e) => setCatalogFocus(e.target.value as typeof catalogFocus)}
                        className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-sm font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-200"
                        aria-label="Filter by catalog focus"
                     >
                        <option value="all">All stock/image states</option>
                        <option value="missing-images">Need images ({catalogMissingImages})</option>
                        <option value="low-stock">Low stock ({catalogLowStock})</option>
                        <option value="inactive">Inactive ({catalogInactive})</option>
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>

                  {uniqueCurrencies.length > 2 ? (
                     <div className="relative">
                        <select
                           value={selectedCurrency}
                           onChange={(e) => setSelectedCurrency(e.target.value)}
                           className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-sm font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-200"
                           aria-label="Filter by currency"
                        >
                           {uniqueCurrencies.map((curr) => (
                              <option key={curr} value={curr}>{curr === 'All' ? 'All currencies' : `${CURRENCIES[curr]?.symbol || curr} ${curr}`}</option>
                           ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                     </div>
                  ) : (
                     <div className="hidden xl:block" />
                  )}
               </div>

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
                     {catalogFocus !== 'all' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-700">
                           Focus: {catalogFocus.replace('-', ' ')}
                        </span>
                     )}
                  </div>
               )}
            </div>

            {/* PRODUCT LIST */}
            <div className="mb-4 flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
               <div>
                  <h2 className="text-lg font-bold text-gray-800">Catalog items ({filteredProducts.length})</h2>
                  <p className="text-xs font-semibold text-gray-500">
                     {catalogDisplayMode === 'visual'
                        ? 'Visual check for product photos, names, price, and stock before customers see them.'
                        : 'Operations view for dense stock and maintenance actions.'}
                  </p>
               </div>
            </div>
            
            {loading ? (
               <div className="text-center py-12 text-gray-400">Loading products...</div>
            ) : filteredProducts.length > 0 ? (
               <>
                  {catalogDisplayMode === 'visual' ? (
                     <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filteredProducts.map(product => {
                           const effectiveStatus = getEffectiveStatus(product);
                           const hasImage = Boolean(product.image_url);
                           return (
                              <article key={product.id} className="group overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-pink-100 hover:shadow-lg hover:shadow-pink-100/60">
                                 <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
                                    {hasImage ? (
                                       <img
                                          src={getProductImageUrl(product.image_url, 600)}
                                          alt={product.name}
                                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                          loading="lazy"
                                          decoding="async"
                                       />
                                    ) : (
                                       <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-50 text-gray-400">
                                          <PackageSearch size={28} aria-hidden="true" />
                                          <span className="text-xs font-black uppercase tracking-wide">Need image</span>
                                       </div>
                                    )}

                                    <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                                       <span className="rounded-full bg-white/95 px-2 py-1 text-[10px] font-black text-gray-700 shadow-sm">
                                          {product.category || 'Other'}
                                       </span>
                                       {effectiveStatus === 'disable' && (
                                          <span className="rounded-full bg-gray-900/85 px-2 py-1 text-[10px] font-black text-white shadow-sm">Disabled</span>
                                       )}
                                       {effectiveStatus === 'soldout' && (
                                          <span className="rounded-full bg-red-600/90 px-2 py-1 text-[10px] font-black text-white shadow-sm">Sold out</span>
                                       )}
                                    </div>

                                    <div className="absolute right-3 top-3 flex gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                                       <button
                                          onClick={(e) => { e.stopPropagation(); handleEditClick(product); }}
                                          className="icon-touch inline-flex items-center justify-center rounded-full border border-white/70 bg-white/95 text-gray-600 shadow-sm hover:text-blue-700"
                                          aria-label={`Edit ${product.name}`}
                                          title="Edit"
                                       >
                                          <Edit2 size={15} />
                                       </button>
                                       <button
                                          onClick={(e) => { e.stopPropagation(); requestDeleteProduct(product); }}
                                          className="icon-touch inline-flex items-center justify-center rounded-full border border-white/70 bg-white/95 text-gray-600 shadow-sm hover:text-red-700"
                                          aria-label={`Delete ${product.name}`}
                                          title="Delete"
                                       >
                                          <Trash2 size={15} />
                                       </button>
                                    </div>
                                 </div>

                                 <div className="space-y-3 p-4">
                                    <div className="min-h-[76px]">
                                       <h3 className="line-clamp-2 text-base font-black leading-tight text-gray-900">{product.name}</h3>
                                       {product.sku && <div className="mt-1 font-mono text-[10px] font-bold text-gray-400">{product.sku}</div>}
                                       {product.variant_group_name && (
                                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                             <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-black text-pink-700">
                                                {product.variant_group_name}
                                             </span>
                                             {product.variant_name && (
                                                <span className="text-[11px] font-bold text-gray-500">{product.variant_name}</span>
                                             )}
                                          </div>
                                       )}
                                       <div className="mt-2 text-xl font-black text-pink-600">
                                          {formatPrice(product.price, product.currency)}
                                       </div>
                                    </div>

                                    {!!product.tags?.length && (
                                       <div className="flex min-h-6 flex-wrap gap-1">
                                          {product.tags.slice(0, 3).map((tag) => (
                                             <span key={`${product.id}-grid-${tag}`} className="rounded-full bg-pink-50 px-2 py-1 text-[10px] font-black text-pink-600">
                                                #{tag}
                                             </span>
                                          ))}
                                          {product.tags.length > 3 && (
                                             <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-500">+{product.tags.length - 3}</span>
                                          )}
                                       </div>
                                    )}

                                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                                       {renderCatalogStockFlow(product, true)}
                                    </div>

                                    <div className="grid grid-cols-3 gap-2">
                                       <button onClick={() => void openAddToSale(product)} className="min-h-10 rounded-xl bg-pink-600 px-2 text-xs font-black text-white">{t('catalogAddToSale')}</button>
                                       {!product.is_unlimited ? (
                                          <button
                                             onClick={() => openStockAction({ scope: 'catalog', kind: 'add', product })}
                                             className="min-h-10 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 hover:bg-emerald-100"
                                          >
                                             Add stock
                                          </button>
                                       ) : (
                                          <div className="min-h-10 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-center text-xs font-black text-gray-400">
                                             Unlimited
                                          </div>
                                       )}
                                       <button
                                          onClick={() => openDuplicateVariants(product)}
                                          className="min-h-10 rounded-xl border border-pink-200 bg-pink-50 px-3 text-xs font-black text-pink-700 hover:bg-pink-100"
                                          aria-label={`Create variants from ${product.name}`}
                                       >
                                          Variants
                                       </button>
                                    </div>
                                 </div>
                              </article>
                           );
                        })}
                     </div>
                  ) : (
                     <>
                     {/* MOBILE VIEW: List/Cards (<768px) */}
                     <div className="flex flex-col gap-3 md:hidden">
                        {filteredProducts.map(product => {
                           const effectiveStatus = getEffectiveStatus(product);
                           const hasImage = Boolean(product.image_url);
                           return (
                           <div key={product.id} className="bg-white/70 backdrop-blur-md border border-white/40 shadow-sm rounded-xl overflow-hidden flex flex-row min-h-36 group relative">
                              {/* Image */}
                              <div className="w-[100px] bg-gray-100 relative overflow-hidden shrink-0">
                                 {hasImage ? (
                                    <img
                                       src={getProductImageUrl(product.image_url, 400)}
                                       alt={product.name}
                                       className="w-full h-full object-cover"
                                       loading="lazy"
                                       decoding="async"
                                    />
                                 ) : (
                                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-gray-400">
                                       <PackageSearch size={20} aria-hidden="true" />
                                       <span className="text-[10px] font-black">Image</span>
                                    </div>
                                 )}
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
                                    {product.sku && <div className="font-mono text-[9px] font-bold text-gray-400">{product.sku}</div>}
                                    {product.variant_group_name && (
                                       <div className="mt-1 flex items-center gap-1">
                                          <span className="truncate rounded bg-pink-50 px-1.5 py-0.5 text-[9px] font-black text-pink-700">
                                             {product.variant_group_name}
                                          </span>
                                          <span className="truncate text-[9px] font-bold text-gray-500">
                                             {product.variant_name || product.name}
                                          </span>
                                       </div>
                                    )}
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
                                    {renderCatalogStockFlow(product, true)}
                                 </div>

                                 {/* Mobile Actions (Always Visible) */}
                                 <div className="absolute bottom-2 right-2 flex gap-2">
                                     <button onClick={(e) => { e.stopPropagation(); void openAddToSale(product); }} className="min-h-8 rounded-full bg-pink-600 px-2 text-[10px] font-black text-white shadow-sm" aria-label={`${t('catalogAddToSale')} ${product.name}`}>{t('catalogAddToSale')}</button>
                                     <button onClick={(e) => { e.stopPropagation(); openDuplicateVariants(product); }} className="icon-touch inline-flex items-center justify-center text-gray-400 hover:text-pink-600 bg-white/80 rounded-full shadow-sm border border-gray-100" aria-label={`Create variants from ${product.name}`}><Copy size={14}/></button>
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
                              <th className="px-6 py-4 font-bold">Stock Flow</th>
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
                                          {product.sku && <div className="font-mono text-[10px] font-bold text-gray-400">{product.sku}</div>}
                                          {product.variant_group_name && (
                                             <div className="mt-1 flex flex-wrap items-center gap-1">
                                                <span className="rounded bg-pink-50 px-1.5 py-0.5 text-[10px] font-black text-pink-700">
                                                   {product.variant_group_name}
                                                </span>
                                                <span className="text-[10px] font-bold text-gray-500">
                                                   {product.variant_name || product.name}
                                                </span>
                                             </div>
                                          )}
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
                                    {renderCatalogStockFlow(product)}
                                 </td>
                                 <td className="px-6 py-4">
                                    {effectiveStatus === 'enable' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>}
                                    {effectiveStatus === 'disable' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">Disabled</span>}
                                    {effectiveStatus === 'soldout' && <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600">Sold Out</span>}
                                 </td>
                                 <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 transition-opacity">
                                       <button onClick={() => void openAddToSale(product)} className="min-h-8 rounded-md bg-pink-600 px-2 py-1 text-[11px] font-black text-white">{t('catalogAddToSale')}</button>
                                       {!product.is_unlimited && (
                                          <>
                                             <button
                                                onClick={() => openStockAction({ scope: 'catalog', kind: 'add', product })}
                                                className="min-h-8 rounded-md px-2 py-1 text-[11px] font-black text-emerald-700 hover:bg-emerald-50"
                                             >
                                                Add stock
                                             </button>
                                             <button
                                                onClick={() => openStockAction({ scope: 'catalog', kind: 'remove', product })}
                                                className="min-h-8 rounded-md px-2 py-1 text-[11px] font-black text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                             >
                                                Remove
                                             </button>
                                          </>
                                       )}
                                       <button
                                          onClick={() => openDuplicateVariants(product)}
                                          className="min-h-8 rounded-md px-2 py-1 text-[11px] font-black text-pink-700 hover:bg-pink-50"
                                          title="Create variants"
                                          aria-label={`Create variants from ${product.name}`}
                                       >
                                          Variants
                                       </button>
                                       <button
                                          onClick={() => handleEditClick(product)}
                                          className="icon-touch inline-flex items-center justify-center text-slate-600 hover:text-blue-700 hover:bg-gray-50 rounded-lg transition-colors"
                                          title="Edit"
                                          aria-label={`Edit ${product.name}`}
                                       >
                                          <Edit2 size={18} />
                                       </button>
                                       <button
                                          onClick={() => requestDeleteProduct(product)}
                                          className="icon-touch inline-flex items-center justify-center text-slate-600 hover:text-red-700 hover:bg-gray-50 rounded-lg transition-colors"
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
                  )}
               </>
            ) : (
               <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                  <span className="material-icons-outlined text-4xl text-gray-300 mb-2">restaurant_menu</span>
                  <p className="text-gray-500">No items available. Use Add Product to create the first catalog item.</p>
               </div>
            )}
            </>
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
                              onKeyDown={(event) => {
                                 if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                 }
                              }}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="Select or type category..."
                           />
                           {/* Datalist is reusable, defined above in the Add form */}
                        </div>

                        <div>
                           <label className="mb-2 block text-sm font-medium text-gray-700">SKU</label>
                           <input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder={t('catalogSkuGenerated')} className="w-full rounded-lg border border-gray-200 px-4 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-pink-500" />
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
                           <label className="block text-sm font-medium text-gray-700 mb-2">Product line</label>
                           <input
                              list="edit-variant-group-suggestions"
                              type="text"
                              value={variantGroupName}
                              onChange={(e) => setVariantGroupName(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="e.g. Sticker Bualoi"
                           />
                           <datalist id="edit-variant-group-suggestions">
                              {allVariantGroupSuggestions.map(group => (
                                 <option key={group} value={group} />
                              ))}
                           </datalist>
                        </div>

                        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                           <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Option name</label>
                              <input
                                 type="text"
                                 value={variantName}
                                 onChange={(e) => setVariantName(e.target.value)}
                                 className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                                 placeholder="e.g. Paimon / Blue / 57mm"
                              />
                           </div>
                           <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Sort</label>
                              <input
                                 type="number"
                                 value={variantSortOrder}
                                 onChange={(e) => setVariantSortOrder(e.target.value)}
                                 className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                                 step="1"
                              />
                           </div>
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
                                 className={[
                                    'w-full flex items-center justify-center px-4 py-2 border border-dashed rounded-lg cursor-pointer transition-colors',
                                    editFile
                                       ? 'border-pink-500 bg-pink-50 text-pink-700'
                                       : 'border-gray-300 text-slate-600 hover:border-pink-400'
                                 ].join(' ')}
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
                           {editingProduct.is_unlimited ? (
                              <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-600">Unlimited</div>
                           ) : (() => {
                              const summary = getProductStockSummary(editingProduct);
                              return (
                                 <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700">
                                    <div>On hand: {summary.on_hand}</div>
                                    <div>Allocated: {summary.allocated}</div>
                                    <div>Available: {summary.available}</div>
                                    <div className="mt-3 flex gap-2">
                                       <Button
                                          type="button"
                                          onClick={() => openStockAction({ scope: 'catalog', kind: 'add', product: editingProduct })}
                                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                                       >
                                          Add stock
                                       </Button>
                                       <Button
                                          type="button"
                                          onClick={() => openStockAction({ scope: 'catalog', kind: 'remove', product: editingProduct })}
                                          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100"
                                       >
                                          Remove stock
                                       </Button>
                                    </div>
                                 </div>
                              );
                           })()}
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
                                 className="rounded-lg border border-pink-600 bg-pink-600 px-4 py-2 text-sm font-bold text-white hover:bg-pink-700"
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
                           className="rounded-lg border border-gray-700 bg-gray-700 px-6 py-2 text-white transition-colors hover:bg-gray-800"
                        >
                           Cancel
                        </Button>
                        <Button 
                           type="submit" 
                           disabled={uploading}
                           className="bg-pink-600 hover:bg-pink-700 text-white py-2 px-8 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95"
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
