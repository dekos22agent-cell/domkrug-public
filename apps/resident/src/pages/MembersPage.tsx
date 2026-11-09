import { useMemo, useState } from 'react';
import { Button } from '@ui/Button';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { useApartment } from '@shared/apartmentContext';
import { useAccessPoints } from '@shared/useAccess';
import {
  confirmMember,
  createCodeAccess,
  inviteMember,
  revokeMember,
  useMembers,
} from '@shared/useUtilities';
import { formatDateTime, formatPhone } from '@shared/format';
import styles from './MembersPage.module.css';
import pageStyles from './pages.module.css';

/**
 * «Семья и доступ».
 *
 * Два способа выдать доступ:
 *  • код — человек вводит его на экране входа и не оставляет никаких данных;
 *  • телефон — для тех, кому нужен полноценный аккаунт с историей заявок.
 *
 * Права выбираются чекбоксами: какие двери открывать (подъезд, калитка,
 * шлагбаум, ворота, парковка) и, для аккаунта, что ещё разрешено (видео,
 * показания, заявки, начисления). Пресеты «ребёнок/рабочий/гость» убраны:
 * владелец сам решает, что нужно человеку.
 */
const KIND_LABELS: Record<string, string> = {
  entrance_door: 'Подъезд',
  wicket: 'Калитка',
  barrier: 'Шлагбаум',
  gate: 'Ворота',
  parking: 'Парковка',
};

const EXTRA_SCOPES: { scope: string; label: string }[] = [
  { scope: 'video.view', label: 'Видеонаблюдение' },
  { scope: 'meters.submit', label: 'Показания счётчиков' },
  { scope: 'tickets.create', label: 'Заявки в УК' },
  { scope: 'finance.view', label: 'Начисления' },
];

const SCOPES_LABELS: Record<string, string> = {
  'access.open': 'все двери',
  'access.entrance_door': 'подъезд',
  'access.wicket': 'калитка',
  'access.barrier': 'шлагбаум',
  'access.gate': 'ворота',
  'access.parking': 'парковка',
  'video.view': 'видео',
  'meters.submit': 'показания',
  'tickets.create': 'заявки',
  'finance.view': 'начисления',
  'members.manage': 'управление',
};

export function MembersPage() {
  const { active } = useApartment();
  const { items, loading, error, reload } = useMembers(active?.apartmentId);
  const { items: accessPoints } = useAccessPoints();

  const [mode, setMode] = useState<'account' | 'code'>('code');
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [invitedPhone, setInvitedPhone] = useState<string | null>(null);

  // Показываем только точки текущей квартиры: у человека может быть
  // несколько квартир, и чужие двери в этом списке не нужны
  const apartmentPoints = useMemo(
    () => accessPoints.filter((point) => point.apartmentId === active?.apartmentId),
    [accessPoints, active],
  );

  const availableKinds = useMemo(() => {
    const labels = new Map<string, string>();
    for (const point of apartmentPoints) {
      labels.set(point.kind, KIND_LABELS[point.kind] ?? point.kind);
    }
    return [...labels.entries()].map(([kind, label]) => ({ kind, label }));
  }, [apartmentPoints]);

  // null — «выбрано всё, что есть в квартире»; массив — явный выбор владельца
  const [selectedKinds, setSelectedKinds] = useState<string[] | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([
    'video.view',
    'meters.submit',
    'tickets.create',
  ]);

  const effectiveKinds = selectedKinds ?? availableKinds.map((item) => item.kind);
  const accessScopes = effectiveKinds.map((kind) => `access.${kind}`);
  const scopes = mode === 'account' ? [...accessScopes, ...selectedExtras] : accessScopes;

  const toggleKind = (kind: string) => {
    setSelectedKinds(
      effectiveKinds.includes(kind)
        ? effectiveKinds.filter((item) => item !== kind)
        : [...effectiveKinds, kind],
    );
  };

  const toggleExtra = (scope: string) => {
    setSelectedExtras((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const handleSubmit = async () => {
    if (!active) return;
    setBusy(true);
    setNotice(null);
    setIssuedCode(null);
    try {
      // Пресет больше не выбирается: права заданы чекбоксами. 'family'
      // оставляем только как допустимое значение колонки preset в базе.
      const preset = 'family' as const;
      if (mode === 'code') {
        const result = await createCodeAccess({
          apartmentId: active.apartmentId,
          preset,
          scopes,
          label: label || 'Гость',
          expiresAt: expiresAt || undefined,
        });
        setNotice({ ok: result.ok, text: result.message });
        if (result.ok && result.code) {
          setIssuedCode(result.code);
          setLabel('');
          reload();
        }
      } else {
        const result = await inviteMember({
          apartmentId: active.apartmentId,
          phone,
          preset,
          scopes,
          expiresAt: expiresAt || undefined,
        });
        setNotice({ ok: result.ok, text: result.message });
        if (result.ok) {
          setInvitedPhone(formatPhone(phone) || phone);
          setPhone('');
          reload();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  /** Скопировать текст в буфер. Возвращает false, если браузер не дал. */
  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const codeMessage = (code: string, until: string | null) =>
    [
      `Код доступа liviti: ${code}`,
      `${active?.addressText ?? ''}, кв. ${active?.apartmentNumber ?? ''}`,
      until ? `Действует до ${formatDateTime(until)}` : 'Бессрочный',
      // Адрес берём у браузера, а не пишем строкой: при переезде на новый
      // домен текст не должен врать (так и случилось при смене на liviti.ru)
      `Вход: ${window.location.host} → «Войти по коду»`,
    ].join('\n');

  const handleCopyCode = async (code: string) => {
    const ok = await copyText(code);
    setNotice({
      ok,
      text: ok ? 'Код скопирован' : 'Браузер не разрешил копирование — выделите код вручную',
    });
  };

  /**
   * Отправить код в мессенджер или SMS.
   *
   * На телефоне используем системное «Поделиться» — там сразу WhatsApp,
   * Telegram, SMS. Если браузер его не умеет, копируем текст в буфер:
   * человек вставит его в любой мессенджер сам.
   */
  const handleShareCode = async (code: string, until: string | null) => {
    const text = codeMessage(code, until);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Код доступа liviti', text });
        return;
      } catch {
        // человек отменил — ничего не делаем
        return;
      }
    }
    const ok = await copyText(text);
    setNotice({
      ok,
      text: ok ? 'Текст скопирован — вставьте его в мессенджер' : 'Не удалось скопировать',
    });
  };
  const handleRevoke = async (memberId: string) => {
    if (!active) return;
    const result = await revokeMember(active.apartmentId, memberId);
    setNotice({ ok: result.ok, text: result.message });
    if (result.ok) reload();
  };
  const handleConfirm = async (memberId: string) => {
    if (!active) return;
    const result = await confirmMember(active.apartmentId, memberId);
    setNotice({ ok: result.ok, text: result.message });
    if (result.ok) reload();
  };

  if (!active) {
    return (
      <EmptyState
        title="Квартира не привязана"
        description="Чтобы выдавать доступ, нужна подтверждённая привязка к квартире."
      />
    );
  }

  const canSubmit =
    scopes.length > 0 &&
    (mode === 'code' ? label.trim().length > 0 : phone.replace(/\D/g, '').length >= 10);

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Семья и доступ</h1>
          <p className={pageStyles.pageSubtitle}>
            {active.addressText}, кв. {active.apartmentNumber}
          </p>
        </div>
      </div>

      {notice && (
        <p
          className={`${styles.notice} ${notice.ok ? styles.noticeOk : styles.noticeError}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {/* Выданный код показываем один раз и крупно: его диктуют или переписывают */}
      {issuedCode && (
        <section className={styles.codeCard}>
          <h2 className={styles.codeTitle}>Код доступа</h2>
          <p className={styles.codeValue}>{issuedCode}</p>
          <p className={styles.codeHint}>
            Передайте код человеку. Он вводит его на экране входа — без регистрации и
            персональных данных. Код показывается один раз: если потеряли, выпустите новый,
            старый перестанет работать.
          </p>
          <div className={styles.codeActions}>
            <Button variant="secondary" compact onClick={() => void handleCopyCode(issuedCode)}>
              Скопировать
            </Button>
            <Button compact onClick={() => void handleShareCode(issuedCode, null)}>
              Отправить
            </Button>
          </div>
          <Button variant="ghost" compact onClick={() => setIssuedCode(null)}>
            Готово
          </Button>
        </section>
      )}

      {/* Приглашение по телефону: объясняем, что делать дальше — иначе
          владелец ждёт SMS, которого не будет */}
      {invitedPhone && (
        <section className={styles.codeCard}>
          <h2 className={styles.codeTitle}>Что дальше</h2>
          <p className={styles.codeHint}>
            Скажите человеку: установить приложение liviti и зарегистрироваться с номером{' '}
            <strong>{invitedPhone}</strong>. После регистрации он появится в списке — нажмите
            «Подтвердить», и доступ включится.
          </p>
          <p className={styles.codeHint}>
            Автоматически доступ не включается: номер не проверяется SMS-кодом, поэтому последнее
            слово остаётся за вами. SMS приложение не отправляет — у нас нет SMS-шлюза.
          </p>
          <Button variant="ghost" compact onClick={() => setInvitedPhone(null)}>
            Понятно
          </Button>
        </section>
      )}

      {/* ─── Выдать доступ ───────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Выдать доступ</h2>

        <div className={styles.modeSwitch} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'code'}
            className={mode === 'code' ? styles.modeActive : styles.mode}
            onClick={() => setMode('code')}
          >
            По коду
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'account'}
            className={mode === 'account' ? styles.modeActive : styles.mode}
            onClick={() => setMode('account')}
          >
            По телефону
          </button>
        </div>

        {mode === 'code' && (
          <p className={styles.hint}>
            Нужны видео, показания и заявки?{' '}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setMode('account')}
            >
              Пригласите по телефону
            </button>
          </p>
        )}

        <p className={styles.hint}>
          {mode === 'code'
            ? 'Код: человек не регистрируется и не оставляет персональных данных. Отметьте, какие двери ему открывать. Видео, показания и заявки требуют личного кабинета — для них выберите «По телефону».'
            : 'Телефон: полноценный аккаунт, в котором человек сам подаёт заявки и видит историю. SMS не отправляется — человеку нужно установить приложение и зарегистрироваться этим номером.'}
        </p>

        {mode === 'code' ? (
          <label className={styles.field}>
            <span className={styles.label}>Для кого</span>
            <input
              className={styles.input}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Например: Строитель Пётр"
              maxLength={60}
            />
          </label>
        ) : (
          <label className={styles.field}>
            <span className={styles.label}>Телефон</span>
            <input
              className={styles.input}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onBlur={() => setPhone(formatPhone(phone) || phone)}
              placeholder="+7 900 000-00-00"
              inputMode="tel"
            />
          </label>
        )}

        <fieldset className={styles.field}>
          <legend className={styles.label}>Что разрешено</legend>

          {availableKinds.length === 0 ? (
            <p className={styles.fieldHint}>
              В квартире пока нет точек доступа — проверьте привязку или обратитесь в УК.
            </p>
          ) : (
            <div className={styles.checkGrid}>
              {availableKinds.map((item) => (
                <label key={item.kind} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={effectiveKinds.includes(item.kind)}
                    onChange={() => toggleKind(item.kind)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          )}

          {mode === 'account' && (
            <>
              <span className={styles.label} style={{ marginTop: 'var(--space-3)' }}>
                Дополнительно
              </span>
              <div className={styles.checkGrid}>
                {EXTRA_SCOPES.map((item) => (
                  <label key={item.scope} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={selectedExtras.includes(item.scope)}
                      onChange={() => toggleExtra(item.scope)}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </fieldset>

        <label className={styles.field}>
          <span className={styles.label}>Доступ до</span>
          <span className={styles.fieldHint}>
            {expiresAt ? 'По этот день включительно' : 'Не указан — доступ бессрочный'}
          </span>
          <input
            className={styles.input}
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>

        <Button block loading={busy} disabled={!canSubmit} onClick={() => void handleSubmit()}>
          {mode === 'code' ? 'Создать код' : 'Пригласить'}
        </Button>
      </section>

      {/* ─── Кто имеет доступ ────────────────────────────────────────── */}
      <h2 className={styles.sectionTitle}>Кто имеет доступ</h2>

      {loading ? (
        <CenteredSpinner label="Загружаем список" />
      ) : error ? (
        <p className={styles.noticeError} role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>
          Кроме вас доступ ни у кого нет. Владелец квартиры всегда имеет полный доступ.
        </p>
      ) : (
        <div className={styles.list}>
          {items.map((member) => (
            <div key={member.id} className={styles.member}>
              <div className={styles.memberMain}>
                <span className={styles.memberName}>
                  {member.kind === 'code'
                    ? (member.label ?? 'Гость')
                    : (member.fullName ?? formatPhone(member.phone ?? ''))}
                </span>
                <span className={styles.memberMeta}>
                  {member.kind === 'code'
                    ? member.code
                      ? `Код ${member.code}`
                      : `Код ${member.codePrefix ?? '••••'}-… (выпущен до обновления)`
                    : formatPhone(member.phone ?? '')}
                  {' · '}
                  {member.scopes.length > 0
                    ? member.scopes.map((scope) => SCOPES_LABELS[scope] ?? scope).join(', ')
                    : 'нет прав'}
                </span>
                <span className={styles.memberMeta}>
                  {member.status === 'invited'
                    ? member.claimed
                      ? 'Зарегистрировался, ждёт подтверждения'
                      : 'Ждёт регистрации с этого номера'
                    : member.expiresAt
                      ? `Доступ до ${formatDateTime(member.expiresAt)}`
                      : 'Бессрочно'}
                </span>
              </div>

              <div className={styles.memberActions}>
                {member.kind === 'code' && member.status !== 'revoked' && member.code && (
                  <>
                    <Button
                      variant="ghost"
                      compact
                      onClick={() => void handleCopyCode(member.code ?? '')}
                    >
                      Скопировать
                    </Button>
                    <Button
                      variant="ghost"
                      compact
                      onClick={() => void handleShareCode(member.code ?? '', member.expiresAt)}
                    >
                      Отправить
                    </Button>
                  </>
                )}
                {member.status === 'invited' && member.claimed && (
                  <Button variant="secondary" compact onClick={() => void handleConfirm(member.id)}>
                    Подтвердить
                  </Button>
                )}
                {member.status !== 'revoked' && (
                  <Button variant="ghost" compact onClick={() => void handleRevoke(member.id)}>
                    Отозвать
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className={styles.hint} style={{ marginTop: 'var(--space-4)' }}>
        Отозванный доступ действует сразу: человек перестаёт открывать двери и видеть камеры.
        Ответственность за тех, кому выдан код, несёт владелец квартиры.
      </p>
    </div>
  );
}
