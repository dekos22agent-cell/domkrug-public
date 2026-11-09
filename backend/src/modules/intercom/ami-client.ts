/**
 * Клиент Asterisk Manager Interface (AMI).
 *
 * Зачем именно AMI: это единственный способ узнать о входящем вызове. Событие
 * нажатия кнопки вызова у панели Hikvision по HTTP не отдаётся (проверено,
 * docs/INTERCOM-HIKVISION.md раздел 3), а Asterisk видит вызов всегда и умеет
 * рассказать о нём по TCP на 127.0.0.1:5038.
 *
 * Почему свой клиент, а не пакет: протокол — построчный текст, а зависимость
 * пришлось бы тащить в прод ради двух действий (Login и чтение событий).
 *
 * Чего здесь намеренно нет:
 *  - переподключения «в цикле без паузы» (пауза растёт до минуты);
 *  - логирования пароля и содержимого пакетов;
 *  - отправки каких-либо команд, кроме Login: бэкенду слушать достаточно.
 */
import { Socket } from 'node:net';
import { drainEvents, type AmiEvent } from './ami-parser.js';

export interface AmiOptions {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface AmiLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/** Пауза перед переподключением: 5, 10, 20, 40, 60 секунд и далее. */
const RECONNECT_STEPS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

export class AmiClient {
  private socket: Socket | null = null;
  private buffer = '';
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Когда последний раз приходили данные — для сторожа соединения. */
  private lastDataAt = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly options: AmiOptions,
    private readonly log: AmiLogger,
    private readonly onEvent: (event: AmiEvent) => void,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /**
   * Отправить команду в Asterisk.
   *
   * Используется для сброса вызова (Hangup), когда житель открыл дверь или
   * отклонил звонок. Возвращает false, если соединения нет: тогда команда
   * просто теряется, но приложение не падает.
   */
  send(command: string): boolean {
    if (!this.socket || this.socket.destroyed) return false;

    const payload = command.endsWith('\r\n\r\n') ? command : `${command}\r\n\r\n`;
    this.socket.write(payload);
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;

    const socket = new Socket();
    this.socket = socket;
    this.buffer = '';
    this.lastDataAt = Date.now();

    socket.setKeepAlive(true, 30_000);
    // ВАЖНО: не ставим socket.setTimeout как «таймаут простоя». AMI штатно
    // молчит между звонками, и таймаут убивал живое соединение каждые две
    // минуты. В эти секунды звонок с панели терялся (поймано на стенде
    // 06.11: в журнале «соединение молчит 2 минуты» раз в две минуты).
    // Вместо этого — активный опрос Ping и сторож по факту данных.

    socket.connect(this.options.port, this.options.host, () => {
      this.attempt = 0;
      // Events: on — подписка на события; без неё придут только ответы.
      socket.write(
        'Action: Login\r\n' +
          `Username: ${this.options.user}\r\n` +
          `Secret: ${this.options.password}\r\n` +
          'Events: on\r\n\r\n',
      );
      this.log.info(`[ami] подключились к ${this.options.host}:${this.options.port}`);

      // Опрос Ping каждые 30 секунд: держит соединение живым и даёт признак
      // жизни. Сторож ниже рвёт связь, только если данных нет 90 секунд —
      // то есть три пропущенных ответа подряд, а не штатное молчание.
      this.keepAliveTimer = setInterval(() => {
        if (!this.socket || this.socket.destroyed) return;

        if (Date.now() - this.lastDataAt > 90_000) {
          this.log.warn('[ami] 90 секунд без ответа, переподключаюсь');
          this.socket.destroy();
          return;
        }

        this.socket.write('Action: Ping\r\n\r\n');
      }, 30_000);
    });

    socket.on('data', (chunk: Buffer) => {
      this.lastDataAt = Date.now();
      this.buffer += chunk.toString('utf8');
      const { events, rest } = drainEvents(this.buffer);
      this.buffer = rest;
      for (const event of events) {
        // Ответ на Login («Response: Success») тоже приходит событием-блоком,
        // но без поля Event — парсер его уже отбросил.
        this.onEvent(event);
      }
    });

    socket.on('error', (error: Error) => {
      // Частая и ожидаемая ситуация, пока Asterisk не настроен: не шумим
      // стеком, а пишем одну строку.
      this.log.warn(`[ami] ошибка соединения: ${error.message}`);
    });

    socket.on('close', () => {
      this.socket = null;
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      if (this.stopped) return;

      const delay = RECONNECT_STEPS_MS[Math.min(this.attempt, RECONNECT_STEPS_MS.length - 1)]!;
      this.attempt += 1;
      this.log.warn(`[ami] соединение закрыто, повтор через ${Math.round(delay / 1000)} с`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }
}
