# Image And Storage Hygiene

This app currently uses a single `products.image_url` as the product cover image. Future multi-image support should add a separate gallery table while keeping `products.image_url` as the cover for backward compatibility.

## Current Rule

- Product cover images live in the Supabase Storage `Menu` bucket.
- `products.image_url` should store either the Storage path or the existing compatible URL value.
- Customer-facing pages should request optimized display sizes instead of rendering the original image at full size.

## Upload Limits

Use client-side compression before upload for catalog/menu images.

Recommended app limits:

- Max original upload size: 6 MB for normal product images.
- Max image dimension after compression: 2000 px on the longest edge.
- Preferred output format: JPEG/WebP where possible.
- HEIC/HEIF should be converted before upload.
- Reject non-image MIME types.

Supabase standard uploads are best for small files. For files over 6 MB, use resumable uploads instead of standard multipart uploads.

## Display Sizes

Use separate requested widths for each surface:

- Product card thumbnail: 300-420 px
- Admin list thumbnail: 100-160 px
- Product detail modal: 900-1200 px
- Future gallery thumbnail: 120-180 px

For product detail images, use `object-contain` and a max height. Do not upscale tiny images aggressively; it makes compression artifacts obvious.

## Multi-Image Data Model

When adding product galleries, prefer a table like:

```sql
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
```

Rules:

- Keep `products.image_url` as the cover image.
- Gallery rows are extra images, not replacements for the cover.
- The first gallery image may mirror the cover only if the UI needs one unified carousel.
- Reorder by `sort_order`, then `created_at`.
- Enable RLS before exposing the table.

## Deletion Hygiene

Deletion must be explicit:

- Removing a product image row should remove the related Storage object when no other product references it.
- Replacing a cover image should remove the old Storage object only after the new upload and DB update both succeed.
- Product soft delete should not immediately delete images; keep images until a cleanup job or manual purge confirms the product will not be restored.
- Never retry mutating upload/delete operations blindly after a timeout. First check current DB and Storage state.

## Orphan Cleanup

Run a periodic manual check before large releases:

1. List product image paths referenced by `products.image_url`.
2. After multi-image support, include `product_images.image_url`.
3. List files in the `Menu` bucket.
4. Report files that are older than 24 hours and not referenced by any product.
5. Delete only after exporting the report.

Do not automate destructive cleanup until restore expectations are clear.

## Monitoring Signals

Watch for:

- sudden storage growth
- 404 images in customer menu
- repeated upload failures
- large original images being served in card grids
- failed delete requests after product edit

## References

- Supabase image transformations: https://supabase.com/docs/guides/storage/serving/image-transformations
- Supabase standard uploads: https://supabase.com/docs/guides/storage/uploads/standard-uploads
