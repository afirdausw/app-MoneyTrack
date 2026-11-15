import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@client/App';
import '@client/index.css';
import { initTheme } from '@client/lib/theme';

// Terapkan tema sebelum render pertama agar tidak berkedip terang.
initTheme();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root tidak ditemukan');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Service worker hanya di build produksi (di dev, Vite HMR tidak boleh ikut ter-cache).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('[pwa] gagal mendaftarkan service worker:', err);
    });
  });
}
