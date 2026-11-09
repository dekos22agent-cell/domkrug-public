/**
 * Колокольчик уведомлений.
 *
 * Зачем: житель должен узнать об ответе УК, не заходя в заявку наугад.
 * Счётчик показывает, сколько непрочитанных, клик по строке ведёт прямо
 * в заявку.
 *
 * Доступность: это кнопка с понятным текстом для скринридера
 * («Уведомления, 3 непрочитанных»), закрывается по Escape и по клику вне панели.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/authContext';
import { formatRelative } from '@shared/format';
import { useUpdates } from '@shared/updatesContext';
import type { NotificationItem } from '@shared/types';
import styles from './NotificationBell.module.css';

/** Куда ведёт уведомление: у жителя и у сотрудника разные маршруты заявки. */
function pathFor(item: NotificationItem, staffRoute: boolean): string | null {
  if (item.entityType === 'ticket' && item.entityId) {
    return staffRoute ? `/tickets/${item.entityId}` : `/my-requests/${item.entityId}`;
  }
  if (item.entityType === 'resident_binding') return '/binding';
  if (item.entityType === 'news') return '/news';
  return null;
}

export function NotificationBell({
  placement = 'bottom-end',
}: {
  placement?: 'bottom-end' | 'top-start';
} = {}) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { notifications, unread, loading, markRead, markAllRead } = useUpdates();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const staffRoute = hasPermission('ticket.view.all') || hasPermission('ticket.view.assigned');

  // Закрытие по клику вне и по Escape — иначе панель «залипает» поверх страницы
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handlePick = (item: NotificationItem) => {
    if (!item.readAt) void markRead(item.id);
    const path = pathFor(item, staffRoute);
    setOpen(false);
    if (path) navigate(path);
  };

  const label =
    unread > 0 ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления, новых нет';

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={[styles.button, unread > 0 ? styles.buttonActive : ''].filter(Boolean).join(' ')}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        {/* Колокольчик — встроенный SVG: не тянем иконный шрифт ради одной
            иконки, и она наследует цвет текста */}
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
          <path d="M10.3 20a2 2 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div
          className={[styles.panel, placement === 'top-start' ? styles.panelTop : '']
            .filter(Boolean)
            .join(' ')}
          role="dialog"
          aria-label="Уведомления"
        >
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Уведомления</span>
            {unread > 0 && (
              <button type="button" className={styles.linkButton} onClick={() => void markAllRead()}>
                Прочитать все
              </button>
            )}
          </div>

          {loading && notifications.length === 0 ? (
            <p className={styles.empty}>Загружаем…</p>
          ) : notifications.length === 0 ? (
            <p className={styles.empty}>Новых уведомлений нет</p>
          ) : (
            <ul className={styles.list}>
              {notifications.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => handlePick(item)}
                  >
                    <span className={styles.itemTitle}>{item.title}</span>
                    {item.body && <span className={styles.itemBody}>{item.body}</span>}
                    <span className={styles.itemTime}>{formatRelative(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!staffRoute && (
            <div className={styles.panelFoot}>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setOpen(false);
                  navigate('/notifications');
                }}
              >
                Все уведомления
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
