import type { BuildingObjectKind } from './types';

export const OBJECT_KIND_LABELS: Record<BuildingObjectKind, string> = {
  apartment_building: 'МКД',
  cottage_settlement: 'Коттеджный посёлок',
  mixed_use: 'Смешанный объект',
  commercial_building: 'Нежилое здание',
};

export const OBJECT_KIND_OPTIONS: { value: BuildingObjectKind; label: string }[] = [
  { value: 'apartment_building', label: 'МКД' },
  { value: 'cottage_settlement', label: 'Коттеджный посёлок' },
  { value: 'mixed_use', label: 'Смешанный объект' },
  { value: 'commercial_building', label: 'Нежилое здание' },
];

export function objectKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Объект';
  return OBJECT_KIND_LABELS[kind as BuildingObjectKind] ?? kind;
}

/** Название ЖК уже может содержать «ЖК», не дублируем префикс. */
export function complexLabel(name: string | null | undefined): string {
  if (!name) return '';
  return /^ЖК/i.test(name.trim()) ? name : `ЖК «${name}»`;
}

export const APARTMENT_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'apartment', label: 'Квартира' },
  { value: 'nonresidential', label: 'Нежилое' },
  { value: 'house', label: 'Дом' },
  { value: 'office', label: 'Офис' },
  { value: 'retail', label: 'Магазин' },
  { value: 'parking', label: 'Паркинг' },
  { value: 'storage', label: 'Кладовая' },
];

export function apartmentKindLabel(kind: string | null | undefined): string {
  return APARTMENT_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? 'Помещение';
}
