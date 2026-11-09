/**
 * Справочник категорий заявок.
 *
 * Категории отдаются целиком, без пагинации — их мало (docs/API-CONTRACT.md п. 2.4).
 * Хук один на все экраны: форма создания заявки и будущие фильтры инбокса.
 */

import { useEffect, useState } from 'react';
import { api } from './api';
import type { TicketCategory } from './types';

interface UseCategoriesResult {
  categories: TicketCategory[];
  loading: boolean;
  error: string | null;
}

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await api.get<{ items: TicketCategory[] }>('/ticket-categories');
        if (cancelled) return;
        setCategories(response.items);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить категории');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { categories, loading, error };
}
