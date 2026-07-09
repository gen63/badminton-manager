import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PWAPrompt } from './components/PWAPrompt';
import { FirebaseSyncMount } from './components/FirebaseSyncMount';
import { FirebaseConfigBanner } from './components/FirebaseConfigBanner';
import { SyncErrorBanner } from './components/SyncErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GlobalNotices } from './components/GlobalNotices';
import { Loader2 } from 'lucide-react';

// Phase 8 / PERF1: ルート別 code splitting でメインバンドルを縮小。
// 起点となる SessionSelectPage / SessionCreate / SessionJoin は直接 import すれば
// 初期表示が速いが、シンプルさを優先して全ページ lazy にする。
const SessionCreate = lazy(() =>
  import('./pages/SessionCreate').then((m) => ({ default: m.SessionCreate })),
);
const SessionSelectPage = lazy(() =>
  import('./pages/SessionSelectPage').then((m) => ({ default: m.SessionSelectPage })),
);
const PlayerSelect = lazy(() =>
  import('./pages/PlayerSelect').then((m) => ({ default: m.PlayerSelect })),
);
const MainPage = lazy(() =>
  import('./pages/MainPage').then((m) => ({ default: m.MainPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const ScoreInputPage = lazy(() =>
  import('./pages/ScoreInputPage').then((m) => ({ default: m.ScoreInputPage })),
);
const AccountingPage = lazy(() =>
  import('./pages/AccountingPage').then((m) => ({ default: m.AccountingPage })),
);
const AccountingCalcPage = lazy(() =>
  import('./pages/AccountingCalcPage').then((m) => ({ default: m.AccountingCalcPage })),
);
const ReservationPage = lazy(() =>
  import('./pages/ReservationPage').then((m) => ({ default: m.ReservationPage })),
);
const SessionJoinPage = lazy(() =>
  import('./pages/SessionJoinPage').then((m) => ({ default: m.SessionJoinPage })),
);

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-muted-foreground" />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename="/badminton-manager">
        <FirebaseSyncMount>
          <FirebaseConfigBanner />
          <SyncErrorBanner />
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<SessionSelectPage />} />
              <Route path="/session/create" element={<SessionCreate />} />
              <Route path="/session/:sessionId" element={<SessionJoinPage />} />
              <Route path="/players" element={<PlayerSelect />} />
              <Route path="/main" element={<MainPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/accounting" element={<AccountingPage />} />
              <Route path="/calc" element={<AccountingCalcPage />} />
              <Route path="/reservation" element={<ReservationPage />} />
              <Route path="/score/:matchId" element={<ScoreInputPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <PWAPrompt />
          <GlobalNotices />
        </FirebaseSyncMount>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
