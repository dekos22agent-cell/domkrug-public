import { EmptyState } from '@ui/EmptyState';
import { useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';

interface ComingSoonProps {
  title: string;
  description: string;
  /** Что именно появится на этом экране — по плану работ. */
  plan: string;
}

/**
 * Заглушка для экранов, которые ещё не сделаны.
 *
 * Намеренно говорит прямо «ещё не готово»: правила проекта запрещают выдавать
 * демонстрационное за реальное (ТЗ v1.1 п. 10). Кнопка «Назад» есть всегда,
 * чтобы человек не попал в тупик.
 */
export function ComingSoon({ title, description, plan }: ComingSoonProps) {
  const navigate = useNavigate();
  return (
    <EmptyState
      title={title}
      description={`${description} ${plan}`}
      action={
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Назад
        </Button>
      }
    />
  );
}
