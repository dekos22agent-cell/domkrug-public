/**
 * Карточка заявки глазами жителя.
 *
 * Отличия от карточки УК: нет назначения, отклонения и закрытия — это не его
 * работа. Зато есть «Проблема не решена» (создаёт повторную заявку) и удаление
 * своей заявки. Комментарий всегда публичный: служебных заметок житель не пишет.
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@ui/Button';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { PhotoPicker, type PickedPhoto } from '@ui/PhotoPicker';
import { TextArea } from '@ui/TextArea';
import { ActionPanel, TicketView } from '@ui/ticket/TicketView';
import { ticketStyles as styles } from '@ui/ticket/styles';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { useTicket } from '@shared/useTicket';
import { useTicketHistory } from '@shared/useTicketHistory';
import { uploadAttachment } from '@shared/useAttachments';

type Panel = 'report' | null;

export function ResidentTicketPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { ticket, loading, error, reload } = useTicket(id, false);
  const {
    items: history,
    loading: historyLoading,
    error: historyError,
    reload: reloadHistory,
  } = useTicketHistory(id, false);

  const [panel, setPanel] = useState<Panel>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentFiles, setCommentFiles] = useState<PickedPhoto[]>([]);
  const [reportText, setReportText] = useState('');

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        setPanel(null);
        setReportText('');
        // Перечитываем и заявку, и историю: иначе новый статус виден только
        // после перезагрузки страницы
        reload();
        reloadHistory();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 409) {
            setActionError(`${err.message} Статус заявки обновился — проверьте его ниже.`);
            reload();
          } else {
            setActionError(err.message);
          }
        } else {
          setActionError('Не удалось выполнить действие. Попробуйте ещё раз.');
        }
      } finally {
        setBusy(false);
      }
    },
    [reload, reloadHistory],
  );

  const handleDelete = async () => {
    if (!ticket) return;
    if (!window.confirm('Удалить заявку? Она исчезнет из списков, вернуть её будет нельзя.')) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(`/resident/tickets/${ticket.id}`);
      navigate('/my-requests', { replace: true });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Не удалось удалить заявку');
      setBusy(false);
    }
  };

  if (loading && !ticket) return <CenteredSpinner label="Загружаем заявку" />;

  if (error || !ticket) {
    return (
      <EmptyState
        title="Заявка не найдена"
        description="Возможно, у вас нет доступа к этой заявке или ссылка устарела."
        action={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Назад
          </Button>
        }
      />
    );
  }

  const isOwnTicket = Boolean(user && ticket.createdBy?.id === user.id);
  const canReportProblem = isOwnTicket && ticket.status.code === 'closed';
  const canDelete = isOwnTicket;
  const hasActions = canReportProblem || canDelete;

  const composer = (
    <div className={styles.composer}>
      <TextArea
        label="Добавить комментарий"
        placeholder="Уточнение или вопрос по заявке"
        value={commentText}
        onChange={(event) => setCommentText(event.target.value)}
        maxLength={4000}
      />
      <PhotoPicker label="Приложить фото" photos={commentFiles} onChange={setCommentFiles} />

      <div className={styles.composerRow}>
        <span />
        <Button
          variant="secondary"
          loading={busy}
          disabled={commentText.trim().length === 0}
          onClick={() =>
            runAction(async () => {
              const created = await api.post<{ id: string }>(
                `/resident/tickets/${ticket.id}/comments`,
                { body: commentText.trim(), isInternal: false },
              );
              // Фото крепим к комментарию, чтобы они были видны под ним.
              // Список очищаем до загрузки: повторное нажатие не отправит их снова
              const toUpload = commentFiles;
              setCommentFiles([]);
              for (const photo of toUpload) {
                await uploadAttachment(ticket.id, photo.file, {
                  kind: 'comment_file',
                  commentId: created?.id ?? null,
                  isStaff: false,
                });
              }
              setCommentText('');
            })
          }
        >
          Отправить
        </Button>
      </div>

      {actionError && !panel && (
        <p className={styles.formError} role="alert">
          {actionError}
        </p>
      )}
    </div>
  );

  const actions = hasActions ? (
    <>
      {canReportProblem && (
        <Button variant="secondary" onClick={() => setPanel('report')}>
          Проблема не решена
        </Button>
      )}
      {canDelete && (
        <Button variant="ghost" loading={busy} onClick={handleDelete}>
          Удалить заявку
        </Button>
      )}

      {panel === 'report' && (
        <ActionPanel title="Проблема не решена" error={actionError}>
          <div className={styles.actionForm}>
            <TextArea
              label="Что осталось не решено"
              placeholder="Опишите, что именно не устраивает в результате работ"
              value={reportText}
              onChange={(event) => setReportText(event.target.value)}
              maxLength={4000}
              showCounter
              hint="Создастся новая заявка со ссылкой на эту"
            />
            <div className={styles.actionButtons}>
              <Button
                loading={busy}
                disabled={reportText.trim().length < 10}
                onClick={() =>
                  runAction(async () => {
                    const created = await api.post<{ id: string }>(
                      `/resident/tickets/${ticket.id}/report-problem`,
                      { description: reportText.trim() },
                    );
                    navigate(`/my-requests/${created.id}`);
                  })
                }
              >
                Создать повторную заявку
              </Button>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                Отмена
              </Button>
            </div>
          </div>
        </ActionPanel>
      )}
    </>
  ) : null;

  return (
    <TicketView
      ticket={ticket}
      attachmentsForStaff={false}
      history={history}
      historyLoading={historyLoading}
      historyError={historyError}
      onBack={() => navigate(-1)}
      onOpenParent={(parentId) => navigate(`/my-requests/${parentId}`)}
      composer={composer}
      actions={actions}
    />
  );
}
