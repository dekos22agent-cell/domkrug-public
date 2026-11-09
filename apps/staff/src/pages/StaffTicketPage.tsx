/**
 * Карточка заявки глазами сотрудника УК.
 *
 * Здесь живут рабочие действия: назначить, взять в работу, возобновить,
 * закрыть с фотоотчётом, отклонить. Комментарий может быть служебным —
 * житель его не увидит.
 *
 * Правила (по решению владельца, 04.11.2026):
 *   диспетчер  — назначить/переназначить и отклонить;
 *   исполнитель — «Взять в работу» и «Закрыть», плюс переназначить;
 *   админ УК   — всё на любой стадии.
 * Лишние кнопки скрываются, а не блокируются: короткий список читается лучше.
 */
import { useCallback, useEffect, useState } from 'react';
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
import type { StaffMember } from '@shared/types';

type Panel = 'assign' | 'close' | 'reject' | null;

export function StaffTicketPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasPermission, roles } = useAuth();

  const { ticket, loading, error, reload } = useTicket(id, true);
  const {
    items: history,
    loading: historyLoading,
    error: historyError,
    reload: reloadHistory,
  } = useTicketHistory(id, true);

  const [panel, setPanel] = useState<Panel>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [closeFiles, setCloseFiles] = useState<PickedPhoto[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [commentFiles, setCommentFiles] = useState<PickedPhoto[]>([]);

  const canAssign = hasPermission('ticket.assign');
  const canReject = hasPermission('ticket.reject');
  const canClose = hasPermission('ticket.close');
  const canChangeStatus = hasPermission('ticket.status.change');
  const canCommentInternal = hasPermission('ticket.comment.internal');

  // Список исполнителей грузим только когда открыли панель назначения
  useEffect(() => {
    if (panel !== 'assign' || staff.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: StaffMember[] }>('/staff');
        if (!cancelled) setStaff(response.items.filter((member) => member.isActive));
      } catch {
        if (!cancelled) setStaff([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panel, staff.length]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        setPanel(null);
        setCloseNote('');
        setRejectReason('');
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

  if (loading && !ticket) return <CenteredSpinner label="Загружаем заявку" />;

  if (error || !ticket) {
    return (
      <EmptyState
        title="Заявка не найдена"
        description="Возможно, заявка относится к другой УК или ссылка устарела."
        action={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Назад
          </Button>
        }
      />
    );
  }

  const status = ticket.status.code;
  const isTerminal = status === 'closed' || status === 'rejected';
  const isWorkDone = status === 'done';
  const isAssignee = Boolean(user && ticket.assignedTo?.id === user.id);
  const isAdmin = roles.includes('uk_admin');
  const canWork = isAssignee || isAdmin;

  const canShowAssign = canAssign && !isTerminal && !isWorkDone;
  const canShowReject = canReject && !isTerminal && !isWorkDone;
  const canStart = canChangeStatus && status === 'assigned' && canWork;
  const canResume = canChangeStatus && status === 'waiting' && canWork;
  const canShowClose =
    (canClose || isAssignee || isAdmin) && ['in_progress', 'waiting', 'done'].includes(status);

  const hasActions = canShowAssign || canShowReject || canStart || canResume || canShowClose;

  const changeStatus = () =>
    runAction(() => api.post(`/tickets/${ticket.id}/status`, { to: 'in_progress' }));

  const composer = (
    <div className={styles.composer}>
      <TextArea
        label="Добавить комментарий"
        placeholder="Уточнение, вопрос или отметка о ходе работ"
        value={commentText}
        onChange={(event) => setCommentText(event.target.value)}
        maxLength={4000}
      />
      <PhotoPicker label="Приложить фото" photos={commentFiles} onChange={setCommentFiles} />

      <div className={styles.composerRow}>
        {canCommentInternal ? (
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={commentInternal}
              onChange={(event) => setCommentInternal(event.target.checked)}
            />
            Служебный — житель не увидит
          </label>
        ) : (
          <span />
        )}
        <Button
          variant="secondary"
          loading={busy}
          disabled={commentText.trim().length === 0}
          onClick={() =>
            runAction(async () => {
              const created = await api.post<{ id: string }>(`/tickets/${ticket.id}/comments`, {
                body: commentText.trim(),
                isInternal: canCommentInternal ? commentInternal : false,
              });
              const toUpload = commentFiles;
              setCommentFiles([]);
              for (const photo of toUpload) {
                await uploadAttachment(ticket.id, photo.file, {
                  kind: 'comment_file',
                  commentId: created?.id ?? null,
                  isStaff: true,
                });
              }
              setCommentText('');
              setCommentInternal(false);
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
      {canShowAssign && (
        <Button variant="primary" onClick={() => setPanel('assign')}>
          {ticket.assignedTo ? 'Переназначить исполнителя' : 'Назначить исполнителя'}
        </Button>
      )}

      {canStart && (
        <Button loading={busy} onClick={changeStatus}>
          Взять в работу
        </Button>
      )}

      {canResume && (
        <Button loading={busy} onClick={changeStatus}>
          Возобновить работу
        </Button>
      )}

      {canShowClose && (
        <Button variant="secondary" onClick={() => setPanel('close')}>
          Закрыть заявку
        </Button>
      )}

      {canShowReject && (
        <Button variant="danger" onClick={() => setPanel('reject')}>
          Отклонить
        </Button>
      )}

      {panel === 'assign' && (
        <ActionPanel title="Назначение исполнителя" error={actionError}>
          <div className={styles.actionForm}>
            <label className={styles.metaLabel} htmlFor="assignee">
              Кому назначить
            </label>
            <select
              id="assignee"
              className={styles.select}
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">— выберите исполнителя —</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                  {member.position ? ` — ${member.position}` : ''}
                </option>
              ))}
            </select>
            <div className={styles.actionButtons}>
              <Button
                loading={busy}
                disabled={!assigneeId}
                onClick={() =>
                  runAction(() => api.post(`/tickets/${ticket.id}/assign`, { assigneeId }))
                }
              >
                Назначить
              </Button>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                Отмена
              </Button>
            </div>
          </div>
        </ActionPanel>
      )}

      {panel === 'close' && (
        <ActionPanel title="Закрытие заявки" error={actionError}>
          <div className={styles.actionForm}>
            <TextArea
              label="Что именно сделано"
              placeholder="Например: заменил смеситель, проверил соединения, течи нет"
              value={closeNote}
              onChange={(event) => setCloseNote(event.target.value)}
              maxLength={2000}
              showCounter
              hint="Без этого заявку закрыть нельзя"
            />
            <PhotoPicker
              label="Приложить фотоотчёт"
              photos={closeFiles}
              onChange={setCloseFiles}
              hint="Фото того, что сделали: видно результат работ"
            />
            <div className={styles.actionButtons}>
              <Button
                loading={busy}
                disabled={closeNote.trim().length < 5}
                onClick={() =>
                  runAction(async () => {
                    await api.post(`/tickets/${ticket.id}/close`, {
                      resolutionNote: closeNote.trim(),
                    });
                    const toUpload = closeFiles;
                    setCloseFiles([]);
                    for (const photo of toUpload) {
                      await uploadAttachment(ticket.id, photo.file, {
                        kind: 'result_photo',
                        isStaff: true,
                      });
                    }
                  })
                }
              >
                Закрыть заявку
              </Button>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                Отмена
              </Button>
            </div>
          </div>
        </ActionPanel>
      )}

      {panel === 'reject' && (
        <ActionPanel title="Отклонение заявки" error={actionError}>
          <div className={styles.actionForm}>
            <TextArea
              label="Причина отклонения"
              placeholder="Например: не относится к зоне ответственности УК"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              maxLength={1000}
              hint="Житель увидит причину"
            />
            <div className={styles.actionButtons}>
              <Button
                variant="danger"
                loading={busy}
                disabled={rejectReason.trim().length < 3}
                onClick={() =>
                  runAction(() =>
                    api.post(`/tickets/${ticket.id}/reject`, { reason: rejectReason.trim() }),
                  )
                }
              >
                Отклонить заявку
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
      attachmentsForStaff
      history={history}
      historyLoading={historyLoading}
      historyError={historyError}
      onBack={() => navigate(-1)}
      onOpenParent={(parentId) => navigate(`/tickets/${parentId}`)}
      composer={composer}
      actions={actions}
    />
  );
}
