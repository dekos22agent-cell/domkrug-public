/**
 * Администрирование УК: сотрудники, телефоны, журнал и отчёты.
 */
import { describe, expect, it } from 'vitest';
import { login } from './helpers.js';

interface StaffItem {
  id: string;
  roles: string[];
}

describe('Управление УК', () => {
  it('создаёт сотрудника, телефон и отдаёт журнал с отчётом', async () => {
    const { client: admin } = await login({ identifier: '+79000000001' });

    const created = await admin.post<StaffItem>('/staff', {
      fullName: 'Автотест Сотрудник',
      phone: '+79000000992',
      email: '',
      password: 'Demo1234!',
      position: 'Тестовая должность',
      roles: ['executor'],
    });
    expect(created.status).toBe(201);
    expect(created.data?.roles).toContain('executor');

    const contact = await admin.post('/contacts', {
      kind: 'other',
      name: 'Автотест телефон',
      phone: '+7 385 000-00-01',
      note: null,
      buildingId: null,
      sortOrder: 100,
    });
    expect(contact.status).toBe(201);

    const audit = await admin.get<{ items: { action: string }[] }>('/audit?limit=20');
    expect(audit.status).toBe(200);
    expect(audit.data?.items.some((item) => item.action === 'staff.create')).toBe(true);

    const report = await admin.get<{ totals: { total: number } }>('/reports');
    expect(report.status).toBe(200);
    expect(report.data?.totals.total).toBeGreaterThan(0);
  });
});
