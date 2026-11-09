import { useState } from 'react';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { Select } from '@ui/Select';
import { TextArea } from '@ui/TextArea';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { useBuildings } from '@shared/useStructure';
import { useStaffDocuments } from '@shared/useUtilities';
import type { DocumentCategory } from '@shared/types';
import { formatDateTime } from '@shared/format';
import pageStyles from './pages.module.css';
import styles from './DocumentsPage.module.css';

const CATEGORIES: { value: DocumentCategory; label: string }[] = [
  { value: 'house', label: 'Документ дома' },
  { value: 'apartment', label: 'Квартира' },
  { value: 'receipt', label: 'Квитанция' },
  { value: 'other', label: 'Другое' },
];

export function DocumentsPage() {
  const { hasPermission } = useAuth();
  const documents = useStaffDocuments();
  const buildings = useBuildings();
  const canManage = hasPermission('news.manage');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('house');
  const [buildingId, setBuildingId] = useState('');
  const [publish, setPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const create = async () => {
    if (!title.trim() || !url.trim()) {
      setNotice({ ok: false, text: 'Заполните название и ссылку' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.post('/documents', {
        title: title.trim(),
        description: description.trim() || null,
        category,
        url: url.trim(),
        buildingId: buildingId || null,
        publish,
      });
      setTitle('');
      setDescription('');
      setUrl('');
      setNotice({ ok: true, text: publish ? 'Документ опубликован' : 'Черновик сохранён' });
      documents.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось сохранить документ',
      });
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async (id: string) => {
    try {
      await api.post(`/documents/${id}/publish`, {});
      setNotice({ ok: true, text: 'Документ опубликован' });
      documents.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось опубликовать',
      });
    }
  };

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Документы</h1>
          <p className={pageStyles.pageSubtitle}>
            Ссылки на документы дома и управляющей компании для жителей
          </p>
        </div>
      </div>

      {notice && (
        <Alert variant={notice.ok ? 'success' : 'danger'} className={styles.notice}>
          {notice.text}
        </Alert>
      )}

      {canManage && (
        <Card className={styles.formCard}>
          <h2 className={styles.formTitle}>Новый документ</h2>
          <div className={styles.formGrid}>
            <Field
              label="Название"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Select
              label="Тип"
              value={category}
              onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            >
              {CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Select
              label="Дом"
              value={buildingId}
              onChange={(event) => setBuildingId(event.target.value)}
            >
              <option value="">Вся УК</option>
              {buildings.items.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.addressText}
                </option>
              ))}
            </Select>
            <Field
              label="Ссылка"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…/document.pdf"
            />
          </div>
          <TextArea
            label="Описание"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={publish}
              onChange={(event) => setPublish(event.target.checked)}
            />
            Опубликовать сразу
          </label>
          <div className={styles.formActions}>
            <Button loading={saving} onClick={() => void create()}>
              {publish ? 'Опубликовать' : 'Сохранить черновик'}
            </Button>
          </div>
        </Card>
      )}

      {documents.loading ? (
        <CenteredSpinner label="Загружаем документы" />
      ) : documents.error ? (
        <p className={pageStyles.loadError}>{documents.error}</p>
      ) : documents.items.length === 0 ? (
        <EmptyState title="Документов пока нет" description="Добавьте первую ссылку." />
      ) : (
        <div className={styles.list}>
          {documents.items.map((item) => (
            <Card key={item.id} className={styles.card}>
              <div className={styles.head}>
                <div>
                  <h2 className={styles.title}>{item.title}</h2>
                  <div className={styles.meta}>
                    <Badge variant="neutral">{item.category}</Badge>
                    {item.buildingAddress && <span>{item.buildingAddress}</span>}
                    {!item.publishedAt && <Badge variant="neutral">Черновик</Badge>}
                  </div>
                </div>
                <a className={styles.open} href={item.url} target="_blank" rel="noreferrer">
                  Открыть
                </a>
              </div>
              {item.description && <p className={styles.description}>{item.description}</p>}
              <div className={styles.foot}>
                {item.publishedAt && (
                  <span className={styles.date}>{formatDateTime(item.publishedAt)}</span>
                )}
                {!item.publishedAt && canManage && (
                  <Button compact variant="secondary" onClick={() => void publishDraft(item.id)}>
                    Опубликовать
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
