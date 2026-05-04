import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionCreate } from './pages/SessionCreate';
import { SessionSelectPage } from './pages/SessionSelectPage';
import { PlayerSelect } from './pages/PlayerSelect';
import { MainPage } from './pages/MainPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ScoreInputPage } from './pages/ScoreInputPage';
import { AccountingPage } from './pages/AccountingPage';
import { AccountingCalcPage } from './pages/AccountingCalcPage';
import { ReservationPage } from './pages/ReservationPage';
import { SessionJoinPage } from './pages/SessionJoinPage';
import { PWAPrompt } from './components/PWAPrompt';
import { FirebaseSyncMount } from './components/FirebaseSyncMount';
import { FirebaseConfigBanner } from './components/FirebaseConfigBanner';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename="/badminton-manager">
        <FirebaseSyncMount>
          <FirebaseConfigBanner />
          <Routes>
            <Route path="/" element={<SessionSelectPage />} />
            <Route path="/local" element={<SessionCreate />} />
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
          <PWAPrompt />
        </FirebaseSyncMount>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
