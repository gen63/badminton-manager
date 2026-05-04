import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { applyDevModeFromUrl } from './hooks/useDevMode';
import { cleanupLegacyLocalStorage } from './lib/legacyStorageMigration';

// デバッグモード: URLに ?debug を付けると有効
if (window.location.search.includes('debug')) {
  import('eruda').then((eruda) => {
    eruda.default.init();
  });
}

// dev mode: ?dev=1 で有効化（localStorageに永続）
applyDevModeFromUrl();

// Phase 3/4 で廃止した zustand persist キー / オフラインセッションを 1 度だけ掃除
cleanupLegacyLocalStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
