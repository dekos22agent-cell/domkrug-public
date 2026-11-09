import { useEffect, useState } from 'react';
import styles from './DemoVideo.module.css';

/**
 * Заглушка вместо видеопотока.
 *
 * Зачем не «чёрный экран»: жителю нужно понимать, что раздел работает и
 * картинка появится, когда подключат камеру. Чёрный прямоугольник выглядит
 * как поломка, а двигающаяся полоса и часы — как «идёт эфир».
 *
 * Честность: поверх всегда написано «ДЕМО», а внизу — что поток не подключён.
 * Никакого притворства, что это реальная камера.
 */
export function DemoVideo({ label }: { label?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = now.toLocaleTimeString('ru-RU', { hour12: false });

  return (
    <div className={styles.frame} role="img" aria-label="Демонстрационный видеопоток">
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.scan} aria-hidden="true" />

      <span className={styles.badge}>ДЕМО</span>
      <span className={styles.clock}>{time}</span>

      <div className={styles.caption}>
        <span className={styles.captionTitle}>{label ?? 'Камера'}</span>
        <span className={styles.captionHint}>Поток не подключён — картинка появится после настройки камеры</span>
      </div>
    </div>
  );
}
