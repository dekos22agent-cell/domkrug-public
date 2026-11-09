/**
 * Правила навигации и доступа — чистые функции, без React.
 *
 * Вынесены из auth.tsx, чтобы файл с провайдером экспортировал только
 * компонент: иначе Fast Refresh не работает и каждое изменение тянет
 * полную перезагрузку. Заодно эти функции легко тестировать.
 */

import type { Binding } from './types';

/** Привязка, подтверждённая УК. Без неё житель не может создавать заявки. */
export function confirmedBinding(bindings: Binding[]): Binding | null {
  return bindings.find((b) => b.status === 'confirmed') ?? null;
}

/**
 * Человеческие названия ролей.
 *
 * Один словарь на оба приложения: иначе в кабинете УК и в приложении жителя
 * одна и та же роль называлась бы по-разному. Источник кодов — docs/RBAC.md.
 */
export const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Администратор платформы',
  uk_admin: 'Администратор УК',
  dispatcher: 'Диспетчер',
  executor: 'Исполнитель',
  resident: 'Житель',
  uk_manager: 'Руководитель УК',
};

/** Название роли для показа; неизвестный код возвращаем как есть. */
export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

/**
 * Куда вести пользователя после входа.
 *
 * Порядок важен: у сотрудника УК может быть и роль resident (например, админ,
 * который сам живёт в этом доме), поэтому сначала проверяем «рабочие» роли.
 */
export function defaultRouteFor(roles: string[]): string {
  if (roles.includes('platform_admin')) return '/platform';
  if (roles.includes('uk_admin') || roles.includes('dispatcher') || roles.includes('uk_manager')) {
    return '/inbox';
  }
  if (roles.includes('executor')) return '/my';
  return '/';
}
