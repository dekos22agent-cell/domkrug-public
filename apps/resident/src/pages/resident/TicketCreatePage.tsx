import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { CenteredSpinner } from '@ui/Spinner';
import { Field } from '@ui/Field';
import { TextArea } from '@ui/TextArea';
import { api, ApiError } from '@shared/api';
import { PhotoPicker, type PickedPhoto } from '@ui/PhotoPicker';
import { uploadAttachment } from '@shared/useAttachments';
import { useAuth } from '@shared/authContext';
import { useApartment } from '@shared/apartmentContext';
import { defaultRouteFor } from '@shared/roles';
import { useCategories } from '@shared/useCategories';
import { formatTicketNumber, normalizePhone } from '@shared/format';
import type { StatusInfo, TicketPriority } from '@shared/types';
import styles from './TicketCreatePage.module.css';

interface CreatedTicket {
  id: string;
  number: number;
  status: StatusInfo;
  slaDueAt: string | null;
}

/** Срочность, которую выбирает житель. «Аварийная» ставится сама по категории. */
type UserPriority = 'low' | 'normal' | 'high';

const PRIORITIES: { value: UserPriority; label: string }[] = [
  { value: 'low', label: 'Низкая' },
  { value: 'normal', label: 'Обычная' },
  { value: 'high', label: 'Высокая' },
];

/**
 * Создание заявки жителем.
 *
 * Правила MVP:
 *  - заявку можно создать только по ПОДТВЕРЖДЁННОЙ привязке (PROGRESS.md п. 5.2);
 *  - аварийной заявка становится по категории, а не по выбору жителя:
 *    иначе «аварийно» пишут про всё подряд;
 *  - описание — минимум 10 символов, иначе диспетчеру не с чем работать.
 */
export function TicketCreatePage() {
  const { user, roles } = useAuth();
  // Квартиру берём из переключателя: у жителя их может быть несколько
  const { apartments, active } = useApartment();
  const navigate = useNavigate();
  const { categories, loading: categoriesLoading, error: categoriesError } = useCategories();

  const [categoryId, setCategoryId] = useState<string>('');
  const [priority, setPriority] = useState<UserPriority>('normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [contactPhone, setContactPhone] = useState(user?.phone ?? '');

  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTicket | null>(null);
  // Фото выбираются до отправки, а грузятся после: хуки обязаны идти
  // до любого раннего return — иначе React ругается справедливо
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [apartmentId, setApartmentId] = useState<string>(active?.apartmentId ?? '');
  const binding = apartments.find((item) => item.apartmentId === apartmentId) ?? active;

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId],
  );

  // Аварийная категория переводит заявку в аварийный режим автоматически
  const isEmergencyCategory = selectedCategory?.isEmergency ?? false;
  const effectivePriority: TicketPriority = isEmergencyCategory ? 'emergency' : priority;

  const descriptionTooShort = description.trim().length > 0 && description.trim().length < 10;
  const descriptionEmpty = description.trim().length === 0;
  // Нормализуем до проверки: 8-923… и 923… — правильные номера,
  // не стоит показывать на них ошибку формата.
  const phoneNormalized = normalizePhone(contactPhone);
  const phoneInvalid = !/^\+7\d{10}$/.test(phoneNormalized);

  // Не житель — сюда незачем
  if (!roles.includes('resident')) {
    return <Navigate to={defaultRouteFor(roles)} replace />;
  }

  // Нет подтверждённой привязки — создавать заявку нельзя. Возвращаем на
  // главную: там уже объяснено, что делать (PROGRESS.md п. 5.2).
  if (!binding) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    setSubmitError(null);

    if (!categoryId || descriptionEmpty || description.trim().length < 10 || phoneInvalid) {
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post<CreatedTicket>('/resident/tickets', {
        apartmentId: binding.apartmentId,
        categoryId,
        priority: effectivePriority,
        description: description.trim(),
        contactPhone: phoneNormalized,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(locationNote.trim() ? { locationNote: locationNote.trim() } : {}),
      });
      // Фото грузим после создания: до этого у заявки нет id.
      // Ошибку загрузки не скрываем — житель должен знать, что снимок не дошёл.
      for (const photo of photos) {
        const uploaded = await uploadAttachment(result.id, photo.file);
        if (!uploaded.ok) setPhotoError(uploaded.message);
      }
      setCreated(result);
    } catch (error) {
      if (error instanceof ApiError) {
        // Привязку могли отозвать между открытием формы и отправкой
        if (error.code === 'BINDING_NOT_CONFIRMED') {
          navigate('/', { replace: true });
          return;
        }
        setSubmitError(error.message);
      } else {
        setSubmitError('Не удалось отправить заявку. Попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Успех ─────────────────────────────────────────────────────────────
  if (created) {
    return (
      <div className={styles.success}>
        <span className={styles.successMark} aria-hidden="true">
          ✓
        </span>
        <div>
          <p className={styles.successTitle}>Заявка отправлена</p>
          <p className={styles.successNumber}>{formatTicketNumber(created.number)}</p>
        </div>
        <p className={styles.successText}>
          Управляющая компания увидела её и приступит к работе. Статус можно
          посмотреть в разделе «Мои заявки».
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Button onClick={() => navigate('/my-requests')}>К моим заявкам</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            На главную
          </Button>
        </div>
      </div>
    );
  }

  // ─── Форма ─────────────────────────────────────────────────────────────
  return (
    <>
      <button type="button" className={styles.backLink} onClick={() => navigate('/')}>
        ← На главную
      </button>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', lineHeight: 'var(--leading-2xl)' }}>
          Новая заявка
        </h1>
        <p style={{ marginTop: 'var(--space-1)', color: 'var(--text-secondary)' }}>
          {binding.addressText}, кв. {binding.apartmentNumber}
        </p>

        {/* Если квартир несколько — заявку можно адресовать любой из них.
            Выбор по умолчанию — та, что выбрана в шапке. */}
        {apartments.length > 1 && (
          <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
            <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Квартира для этой заявки
            </span>
            <select
              value={apartmentId || binding.apartmentId}
              onChange={(event) => setApartmentId(event.target.value)}
              style={{
                marginTop: 'var(--space-1)',
                width: '100%',
                minHeight: 'var(--control-height-resident)',
                padding: '0 var(--space-3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
                font: 'inherit',
              }}
            >
              {apartments.map((item) => (
                <option key={item.id} value={item.apartmentId}>
                  {item.addressText}, кв. {item.apartmentNumber} · {item.tenantName}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {/* ─── Категория ─────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Что случилось?</h2>
          <p className={styles.sectionHint}>Выберите подходящую категорию</p>

          {categoriesLoading ? (
            <CenteredSpinner label="Загружаем категории" />
          ) : categoriesError ? (
            <p className={styles.formError} role="alert">
              {categoriesError}
            </p>
          ) : (
            <div className={styles.categories} role="radiogroup" aria-label="Категория заявки">
              {categories.map((category) => {
                const active = category.id === categoryId;
                return (
                  <button
                    key={category.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={[styles.category, active ? styles.categoryActive : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setCategoryId(category.id)}
                  >
                    <span className={styles.categoryName}>{category.name}</span>
                    {category.isEmergency && (
                      <span className={styles.emergencyMark}>Аварийная</span>
                    )}
                    <span className={styles.slaHint}>до {category.slaHours} ч</span>
                  </button>
                );
              })}
            </div>
          )}

          {touched && !categoryId && (
            <p className={styles.formError} role="alert">
              Выберите категорию — так заявка быстрее попадёт к нужному специалисту
            </p>
          )}
        </section>

        {/* ─── Аварийное предупреждение ──────────────────────────── */}
        {isEmergencyCategory && (
          <div className={styles.emergencyNotice} role="status">
            <span className={styles.emergencyNoticeTitle}>Аварийная заявка</span>
            Если есть угроза жизни или затопление — дополнительно позвоните диспетчеру УК.
            Такие заявки обрабатываются в первую очередь.
          </div>
        )}

        {/* ─── Срочность ─────────────────────────────────────────── */}
        {!isEmergencyCategory && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Насколько срочно?</h2>
            <div className={styles.priorities} role="radiogroup" aria-label="Срочность заявки">
              {PRIORITIES.map((item) => {
                const active = priority === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={[styles.priority, active ? styles.priorityActive : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setPriority(item.value)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ─── Описание ──────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Опишите проблему</h2>

          <Field
            label="Кратко (необязательно)"
            type="text"
            maxLength={200}
            placeholder="Например: течёт кран на кухне"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            hint="Одна строка — её увидят в списке заявок"
          />

          <TextArea
            label="Что случилось"
            placeholder="Опишите, что произошло и что уже пробовали сделать"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            showCounter
            error={
              touched && descriptionEmpty
                ? 'Опишите проблему — без этого заявку не примут'
                : touched && descriptionTooShort
                  ? 'Слишком коротко: нужно минимум 10 символов'
                  : null
            }
            hint="Минимум 10 символов"
          />

          <Field
            label="Где именно (необязательно)"
            type="text"
            maxLength={200}
            placeholder="Например: подъезд 2, этаж 5, у лифта"
            value={locationNote}
            onChange={(e) => setLocationNote(e.target.value)}
            hint="Поможет специалисту быстрее найти место"
          />
        </section>

        {/* ─── Контакты ──────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Как с вами связаться</h2>
          <Field
            label="Телефон"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+79000000000"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            // Приводим к +7XXXXXXXXXX, когда человек закончил ввод
            onBlur={() => setContactPhone(normalizePhone(contactPhone))}
            error={
              touched && phoneInvalid
                ? 'Телефон в формате +7XXXXXXXXXX, например +79001234567'
                : null
            }
            hint="Можно 8…, +7… или 9… — приведём к +7XXXXXXXXXX"
          />
        </section>

        {/* ─── Фотографии ────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Фотографии</h2>
          <p className={styles.hint} style={{ marginBottom: 'var(--space-2)' }}>
            Снимок протечки или поломки объяснит быстрее слов. До 10 МБ, форматы JPEG, PNG, WebP.
          </p>

          <PhotoPicker label="Приложить фото" photos={photos} onChange={setPhotos} />

          {photoError && <p className={styles.formError}>{photoError}</p>}
        </section>

        {submitError && (
          <p className={styles.formError} role="alert">
            {submitError}
          </p>
        )}

        <div className={styles.actions}>
          <Button type="submit" block loading={submitting} disabled={submitting}>
            Отправить заявку
          </Button>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
            Заявка сразу попадёт диспетчеру управляющей компании
          </p>
        </div>
      </form>
    </>
  );
}
