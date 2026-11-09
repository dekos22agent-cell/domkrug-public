/**
 * Звук в звонке из браузера (WebRTC через Asterisk).
 *
 * Как это работает:
 *   1. Сервер отдаёт параметры SIP-регистрации (адрес WebSocket, абонент,
 *      пароль) — только авторизованному жителю, не в JS-бандле.
 *   2. Браузер регистрируется на Asterisk по WSS и получает INVITE, когда
 *      гость нажимает кнопку на панели.
 *   3. Житель нажимает «Ответить и говорить» — только в этот момент
 *      включается микрофон и звук. Сам вызов НЕ принимается автоматически:
 *      микрофон в квартире не должен включаться без согласия человека.
 *
 * Почему отдельный хук, а не готовый компонент: окно звонка уже существует и
 * отвечает за картинку и открытие двери. Здесь только звук, чтобы не ломать
 * то, что работает.
 *
 * Про звук в картинке: видео с панели идёт отдельным потоком и намеренно
 * остаётся БЕЗ звука. Иначе голос шёл бы дважды — из видео и из звонка — и
 * получалось бы эхо. Голос живёт только в звонке.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Invitation, Registerer, Session, SessionState as SessionStateEnum, UserAgent } from 'sip.js';
import { api } from './api';

interface SipCredentials {
  enabled: boolean;
  wss: string;
  user: string;
  password: string | null;
  realm: string;
}

export interface SipAudio {
  /** Есть ли регистрация на сервере телефонии. */
  ready: boolean;
  /** Пришёл входящий вызов — можно отвечать. */
  incoming: boolean;
  /** Разговор идёт: микрофон и динамик работают. */
  talking: boolean;
  /** Понятный человеку текст ошибки (микрофон, сеть, сервер). */
  error: string | null;
  /** Ответить: включает микрофон и звук. Требует нажатия пользователя. */
  answer: () => void;
  /** Завершить разговор (и отклонить входящий). */
  hangup: () => void;
}

export function useSipAudio(): SipAudio & { audioRef: React.RefObject<HTMLAudioElement | null> } {
  const [ready, setReady] = useState(false);
  const [incoming, setIncoming] = useState(false);
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uaRef = useRef<UserAgent | null>(null);
  /** Состояния сессии из динамически загруженного модуля. */
  const sessionStateRef = useRef<typeof SessionStateEnum | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<Session | null>(null);
  /** Входящий вызов, который ещё не принят. */
  const inviteRef = useRef<Invitation | null>(null);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      let credentials: SipCredentials;
      try {
        credentials = await api.get<SipCredentials>('/resident/video/sip');
      } catch {
        // Телефония не настроена — это не ошибка экрана: видео и дверь
        // продолжают работать.
        return;
      }

      if (cancelled) return;
      if (!credentials.enabled || !credentials.password) {
        return;
      }

      /*
       * sip.js весит больше двухсот килобайт. Грузим его только когда жителю
       * действительно нужен звук: остальным он замедлил бы первую загрузку.
       */
      const sip = await import('sip.js');
      const { UserAgent, Registerer, SessionState } = sip;
      sessionStateRef.current = SessionState;

      const uri = UserAgent.makeURI(`sip:${credentials.user}@${credentials.realm}`);
      if (!uri) {
        setError('Не удалось собрать адрес абонента телефонии');
        return;
      }

      const ua = new UserAgent({
        uri,
        displayName: 'Житель',
        authorizationUsername: credentials.user,
        authorizationPassword: credentials.password,
        transportOptions: { server: credentials.wss },
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: {
            // STUN помогает, когда житель за своим роутером: без него браузер
            // может не найти путь до сервера.
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          },
        },
        delegate: {
          onInvite: (invitation: Invitation) => {
            // Пришёл звонок с панели. Микрофон пока не включаем: разрешение
            // спросим при нажатии «Ответить».
            inviteRef.current = invitation;
            sessionRef.current = invitation;
            setIncoming(true);
            setError(null);

            invitation.stateChange.addListener((state) => {
              if (state === sessionStateRef.current?.Terminated) {
                setIncoming(false);
                setTalking(false);
                inviteRef.current = null;
                sessionRef.current = null;
              }
            });
          },
        },
      });

      try {
        await ua.start();
        const registerer = new Registerer(ua);
        await registerer.register();
        if (cancelled) return;

        uaRef.current = ua;
        registererRef.current = registerer;
        setReady(true);
        setError(null);
      } catch {
        setError('Не удалось подключиться к серверу телефонии');
      }
    };

    void setup();

    return () => {
      cancelled = true;
      void registererRef.current?.unregister().catch(() => undefined);
      void uaRef.current?.stop().catch(() => undefined);
      uaRef.current = null;
      registererRef.current = null;
      sessionRef.current = null;
      inviteRef.current = null;
    };
  }, []);

  const answer = useCallback(() => {
    const invitation = inviteRef.current;
    if (!invitation) return;

    setError(null);

    // Микрофон запрашиваем здесь: браузер разрешает getUserMedia только по
    // действию пользователя, иначе запрос отклоняется без окна.
    invitation
      .accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      })
      .then(() => {
        setIncoming(false);
        setTalking(true);

        invitation.stateChange.addListener((state) => {
          if (state === sessionStateRef.current?.Established) {
            // Подключаем звук к <audio> в окне звонка.
            const handler = invitation.sessionDescriptionHandler as unknown as {
              peerConnection?: RTCPeerConnection;
            };
            const track = handler.peerConnection
              ?.getReceivers()
              .find((receiver) => receiver.track?.kind === 'audio')?.track;
            if (audioRef.current && track) {
              audioRef.current.srcObject = new MediaStream([track]);
              // Политика автозапуска может не дать играть сразу — тогда
              // человек нажмёт «Ответить и говорить» ещё раз, и звук пойдёт.
              void audioRef.current.play().catch(() => {
                setError('Нажмите «Ответить и говорить», чтобы слышать собеседника');
              });
            }
          }
          if (state === sessionStateRef.current?.Terminated) {
            setTalking(false);
            setIncoming(false);
            inviteRef.current = null;
            sessionRef.current = null;
          }
        });
      })
      .catch((cause: unknown) => {
        // Самая частая причина — запрещённый микрофон.
        const name = (cause as { name?: string })?.name ?? '';
        setError(
          name === 'NotAllowedError'
            ? 'Браузер не дал доступ к микрофону. Разрешите его в настройках сайта и попробуйте снова.'
            : 'Не удалось ответить на звонок. Попробуйте ещё раз.',
        );
      });
  }, []);

  const hangup = useCallback(() => {
    const session = sessionRef.current;
    const invitation = inviteRef.current;

    if (invitation) {
      // Не приняли — отклоняем.
      void invitation.reject().catch(() => undefined);
      inviteRef.current = null;
      sessionRef.current = null;
      setIncoming(false);
      return;
    }

    if (session) {
      void session.bye().catch(() => undefined);
      setTalking(false);
    }
  }, []);

  return { ready, incoming, talking, error, answer, hangup, audioRef };
}
