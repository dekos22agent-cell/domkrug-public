import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@ui/Badge';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { api, ApiError } from '@shared/api';
import { formatDateTime } from '@shared/format';
import type { ReportSummary } from '@shared/types';
import pageStyles from './pages.module.css';
import styles from './ReportsPage.module.css';

export function ReportsPage() {
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ReportSummary>('/reports')
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Не удалось загрузить отчёт');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <CenteredSpinner label="Считаем показатели" />;

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Отчёты</h1>
          <p className={pageStyles.pageSubtitle}>Заявки, просрочки и нагрузка сотрудников</p>
        </div>
      </div>

      {error && <p className={pageStyles.loadError}>{error}</p>}

      {report && (
        <>
          <div className={styles.stats}>
            <Stat label="Всего заявок" value={report.totals.total} />
            <Stat label="Открытых" value={report.totals.open} />
            <Stat label="Просрочено" value={report.totals.overdue} danger={report.totals.overdue > 0} />
            <Stat label="Аварийных открытых" value={report.totals.emergencyOpen} />
            <Stat label="За этот месяц" value={report.totals.thisMonth} />
            <Stat label="Закрыто за месяц" value={report.totals.closedThisMonth} />
            <Stat
              label="Среднее закрытие"
              value={report.totals.avgCloseHours === null ? '—' : `${report.totals.avgCloseHours} ч`}
            />
          </div>

          <section className={styles.section}>
            <h2 className={pageStyles.sectionTitle}>Просроченные заявки</h2>
            {report.overdue.length === 0 ? (
              <EmptyState title="Просрочек нет" description="Все заявки в пределах срока." />
            ) : (
              <div className={styles.list}>
                {report.overdue.map((ticket) => (
                  <Link key={ticket.id} to={`/tickets/${ticket.id}`} className={styles.overdueRow}>
                    <span>
                      <strong>№{ticket.number}</strong> {ticket.title}
                      <span className={styles.meta}>{ticket.address}</span>
                    </span>
                    <span className={styles.due}>
                      <Badge variant="danger">Просрочено</Badge>
                      <span>{formatDateTime(ticket.dueAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={pageStyles.sectionTitle}>По категориям</h2>
            <Card className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Категория</th>
                    <th>Всего</th>
                    <th>Открыто</th>
                    <th>Просрочено</th>
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((category) => (
                    <tr key={category.name}>
                      <td>{category.name}</td>
                      <td>{category.total}</td>
                      <td>{category.open}</td>
                      <td className={category.overdue > 0 ? styles.dangerText : undefined}>
                        {category.overdue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section className={styles.section}>
            <h2 className={pageStyles.sectionTitle}>Нагрузка сотрудников</h2>
            <Card className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Открыто</th>
                    <th>Просрочено</th>
                    <th>Закрыто за месяц</th>
                  </tr>
                </thead>
                <tbody>
                  {report.staff.map((member) => (
                    <tr key={member.name}>
                      <td>{member.name}</td>
                      <td>{member.open}</td>
                      <td className={member.overdue > 0 ? styles.dangerText : undefined}>
                        {member.overdue}
                      </td>
                      <td>{member.closedThisMonth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <Card className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={[styles.statValue, danger ? styles.dangerText : ''].filter(Boolean).join(' ')}>
        {value}
      </span>
    </Card>
  );
}
