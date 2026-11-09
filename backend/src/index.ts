/**
 * Точка входа: запуск HTTP-сервера и корректное завершение.
 *
 * Graceful shutdown важен: если убить процесс посреди запроса к БД,
 * можно оставить незакрытую транзакцию.
 */
import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool, pingDatabase } from './db/pool.js';

async function main(): Promise<void> {
  const app = await buildApp();

  // Проверяем БД на старте: лучше упасть сразу с понятным сообщением,
  // чем принимать запросы и отдавать 500 на каждый.
  const dbReady = await pingDatabase();
  if (!dbReady) {
    app.log.error(
      'Не удалось подключиться к PostgreSQL. Проверьте DATABASE_URL и что база запущена: docker compose up -d postgres',
    );
    process.exitCode = 1;
    await app.close();
    return;
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      `ДомКруг API запущен: http://${config.host}:${config.port} (${config.env})`,
    );
    app.log.info(`Проверка живости: http://${config.host}:${config.port}/health`);

    // Работа по HTTP в production — вынужденный режим для пилота на голом IP.
    // Токены и cookie идут в открытом виде, это нужно проговорить в логе.
    if (config.insecureHttpInProduction) {
      app.log.warn(
        'HTTPS ОТКЛЮЧЁН (COOKIE_SECURE=false): токены передаются в открытом виде. ' +
          'Допустимо только для пилота с тестовыми данными до подключения домена.',
      );
    }

    // Громкое предупреждение: режим разработки ослабляет защиту.
    // Если такой сервер окажется доступен по сети, это станет дырой,
    // поэтому пишем явно, а не надеемся, что кто-то помнит про NODE_ENV.
    if (!config.isProduction) {
      app.log.warn(
        'РЕЖИМ РАЗРАБОТКИ: лимиты запросов увеличены, CORS разрешён только localhost. ' +
          'Для боевого запуска обязательно NODE_ENV=production.',
      );
    }
  } catch (err) {
    app.log.error({ err }, 'Не удалось запустить сервер');
    process.exitCode = 1;
    await app.close();
    return;
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Получен ${signal}, останавливаемся...`);
    try {
      await app.close();
      await closePool();
      app.log.info('Остановлено корректно.');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Ошибка при остановке');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
