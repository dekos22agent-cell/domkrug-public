import { ComingSoon } from './ComingSoon';

/** Платформенная часть — вне MVP-интерфейса. */
export function PlatformPage() {
  return (
    <ComingSoon
      title="Раздел платформы ещё не готов"
      description="Управление УК на платформе — административная часть, не входит в MVP-экраны."
      plan="Вернёмся к нему после пилота."
    />
  );
}

/** Страница 404. */
export function NotFoundPage() {
  return (
    <ComingSoon
      title="Страница не найдена"
      description="Возможно, ссылка устарела или у вас нет доступа к этому разделу."
      plan=""
    />
  );
}

/** Экран «нет прав» — 403 показываем текстом, а не прячем молча. */
export function ForbiddenPage() {
  return (
    <ComingSoon
      title="Недостаточно прав"
      description="Ваша роль не даёт доступа к этому разделу."
      plan="Если это ошибка — обратитесь к администратору УК."
    />
  );
}
