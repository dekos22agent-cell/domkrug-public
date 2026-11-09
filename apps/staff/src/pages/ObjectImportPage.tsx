import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { CenteredSpinner } from '@ui/Spinner';
import { TextArea } from '@ui/TextArea';
import { ApiError } from '@shared/api';
import {
  importApartmentRows,
  useBuildingPassport,
  type ImportApartmentRow,
} from '@shared/useStructure';
import { ObjectTabs } from './ObjectTabs';
import pageStyles from './pages.module.css';
import styles from './ObjectImportPage.module.css';

const TEMPLATE = `number,kind,rooms,area
1,apartment,2,54.2
2,apartment,1,38.0
10,office,2,72.5
12,parking,0,18.0`;

const KIND_ALIASES: Record<string, ImportApartmentRow['kind']> = {
  apartment: 'apartment',
  квартира: 'apartment',
  nonresidential: 'nonresidential',
  нежилое: 'nonresidential',
  house: 'house',
  дом: 'house',
  office: 'office',
  офис: 'office',
  retail: 'retail',
  магазин: 'retail',
  parking: 'parking',
  паркинг: 'parking',
  storage: 'storage',
  кладовая: 'storage',
};

function splitCsvLine(line: string): string[] {
  return line.split(/[;,]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

function parseCsv(text: string): { rows: ImportApartmentRow[]; errors: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], errors: ['Файл пустой'] };

  const first = splitCsvLine(lines[0] ?? '').map((cell) => cell.toLowerCase());
  const hasHeader = ['number', 'номер'].includes(first[0] ?? '');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: ImportApartmentRow[] = [];
  const errors: string[] = [];

  dataLines.forEach((line, index) => {
    const lineNumber = index + (hasHeader ? 2 : 1);
    const cells = splitCsvLine(line);
    const number = cells[0] ?? '';
    if (!number) {
      errors.push(`Строка ${lineNumber}: не указан номер помещения`);
      return;
    }
    const kindCell = (cells[1] ?? 'apartment').toLowerCase();
    const kind = KIND_ALIASES[kindCell];
    if (!kind) {
      errors.push(`Строка ${lineNumber}: неизвестный тип «${cells[1] ?? ''}»`);
      return;
    }
    const roomsRaw = cells[2] ?? '';
    const rooms = roomsRaw === '' ? null : Number(roomsRaw);
    if (rooms !== null && (!Number.isInteger(rooms) || rooms < 0 || rooms > 20)) {
      errors.push(`Строка ${lineNumber}: комнатность должна быть 0–20`);
      return;
    }
    const areaRaw = (cells[3] ?? '').replace(',', '.');
    const area = areaRaw === '' ? null : Number(areaRaw);
    if (area !== null && (!Number.isFinite(area) || area <= 0)) {
      errors.push(`Строка ${lineNumber}: площадь должна быть больше нуля`);
      return;
    }
    rows.push({ number, kind, rooms, areaTotal: area });
  });

  return { rows, errors };
}

/** Импорт помещений из CSV: предпросмотр и явные ошибки по строкам. */
export function ObjectImportPage() {
  const { id } = useParams<{ id: string }>();
  const object = useBuildingPassport(id ?? null);
  const [text, setText] = useState(TEMPLATE);
  const [parsed, setParsed] = useState<{ rows: ImportApartmentRow[]; errors: string[] } | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setText(await file.text());
      setParsed(null);
    } catch {
      setError('Не удалось прочитать файл');
    }
  };

  const handleParse = () => {
    setResult(null);
    setError(null);
    setParsed(parseCsv(text));
  };

  const handleImport = async () => {
    if (!id || !parsed || parsed.errors.length > 0 || parsed.rows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const response = await importApartmentRows(id, parsed.rows);
      setResult(response);
      setParsed(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось импортировать помещения');
    } finally {
      setImporting(false);
    }
  };

  if (object.loading) return <CenteredSpinner label="Загружаем объект" />;
  if (object.error || !object.data) {
    return (
      <div className={styles.page}>
        <Link to="/objects" className={styles.back}>
          ← Объекты
        </Link>
        <Alert variant="danger">{object.error ?? 'Объект не найден'}</Alert>
      </div>
    );
  }

  const building = object.data.building;

  return (
    <div className={styles.page}>
      <Link to={`/objects/${id}/units`} className={styles.back}>
        ← Помещения
      </Link>

      <div className={styles.kicker}>
        <Badge variant="info">{building.objectKind === 'apartment_building' ? 'МКД' : 'Объект'}</Badge>
        <span>{building.addressText}</span>
      </div>
      <h1 className={pageStyles.pageTitle}>Импорт помещений</h1>
      <p className={pageStyles.pageSubtitle}>
        CSV с колонками <code>number, kind, rooms, area</code>. Дубли по номеру
        пропускаются — существующие помещения не перезаписываются.
      </p>

      <ObjectTabs objectId={id ?? ''} active="units" />

      <div className={styles.panel}>
        <label className={styles.fileButton}>
          Выбрать CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>

        <TextArea
          label="Или вставьте CSV"
          rows={10}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setParsed(null);
            setResult(null);
          }}
        />

        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleParse}>
            Проверить
          </Button>
          <Button
            loading={importing}
            disabled={!parsed || parsed.errors.length > 0 || parsed.rows.length === 0}
            onClick={() => void handleImport()}
          >
            Импортировать
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {result && (
        <Alert variant="success" className={styles.notice}>
          Импорт завершён: добавлено {result.created}, пропущено {result.skipped}.
          <Link className={styles.resultLink} to={`/objects/${id}/units`}>
            Открыть помещения
          </Link>
        </Alert>
      )}

      {parsed && (
        <div className={styles.panel}>
          <h2 className={styles.previewTitle}>Предпросмотр</h2>
          {parsed.errors.length > 0 && (
            <Alert variant="danger">
              <ul className={styles.errors}>
                {parsed.errors.slice(0, 12).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          )}
          {parsed.rows.length > 0 && (
            <>
              <p className={styles.summary}>Строк к импорту: {parsed.rows.length}</p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Тип</th>
                      <th>Комнат</th>
                      <th>Площадь</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 50).map((row) => (
                      <tr key={`${row.number}-${row.kind}`}>
                        <td>{row.number}</td>
                        <td>{row.kind}</td>
                        <td>{row.rooms ?? '—'}</td>
                        <td>{row.areaTotal ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
