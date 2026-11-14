import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@client/App';
import '@client/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root tidak ditemukan');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
