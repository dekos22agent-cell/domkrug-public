/**
 * Гостевой доступ по коду.
 *
 * Один экран, два состояния: ввод кода и, после входа, кнопки открытия.
 * Здесь нет профиля, заявок, счётчиков и привязки квартиры — гостю они
 * не положены, и показывать их значит обещать то, чего нет.
 *
 * Токен храним в localStorage: строитель не должен вводить код каждый
 * раз, когда подошёл к двери.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { Field } from '@ui/Field';
import { Logo } from '@ui/Logo';
import { CenteredSpinner } from '@ui/Spinner';
import { formatDateTime } from '@shared/format';
import styles from './GuestPage.module.css';

const API_BASE = '/api/v1';
const TOKEN_KEY = 'liviti.guestToken';

interface GuestInfo {
  memberId: string;
  addressText: string;
  apartmentNumber: string;
  tenantName: string;
  scopes: string[];
  expiresAt: string | null;
}

interface GuestPoint {
  id: string;
  kind: string;
  name: string;
  instruction: string | null;
  buildingAddress: string;
}

async function guestRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const token = options.token ?? localStorage.getItem(TOKEN_KEY) ?? '';
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response.status === 204) return { ok: true, status: 204 };
    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: { message?: string } })
      | null;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload?.error?.message ?? 'Не удалось выполнить запрос',
      };
    }
    return { ok: true, status: response.status, data: payload as T };
  } catch {
    return { ok: false, status: 0, error: 'Нет связи. Проверьте интернет.' };
  }
}

export function GuestPage() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [guest, setGuest] = useState<GuestInfo | null>(null);
  const [points, setPoints] = useState<GuestPoint[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  // Сообщение об открытии должно исчезать само: иначе «Открыто» висит
  // на экране до следующего нажатия и выглядит как незавершённое действие
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((text: string, ok = true) => {
    setToast({ ok, text });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // Загрузку запускает эффект: setState здесь был бы лишним рендером
  const loadGuest = useCallback(async (activeToken: string) => {
    const me = await guestRequest<{ guest: GuestInfo }>('/guest/me', { token: activeToken });
    if (!me.ok || !me.data) {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setGuest(null);
      setLoading(false);
      if (me.status === 401) setError('Доступ истёк — введите код заново');
      return;
    }
    setGuest(me.data.guest);

    const list = await guestRequest<{ items: GuestPoint[] }>('/guest/points', {
      token: activeToken,
    });
    if (list.ok && list.data) setPoints(list.data.items);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Данные приходят из сети: эффект здесь — синхронизация с внешним API,
    // а не вычисление состояния из пропсов
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (token) void loadGuest(token);
  }, [token, loadGuest]);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    const result = await guestRequest<{ token: string; guest: GuestInfo }>('/guest/login', {
      method: 'POST',
      body: { code },
    });
    setBusy(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? 'Код не подошёл');
      return;
    }

    localStorage.setItem(TOKEN_KEY, result.data.token);
    setToken(result.data.token);
    setGuest(result.data.guest);
    setCode('');
  };

  const handleOpen = async (point: GuestPoint) => {
    setOpeningId(point.id);
    setToast(null);
    const result = await guestRequest<{ message: string }>(`/guest/points/${point.id}/open`, {
      method: 'POST',
      body: {},
    });
    setOpeningId(null);
    if (result.ok && result.data) {
      showToast(result.data.message, true);
    } else {
      showToast(result.error ?? 'Не удалось открыть', false);
    }
  };

  const handleExit = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setGuest(null);
    setPoints([]);
    setToast(null);
  };

  // ─── Ввод кода ───────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className={styles.page}>
        <Card className={styles.card}>
          <div className={styles.brand}>
            <Logo size="lg" />
          </div>
          <p className={styles.subtitle}>Вход по коду доступа</p>

          <Field
            label="Код из приглашения"
            className={styles.codeInput}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && code.length >= 4) void handleLogin();
            }}
            placeholder="XXXX-XXXX"
            autoComplete="one-time-code"
            autoFocus
          />

          {error && <Alert variant="danger">{error}</Alert>}

          <Button
            block
            loading={busy}
            disabled={code.replace(/\W/g, '').length < 4}
            onClick={() => void handleLogin()}
          >
            Войти
          </Button>

          <p className={styles.hint}>
            Код выдаёт собственник квартиры. Регистрация и персональные данные не нужны.
          </p>

          {/* Гость мог открыть эту страницу по ошибке — путь назад должен быть
              очевидным, без кнопки «назад» в браузере */}
          <p className={styles.backLine}>
            <Link to="/login" className={styles.backLink}>
              Войти по телефону или зарегистрироваться
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  // ─── Экран доступа ───────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {loading ? (
        <CenteredSpinner label="Проверяем доступ" />
      ) : (
        <>
          <header className={styles.header}>
            <div>
              <Logo size="sm" />
              <h1 className={styles.title}>Гостевой доступ</h1>
              <p className={styles.address}>
                {guest?.addressText}, кв. {guest?.apartmentNumber}
              </p>
              {guest?.expiresAt && (
                <p className={styles.expiry}>Доступ до {formatDateTime(guest.expiresAt)}</p>
              )}
            </div>
            <Button variant="ghost" compact onClick={handleExit}>
              Выйти
            </Button>
          </header>

          {toast && (
            <Alert variant={toast.ok ? 'success' : 'danger'} className={styles.toast}>
              {toast.text}
            </Alert>
          )}

          <div className={styles.points}>
            {points.map((point) => (
              <button
                key={point.id}
                type="button"
                className={styles.point}
                disabled={openingId !== null}
                onClick={() => void handleOpen(point)}
              >
                <span className={styles.pointName}>{point.name}</span>
                <span className={styles.pointHint}>
                  {point.instruction ?? 'Нажмите, чтобы открыть'}
                </span>
                <span className={styles.pointAction}>
                  {openingId === point.id ? 'Открываем…' : 'Открыть'}
                </span>
              </button>
            ))}
          </div>

          {points.length === 0 && (
            <p className={styles.hint}>К этому коду не привязано ни одной двери.</p>
          )}

          <p className={styles.footer}>
            Доступ выдан собственником квартиры. Если код больше не нужен — попросите его
            отозвать.
          </p>
        </>
      )}
    </div>
  );
}
