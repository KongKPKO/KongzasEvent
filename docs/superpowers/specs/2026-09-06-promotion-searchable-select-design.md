# Promotion Searchable Select Design

## Goal

Make the Promotion form's category and tag fields immediately recognizable as searchable selections sourced from the catalog.

## Design

- Keep the existing native `input` + `datalist` behavior and existing catalog suggestions.
- Show localized placeholders: `เลือกหรือพิมพ์ค้นหาหมวดหมู่` / `เลือกหรือพิมพ์ค้นหาแท็ก` (and English equivalents).
- Add a visible dropdown chevron inside each field without blocking typing or native list interaction.
- Add localized helper text explaining that one existing catalog value can be selected or searched.
- Preserve free typing, validation, saved values, promotion targeting, and data contracts.

## Accessibility

- Keep the existing associated labels.
- Treat the chevron as decorative and hide it from assistive technology.
- Maintain the existing keyboard and native datalist behavior.

## Verification

- Build and lint pass.
- Category and tag suggestions still open and filter while typing.
- Thai and English placeholders/helper text render correctly.
