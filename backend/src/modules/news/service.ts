/**
 * Объявления УК.
 *
 * Житель видит опубликованные объявления, относящиеся к его УК, ЖК или дому.
 * Черновики не отдаются. Публикация создаёт уведомление всем подтверждённым
 * жителям УК.
 */
import { pool } from '../../db/pool.js';

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  isEmergency: boolean;
  publishedAt: string | null;
  createdAt: string;
}

interface NewsRow {
  id: string;
  title: string;
  body: string;
  is_emergency: boolean;
  published_at: Date | null;
  created_at: Date;
}

function toItem(row: NewsRow): NewsItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isEmergency: row.is_emergency,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listNewsForResident(userId: string, limit = 30): Promise<NewsItem[]> {
  const res = await pool.query<NewsRow>(
    `SELECT n.id, n.title, n.body, n.is_emergency, n.published_at, n.created_at
       FROM news n
      WHERE n.published_at IS NOT NULL
        AND n.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM resident_bindings rb
            JOIN apartments a ON a.id = rb.apartment_id AND a.deleted_at IS NULL
            JOIN buildings b ON b.id = a.building_id AND b.deleted_at IS NULL
           WHERE rb.user_id = $1
             AND rb.status = 'confirmed'
             AND n.tenant_id = rb.tenant_id
             AND (
               n.scope = 'tenant'
               OR (n.scope = 'complex' AND n.complex_id = b.complex_id)
               OR (n.scope = 'building' AND n.building_id = a.building_id)
             )
        )
      ORDER BY n.is_emergency DESC, n.published_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return res.rows.map(toItem);
}

export async function listNewsForTenant(tenantId: string, limit = 100): Promise<NewsItem[]> {
  const res = await pool.query<NewsRow>(
    `SELECT id, title, body, is_emergency, published_at, created_at
       FROM news
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY is_emergency DESC, COALESCE(published_at, created_at) DESC
      LIMIT $2`,
    [tenantId, limit],
  );
  return res.rows.map(toItem);
}

export interface CreateNewsInput {
  tenantId: string;
  title: string;
  body: string;
  isEmergency: boolean;
  publish: boolean;
  authorId: string;
}

export async function createNews(input: CreateNewsInput): Promise<NewsItem> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<NewsRow>(
      `INSERT INTO news
         (tenant_id, scope, title, body, is_emergency, published_at, published_by)
       VALUES ($1::uuid, 'tenant', $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END, $6::uuid)
       RETURNING id, title, body, is_emergency, published_at, created_at`,
      [input.tenantId, input.title, input.body, input.isEmergency, input.publish, input.authorId],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Не удалось создать объявление');

    if (input.publish) {
      await client.query(
        `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
         SELECT DISTINCT $1::uuid, rb.user_id, 'news_published',
                n.title, left(n.body, 200), 'news', n.id
           FROM news n
           JOIN resident_bindings rb
             ON rb.tenant_id = n.tenant_id AND rb.status = 'confirmed'
          WHERE n.id = $2`,
        [input.tenantId, row.id],
      );
    }

    await client.query('COMMIT');
    return toItem(row);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function publishNews(
  tenantId: string,
  newsId: string,
  authorId: string,
): Promise<NewsItem | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<NewsRow>(
      `UPDATE news
          SET published_at = COALESCE(published_at, now()),
              published_by = COALESCE(published_by, $3)
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id, title, body, is_emergency, published_at, created_at`,
      [newsId, tenantId, authorId],
    );
    const row = res.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT DISTINCT $1::uuid, rb.user_id, 'news_published',
              n.title, left(n.body, 200), 'news', n.id
         FROM news n
         JOIN resident_bindings rb
           ON rb.tenant_id = n.tenant_id AND rb.status = 'confirmed'
        WHERE n.id = $2
          AND NOT EXISTS (
            SELECT 1 FROM notifications x
             WHERE x.user_id = rb.user_id AND x.entity_type = 'news' AND x.entity_id = n.id
          )`,
      [tenantId, newsId],
    );

    await client.query('COMMIT');
    return toItem(row);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
