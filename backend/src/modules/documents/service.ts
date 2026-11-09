/**
 * Документы УК: ссылки на PDF и страницы.
 *
 * Житель видит опубликованные документы своей УК и своего дома. Черновики
 * доступны только сотрудникам.
 */
import { pool } from '../../db/pool.js';

export type DocumentCategory = 'house' | 'apartment' | 'receipt' | 'other';

export interface DocumentItem {
  id: string;
  title: string;
  description: string | null;
  category: DocumentCategory;
  url: string;
  buildingId: string | null;
  buildingAddress: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  title: string;
  description: string | null;
  category: DocumentCategory;
  url: string;
  building_id: string | null;
  building_address: string | null;
  published_at: Date | null;
  created_at: Date;
}

const SELECT = `
  SELECT d.id, d.title, d.description, d.category, d.url, d.building_id,
         b.address_text AS building_address, d.published_at, d.created_at
    FROM documents d
    LEFT JOIN buildings b ON b.id = d.building_id AND b.deleted_at IS NULL`;

function toItem(row: Row): DocumentItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    url: row.url,
    buildingId: row.building_id,
    buildingAddress: row.building_address,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listDocumentsForResident(userId: string): Promise<DocumentItem[]> {
  const res = await pool.query<Row>(
    `${SELECT}
      WHERE d.published_at IS NOT NULL
        AND d.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM resident_bindings rb
            JOIN apartments a ON a.id = rb.apartment_id AND a.deleted_at IS NULL
           WHERE rb.user_id = $1
             AND rb.status = 'confirmed'
             AND d.tenant_id = rb.tenant_id
             AND (d.building_id IS NULL OR d.building_id = a.building_id)
        )
      ORDER BY d.category, d.published_at DESC`,
    [userId],
  );
  return res.rows.map(toItem);
}

export async function listDocumentsForTenant(tenantId: string): Promise<DocumentItem[]> {
  const res = await pool.query<Row>(
    `${SELECT}
      WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
      ORDER BY COALESCE(d.published_at, d.created_at) DESC`,
    [tenantId],
  );
  return res.rows.map(toItem);
}

export interface CreateDocumentInput {
  tenantId: string;
  buildingId: string | null;
  title: string;
  description: string | null;
  category: DocumentCategory;
  url: string;
  publish: boolean;
  authorId: string;
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentItem | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (input.buildingId) {
      const building = await client.query(
        `SELECT 1 FROM buildings
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [input.buildingId, input.tenantId],
      );
      if ((building.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }
    }

    const res = await client.query<Row>(
      `INSERT INTO documents
         (tenant_id, building_id, title, description, category, url, published_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
               CASE WHEN $7 THEN now() ELSE NULL END, $8::uuid)
       RETURNING id, title, description, category, url, building_id,
                 NULL::text AS building_address, published_at, created_at`,
      [
        input.tenantId,
        input.buildingId,
        input.title,
        input.description,
        input.category,
        input.url,
        input.publish,
        input.authorId,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Не удалось создать документ');

    await client.query('COMMIT');
    return toItem(row);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function publishDocument(
  tenantId: string,
  documentId: string,
): Promise<DocumentItem | null> {
  const res = await pool.query<Row>(
    `UPDATE documents
        SET published_at = COALESCE(published_at, now())
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      RETURNING id, title, description, category, url, building_id,
                (SELECT address_text FROM buildings b WHERE b.id = documents.building_id) AS building_address,
                published_at, created_at`,
    [documentId, tenantId],
  );
  const row = res.rows[0];
  return row ? toItem(row) : null;
}
