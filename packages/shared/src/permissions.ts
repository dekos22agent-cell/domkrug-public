/**
 * Каталог прав платформы: русские названия и группы.
 *
 * Зачем: в ответе `/auth/me` права приходят кодами (`ticket.view.all`).
 * Показывать их сотруднику в сыром виде бессмысленно — он не должен знать
 * внутренние имена. Здесь один источник подписей для профиля УК и будущих
 * экранов администрирования.
 *
 * Источник кодов — таблица `permissions` (backend/migrations/001_core_reference.sql),
 * описания — docs/RBAC.md п. 3. Если появится новое право, его нужно добавить
 * сюда, иначе в профиле оно покажется сырым кодом (это осознанный запасной
 * вариант: лучше код, чем ничего).
 */

export interface PermissionInfo {
  code: string;
  label: string;
}

export interface PermissionGroup {
  title: string;
  items: PermissionInfo[];
}

/**
 * Порядок групп — от «общего» к «рабочему»: сначала организация, потом дома,
 * заявки и служебное. Внутри группы права идут в порядке рабочего сценария,
 * а не по алфавиту: сотрудник читает сверху вниз.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    title: 'Организация и сотрудники',
    items: [
      { code: 'tenant.view', label: 'Просмотр своей УК' },
      { code: 'tenant.update', label: 'Изменение данных УК' },
      { code: 'tenant.create', label: 'Создание УК на платформе' },
      { code: 'tenant.suspend', label: 'Приостановка и возобновление УК' },
      { code: 'staff.view', label: 'Просмотр сотрудников' },
      { code: 'staff.manage', label: 'Приём и деактивация сотрудников' },
      { code: 'staff.roles.assign', label: 'Назначение ролей сотрудникам' },
      { code: 'user.view', label: 'Просмотр пользователей' },
      { code: 'user.create', label: 'Создание учётных записей' },
      { code: 'user.block', label: 'Блокировка пользователей' },
    ],
  },
  {
    title: 'Дома и квартиры',
    items: [
      { code: 'complex.view', label: 'Просмотр жилых комплексов' },
      { code: 'complex.manage', label: 'Управление жилыми комплексами' },
      { code: 'building.view', label: 'Просмотр домов' },
      { code: 'building.manage', label: 'Управление домами' },
      { code: 'building.import', label: 'Импорт домов' },
      { code: 'apartment.view', label: 'Просмотр квартир' },
      { code: 'apartment.manage', label: 'Управление квартирами' },
      { code: 'apartment.import', label: 'Импорт квартир' },
    ],
  },
  {
    title: 'Жители и привязки',
    items: [
      { code: 'resident_binding.view', label: 'Просмотр заявок на привязку' },
      { code: 'resident_binding.confirm', label: 'Подтверждение привязок' },
      { code: 'resident_binding.reject', label: 'Отклонение привязок' },
      { code: 'resident_binding.revoke', label: 'Отзыв подтверждённых привязок' },
    ],
  },
  {
    title: 'Заявки',
    items: [
      { code: 'ticket.create', label: 'Создание заявок' },
      { code: 'ticket.view.own', label: 'Просмотр своих заявок' },
      { code: 'ticket.view.all', label: 'Просмотр всех заявок УК' },
      { code: 'ticket.view.assigned', label: 'Просмотр назначенных на меня' },
      { code: 'ticket.accept', label: 'Принятие заявок' },
      { code: 'ticket.assign', label: 'Назначение исполнителя' },
      { code: 'ticket.status.change', label: 'Смена статуса заявки' },
      { code: 'ticket.close', label: 'Закрытие заявок' },
      { code: 'ticket.reject', label: 'Отклонение заявок' },
      { code: 'ticket.delete', label: 'Удаление заявок' },
      { code: 'ticket.export', label: 'Выгрузка заявок' },
      { code: 'ticket.comment.create', label: 'Комментирование заявок' },
      { code: 'ticket.comment.internal', label: 'Служебные комментарии' },
      { code: 'ticket.comment.delete', label: 'Удаление комментариев' },
      { code: 'ticket.attachment.upload', label: 'Загрузка фото и файлов' },
      { code: 'ticket.attachment.delete', label: 'Удаление вложений' },
    ],
  },
  {
    title: 'Справочники',
    items: [
      { code: 'category.view', label: 'Просмотр категорий' },
      { code: 'category.manage', label: 'Настройка категорий' },
      { code: 'sla.manage', label: 'Настройка сроков SLA' },
      { code: 'status.view', label: 'Просмотр справочника статусов' },
    ],
  },
  {
    title: 'Объявления',
    items: [
      { code: 'news.view', label: 'Просмотр объявлений' },
      { code: 'news.manage', label: 'Создание и редактирование объявлений' },
      { code: 'news.publish', label: 'Публикация объявлений' },
      { code: 'news.delete', label: 'Удаление объявлений' },
    ],
  },
  {
    title: 'Уведомления',
    items: [{ code: 'notification.view.own', label: 'Свои уведомления' }],
  },
  {
    title: 'Контроль и отчёты',
    items: [
      { code: 'audit.view', label: 'Журнал действий УК' },
      { code: 'platform.audit.view', label: 'Платформенный журнал' },
      { code: 'report.view', label: 'Аналитика и сводки' },
      { code: 'report.export', label: 'Выгрузка отчётов' },
    ],
  },
];

/** Код → подпись. Строим один раз: прав немного, но искать их в цикле незачем. */
const LABELS = new Map<string, string>(
  PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => [item.code, item.label] as const)),
);

export function permissionLabel(code: string): string {
  return LABELS.get(code) ?? code;
}

export interface GrantedPermissionGroup {
  title: string;
  items: PermissionInfo[];
}

/**
 * Оставить только выданные права и убрать пустые группы.
 *
 * Порядок групп и прав сохраняется как в каталоге: профиль не должен
 * перетасовываться от того, в каком порядке сервер вернул права.
 */
export function groupGrantedPermissions(codes: readonly string[]): GrantedPermissionGroup[] {
  const granted = new Set(codes);
  return PERMISSION_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => granted.has(item.code)),
  })).filter((group) => group.items.length > 0);
}
