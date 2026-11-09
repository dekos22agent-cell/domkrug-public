/**
 * Провайдер доступа для вызывной панели Hikvision (проверено на DS-KD9633-E6,
 * прошивка V2.3.9 build 241016).
 *
 * КАК ОТКРЫВАЕТСЯ. У панели есть штатный ISAPI-метод управления реле:
 *
 *   PUT /ISAPI/AccessControl/RemoteControl/door/<N>
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>
 *
 * Успех — HTTP 200 и тело
 *   <ResponseStatus><statusCode>1</statusCode>
 *   <statusString>OK</statusString><subStatusCode>ok</subStatusCode></ResponseStatus>
 *
 * Возможные команды (из /ISAPI/AccessControl/RemoteControl/door/capabilities):
 * `open`, `close`, `alwaysOpen`, `resume`. Мы используем только `open`:
 * `alwaysOpen` оставляет дверь открытой до `resume`, и забытый вызов превращает
 * подъезд в проходной двор.
 *
 * НОМЕР РЕЛЕ берётся из `access_points.provider_ref` (у DS-KD9633 реле два:
 * 1 — замок, 2 — второй замок/калитка). Провайдер один на все точки, поэтому
 * адрес живёт в точке, а не в конфиге.
 *
 * АВТОРИЗАЦИЯ. HTTP Digest (qop=auth, MD5). Пароль панели не годится в URL и
 * не может уйти в query string: считаем хеш и отправляем заголовком. Делаем
 * два запроса — первый без авторизации получает 401 с nonce, второй несёт хеш.
 * Поэтому нужен именно fetch/crypto из Node, без сторонних пакетов.
 *
 * ЧЕГО ПРОВАЙДЕР НЕ ДЕЛАЕТ. Не хранит учётку в коде (только `config.access`),
 * не ретраит открытие (повторное нажатие — это второе открытие, а не повтор
 * команды), не сообщает `holdSeconds` от устройства (панель его не отдаёт —
 * берём из `ACCESS_VENDOR_HOLD_SECONDS`).
 */
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../../config.js';
import type { AccessPointInfo, AccessProvider, OpenResult } from './provider.js';

/** Ответ устройства разбираем как строку: нам нужны только коды. */
function pickTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m?.[1]?.trim() ?? null;
}

function md5(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

interface Challenge {
  realm: string;
  nonce: string;
  qop: string;
  opaque: string | null;
}

/** Разбор `WWW-Authenticate: Digest realm="…", nonce="…", qop="auth"`. */
export function parseDigestChallenge(header: string | null): Challenge | null {
  if (!header || !/^digest\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  const body = header.replace(/^digest\s+/i, '');
  for (const part of body.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const raw = part.slice(eq + 1).trim();
    params[key] = raw.startsWith('"') ? raw.slice(1, raw.endsWith('"') ? -1 : undefined) : raw;
  }
  if (!params['realm'] || !params['nonce']) return null;
  return {
    realm: params['realm'],
    nonce: params['nonce'],
    // qop может быть списком: "auth,auth-int" — берём первый поддерживаемый
    qop: (params['qop'] ?? '').split(',')[0]?.trim() ?? '',
    opaque: params['opaque'] ?? null,
  };
}

/**
 * Заголовок `Authorization: Digest …` для одного запроса.
 *
 * Вынесен в экспорт, чтобы проверять расчёт тестом без сети: ошибка в хеше
 * выглядит как «401 на любой пароль», и без теста её легко спутать с неверной
 * учёткой.
 */
export function buildDigestAuthorization(opts: {
  user: string;
  password: string;
  method: string;
  uri: string;
  challenge: Challenge;
  /** Только для тестов: у реального запроса cnonce случайный. */
  cnonce?: string;
  /** Только для тестов: счётчик повторов nonce. */
  nc?: string;
}): string {
  const { user, password, method, uri, challenge } = opts;
  const ha1 = md5(`${user}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const parts = [
    `username="${user}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
  ];

  if (challenge.qop) {
    const nc = opts.nc ?? '00000001';
    const cnonce = opts.cnonce ?? randomBytes(8).toString('hex');
    const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`);
    parts.push(
      `response="${response}"`,
      `qop=${challenge.qop}`,
      `nc=${nc}`,
      `cnonce="${cnonce}"`,
    );
  } else {
    parts.push(`response="${md5(`${ha1}:${challenge.nonce}:${ha2}`)}"`);
  }

  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

/** `192.168.2.108` → `http://192.168.2.108`; схема и порт допускаются в конфиге. */
function baseUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export class HikvisionAccessProvider implements AccessProvider {
  readonly name = 'hikvision';

  async open(point: AccessPointInfo): Promise<OpenResult> {
    const { host, user, password, timeoutMs, holdSeconds } = config.access;

    if (!host || !user || !password) {
      // Не бросаем исключение: это не сбой устройства, а незаполненный .env.
      // Сообщение попадёт в журнал и в интерфейс как есть.
      return {
        ok: false,
        message: 'Домофон не настроен (нет ACCESS_VENDOR_* в .env). Откройте ключом.',
      };
    }

    const door = Number.parseInt(point.ref ?? '1', 10);
    if (!Number.isInteger(door) || door < 1 || door > 8) {
      return { ok: false, message: 'У точки доступа неверный номер реле (provider_ref).' };
    }

    const url = `${baseUrl(host)}/ISAPI/AccessControl/RemoteControl/door/${door}`;
    const uri = new URL(url).pathname;
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>';

    const send = (authorization?: string) =>
      fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body,
        // Панель не должна держать запрос интерфейса дольше таймаута:
        // житель стоит у двери и не будет ждать 30 секунд.
        signal: AbortSignal.timeout(timeoutMs),
      });

    try {
      let response = await send();

      // Digest: первый заход всегда 401, второй — с хешем
      if (response.status === 401) {
        const challenge = parseDigestChallenge(response.headers.get('www-authenticate'));
        if (!challenge) {
          return {
            ok: false,
            message: 'Домофон требует авторизацию, но не прислал Digest-заголовок.',
          };
        }
        response = await send(
          buildDigestAuthorization({ user, password, method: 'PUT', uri, challenge }),
        );
      }

      const text = await response.text();

      if (response.status === 401 || response.status === 403) {
        // Не «неверный пароль» в интерфейсе: жителю это ничего не объясняет,
        // а оператор увидит причину в журнале (detail: status).
        return { ok: false, message: 'Домофон отклонил команду. Сообщите в управляющую компанию.' };
      }

      if (!response.ok) {
        return { ok: false, message: `Домофон ответил ошибкой (HTTP ${response.status}).` };
      }

      // Тело успешного ответа: <statusCode>1</statusCode><subStatusCode>ok</subStatusCode>
      const statusCode = pickTag(text, 'statusCode');
      const subStatus = pickTag(text, 'subStatusCode');
      if (statusCode !== null && statusCode !== '1') {
        return {
          ok: false,
          message: 'Домофон не открыл: устройство занято или реле отключено.',
        };
      }
      if (subStatus && subStatus !== 'ok') {
        return { ok: false, message: `Домофон не открыл (${subStatus}).` };
      }

      return {
        ok: true,
        message: point.kind === 'barrier' || point.kind === 'gate' ? 'Шлагбаум открыт' : 'Открыто',
        holdSeconds,
      };
    } catch (error) {
      // Сюда попадают таймаут, обрыв сети и DNS: устройство физически недоступно.
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
      throw new Error(`hikvision: устройство недоступно (${reason})`);
    }
  }

  async getStream(): Promise<null> {
    // Видео с панели отдаётся по RTSP/SIP через медиасервер — это отдельная
    // задача этапа 19b, а не свойство провайдера открытия.
    return null;
  }
}
