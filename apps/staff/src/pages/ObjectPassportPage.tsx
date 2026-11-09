import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { Drawer } from '@ui/Drawer';
import { Field } from '@ui/Field';
import { Select } from '@ui/Select';
import { TextArea } from '@ui/TextArea';
import { ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import {
  saveBuildingPassport,
  useBuildingPassport,
  type PassportSaveInput,
} from '@shared/useStructure';
import { OBJECT_KIND_OPTIONS, complexLabel, objectKindLabel } from '@shared/objectKind';
import type { BuildingObjectKind, BuildingPassport } from '@shared/types';
import { ObjectTabs } from './ObjectTabs';
import pageStyles from './pages.module.css';
import styles from './ObjectPassportPage.module.css';

interface PassportForm {
  objectKind: BuildingObjectKind;
  yearBuilt: string;
  totalFloors: string;
  totalEntrances: string;
  cadastralNumber: string;
  yearCommissioned: string;
  totalArea: string;
  livingArea: string;
  commercialArea: string;
  landArea: string;
  parkingSpots: string;
  elevatorsCount: string;
  energyClass: string;
  managementStart: string;
  warrantyUntil: string;
  notes: string;
}

function value(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function toForm(data: BuildingPassport): PassportForm {
  const b = data.building;
  const p = data.passport;
  return {
    objectKind: b.objectKind,
    yearBuilt: value(b.yearBuilt),
    totalFloors: value(b.totalFloors),
    totalEntrances: value(b.totalEntrances),
    cadastralNumber: p?.cadastralNumber ?? '',
    yearCommissioned: value(p?.yearCommissioned),
    totalArea: value(p?.totalArea),
    livingArea: value(p?.livingArea),
    commercialArea: value(p?.commercialArea),
    landArea: value(p?.landArea),
    parkingSpots: value(p?.parkingSpots),
    elevatorsCount: value(p?.elevatorsCount),
    energyClass: p?.energyClass ?? '',
    managementStart: p?.managementStart ?? '',
    warrantyUntil: p?.warrantyUntil ?? '',
    notes: p?.notes ?? '',
  };
}

function numberOrNull(input: string): number | null {
  if (input.trim() === '') return null;
  const parsed = Number(input.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(input: string): string | null {
  return input.trim() === '' ? null : input.trim();
}

function formatArea(input: string | null): string {
  if (!input) return '—';
  const number = Number(input);
  if (!Number.isFinite(number)) return input;
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²`;
}

function formatDate(input: string | null): string {
  if (!input) return '—';
  const date = new Date(`${input}T00:00:00`);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString('ru-RU');
}

const KIND_NAMES: Record<string, string> = {
  apartment: 'Квартиры',
  nonresidential: 'Нежилые помещения',
  house: 'Дома',
  office: 'Офисы',
  retail: 'Торговые помещения',
  parking: 'Паркинг',
  storage: 'Кладовые',
};

/** Паспорт объекта: данные дома, состав и переход в смежные разделы. */
export function ObjectPassportPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { data, loading, error, reload } = useBuildingPassport(id ?? null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PassportForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = hasPermission('building.manage');

  const openEdit = () => {
    if (!data) return;
    setForm(toForm(data));
    setFormError(null);
    setEditing(true);
  };

  const update = (key: keyof PassportForm) => (next: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: next } : prev));
  };

  const handleSave = async () => {
    if (!form || !id) return;
    setSaving(true);
    setFormError(null);
    try {
      const input: PassportSaveInput = {
        objectKind: form.objectKind,
        yearBuilt: numberOrNull(form.yearBuilt),
        totalFloors: numberOrNull(form.totalFloors),
        totalEntrances: numberOrNull(form.totalEntrances),
        cadastralNumber: textOrNull(form.cadastralNumber),
        yearCommissioned: numberOrNull(form.yearCommissioned),
        totalArea: numberOrNull(form.totalArea),
        livingArea: numberOrNull(form.livingArea),
        commercialArea: numberOrNull(form.commercialArea),
        landArea: numberOrNull(form.landArea),
        parkingSpots: numberOrNull(form.parkingSpots),
        elevatorsCount: numberOrNull(form.elevatorsCount),
        energyClass: form.energyClass || null,
        managementStart: form.managementStart || null,
        warrantyUntil: form.warrantyUntil || null,
        notes: textOrNull(form.notes),
      };
      await saveBuildingPassport(id, input);
      setEditing(false);
      setNotice('Паспорт сохранён');
      reload();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Не удалось сохранить паспорт объекта',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <CenteredSpinner label="Загружаем паспорт объекта" />;
  if (error || !data) {
    return (
      <div className={styles.page}>
        <Link to="/objects" className={styles.back}>
          ← Объекты
        </Link>
        <Alert variant="danger">{error ?? 'Объект не найден'}</Alert>
      </div>
    );
  }

  const { building, passport, stats } = data;
  const title = building.addressText;

  return (
    <div className={styles.page}>
      <Link to="/objects" className={styles.back}>
        ← Объекты
      </Link>

      <div className={styles.header}>
        <div>
          <div className={styles.kicker}>
            <Badge variant="info">{objectKindLabel(building.objectKind)}</Badge>
            {building.complexName && <span>{complexLabel(building.complexName)}</span>}
          </div>
          <h1 className={pageStyles.pageTitle}>{title}</h1>
          <p className={pageStyles.pageSubtitle}>
            Паспорт объекта, состав помещений и текущая эксплуатация.
          </p>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={openEdit}>
            Редактировать паспорт
          </Button>
        )}
      </div>

      {notice && (
        <Alert variant="success" className={styles.notice}>
          {notice}
        </Alert>
      )}

      <ObjectTabs objectId={id ?? ''} active="overview" />

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.unitsTotal}</span>
          <span className={styles.statLabel}>помещений</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.residentsConfirmed}</span>
          <span className={styles.statLabel}>подтверждённых жителей</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.entrances}</span>
          <span className={styles.statLabel}>подъездов</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.openTickets}</span>
          <span className={styles.statLabel}>открытых заявок</span>
        </div>
      </div>

      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>Паспорт</h2>
        {!passport && (
          <p className={styles.emptyHint}>
            Паспорт ещё не заполнен. Укажите кадастровые и эксплуатационные данные —
            они появятся в карточке объекта.
          </p>
        )}
        <dl className={styles.fields}>
          <div>
            <dt>Кадастровый номер</dt>
            <dd>{passport?.cadastralNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>Год постройки</dt>
            <dd>{building.yearBuilt ?? '—'}</dd>
          </div>
          <div>
            <dt>Год ввода в эксплуатацию</dt>
            <dd>{passport?.yearCommissioned ?? '—'}</dd>
          </div>
          <div>
            <dt>Этажей</dt>
            <dd>{building.totalFloors ?? '—'}</dd>
          </div>
          <div>
            <dt>Подъездов</dt>
            <dd>{stats.entrances}</dd>
          </div>
          <div>
            <dt>Общая площадь</dt>
            <dd>{formatArea(passport?.totalArea ?? null)}</dd>
          </div>
          <div>
            <dt>Жилая площадь</dt>
            <dd>{formatArea(passport?.livingArea ?? null)}</dd>
          </div>
          <div>
            <dt>Коммерческая площадь</dt>
            <dd>{formatArea(passport?.commercialArea ?? null)}</dd>
          </div>
          <div>
            <dt>Земельный участок</dt>
            <dd>{formatArea(passport?.landArea ?? null)}</dd>
          </div>
          <div>
            <dt>Парковка</dt>
            <dd>{passport?.parkingSpots != null ? `${passport.parkingSpots} м/м` : '—'}</dd>
          </div>
          <div>
            <dt>Лифты</dt>
            <dd>{passport?.elevatorsCount ?? '—'}</dd>
          </div>
          <div>
            <dt>Класс энергоэффективности</dt>
            <dd>{passport?.energyClass ?? '—'}</dd>
          </div>
          <div>
            <dt>Управление с</dt>
            <dd>{formatDate(passport?.managementStart ?? null)}</dd>
          </div>
          <div>
            <dt>Гарантия до</dt>
            <dd>{formatDate(passport?.warrantyUntil ?? null)}</dd>
          </div>
        </dl>
        {passport?.notes && (
          <div className={styles.notes}>
            <span className={styles.notesLabel}>Заметки</span>
            <p>{passport.notes}</p>
          </div>
        )}
      </Card>

      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>Состав объекта</h2>
        <div className={styles.composition}>
          <div>
            <span className={styles.compositionValue}>{stats.apartments}</span>
            <span className={styles.compositionLabel}>квартир</span>
          </div>
          <div>
            <span className={styles.compositionValue}>{stats.nonresidential}</span>
            <span className={styles.compositionLabel}>нежилых помещений</span>
          </div>
          {stats.unitsByKind
            .filter((item) => item.kind !== 'apartment' && item.kind !== 'nonresidential')
            .map((item) => (
              <div key={item.kind}>
                <span className={styles.compositionValue}>{item.count}</span>
                <span className={styles.compositionLabel}>
                  {KIND_NAMES[item.kind] ?? item.kind}
                </span>
              </div>
            ))}
        </div>
        {building.entrances.length > 0 && (
          <div className={styles.entrances}>
            <span className={styles.entrancesLabel}>Подъезды</span>
            {building.entrances.map((entrance) => (
              <span key={entrance.id} className={styles.entranceChip}>
                {entrance.number}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card className={styles.section}>
        <div className={styles.ownersHeader}>
          <h2 className={styles.sectionTitle}>Собственники и доли</h2>
          <Link to={`/objects/${id}/owners`} className={styles.ownerLink}>
            Открыть реестр →
          </Link>
        </div>
        <p className={styles.ownersText}>
          Отдельный реестр физических лиц: ФИО, доля, роль и период права.
          Учётная запись в приложении — не то же самое, что собственник.
        </p>
      </Card>

      {editing && form && (
        <Drawer title="Паспорт объекта" onClose={() => setEditing(false)}>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <Select
              label="Тип объекта"
              value={form.objectKind}
              onChange={(event) => update('objectKind')(event.target.value)}
            >
              {OBJECT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            <div className={styles.formGrid}>
              <Field
                label="Кадастровый номер"
                value={form.cadastralNumber}
                onChange={(event) => update('cadastralNumber')(event.target.value)}
              />
              <Select
                label="Класс энергоэффективности"
                value={form.energyClass}
                onChange={(event) => update('energyClass')(event.target.value)}
              >
                <option value="">Не указан</option>
                {['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </Select>
              <Field
                label="Год постройки"
                type="number"
                min={1700}
                max={2100}
                value={form.yearBuilt}
                onChange={(event) => update('yearBuilt')(event.target.value)}
              />
              <Field
                label="Год ввода"
                type="number"
                min={1700}
                max={2100}
                value={form.yearCommissioned}
                onChange={(event) => update('yearCommissioned')(event.target.value)}
              />
              <Field
                label="Этажей"
                type="number"
                min={0}
                value={form.totalFloors}
                onChange={(event) => update('totalFloors')(event.target.value)}
              />
              <Field
                label="Подъездов по проекту"
                type="number"
                min={0}
                value={form.totalEntrances}
                onChange={(event) => update('totalEntrances')(event.target.value)}
                hint="Фактическое число подъездов берётся из реестра."
              />
              <Field
                label="Общая площадь, м²"
                type="number"
                min={0}
                value={form.totalArea}
                onChange={(event) => update('totalArea')(event.target.value)}
              />
              <Field
                label="Жилая площадь, м²"
                type="number"
                min={0}
                value={form.livingArea}
                onChange={(event) => update('livingArea')(event.target.value)}
              />
              <Field
                label="Коммерческая площадь, м²"
                type="number"
                min={0}
                value={form.commercialArea}
                onChange={(event) => update('commercialArea')(event.target.value)}
              />
              <Field
                label="Земельный участок, м²"
                type="number"
                min={0}
                value={form.landArea}
                onChange={(event) => update('landArea')(event.target.value)}
              />
              <Field
                label="Машиномест"
                type="number"
                min={0}
                value={form.parkingSpots}
                onChange={(event) => update('parkingSpots')(event.target.value)}
              />
              <Field
                label="Лифтов"
                type="number"
                min={0}
                value={form.elevatorsCount}
                onChange={(event) => update('elevatorsCount')(event.target.value)}
              />
              <Field
                label="Управление с"
                type="date"
                value={form.managementStart}
                onChange={(event) => update('managementStart')(event.target.value)}
              />
              <Field
                label="Гарантия до"
                type="date"
                value={form.warrantyUntil}
                onChange={(event) => update('warrantyUntil')(event.target.value)}
              />
            </div>

            <TextArea
              label="Заметки"
              rows={4}
              value={form.notes}
              onChange={(event) => update('notes')(event.target.value)}
              placeholder="Особенности объекта, доступы, контакты"
            />

            {formError && <Alert variant="danger">{formError}</Alert>}

            <div className={styles.formActions}>
              <Button type="submit" loading={saving}>
                Сохранить
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </Drawer>
      )}
    </div>
  );
}

