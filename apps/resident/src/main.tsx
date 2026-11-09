import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@ui/styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Не найден элемент #root в index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker — только в собранном приложении.
//
// В разработке он вреден: кеширует файлы и мешает HMR, а чистка кеша
// превращается в отдельную отладку. Vite подставляет PROD при сборке.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      // Не роняем приложение: без service worker всё работает,
      // просто нет офлайн-оболочки и предложения установки.
      console.warn('[sw] Не удалось зарегистрировать service worker:', error);
    });
  });
}
