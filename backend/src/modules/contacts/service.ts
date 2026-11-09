/**
 * Полезные телефоны.
 *
 * Телефоны УК, участкового, провайдеров, поликлиники. Человек ищет их
 * в момент проблемы — когда нет горячей воды или не работает интернет,
 * а не «на всякий случай».
 *
 * Телефон храним строкой, а не числом: в нём бывают добавочные, скобки и
 * несколько номеров через запятую. Для набора на телефоне фронтенд приводит
 * его к формату tel: отдельно.
 */
import { pool } from '../../db/pool.js';

export type ContactKind = 'uk' | 'district' | 'provider' | 'clinic' | 'emergency' | 'other';

export interface ContactItem {
  id: string;
  kind: ContactKind;
  name: string;
  phone: string;
  note: string | null;
  buildingAddress: string | null;
}

/** Контакты УК и домов, где живёт человек. */
export async function listContactsForUser(userId: string): Promise<ContactItem[]> {
  const res = await pool.query<{
    id: string;
    kind: ContactKind;
    name: string;
    phone: string;
    note: string | null;
    sort_order: number;
    address_text: string | null;
  }>(
    `SELECT DISTINCT c.id, c.kind, c.name, c.phone, c.note, c.sort_order, b.address_text
       FROM resident_bindings rb
       JOIN apartments a ON a.id = rb.apartment_id
       JOIN contacts c
         ON c.tenant_id = rb.tenant_id
        AND (c.building_id IS NULL OR c.building_id = a.building_id)
       LEFT JOIN buildings b ON b.id = c.building_id
      WHERE rb.user_id = $1 AND rb.status = 'confirmed'
      ORDER BY c.kind, c.sort_order, c.name`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    note: row.note,
    buildingAddress: row.address_text,
  }));
}
