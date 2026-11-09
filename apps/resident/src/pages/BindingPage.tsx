import { useState, type FormEvent } from 'react';
import { Button } from '@ui/Button';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { Modal } from '@ui/Modal';
import { CenteredSpinner } from '@ui/Spinner';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { useMyBindings } from '@shared/useBindings';
import type { ApartmentSearchItem, Binding } from '@shared/types';
import styles from './BindingPage.module.css';
import pageStyles from './pages.module.css';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Собственник',
  renter: 'Арендатор',
  representative: 'Представитель',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  rejected: 'Отклонена',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--status-progress)',
  confirmed: 'var(--status-done)',
  rejected: 'var(--status-rejected)',
};

/**
 * Привязка к квартире — экран жителя.
 *
 * Поиск отдаёт только адрес и номер квартиры, поэтому человек видит ровно
 * то, что нужно для выбора, и ничего лишнего о соседях.
 *
 * Заявку подтверждает УК (PROGRESS.md п. 5.2). До подтверждения житель видит
 * статус и может отозвать заявку, но создавать обращения не может.
 */
export function BindingPage() {
  const { refreshUser } = useAuth();
  const { items: bindings, loading, error, reload } = useMyBindings();

  const [address, setAddress] = useState('');
  const [apartment, setApartment] = useState('');
  const [roleInApartment, setRoleInApartment] = useState<Binding['roleInApartment']>('owner');

  const [results, setResults] = useState<ApartmentSearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Квартира, открытая в карточке: площадь, дом, отвязка. */
  const [detail, setDetail] = useState<Binding | null>(null);

  /**
   * Показывать ли форму поиска.
   *
   * Владелец заметил: когда квартира уже привязана, блок «Найти свою
   * квартиру» всё равно висит открытым — выглядит так, будто привязка
   * не сработала. Поэтому форма по умолчанию свёрнута и раскрывается
   * кнопкой «Добавить недвижимость».
   *
   * Исключение — первый вход без привязок: там форма нужна сразу, иначе
   * человек не поймёт, что делать.
   *
   * Состояние хранит только выбор пользователя; до первого клика значение
   * вычисляется из загруженных данных. Так не нужен эффект, который меняет
   * состояние на каждом рендере.
   */
  const [userChoice, setUserChoice] = useState<boolean | null>(null);
  const showSearch = userChoice ?? (!loading && bindings.length === 0);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchError(null);
    setActionError(null);

    if (address.trim().length < 3) {
      setSearchError('Укажите адрес — минимум 3 символа');
      return;
    }

    setSearching(true);
    try {
      const params = new URLSearchParams({ address: address.trim() });
      if (apartment.trim()) params.set('apartment', apartment.trim());
      const response = await api.get<{ items: ApartmentSearchItem[] }>(
        `/resident/search-apartment?${params.toString()}`,
      );
      setResults(response.items);
    } catch (err) {
      setResults(null);
      setSearchError(err instanceof Error ? err.message : 'Не удалось выполнить поиск');
    } finally {
      setSearching(false);
    }
  };

  const requestBinding = async (apartmentId: string) => {
    setBusyId(apartmentId);
    setActionError(null);
    try {
      await api.post('/resident/bindings', { apartmentId, roleInApartment });
      setResults(null);
      setAddress('');
      setApartment('');
      // Заявка ушла — форма больше не нужна: статус виден в «Моих привязках»
      setUserChoice(false);
      reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : 'Не удалось отправить заявку на привязку. Попробуйте ещё раз.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const revokeBinding = async (binding: Binding) => {
    // Подтверждённую квартиру отвязываем только после явного подтверждения:
    // действие закрывает доступ и его нельзя отменить кнопкой «назад»
    if (binding.status === 'confirmed') {
      const confirmed = window.confirm(
        `Отвязать квартиру ${binding.addressText}, кв. ${binding.apartmentNumber}? Доступ к ней закроется сразу.`,
      );
      if (!confirmed) return;
    }

    setBusyId(binding.id);
    setActionError(null);
    try {
      await api.delete(`/resident/bindings/${binding.id}`);
      setDetail(null);
      // Обновляем привязки в шапке и переключателе квартир: иначе отвязанная
      // квартира останется в списке до перезагрузки страницы
      await refreshUser();
      reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Не удалось отозвать привязку. Попробуйте ещё раз.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.layout}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Квартира</h1>
          <p className={pageStyles.pageSubtitle}>
            Привязка нужна, чтобы управляющая компания знала, по какому адресу обращение
          </p>
        </div>
      </div>

      {/* ─── Мои привязки ─────────────────────────────────────────── */}
      <section>
        <h2 className={pageStyles.sectionTitle}>Мои привязки</h2>

        {loading ? (
          <CenteredSpinner label="Загружаем привязки" />
        ) : error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : bindings.length === 0 ? (
          <EmptyState
            title="Квартира не привязана"
            description="Найдите свой адрес ниже и отправьте заявку — управляющая компания её подтвердит."
          />
        ) : (
          <div className={styles.layout}>
            {bindings.map((binding) => (
              <div
                key={binding.id}
                className={styles.binding}
                role="button"
                tabIndex={0}
                aria-label={`Квартира ${binding.apartmentNumber}, ${binding.addressText}. Подробнее`}
                onClick={() => setDetail(binding)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDetail(binding);
                  }
                }}
              >
                <div className={styles.bindingTop}>
                  <div className={styles.bindingMain}>
                    <span className={styles.bindingAddress}>
                      {binding.addressText}, кв. {binding.apartmentNumber}
                    </span>
                    <span className={styles.bindingTenant}>{binding.tenantName}</span>
                    <span className={styles.bindingTenant}>
                      Роль: {ROLE_LABELS[binding.roleInApartment] ?? binding.roleInApartment}
                    </span>
                    <span className={styles.bindingHint}>
                      Нажмите, чтобы посмотреть площадь и дом
                    </span>
                  </div>

                  <div className={styles.bindingSide}>
                    <span
                      className={styles.statusLine}
                      style={{ color: STATUS_COLORS[binding.status] ?? 'var(--text-secondary)' }}
                    >
                      <span className={styles.statusDot} aria-hidden="true" />
                      {STATUS_LABELS[binding.status] ?? binding.status}
                    </span>

                    {binding.status === 'pending' && (
                      <Button
                        variant="ghost"
                        compact
                        loading={busyId === binding.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void revokeBinding(binding);
                        }}
                      >
                        Отозвать заявку
                      </Button>
                    )}

                    {binding.status === 'confirmed' && (
                      <Button
                        variant="ghost"
                        compact
                        loading={busyId === binding.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void revokeBinding(binding);
                        }}
                      >
                        Отвязать квартиру
                      </Button>
                    )}
                  </div>
                </div>

                {binding.status === 'rejected' && binding.rejectReason && (
                  <p className={styles.rejectReason}>Причина: {binding.rejectReason}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {actionError && (
          <p className={styles.formError} role="alert" style={{ marginTop: 'var(--space-3)' }}>
            {actionError}
          </p>
        )}
      </section>

      {/* ─── Добавление недвижимости ───────────────────────────────
          Форма свёрнута, пока она не нужна: у жителя уже может быть
          привязанная квартира, и открытый поиск сбивает с толку. */}
      <section>
        {!showSearch ? (
          <div className={styles.addRow}>
            <Button
              variant="secondary"
              onClick={() => {
                setUserChoice(true);
              }}
            >
              Добавить недвижимость
            </Button>
            <span className={styles.bindingTenant}>
              Другой адрес или ещё одна квартира
            </span>
          </div>
        ) : (
          <>
            <div className={styles.addHead}>
              <h2 className={pageStyles.sectionTitle}>
                {bindings.length === 0 ? 'Найти свою квартиру' : 'Новая привязка'}
              </h2>
              {bindings.length > 0 && (
                <Button
                  variant="ghost"
                  compact
                  onClick={() => {
                    setUserChoice(false);
                    setResults(null);
                    setSearchError(null);
                  }}
                >
                  Отмена
                </Button>
              )}
            </div>

            <form className={styles.searchForm} onSubmit={handleSearch} noValidate>
          <div className={styles.searchRow}>
            <div className={styles.searchAddress}>
              <Field
                label="Адрес дома"
                type="text"
                placeholder="Например: Ленина 1"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                hint="Минимум 3 символа — часть улицы или дома"
              />
            </div>
            <div className={styles.searchNumber}>
              <Field
                label="Квартира"
                type="text"
                placeholder="1"
                value={apartment}
                onChange={(e) => setApartment(e.target.value)}
                hint="Необязательно"
              />
            </div>
          </div>

          <div>
            <span className={styles.bindingTenant}>Кем вы приходитесь</span>
            <div className={styles.roleRow} style={{ marginTop: 'var(--space-2)' }}>
              {(['owner', 'renter', 'representative'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  className={[
                    styles.roleChip,
                    roleInApartment === role ? styles.roleChipActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-pressed={roleInApartment === role}
                  onClick={() => setRoleInApartment(role)}
                >
                  {ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          </div>

          {searchError && (
            <p className={styles.formError} role="alert">
              {searchError}
            </p>
          )}

          <div>
            <Button type="submit" loading={searching}>
              Найти
            </Button>
          </div>
        </form>

        {results !== null && (
          <div className={styles.results}>
            {results.length === 0 ? (
              <EmptyState
                title="Адрес не найден"
                description="Проверьте улицу и номер дома. Если дом новый, управляющая компания могла ещё не добавить его в систему — позвоните ей."
                action={
                  <Button variant="secondary" compact onClick={() => setResults(null)}>
                    Попробовать другой адрес
                  </Button>
                }
              />
            ) : (
              results.map((item) => (
                <div key={item.apartmentId} className={styles.result}>
                  <div className={styles.resultMain}>
                    <span className={styles.resultAddress}>
                      {item.addressText}, кв. {item.number}
                    </span>
                    <span className={styles.resultMeta}>{item.tenantName}</span>
                  </div>

                  {item.alreadyBound ? (
                    <span className={styles.resultMeta}>Заявка уже отправлена</span>
                  ) : (
                    <Button
                      compact
                      loading={busyId === item.apartmentId}
                      onClick={() => void requestBinding(item.apartmentId)}
                    >
                      Привязаться
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
          </>
        )}
      </section>

      <p className={styles.bindingTenant}>
        Заявку подтверждает управляющая компания — обычно в течение рабочего дня.
        Пока привязка не подтверждена, создавать заявки нельзя.
      </p>

      {detail && (
        <Modal title={`Квартира ${detail.apartmentNumber}`} onClose={() => setDetail(null)}>
          <dl className={styles.detailList}>
            <dt>Адрес</dt>
            <dd>{detail.addressText}</dd>
            <dt>Площадь</dt>
            <dd>{formatArea(detail.areaTotal)}</dd>
            <dt>Комнат</dt>
            <dd>{detail.rooms ?? '—'}</dd>
            <dt>Этаж</dt>
            <dd>{detail.floorNumber ?? '—'}</dd>
            <dt>Подъезд</dt>
            <dd>{detail.entranceNumber ?? '—'}</dd>
            <dt>Тип</dt>
            <dd>
              {detail.kind === 'nonresidential' ? 'Нежилое помещение' : 'Жилая квартира'}
            </dd>
            <dt>Дом</dt>
            <dd>{buildingSummary(detail)}</dd>
            <dt>Управляющая компания</dt>
            <dd>{detail.tenantName}</dd>
            <dt>Роль</dt>
            <dd>{ROLE_LABELS[detail.roleInApartment] ?? detail.roleInApartment}</dd>
            <dt>Статус</dt>
            <dd style={{ color: STATUS_COLORS[detail.status] ?? 'var(--text-secondary)' }}>
              {STATUS_LABELS[detail.status] ?? detail.status}
            </dd>
          </dl>

          <div className={styles.detailActions}>
            {detail.status === 'confirmed' && (
              <Button
                variant="danger"
                loading={busyId === detail.id}
                onClick={() => void revokeBinding(detail)}
              >
                Отвязать квартиру
              </Button>
            )}
            {detail.status === 'pending' && (
              <Button
                variant="ghost"
                loading={busyId === detail.id}
                onClick={() => void revokeBinding(detail)}
              >
                Отозвать заявку
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Площадь: «54.00» из numeric → «54 м²». */
function formatArea(value: string | null): string {
  if (!value) return '—';
  const number = Number(value);
  if (Number.isNaN(number)) return '—';
  return `${number.toLocaleString('ru-RU')} м²`;
}

/** Короткая справка о доме: год, этажность, число подъездов. */
function buildingSummary(binding: Binding): string {
  const parts: string[] = [];
  if (binding.buildingYear) parts.push(`${binding.buildingYear} год`);
  if (binding.buildingFloors) parts.push(`${binding.buildingFloors} эт.`);
  if (binding.buildingEntrances) parts.push(`${binding.buildingEntrances} подъезд.`);
  return parts.length > 0 ? parts.join(', ') : '—';
}
