/** Сводка по заявкам для кабинета УК. */
import { pool } from '../../db/pool.js';

export interface ReportSummary {
  totals: {
    total: number;
    open: number;
    overdue: number;
    emergencyOpen: number;
    thisMonth: number;
    closedThisMonth: number;
    avgCloseHours: number | null;
  };
  categories: { name: string; total: number; open: number; overdue: number }[];
  staff: { name: string; open: number; overdue: number; closedThisMonth: number }[];
  overdue: {
    id: string;
    number: number;
    title: string;
    priority: string;
    address: string;
    dueAt: string;
  }[];
}

export async function getReportSummary(tenantId: string): Promise<ReportSummary> {
  const [totals, categories, staff, overdue] = await Promise.all([
    pool.query<{
      total: string;
      open: string;
      overdue: string;
      emergency_open: string;
      this_month: string;
      closed_this_month: string;
      avg_close_hours: string | null;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE t.closed_at IS NULL)::text AS open,
              count(*) FILTER (
                WHERE t.closed_at IS NULL AND t.sla_due_at IS NOT NULL AND t.sla_due_at < now()
              )::text AS overdue,
              count(*) FILTER (
                WHERE t.closed_at IS NULL AND t.priority = 'emergency'
              )::text AS emergency_open,
              count(*) FILTER (WHERE t.created_at >= date_trunc('month', now()))::text AS this_month,
              count(*) FILTER (
                WHERE t.closed_at >= date_trunc('month', now())
              )::text AS closed_this_month,
              round(avg(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 3600)
                FILTER (WHERE t.closed_at IS NOT NULL))::text AS avg_close_hours
         FROM tickets t
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL`,
      [tenantId],
    ),
    pool.query<{ name: string; total: string; open: string; overdue: string }>(
      `SELECT c.name,
              count(*)::text AS total,
              count(*) FILTER (WHERE t.closed_at IS NULL)::text AS open,
              count(*) FILTER (
                WHERE t.closed_at IS NULL AND t.sla_due_at IS NOT NULL AND t.sla_due_at < now()
              )::text AS overdue
         FROM tickets t
         JOIN ticket_categories c ON c.id = t.category_id
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
        GROUP BY c.name, c.sort_order
        ORDER BY count(*) DESC, c.name`,
      [tenantId],
    ),
    pool.query<{ name: string; open: string; overdue: string; closed_this_month: string }>(
      `SELECT u.full_name AS name,
              count(t.id) FILTER (WHERE t.closed_at IS NULL)::text AS open,
              count(t.id) FILTER (
                WHERE t.closed_at IS NULL AND t.sla_due_at IS NOT NULL AND t.sla_due_at < now()
              )::text AS overdue,
              count(t.id) FILTER (
                WHERE t.closed_at >= date_trunc('month', now())
              )::text AS closed_this_month
         FROM staff s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN tickets t
           ON t.assigned_to = s.user_id
          AND t.tenant_id = s.tenant_id
          AND t.deleted_at IS NULL
        WHERE s.tenant_id = $1 AND s.is_active = true AND u.deleted_at IS NULL
        GROUP BY u.id, u.full_name
        ORDER BY count(t.id) FILTER (WHERE t.closed_at IS NULL) DESC, u.full_name`,
      [tenantId],
    ),
    pool.query<{
      id: string;
      number: number;
      title: string;
      priority: string;
      address: string;
      due_at: Date;
    }>(
      `SELECT t.id, t.number, COALESCE(t.title, t.description) AS title, t.priority,
              b.address_text AS address, t.sla_due_at AS due_at
         FROM tickets t
         JOIN buildings b ON b.id = t.building_id
        WHERE t.tenant_id = $1
          AND t.deleted_at IS NULL
          AND t.closed_at IS NULL
          AND t.sla_due_at IS NOT NULL
          AND t.sla_due_at < now()
        ORDER BY t.sla_due_at
        LIMIT 10`,
      [tenantId],
    ),
  ]);

  const row = totals.rows[0];
  return {
    totals: {
      total: Number(row?.total ?? 0),
      open: Number(row?.open ?? 0),
      overdue: Number(row?.overdue ?? 0),
      emergencyOpen: Number(row?.emergency_open ?? 0),
      thisMonth: Number(row?.this_month ?? 0),
      closedThisMonth: Number(row?.closed_this_month ?? 0),
      avgCloseHours: row?.avg_close_hours ? Number(row.avg_close_hours) : null,
    },
    categories: categories.rows.map((item) => ({
      name: item.name,
      total: Number(item.total),
      open: Number(item.open),
      overdue: Number(item.overdue),
    })),
    staff: staff.rows.map((item) => ({
      name: item.name,
      open: Number(item.open),
      overdue: Number(item.overdue),
      closedThisMonth: Number(item.closed_this_month),
    })),
    overdue: overdue.rows.map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      priority: item.priority,
      address: item.address,
      dueAt: item.due_at.toISOString(),
    })),
  };
}
