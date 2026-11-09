/**
 * Выбор фотографий к заявке.
 *
 * Нативное `<input type="file">` показывает «Файл не выбран», даже когда файлы
 * уже выбраны: после выбора мы очищаем его `value`, иначе повторный выбор того
 * же снимка не срабатывает. Из-за этого рядом со списком файлов висела
 * надпись «Файл не выбран» — и было непонятно, приложатся фото или нет.
 *
 * Здесь поле спрятано, а вместо него — кнопка и список выбранных файлов с
 * возможностью убрать. Видно ровно то, что уйдёт с заявкой.
 */
import { useRef } from 'react';
import styles from './PhotoPicker.module.css';

export interface PickedPhoto {
  /** Уникальный ключ: имя + размер + время изменения ловят дубли */
  key: string;
  file: File;
}

export function PhotoPicker({
  label,
  photos,
  onChange,
  max = 5,
  hint,
}: {
  label: string;
  photos: PickedPhoto[];
  onChange: (next: PickedPhoto[]) => void;
  max?: number;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (files: File[]) => {
    // Одинаковые снимки не дублируем: человек часто выбирает файл дважды
    const known = new Set(photos.map((photo) => photo.key));
    // Ключ из имени, размера и времени изменения: так ловим повторный выбор
    // того же файла, который иначе приложился бы дважды
    const fresh: PickedPhoto[] = files
      .map((file) => ({ key: `${file.name}:${file.size}:${file.lastModified}`, file }))
      .filter((photo) => !known.has(photo.key));
    onChange([...photos, ...fresh].slice(0, max));
  };

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        className={styles.input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          // Сбрасываем, чтобы можно было выбрать тот же файл снова
          event.target.value = '';
        }}
      />

      <button
        type="button"
        className={styles.addButton}
        onClick={() => inputRef.current?.click()}
        disabled={photos.length >= max}
      >
        {photos.length === 0 ? label : `Добавить ещё`}
      </button>

      {photos.length > 0 && (
        <ul className={styles.list}>
          {photos.map((photo) => (
            <li key={photo.key} className={styles.item}>
              <span className={styles.name}>{photo.file.name}</span>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Убрать ${photo.file.name}`}
                onClick={() => onChange(photos.filter((item) => item.key !== photo.key))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.hint}>
        {hint ?? 'JPEG, PNG или WebP, до 10 МБ на файл'} · выбрано {photos.length} из {max}
      </p>
    </div>
  );
}
