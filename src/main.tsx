import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// デバッグモード: URLに ?debug を付けると有効
if (window.location.search.includes('debug')) {
  import('eruda').then((eruda) => {
    eruda.default.init();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
