export type EventCatalogSetupMode = 'empty' | 'reuse' | 'select';

export interface EventCatalogSetupProduct {
  id: string;
  name: string;
  category?: string | null;
  tags?: string[] | null;
  is_unlimited?: boolean | null;
  available: number;
}

export interface EventCatalogSetupDraft {
  mode: EventCatalogSetupMode;
  sourceEventId: string;
  selectedProductIds: string[];
  allocations: Record<string, number>;
}

export const emptyEventCatalogSetupDraft = (): EventCatalogSetupDraft => ({
  mode: 'empty',
  sourceEventId: '',
  selectedProductIds: [],
  allocations: {},
});

export const filterEventCatalogSetupProducts = (
  products: EventCatalogSetupProduct[],
  search: string,
  category: string
) => {
  const query = search.trim().toLocaleLowerCase();
  return products.filter((product) => {
    const matchesCategory = category === 'All' || (product.category || 'Other') === category;
    const haystack = [product.name, product.category || '', ...(product.tags || [])].join(' ').toLocaleLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });
};

export const buildEventCatalogInitializationItems = (
  products: EventCatalogSetupProduct[],
  draft: EventCatalogSetupDraft
) => {
  if (draft.mode === 'empty') return [];
  const selected = new Set(draft.selectedProductIds);
  return products.filter((product) => selected.has(product.id)).map((product) => ({
    product_id: product.id,
    stock_total: product.is_unlimited
      ? null
      : Math.min(product.available, Math.max(0, Math.trunc(draft.allocations[product.id] || 0))),
  }));
};
