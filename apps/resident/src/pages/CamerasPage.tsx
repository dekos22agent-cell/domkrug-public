import { useState } from 'react';
import { Modal } from '@ui/Modal';
import { DemoVideo } from '@ui/DemoVideo';
import { Button } from '@ui/Button';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { useCameras, requestStream } from '@shared/useVideo';
import type { CameraStream, ResidentCamera } from '@shared/types';
import styles from './CamerasPage.module.css';
import pageStyles from './pages.module.css';

/**
 * Экран «Камеры».
 *
 * Житель видит только камеры своих домов: право проверяется на сервере по
 * привязке к квартире, здесь — только отображение.
 *
 * Поток запрашивается в момент открытия и живёт ограниченное время. Поэтому
 * ссылку нельзя сохранить и переслать — что важно, если во дворе камера
 * смотрит и на чужие окна.
 */
export function CamerasPage() {
  const { items, loading, error } = useCameras();

  const [opened, setOpened] = useState<ResidentCamera | null>(null);
  const [stream, setStream] = useState<CameraStream | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);

  const openCamera = async (camera: ResidentCamera) => {
    setOpened(camera);
    setStream(null);
    setStreamLoading(true);
    try {
      setStream(await requestStream(camera.id));
    } finally {
      setStreamLoading(false);
    }
  };


  if (loading) {
    return <CenteredSpinner label="Загружаем камеры" />;
  }

  if (error) {
    return (
      <EmptyState
        title="Не удалось загрузить камеры"
        description={error}
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Повторить
          </Button>
        }
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Камеры</h1>
          <p className={pageStyles.pageSubtitle}>
            Видео с камер вашего дома. Доступ только к тем, что разрешены квартире.
          </p>
        </div>
      </div>


      {items.length === 0 ? (
        <EmptyState
          title="Камер пока нет"
          description="Камеры появятся, когда управляющая компания подключит оборудование к вашему дому."
        />
      ) : (
        <div className={styles.grid}>
          {items.map((camera) => (
            <button
              key={camera.id}
              type="button"
              className={styles.card}
              onClick={() => void openCamera(camera)}
              disabled={!camera.isActive}
            >
              <span className={styles.cardPoster} aria-hidden="true">
                <CameraIcon kind={camera.kind} />
              </span>
              <span className={styles.cardBody}>
                <span className={styles.cardName}>{camera.name}</span>
                <span className={styles.cardMeta}>
                  {camera.buildingAddress}, кв. {camera.apartmentNumber}
                </span>
                <span className={styles.cardStatus}>
                  {camera.isActive
                    ? camera.hasLiveStream
                      ? 'Прямой эфир'
                      : 'Демо-режим'
                    : 'Отключена'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}


      <p className={styles.note}>
        Открытие камеры записывается в журнал: видео — это персональные данные, и доступ к нему
        должен быть виден управляющей компании.
      </p>

      {opened && (
        <Modal onClose={() => setOpened(null)} title={opened.name}>
          {streamLoading ? (
            <CenteredSpinner label="Открываем поток" />
          ) : stream === null ? (
            <p className={styles.note}>Нет доступа к этой камере.</p>
          ) : stream.demo ? (
            <DemoVideo label={opened.name} />
          ) : (
            // Реальный поток: браузер воспроизводит HLS через видеоэлемент,
            // WebRTC потребует отдельного плеера
            <video className={styles.video} src={stream.url ?? undefined} controls autoPlay muted />
          )}
        </Modal>
      )}
    </div>
  );
}

function CameraIcon({ kind }: { kind: ResidentCamera['kind'] }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (kind === 'barrier' || kind === 'parking') {
    return (
      <svg {...common}>
        <path d="M3 17V9l4-3 4 3v8" />
        <path d="M11 9h10v8H11" />
        <path d="M3 17h18" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M3 8h11l3 3v5H3z" />
      <circle cx="8" cy="12" r="2" />
      <path d="M17 11h4v6h-4" />
    </svg>
  );
}
