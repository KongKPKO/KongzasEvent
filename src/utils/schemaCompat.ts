type UnknownRecord = Record<string, any>;

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export const buildLegacyLocation = (record: UnknownRecord) =>
  [record.location_name, record.location_detail]
    .filter(hasText)
    .join(', ');

export const normalizeEventRecord = <T extends UnknownRecord>(record: T, fallbackTimeZone?: string) => {
  const legacyLocation = buildLegacyLocation(record);

  return {
    ...record,
    event_timezone: hasText(record.event_timezone) ? record.event_timezone : fallbackTimeZone || null,
    location: hasText(record.location) ? record.location : legacyLocation || null,
    booth_detail: hasText(record.booth_detail) ? record.booth_detail : record.booth_number || null,
    queueing_area: hasText(record.queueing_area) ? record.queueing_area : null,
  };
};

export const normalizeProductRecord = <T extends UnknownRecord>(record: T) => {
  const tags = Array.isArray(record.tags) ? record.tags.filter(hasText) : [];
  const status = record.is_out_of_stock && record.status !== 'disable' ? 'soldout' : record.status;
  const sortOrder = Number(record.variant_sort_order);

  return {
    ...record,
    parent_product_id: hasText(record.parent_product_id) ? record.parent_product_id : null,
    product_kind: ['single', 'photo', 'bundle', 'preorder', 'service'].includes(record.product_kind) ? record.product_kind : 'single',
    gallery_images: Array.isArray(record.gallery_images) ? record.gallery_images.filter(hasText) : [],
    bundle_items: Array.isArray(record.bundle_items) ? record.bundle_items.filter((item: unknown) =>
      typeof item === 'object' && item !== null && 'name' in item && hasText(item.name)
      && 'quantity' in item && typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0) : [],
    tags,
    status,
    stock_reserved: typeof record.stock_reserved === 'number' ? record.stock_reserved : 0,
    stock_sold: typeof record.stock_sold === 'number' ? record.stock_sold : 0,
    is_unlimited: Boolean(record.is_unlimited),
    variant_group_name: hasText(record.variant_group_name) ? record.variant_group_name.trim() : null,
    variant_name: hasText(record.variant_name) ? record.variant_name.trim() : null,
    variant_sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
};
