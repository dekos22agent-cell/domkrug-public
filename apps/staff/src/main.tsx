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
