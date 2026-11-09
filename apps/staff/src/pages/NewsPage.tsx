import { useState } from 'react';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { TextArea } from '@ui/TextArea';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { useStaffNews } from '@shared/useUtilities';
import { formatDateTime } from '@shared/format';
import pageStyles from './pages.module.css';
import styles from './NewsPage.module.css';

/** Объявления УК: черновик или публикация всем жителям. */
export function NewsPage() {
  const { hasPermission } = useAuth();
  const news = useStaffNews();
  const canManage = hasPermission('news.manage');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isEmergency, setIsEmergency] = useState(false);
  const [publish, setPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) {
      setNotice({ ok: false, text: 'Заполните заголовок и текст' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.post('/news', {
        title: title.trim(),
        body: body.trim(),
        isEmergency,
        publish,
      });
      setTitle('');
      setBody('');
      setIsEmergency(false);
      setNotice({ ok: true, text: publish ? 'Объявление опубликовано' : 'Черновик сохранён' });
      news.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось сохранить объявление',
      });
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async (id: string) => {
    try {
      await api.post(`/news/${id}/publish`, {});
      setNotice({ ok: true, text: 'Объявление опубликовано' });
      news.reload();
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
          <h1 className={pageStyles.pageTitle}>Объявления</h1>
          <p className={pageStyles.pageSubtitle}>
            Сообщения жителям: работы, отключения, собрания и важные события
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
          <h2 className={styles.formTitle}>Новое объявление</h2>
          <Field
            label="Заголовок"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например: отключение холодной воды"
          />
          <TextArea
            label="Текст"
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Что произошло, когда, кого касается"
          />
          <div className={styles.formOptions}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={isEmergency}
                onChange={(event) => setIsEmergency(event.target.checked)}
              />
              Важное объявление
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={publish}
                onChange={(event) => setPublish(event.target.checked)}
              />
              Опубликовать сразу
            </label>
          </div>
          <Button loading={saving} onClick={() => void handleCreate()}>
            {publish ? 'Опубликовать' : 'Сохранить черновик'}
          </Button>
        </Card>
      )}

      {news.loading ? (
        <CenteredSpinner label="Загружаем объявления" />
      ) : news.error ? (
        <p className={pageStyles.loadError}>{news.error}</p>
      ) : news.items.length === 0 ? (
        <EmptyState
          title="Объявлений пока нет"
          description="Создайте первое сообщение для жителей."
        />
      ) : (
        <div className={styles.list}>
          {news.items.map((item) => (
            <Card key={item.id} className={styles.card}>
              <div className={styles.head}>
                <h2 className={styles.title}>{item.title}</h2>
                <div className={styles.badges}>
                  {item.isEmergency && <Badge variant="danger">Важно</Badge>}
                  {!item.publishedAt && <Badge variant="neutral">Черновик</Badge>}
                </div>
              </div>
              <p className={styles.body}>{item.body}</p>
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
