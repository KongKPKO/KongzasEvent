-- Prefer meaningful structured variant data when deriving compact SKU item codes.

create or replace function public.product_sku_item_code(
  p_name text,
  p_variant_name text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := upper(coalesce(nullif(trim(p_name), ''), 'ITEM'));
  v_variant text := upper(coalesce(nullif(trim(p_variant_name), ''), ''));
  v_option_source text := coalesce(nullif(v_variant, ''), v_name);
  v_tokens text[];
  v_token text;
  v_letters text;
  v_digits text;
  v_item text;
  v_option text := '';
begin
  if v_option_source ~ '(^|[^A-Z0-9])NORMAL([^A-Z0-9]|$)' then
    v_option := 'N';
  elsif v_option_source ~ '(^|[^A-Z0-9])SP([^A-Z0-9]|$)' then
    v_option := 'SP';
  end if;

  select array_agg(part order by ordinal)
  into v_tokens
  from regexp_split_to_table(regexp_replace(v_variant, '[^A-Z0-9]+', ' ', 'g'), ' +')
       with ordinality parts(part, ordinal)
  where part <> ''
    and part not in ('CHEKI', 'HAIRCLIP', 'HAIR', 'CLIP', 'PHOTO', 'SET', 'FS', 'HSR', 'NORMAL', 'SP');

  if coalesce(cardinality(v_tokens), 0) = 0 then
    select array_agg(part order by ordinal)
    into v_tokens
    from regexp_split_to_table(regexp_replace(v_name, '[^A-Z0-9]+', ' ', 'g'), ' +')
         with ordinality parts(part, ordinal)
    where part <> ''
      and part not in ('CHEKI', 'HAIRCLIP', 'HAIR', 'CLIP', 'PHOTO', 'SET', 'FS', 'HSR', 'NORMAL', 'SP');
  end if;

  v_token := coalesce(v_tokens[1], 'ITEM');
  if v_token ~ '^[A-Z]{1,3}$' and coalesce(v_tokens[2], '') ~ '^[0-9]+$' then
    v_token := v_token || v_tokens[2];
  end if;
  v_token := coalesce(nullif(regexp_replace(v_token, '[^A-Z0-9]', '', 'g'), ''), 'ITEM');
  v_letters := substring(v_token from '^([A-Z]+)');
  v_digits := substring(v_token from '([0-9]+)$');
  v_item := coalesce(
    nullif(left(coalesce(v_letters, ''), 4) || coalesce(v_digits, ''), ''),
    left(v_token, 8)
  );

  return coalesce(nullif(v_item, ''), 'ITEM')
    || case when v_option = '' then '' else '-' || v_option end;
end;
$$;

comment on function public.product_sku_item_code(text, text) is
  'Builds a compact item and option code from meaningful variant data, falling back to the product name.';
