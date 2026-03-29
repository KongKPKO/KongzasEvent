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

  return {
    ...record,
    tags,
    status,
    stock_reserved: typeof record.stock_reserved === 'number' ? record.stock_reserved : 0,
    stock_sold: typeof record.stock_sold === 'number' ? record.stock_sold : 0,
    is_unlimited: Boolean(record.is_unlimited),
  };
};
