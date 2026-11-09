/**
 * Дома и квартиры УК — нужны, чтобы диспетчер мог зарегистрировать обращение
 * по телефону: он выбирает дом и квартиру сам, в отличие от жителя.
 */

import { useEffect, useState } from 'react';
import { api } from './api';
import type { ApartmentListItem, BuildingListItem } from './types';

interface UseBuildingsResult {
  buildings: BuildingListItem[];
  loading: boolean;
  error: string | null;
}

export function useBuildings(): UseBuildingsResult {
  const [buildings, setBuildings] = useState<BuildingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: BuildingListItem[] }>('/buildings');
        if (cancelled) return;
        setBuildings(response.items);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить дома');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { buildings, loading, error };
}

/** Квартиры выбранного дома. Пустой buildingId — ничего не грузим. */
export function useApartments(buildingId: string): {
  apartments: ApartmentListItem[];
  loading: boolean;
  error: string | null;
} {
  const [apartments, setApartments] = useState<ApartmentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!buildingId) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: ApartmentListItem[] }>(
          `/buildings/${buildingId}/apartments?limit=100`,
        );
        if (cancelled) return;
        setApartments(response.items);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setApartments([]);
        setError(err instanceof Error ? err.message : 'Не удалось загрузить квартиры');
      } finally {
        if (!cancelled) setLoadedFor(buildingId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  return {
    // Пока грузится другой дом — показываем пусто, а не квартиры предыдущего
    apartments: loadedFor === buildingId ? apartments : [],
    loading: Boolean(buildingId) && loadedFor !== buildingId,
    error,
  };
}
