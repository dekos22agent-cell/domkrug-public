import { describe, expect, it } from 'vitest';
import { PERMISSION_GROUPS, groupGrantedPermissions, permissionLabel } from './permissions';

describe('каталог прав', () => {
  it('не содержит дублей кодов', () => {
    const codes = PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.code));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('оставляет только выданные права и сохраняет порядок каталога', () => {
    const groups = groupGrantedPermissions(['ticket.view.all', 'tenant.view', 'unknown.code']);

    expect(groups.map((group) => group.title)).toEqual([
      'Организация и сотрудники',
      'Заявки',
    ]);
    expect(groups.find((g) => g.title === 'Организация и сотрудники')?.items.map((i) => i.code)).toEqual([
      'tenant.view',
    ]);
    expect(groups.find((g) => g.title === 'Заявки')?.items.map((i) => i.code)).toEqual([
      'ticket.view.all',
    ]);
  });

  it('не отдаёт пустых групп', () => {
    expect(groupGrantedPermissions([])).toEqual([]);
  });

  it('переводит код в подпись и не падает на неизвестном', () => {
    expect(permissionLabel('ticket.close')).toBe('Закрытие заявок');
    expect(permissionLabel('future.permission')).toBe('future.permission');
  });
});
