import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('PayChat root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && Boolean(import.meta.env && import.meta.env.PROD)) {
  // Offline-first shell: keeps the app usable on low-connectivity networks.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
