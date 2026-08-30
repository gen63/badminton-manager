import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { applyDevModeFromUrl } from './hooks/useDevMode';

// デバッグモード: URLに ?debug を付けると有効
if (window.location.search.includes('debug')) {
  import('eruda').then((eruda) => {
    eruda.default.init();
  });
}

// dev mode: ?dev=<DEV_MODE_CODE> で有効化（localStorageに永続）
applyDevModeFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
