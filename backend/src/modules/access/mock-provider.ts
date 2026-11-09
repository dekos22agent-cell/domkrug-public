/**
 * Mock-провайдер доступа.
 *
 * Ничего не открывает физически: имитирует задержку устройства и возвращает
 * результат. Нужен по трём причинам:
 *
 *  1. Без реального железа нельзя ни тестировать, ни показывать демо.
 *  2. Контракт провайдера проверяется до покупки оборудования — если модель
 *     данных и экраны работают с mock, вендор меняет только реализацию.
 *  3. Ошибки устройства (недоступно, занято) можно воспроизвести намеренно.
 *
 * ВАЖНО: этот провайдер нельзя включать на реальном доме. Он сообщает
 * «открыто», но дверь остаётся закрытой — житель будет стоять у подъезда.
 */
import type { AccessPointInfo, AccessProvider, OpenResult } from './provider.js';

export class MockAccessProvider implements AccessProvider {
  readonly name = 'mock';

  async open(point: AccessPointInfo): Promise<OpenResult> {
    // Имитация задержки сети до устройства: интерфейс должен уметь ждать
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Устройство может быть недоступно — на реальном железе это обычное дело,
    // поэтому обработку ошибки проверяем уже сейчас, а не после интеграции.
    if (point.provider === 'mock-unavailable') {
      return { ok: false, message: 'Устройство не отвечает. Попробуйте ещё раз.' };
    }

    return {
      ok: true,
      message: point.kind === 'barrier' || point.kind === 'gate' ? 'Шлагбаум открыт' : 'Дверь открыта',
      holdSeconds: 5,
    };
  }

  async getStream(): Promise<null> {
    // У mock-режима нет видео: возвращаем null, а не выдуманную ссылку
    return null;
  }
}
