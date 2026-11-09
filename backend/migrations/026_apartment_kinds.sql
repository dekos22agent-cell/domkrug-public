-- ============================================================================
-- 026_apartment_kinds.sql
-- Типы помещений: квартира, нежилое, дом, офис, магазин, паркинг, кладовая.
--
-- Один и тот же объект управления может содержать разные типы помещений.
-- financial и billing-поля не добавляются.
-- ============================================================================

ALTER TABLE apartments
  DROP CONSTRAINT IF EXISTS apartments_kind_check;

ALTER TABLE apartments
  ADD CONSTRAINT apartments_kind_check
  CHECK (kind IN (
    'apartment',
    'nonresidential',
    'house',
    'office',
    'retail',
    'parking',
    'storage'
  ));

COMMENT ON COLUMN apartments.kind IS
  'Тип помещения: apartment, nonresidential, house, office, retail, parking, storage.';
