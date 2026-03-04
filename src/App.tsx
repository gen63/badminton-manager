import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionCreate } from './pages/SessionCreate';
import { PlayerSelect } from './pages/PlayerSelect';
import { MainPage } from './pages/MainPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ScoreInputPage } from './pages/ScoreInputPage';
import { AccountingPage } from './pages/AccountingPage';
import { PWAPrompt } from './components/PWAPrompt';

function App() {
  return (
    <BrowserRouter basename="/badminton-manager">
      <Routes>
        <Route path="/" element={<SessionCreate />} />
        <Route path="/players" element={<PlayerSelect />} />
        <Route path="/main" element={<MainPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/accounting" element={<AccountingPage />} />
        <Route path="/score/:matchId" element={<ScoreInputPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PWAPrompt />
    </BrowserRouter>
  );
}

export default App;
