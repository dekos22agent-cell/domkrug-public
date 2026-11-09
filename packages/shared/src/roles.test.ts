import { describe, expect, it } from 'vitest';
import { defaultRouteFor, roleLabel } from './roles';

describe('роли', () => {
  it('переводит код в человеческое название', () => {
    expect(roleLabel('dispatcher')).toBe('Диспетчер');
    expect(roleLabel('uk_admin')).toBe('Администратор УК');
  });

  it('не падает на неизвестной роли', () => {
    expect(roleLabel('future.role')).toBe('future.role');
  });

  it('ведёт сотрудника в его раздел', () => {
    expect(defaultRouteFor(['dispatcher'])).toBe('/inbox');
    expect(defaultRouteFor(['executor'])).toBe('/my');
    expect(defaultRouteFor(['resident'])).toBe('/');
  });
});
