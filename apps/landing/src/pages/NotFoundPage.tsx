/**
 * 404 на главном домене.
 *
 * У лендинга нет роутера: Caddy отдаёт его index.html на любой путь,
 * поэтому адрес проверяем сами. Всё, что не корень, — ошибка.
 */
import { NotFound } from '@ui/NotFound';

export function LandingNotFound() {
  return (
    <NotFound
      onHome={() => {
        window.location.href = '/';
      }}
      onBack={() => {
        window.history.back();
      }}
    />
  );
}