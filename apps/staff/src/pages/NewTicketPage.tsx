import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { Select } from '@ui/Select';
import { CenteredSpinner } from '@ui/Spinner';
import { Field } from '@ui/Field';
import { TextArea } from '@ui/TextArea';
import { api, ApiError } from '@shared/api';
import { useApartments, useBuildings } from '@shared/useBuildings';
import { useCategories } from '@shared/useCategories';
import { normalizePhone } from '@shared/format';
import type { TicketPriority } from '@shared/types';
import styles from './NewTicketPage.module.css';
import pageStyles from './pages.module.css';

type Source = 'dispatcher_phone' | 'dispatcher_walkin';

const SOURCES: { value: Source; label: string }[] = [
  { value: 'dispatcher_phone', label: 'По телефону' },
  { value: 'dispatcher_walkin', label: 'На личном приёме' },
];

const PRIORITIES: { value: TicketPriority; label: string; danger?: boolean }[] = [
  { value: 'low', label: 'Низкая' },
  { value: 'normal', label: 'Обычная' },
  { value: 'high', label: 'Высокая' },
  { value: 'emergency', label: 'Аварийная', danger: true },
];

/**
 * Регистрация обращения диспетчером «от имени жителя».
 *
 * Зачем нужно: не все жители пользуются приложением. Срочный звонок нельзя
 * терять только потому, что человек не зарегистрирован (ТЗ v1.1 п. 3.2,
 * PROGRESS.md п. 5.2).
 *
 * Отличия от формы жителя:
 *  - дом и квартиру выбирает сотрудник, а не берётся подтверждённая привязка;
 *  - обязателен источник обращения: по телефону или на личном приёме;
 *  - есть контактное лицо — как житель себя назвал;
 *  - диспетчер может сразу поставить «Аварийная»: он и так обязан
 *    реагировать на аварию, а ждать, пока житель выберет категорию, некогда.
 */
export function NewTicketPage() {
  const navigate = useNavigate();
  const { buildings, loading: buildingsLoading, error: buildingsError } = useBuildings();
  const { categories, loading: categoriesLoading } = useCategories();

  const [buildingId, setBuildingId] = useState('');
  const [apartmentId, setApartmentId] = useState('');
  const [source, setSource] = useState<Source>('dispatcher_phone');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const { apartments, loading: apartmentsLoading } = useApartments(buildingId);

  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Нормализуем до проверки: диспетчер записывает номер со слов жителя,
  // и «8-923…» — обычное дело, а не ошибка.
  const phoneNormalized = normalizePhone(contactPhone);
  const phoneInvalid = !/^\+7\d{10}$/.test(phoneNormalized);
  const descriptionTooShort = description.trim().length < 5;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    setFormError(null);

    if (!buildingId || !categoryId || descriptionTooShort || phoneInvalid) return;

    setSubmitting(true);
    try {
      const created = await api.post<{ id: string; number: number }>('/tickets', {
        buildingId,
        // Квартира необязательна: обращение может быть по местам общего
        // пользования — подъезд, крыша, двор.
        apartmentId: apartmentId || null,
        categoryId,
        priority,
        source,
        description: description.trim(),
        contactPhone: phoneNormalized,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(locationNote.trim() ? { locationNote: locationNote.trim() } : {}),
        ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
      });
      navigate(`/tickets/${created.id}`);
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Не удалось создать заявку. Попробуйте ещё раз.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Новое обращение</h1>
          <p className={pageStyles.pageSubtitle}>
            Регистрация заявки от имени жителя — например, по звонку
          </p>
        </div>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {/* ─── Источник ──────────────────────────────────────────── */}
        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>Откуда обращение</h2>
          <div className={styles.chips} role="radiogroup" aria-label="Источник обращения">
            {SOURCES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={source === item.value}
                className={[styles.chip, source === item.value ? styles.chipActive : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSource(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Card>

        {/* ─── Адрес ─────────────────────────────────────────────── */}
        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>Адрес</h2>

          {buildingsError ? (
            <Alert variant="danger" title="Не удалось загрузить дома">
              {buildingsError}
            </Alert>
          ) : buildingsLoading ? (
            <CenteredSpinner label="Загружаем дома" />
          ) : (
            <div className={styles.row}>
              <Select
                label="Дом"
                value={buildingId}
                onChange={(e) => {
                  setBuildingId(e.target.value);
                  setApartmentId('');
                }}
              >
                <option value="">— выберите дом —</option>
                {buildings.map((building) => (
                  <option key={building.id} value={building.id}>
                    {building.addressText}
                  </option>
                ))}
              </Select>

              <Select
                label="Квартира"
                value={apartmentId}
                onChange={(e) => setApartmentId(e.target.value)}
                disabled={!buildingId || apartmentsLoading}
              >
                <option value="">
                  {buildingId
                    ? 'Место общего пользования (без квартиры)'
                    : '— сначала выберите дом —'}
                </option>
                {apartments.map((apartment) => (
                  <option key={apartment.id} value={apartment.id}>
                    кв. {apartment.number}
                    {apartment.entranceNumber ? `, подъезд ${apartment.entranceNumber}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <p className={styles.note}>
            Квартиру можно не указывать — для обращений по подъезду, крыше или двору.
          </p>
        </Card>

        {/* ─── Что случилось ────────────────────────────────────── */}
        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>Что случилось</h2>

          <Select
            label="Категория"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={categoriesLoading}
          >
            <option value="">— выберите категорию —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} (до {category.slaHours} ч)
              </option>
            ))}
          </Select>

          <div>
            <span className={styles.label}>Срочность</span>
            <div className={styles.chips} role="radiogroup" aria-label="Срочность">
              {PRIORITIES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === item.value}
                  className={[
                    styles.chip,
                    priority === item.value ? styles.chipActive : '',
                    item.danger ? styles.chipDanger : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setPriority(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {priority === 'emergency' && (
            <Alert variant="warning">
              Аварийная заявка попадёт в инбокс с красной меткой и коротким сроком SLA.
            </Alert>
          )}

          <Field
            label="Кратко (необязательно)"
            type="text"
            maxLength={200}
            placeholder="Например: прорвало трубу в подвале"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            hint="Одна строка — её увидят в списке заявок"
          />

          <TextArea
            label="Описание"
            placeholder="Что случилось со слов жителя"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            showCounter
            error={
              touched && descriptionTooShort
                ? 'Опишите проблему — минимум 5 символов'
                : null
            }
            hint="Минимум 5 символов"
          />

          <Field
            label="Где именно (необязательно)"
            type="text"
            maxLength={200}
            placeholder="Например: подъезд 2, этаж 5, у лифта"
            value={locationNote}
            onChange={(e) => setLocationNote(e.target.value)}
          />
        </Card>

        {/* ─── Контакт ──────────────────────────────────────────── */}
        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>Контакт для связи</h2>

          <div className={styles.row}>
            <Field
              label="Как представился"
              type="text"
              maxLength={200}
              placeholder="Например: Иванов, кв. 42"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              hint="Необязательно"
            />

            <Field
              label="Телефон"
              type="tel"
              inputMode="tel"
              required
              placeholder="+79000000000"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              // Приводим к +7XXXXXXXXXX, когда сотрудник закончил ввод
              onBlur={() => setContactPhone(normalizePhone(contactPhone))}
              error={
                touched && phoneInvalid
                  ? 'Формат +7XXXXXXXXXX, например +79001234567'
                  : null
              }
              hint="Можно 8…, +7… или 9… — приведём к +7XXXXXXXXXX. Без него не связаться"
            />
          </div>
        </Card>

        {formError && (
          <Alert variant="danger">{formError}</Alert>
        )}

        <div className={styles.actions}>
          <Button type="submit" loading={submitting} disabled={submitting}>
            Зарегистрировать обращение
          </Button>
          <p className={styles.note}>
            Заявка сразу появится в инбоксе. Источник будет помечен как{' '}
            {source === 'dispatcher_phone' ? '«по телефону»' : '«на личном приёме»'}.
          </p>
        </div>
      </form>
    </>
  );
}
